# FreeHire UAE / remote campaign (3 November 2026)

**Branch-only campaign configuration. This repository branch does not run itself.**

The source of truth for the résumé, employer screening answers, and application
ledger is **the candidate's signed-in FreeHire account**, not this repository.
`cv_variants/` contains a historical snapshot, not necessarily the current
profile. Do **not** paste personal OAuth tokens, applicant data, or application
receipts into GitHub. Keep campaign runtime state outside the repository.

## Scope

- Remote roles: accept global/worldwide/EMEA or the MENA region **only when work
  from Dubai/UAE is permitted**. A Europe-only or US-only remote role is excluded.
- Onsite/hybrid: **UAE locations only**.
- Matching roles: Ruby/Rails, backend, Node.js/NestJS, software, full-stack,
  frontend, and mobile engineering, using the verified saved FreeHire profile.
- Every vacancy must pass FreeHire's deterministic `/jobs/{slug}/match` check;
  the campaign threshold in `campaign.json` is a conservative starting rule,
  not a claim that FreeHire's own criteria require that particular threshold.
- Auto-apply uses FreeHire's **existing** CV-tailoring pipeline and form resolver.
  It does not generate invented skills, fabricate visa authorization, bypass
  CAPTCHAs, or guess the candidate's screening answers.

## How FreeHire submissions actually work

The code in `internal/api/handler/mcpapp_account.go` requires an **OAuth grant**
for the `auto_apply_*` MCP tools. An ordinary personal API key cannot invoke
those tools. The account must also enable **Let connected agents apply for me**
in the FreeHire Integrations screen.

**MCP endpoint:** `https://freehire.me/api/v1/mcp/account`

Use the product's normal OAuth authorization and token handling; do not write
access tokens into source files or a public repository. OAuth grants can expire;
a real deployment needs a trusted OAuth client with refresh-token support.
The runner below accepts only a currently valid OAuth access token from the
*local process environment* for an already authorized account. It does not
perform OAuth sign-in on your behalf.

The server performs CV tailoring then holds a candidate-review gate before
submission. The campaign approves a completed preview only when required
answers are present. Any blocked, uncertain, or failed attempt is left for
review. An `approved` status is **not** yet an employer submission receipt:
check `auto_apply_get` / `auto_apply_list`, and the FreeHire application board
for the final `submitted` outcome.

## Run locally after connecting your account

From this directory:

```bash
python3 -m unittest -v
python3 runner.py --max-pages 2              # read-only preview, no token
# Supply OAuth access token only in the local environment through your OAuth client.
# Do NOT commit or paste the credential into a chat or GitHub.
python3 runner.py --execute                  # at most one rate-limited action
```

For unattended continuation, run `python3 runner.py --execute` on your own
trusted host at a modest schedule (for example, once every 5 minutes), with
OAuth refresh managed by the host's credential service. It exits quickly when
30-minute spacing or the daily start quota has not elapsed, rather than
holding open a fragile session for 30 minutes. Never schedule this from a
public GitHub runner with a long-lived personal token.

## Rate limits and tracking

- At most **3 new starts per UTC day** from this local runner (and subject to
  the actual FreeHire account's server-side plan quota).
- At most **1 start or review approval per run**, with **30 minutes between
  application actions**. Worker concurrency is managed separately by FreeHire.
- Stops on HTTP `429` and reports `Retry-After`; never bypasses a platform
  rate limit or CAPTCHA.
- Server-side `auto_apply_start` creates a durable FreeHire attempt; each
  status event and submitted application is saved in FreeHire. Local state at
  `~/.local/state/freehire/apply-campaign-20261103.json` is only the pacing
  safeguard; it is not the employer-submission source of truth.
- Do not automatically retry failures that could already have reached an
  employer, and never mark a job **submitted** unless FreeHire confirms it.

## Limitations / operational checks

- The script's geographic and skill candidate gate is unit-tested. The **live**
  OAuth MCP handshake, actual job search result shape, server-side plan limit,
  and employer submissions have **not** been integration-tested against the
  candidate's FreeHire account. Use a trusted staging account before production.
- FreeHire search has a 10,000-row deep-pagination bound. Broad catalogs may
  need partitioned searches by stack/region to be exhaustive. The script scans
  four targeted searches, deduplicates by posting slug, and does not assert that
  the entire catalog was exhausted if the server pagination bound is reached.
- `auto_apply_list` includes live attempts and submitted ones from the last 30
  days. For older applications, rely on FreeHire's own duplicate prevention;
  do not bypass duplicate warnings. Existing `my_jobs` application stages should
  also be checked when reviewing the campaign.
- The candidate still needs to inspect open questions and employer responses,
  and the job description may impose location/visa requirements not fully
  reflected in the metadata. Treat uncertain fields as non-applicable until
  confirmed; never guess.

## Status at branch creation

- Branch created and eligibility tests prepared.
- **0 verified submissions performed through this ChatGPT session**: it has
  GitHub repository access but **no authenticated FreeHire OAuth account
  connection**, so it cannot submit to employers or view private saved jobs.
