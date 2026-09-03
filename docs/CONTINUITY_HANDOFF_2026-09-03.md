# InnerOS WebMCP — Continuity Handoff — 2026-09-03

## Read this first

This is the current handoff for the final WebMCP Challenge push. The owner handles the final video and final Devpost Submit. Do not auto-submit.

## Live product

- Public app: `https://webmcp.creatorcore.ai`
- Public repo: `Rafa-Innerchispa/inneros-webmcp`
- Default branch: `main`
- License: MIT
- ChatGPT integrated browser already discovered all **8 WebMCP Site Tools** from the page.

## Product concept

InnerOS turns a website into a coding control plane:

`Human -> WebMCP -> InnerOS -> MCP/A2A -> executor -> trace -> evidence`

The page exposes a local coding copilot plus execution lanes for Local AMD, Codex, Cursor and AntiGravity. Proposal and execution are intentionally separate. Delivery/queued must never be shown as completed execution.

## Eight WebMCP tools

1. `ask_inneros_copilot`
2. `list_agents`
3. `get_project_status`
4. `inspect_blockers`
5. `dispatch_agent_action`
6. `resolve_project_blocker`
7. `get_execution_trace`
8. `get_evidence`

## Verified capabilities

- ChatGPT Site Tools discovery: PASS.
- Local Qwen3-Coder 30B / vLLM inference through the WebMCP service: PASS.
- Durable local A2A dispatch and trace lookup: PASS.
- Cloudflare Tunnel/DNS public delivery: PASS.
- Cloudflare Worker edge attestation at `/edge/attest`: PASS.
- Real Codex programming execution exists independently with tests + commit evidence: PASS.
- External dispatch now resolves the verified project/repo binding instead of sending empty repo/branch values: PASS.
- Stale `queued` IDE projection is overridden by canonical terminal ops/evidence when completion is proven: PASS.
- Nested FastMCP envelopes are normalized so IDE dispatch IDs can be recovered: PASS.

## Latest core test state

Current product suite after the latest UI work: **22/22 PASS**.

The suite includes:

- actual WebMCP registration contract;
- real local-model live smoke;
- real durable local A2A smoke;
- verified project binding for external execution;
- canonical terminal truth over stale IDE delivery state;
- nested FastMCP dispatch-ID recovery.

## Latest UI change

Commit:

`d8fa046bdb7c761ccee534e38fa3714984f6c326` — `feat: unify Copilot chat with persistent history`

The previous UI incorrectly separated the prompt composer from the answer window. The latest `main` changes this to a single conversational panel:

- prompt and responses share one continuous chat box;
- composer stays directly below the conversation;
- automatic scroll always follows the newest response;
- Enter sends, Shift+Enter creates a new line;
- chat history persists in browser `localStorage` (bounded to 80 messages);
- a `Clear history` control resets the conversation;
- project + execution target remain in the same chat panel;
- the execution trace remains separate on purpose because it is proof, not conversation.

## Deployment note for the latest UI

The production runtime worktree has already fast-forwarded to `main` including `d8fa046`.

However, the currently running Node service was started before this UI commit and appears to cache/read the public shell at startup. Browser validation immediately after the fast-forward still saw the previous DOM (no `.unified-chat-panel`). Therefore the next session must restart only:

`inneros-webmcp.service`

The service currently points to the correct registered runtime path. The restart is blocked by the recurring `peer_user_service` host-approval gate (`approval_id_required`). Do not bypass this security gate. Resolve/mint the correct host/systemd approval, restart the service, then verify the new DOM publicly.

## Exact post-restart browser verification

1. Open `https://webmcp.creatorcore.ai/?v=d8fa046`.
2. Confirm `.unified-chat-panel` exists.
3. Send a short prompt to Qwen.
4. Confirm user and assistant messages appear in the same scrollable conversation box.
5. Confirm the box autoscrolls to the last answer.
6. Reload the page and confirm the conversation is restored from browser history.
7. Confirm `Clear history` resets it.
8. Open inside ChatGPT integrated browser and confirm 8 Site Tools still appear.

## Coding E2E still to prove publicly

The strongest remaining acceptance path is:

`ChatGPT Site Tools -> ask_inneros_copilot -> choose Codex -> dispatch_agent_action -> durable ide_ dispatch ID -> get_execution_trace -> get_evidence -> terminal commit/test evidence`

Do not call it complete until the same durable ID is visible through the public WebMCP response and the terminal evidence is retrievable.

## Execution lane truth

- **Local AMD:** real local inference + durable A2A proven.
- **Codex:** real programming execution proven independently; final public WebMCP full E2E still needs terminal proof through the same public dispatch ID.
- **Cursor:** expose as available/configured only when ACP/session state proves it. Do not fake headless execution.
- **AntiGravity:** currently occupied with unrelated home/DMX work in another session. Do not interrupt it for the WebMCP demo unless the owner explicitly reassigns it.

## DMX idea

A DMX/Home Assistant demonstration could be a strong optional WebMCP example because it shows the same agent-native interface controlling the physical world, which is visibly different from coding. But it is NOT part of the core submission acceptance path.

Current canonical InnerOS agent catalog has 56 agents through AG-56 and does not yet contain a dedicated DMX agent. Coordination search also did not find a canonical DMX handoff. Therefore do not add a DMX WebMCP tool until Antigravity's work is registered, safe, reversible and callable through a stable tool contract.

If the DMX work becomes real and stable after core coding E2E is green, add it only as an optional wow-factor tool, e.g. safe scene/status operations, not unrestricted raw DMX writes.

## Coordination discipline

- WebMCP repo owner lane: this WebMCP ChatGPT session.
- Alpaca repo remains separate.
- Shared provider/execution fabric belongs to shared InnerOS infrastructure lanes.
- Acquire RACB lock before writes.
- Never use another project repo as scratch space.
- Inbox delivery is not execution.
- `running` requires actual process/session/heartbeat evidence.
- terminal PASS requires evidence.

## Priority order from here

1. Restart `inneros-webmcp.service` with the correct audited host approval.
2. Verify the unified chat UI publicly.
3. Run public Codex E2E and recover durable `ide_...` ID.
4. Follow that same ID to trace/evidence terminal proof.
5. Re-test the same flow from ChatGPT Site Tools.
6. Only then consider Cursor/AntiGravity/DMX optional proof lanes.
7. Owner records video and submits manually.
