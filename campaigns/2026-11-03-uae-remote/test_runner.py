import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import runner

POLICY = json.loads(Path(__file__).with_name("campaign.json").read_text())

class FakeMCP:
    token = "nonsecret-test-token"
    def __init__(self, attempts=None, answers=None):
        self.attempts = attempts if attempts is not None else []
        self.answers = answers if answers is not None else []
        self.calls = []

    def tool(self, name, **kwargs):
        self.calls.append((name, kwargs))
        if name == "auto_apply_list":
            return {"attempts":self.attempts}
        if name == "auto_apply_get":
            return {"status":"pending_review", "answers":self.answers}
        if name == "auto_apply_review":
            return {"status":"approved"}
        if name == "auto_apply_start":
            return {"status":"tailoring"}
        raise AssertionError("unexpected tool call: " + name)

class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "state.json"
        self.state = {"utc_day":runner.utcday(), "starts_today":0, "last_action_at":0}

    def tearDown(self):
        self.tmp.cleanup()

    def test_start_one_real_freehire_attempt_per_run(self):
        mcp = FakeMCP()
        with patch.object(runner, "fetch_candidates", return_value=[{"public_slug":"job-1"},{"public_slug":"job-2"}]), patch.object(runner, "deterministic_match", return_value=90):
            result = runner.act_once(mcp, self.state, POLICY, self.path)
        self.assertEqual(result["status"], "started_tailoring")
        self.assertEqual(self.state["starts_today"], 1)
        self.assertEqual(len([c for c in mcp.calls if c[0] == "auto_apply_start"]), 1)
        self.assertTrue(self.path.exists())

    def test_rejected_low_match_not_applied(self):
        mcp = FakeMCP()
        with patch.object(runner, "fetch_candidates", return_value=[{"public_slug":"bad-fit"}]), patch.object(runner, "deterministic_match", return_value=10):
            result = runner.act_once(mcp, self.state, POLICY, self.path)
        self.assertEqual(result["status"], "no_more_eligible_jobs_found_in_search_window")
        self.assertFalse(any(c[0] == "auto_apply_start" for c in mcp.calls))

    def test_approve_only_after_resolved_preview(self):
        mcp = FakeMCP(attempts=[{"job_slug":"review-me", "status":"pending_review"}], answers=[{"label":"name", "value":"candidate"}])
        with patch.object(runner, "fetch_candidates", return_value=[]):
            result = runner.act_once(mcp, self.state, POLICY, self.path)
        self.assertEqual(result["status"], "approved_for_submission")
        self.assertTrue(any(c[0] == "auto_apply_review" for c in mcp.calls))
        self.assertFalse(any(c[0] == "auto_apply_start" for c in mcp.calls))

    def test_unresolved_review_not_autoapproved(self):
        mcp = FakeMCP(attempts=[{"job_slug":"review-me", "status":"pending_review"}], answers=[])
        with patch.object(runner, "fetch_candidates", return_value=[]):
            result = runner.act_once(mcp, self.state, POLICY, self.path)
        self.assertEqual(result["status"], "no_more_eligible_jobs_found_in_search_window")
        self.assertFalse(any(c[0] == "auto_apply_review" for c in mcp.calls))

    def test_waits_for_interval(self):
        self.state["last_action_at"] = runner.now()
        result = runner.act_once(FakeMCP(), self.state, POLICY, self.path)
        self.assertEqual(result["status"], "rate_delayed")

    def test_respects_daily_cap(self):
        self.state["starts_today"] = POLICY["max_starts_per_utc_day"]
        result = runner.act_once(FakeMCP(), self.state, POLICY, self.path)
        self.assertEqual(result["status"], "daily_quota_reached")

if __name__ == "__main__": unittest.main()
