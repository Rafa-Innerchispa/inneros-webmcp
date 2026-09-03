# InnerOS WebMCP — Continuity Handoff — 2026-09-03 (Cursor takeover)

## Session owner

- **Ops:** `ops_a04412a709ed`
- **Correlation:** `webmcp-final-cursor-takeover-20260903`
- **Branch:** `cursor/webmcp-final-takeover-20260903`
- **Repo:** `Rafa-Innerchispa/inneros-webmcp`

## Completed in this takeover slice

1. **Judge auth gate** — `src/auth.js`, `/login.html`, `/api/auth/login|logout|status`
   - `WEBMCP_AUTH_REQUIRED=true` + server-side username/password or hash + signed HttpOnly session cookie
   - Fail-closed when auth required but credentials/secret missing
   - Bearer token still supported for automation
2. **Unified chat semantics** — casual greetings (`hola`, `hello`, etc.) stay on local Qwen only; Execute stays disabled until explicit action
3. **Truthful provider labels** — READY / REMOTE INBOX / UNAVAILABLE / DEGRADED from backend payload, not decorative ACTIVE
4. **Live trace enrichment** — delivery/execution/transport metadata on backend-confirmed events
5. **Regression tests** — `tests/auth.test.js`, `tests/chat-semantics.test.js`

## DMX status (truthful blocker)

Live `get_agent_catalog(functional_only=true)` returned **55 agents, zero DMX/AG-57 matches** on 2026-09-03. Do **not** add public DMX WebMCP tools until AG-57/AG-32 contract is registered and callable through the existing MCP/A2A bridge. Existing AntiGravity proof (`docs/ANTIGRAVITY_EXECUTION_PROOF.md` on its branch) should be consumed as historical evidence only.

## Test state

- Unit/regression suite: **27/27 PASS** when live-smoke service is not running (2 live tests need `:5195`)
- With live service up: expected **22/22** baseline from prior handoff

## Deploy checklist (still required)

1. Set env on runtime (no secrets in repo):
   - `WEBMCP_AUTH_REQUIRED=true`
   - `WEBMCP_SESSION_SECRET=...`
   - `WEBMCP_JUDGE_USERNAME=...`
   - `WEBMCP_JUDGE_PASSWORD=...` or `WEBMCP_JUDGE_PASSWORD_HASH=...`
2. Merge/fast-forward branch to `main` per repo policy
3. Restart **only** `inneros-webmcp.service` through audited `peer_user_service` approval (do not bypass gate)
4. Public verify:
   - login → unified chat → real Qwen greeting → no auto-dispatch
   - explicit execute → durable dispatch ID → trace/evidence
   - 8 Site Tools still discoverable in ChatGPT browser after auth session

## Evidence refs

- Cursor live proof (prior): `cursor/webmcp-cursor-live-proof-20260902` @ `0f9a6d3`
- Codex live proof: `docs/AGENT_EXECUTION_PROOF.md`
- AntiGravity proof: consume completed ops `ops_c9ba89c1196f` artifact when integrating provider cards

## Priority from here

1. Deploy + public browser verification (AG-55)
2. Public Codex E2E with durable `ide_...` ID through same page
3. Reconcile DMX only if catalog exposes safe AG-57 tools
4. Owner handles video + Devpost submit manually
