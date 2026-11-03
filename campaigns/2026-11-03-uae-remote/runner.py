#!/usr/bin/env python3
"""FreeHire candidate campaign. Uses the real account MCP to persist applications.

Requires an OAuth grant obtained through FreeHire's normal user-authorized
connection; ordinary API keys CANNOT call auto_apply_* tools.
Default is a non-mutating preview. Designed for repeated, one-step-at-a-time
runs rather than sleeping for half an hour with a fragile session.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from eligibility import eligibility

API = "https://freehire.me/api/v1"
SCRIPT_DIR = Path(__file__).resolve().parent
STATE = Path.home() / ".local/state/freehire/apply-campaign-20261103.json"


class FreeHireError(RuntimeError):
    pass


def utcday():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def now():
    return time.time()


def load_state(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {"utc_day": utcday(), "starts_today": 0, "last_action_at": 0}


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(path)


def unpack_http_response(resp):
    body = resp.read().decode("utf-8")
    if not body.strip():
        return {}
    content_type = resp.headers.get("Content-Type", "")
    if "text/event-stream" in content_type:
        messages = []
        for line in body.splitlines():
            if line.startswith("data: "):
                try:
                    messages.append(json.loads(line[6:]))
                except ValueError:
                    pass
        return messages[-1] if messages else {}
    return json.loads(body)


def request_json(url, token=None, payload=None, method=None, extra_headers=None):
    headers = {"Accept":"application/json, text/event-stream", "User-Agent":"freehire-candidate-campaign/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra_headers:
        headers.update(extra_headers)
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method or ("POST" if data else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return unpack_http_response(resp), resp.headers
    except urllib.error.HTTPError as e:
        # Do not print tokens or body containing private candidate information.
        if e.code == 429:
            raise FreeHireError("FreeHire rate-limited this request (429); stop and honor Retry-After: " + e.headers.get("Retry-After", "unknown")) from None
        if e.code in (401,403):
            raise FreeHireError("FreeHire authentication or permissions refused (HTTP %d). Check OAuth grant and 'Let connected agents apply for me'." % e.code) from None
        raise FreeHireError("FreeHire returned HTTP %d for %s" % (e.code, urllib.parse.urlsplit(url).path)) from None


class MCP:
    def __init__(self, token, base=API):
        self.token = token
        self.url = base.rstrip("/") + "/mcp/account"
        self.session = None
        self.seq = 0
        self.initialized = False

    def rpc(self, method, params, notification=False):
        self.seq += 1
        payload = {"jsonrpc":"2.0", "method":method}
        if not notification:
            payload["id"] = self.seq
        if params is not None:
            payload["params"] = params
        headers = {"MCP-Protocol-Version":"2025-06-18"}
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        result, hdrs = request_json(self.url, self.token, payload, extra_headers=headers)
        if hdrs.get("Mcp-Session-Id"):
            self.session = hdrs["Mcp-Session-Id"]
        if result.get("error"):
            raise FreeHireError("FreeHire MCP error: " + str(result["error"].get("message", "unknown")))
        return result.get("result", {})

    def initialize(self):
        if self.initialized:
            return
        self.rpc("initialize", {"protocolVersion":"2025-06-18", "capabilities":{}, "clientInfo":{"name":"freehire-candidate-campaign", "version":"1.0"}})
        self.rpc("notifications/initialized", None, notification=True)
        self.initialized = True

    def tool(self, name, **args):
        self.initialize()
        value = self.rpc("tools/call", {"name":name, "arguments":args})
        if value.get("isError"):
            raise FreeHireError("FreeHire tool %s refused the action: %s" % (name, "; ".join(str(x.get("text", "error")) for x in value.get("content", []))))
        if "structuredContent" in value:
            return value["structuredContent"]
        for item in value.get("content", []):
            if item.get("type") == "text":
                try:
                    return json.loads(item["text"])
                except ValueError:
                    return {"text": item["text"]}
        return value


def fetch_candidates(policy, token=None, max_pages=None):
    """Catalog search is public. All application writes still require OAuth."""
    # Use multiple searches so a remote vacancy marked only 'UAE' or 'EMEA'
    # is not silently missed by one geographic facet.
    skills = ",".join(policy["core_skills"])
    specs = [
        {"work_mode":"remote", "regions":"global,mena", "skills":skills},
        {"work_mode":"remote", "countries":"ae", "skills":skills},
        {"work_mode":"remote", "q":"EMEA", "skills":skills},
        {"work_mode":"onsite,hybrid", "countries":"ae", "skills":skills},
    ]
    seen = set()
    pages = min(policy["max_pages_per_search"], max_pages or policy["max_pages_per_search"])
    for spec in specs:
        for page in range(pages):
            query = {**spec, "limit":str(policy["page_size"]), "offset":str(page * policy["page_size"])}
            res, _ = request_json(API + "/jobs/search?" + urllib.parse.urlencode(query), token=token)
            items = res.get("data", [])
            if not isinstance(items, list):
                raise FreeHireError("Unexpected jobs/search response")
            for job in items:
                slug = job.get("public_slug")
                if slug and slug not in seen:
                    seen.add(slug)
                    allowed, why = eligibility(job, policy)
                    if allowed:
                        yield job
            if len(items) < policy["page_size"]:
                break
            if (page+1) * policy["page_size"] >= 10000:
                break  # server's documented deep-pagination bound


def deterministic_match(token, slug):
    url = API + "/jobs/" + urllib.parse.quote(slug, safe="") + "/match"
    data, _ = request_json(url, token=token)
    value = data.get("data", {})
    return int(value.get("coverage_percent", 0))


def within_limit(state, policy):
    if state.get("utc_day") != utcday():
        state.update({"utc_day":utcday(), "starts_today":0})
    if now() - state.get("last_action_at", 0) < policy["min_seconds_between_starts"]:
        return False, "minimum spacing not yet elapsed"
    return True, "ready"


def act_once(mcp, state, policy, state_path):
    """At most one durable action per run; server's event ledger is authoritative."""
    allowed, reason = within_limit(state, policy)
    if not allowed:
        return {"status":"rate_delayed", "detail":reason}
    existing = mcp.tool("auto_apply_list").get("attempts", [])
    if policy.get("auto_approve_ready_attempts"):
        for attempt in existing:
            if attempt.get("status") != "pending_review":
                continue
            info = mcp.tool("auto_apply_get", job_slug=attempt["job_slug"])
            if info.get("status") != "pending_review":
                continue
            if info.get("pending_answers") or info.get("open_questions") or info.get("may_have_reached_employer"):
                continue
            if not info.get("answers"):
                continue  # Unknown form cannot be silently approved
            result = mcp.tool("auto_apply_review", job_slug=attempt["job_slug"], decision="approved")
            state["last_action_at"] = now()
            save_state(state_path, state)
            return {"status":"approved_for_submission", "job_slug":attempt["job_slug"], "freehire_status":result.get("status")}

    if state["starts_today"] >= policy["max_starts_per_utc_day"]:
        return {"status":"daily_quota_reached"}
    existing_slugs = {x.get("job_slug") for x in existing}
    # All starts save directly into FreeHire. No guessed answer is ever written.
    for job in fetch_candidates(policy, token=mcp.token):
        slug = job["public_slug"]
        if slug in existing_slugs:
            continue
        # Avoid duplicating older applications if not in the last-30-day MCP list.
        # FreeHire server also guards against a second submission.
        try:
            score = deterministic_match(mcp.token, slug)
        except FreeHireError:
            continue
        if score < policy["min_deterministic_skill_coverage_percent"]:
            continue
        result = mcp.tool("auto_apply_start", job_slug=slug)
        state["starts_today"] += 1
        state["last_action_at"] = now()
        save_state(state_path, state)
        return {"status":"started_tailoring", "job_slug":slug, "coverage_percent":score, "freehire_status":result.get("status")}
    return {"status":"no_more_eligible_jobs_found_in_search_window"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Mutate FreeHire through an authorized OAuth grant")
    parser.add_argument("--max-pages", type=int, default=2, help="Search page cap per query for preview; use 100 for full scan")
    parser.add_argument("--state", type=Path, default=STATE)
    args = parser.parse_args()
    policy = json.loads((SCRIPT_DIR / "campaign.json").read_text())
    if not args.execute:
        candidates = list(fetch_candidates(policy, max_pages=args.max_pages))
        print(json.dumps({"dry_run":True, "eligible_preview_count":len(candidates), "sample":[{"slug":x.get("public_slug"), "title":x.get("title"), "company":x.get("company")} for x in candidates[:20]]}, indent=2))
        return
    token = os.environ.get("FREEHIRE_OAUTH_ACCESS_TOKEN")
    if not token:
        raise SystemExit("Missing OAuth token. Authorize the FreeHire MCP account connection first; an ordinary API key is insufficient.")
    state = load_state(args.state)
    mcp = MCP(token)
    print(json.dumps(act_once(mcp, state, policy, args.state), indent=2))

if __name__ == "__main__":
    try:
        main()
    except FreeHireError as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
