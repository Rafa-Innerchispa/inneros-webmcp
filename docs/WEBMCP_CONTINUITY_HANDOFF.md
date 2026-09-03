# InnerOS WebMCP — Continuity Handoff

**Date:** 2026-09-03
**Owner lane:** ChatGPT / WebMCP
**Repository:** `Rafa-Innerchispa/inneros-webmcp`
**Public URL:** `https://webmcp.creatorcore.ai`
**Current main baseline:** `d8fa046` — `feat: unify Copilot chat with persistent history`

## 1. Current product state

InnerOS WebMCP is a public WebMCP-native coding control plane. The judge-facing flow is:

`Human -> WebMCP Site Tool -> InnerOS safe bridge -> private MCP/A2A fabric -> selected execution lane -> trace/evidence`

The public browser surface exposes 8 WebMCP tools:

1. `ask_inneros_copilot`
2. `list_agents`
3. `get_project_status`
4. `inspect_blockers`
5. `dispatch_agent_action`
6. `resolve_project_blocker`
7. `get_execution_trace`
8. `get_evidence`

ChatGPT's integrated browser has already discovered all 8 Site Tools on the live page.

## 2. Unified chat UX — DONE and LIVE

The old split prompt/response layout has been replaced by one continuous `LIVE CODING CHAT` panel.

Current behavior:

- user prompt and model replies render in the same message timeline;
- the composer lives inside the same panel;
- project and execution-target selection are part of the same experience;
- automatic scroll keeps the newest message visible;
- browser-local chat history is persisted with `localStorage` key `inneros-webmcp-chat-v1`;
- history is bounded to the most recent 80 messages;
- `Clear history` removes the stored transcript;
- Enter submits; Shift+Enter creates a newline;
- execution messages are appended to the same chat after dispatch;
- Global Live Trace remains a separate proof panel because it represents backend evidence, not conversational content.

Public verification on 2026-09-03 confirmed `.unified-chat-panel` is served at `https://webmcp.creatorcore.ai`.

## 3. Verified infrastructure

- Cloudflare public edge and Tunnel are live.
- Cloudflare Worker edge attestation was previously deployed and verified.
- Private InnerOS MCP is reached through loopback from the public Node bridge.
- AMD `.5` runs Qwen3-Coder 30B through vLLM and is the local Copilot path.
- WebMCP public responses expose request/backend/latency proof without private topology or secrets.
- FastMCP nested `structuredContent.result/data` envelopes are normalized so IDE `dispatch_id` values are not silently lost.
- Project dispatches resolve a verified Runtime Registry binding instead of sending an empty repo/branch.
- terminal IDE state prefers canonical ops status/evidence over stale delivery projections.

## 4. Execution lanes — truthful current state

### Local AMD

Operational through the local model and durable A2A path. This is the strongest fully local lane and has live smoke coverage.

### Codex

Server capability is real and healthy:

- Codex CLI installed;
- headless execution supported;
- authentication ready;
- a prior real programming proof completed successfully through InnerOS and produced commit `1c55ae50bd387b78f510d5f008be4fa413b68bdf`.

However, the **public WebMCP button still uses the legacy IDE dispatch path** rather than a fully exposed canonical provider-execution MCP tool. Delivery can be proven with a durable `ide_*` dispatch ID, but do not claim that every WebMCP Codex dispatch has executed code until trace/evidence reaches a real terminal state.

### Cursor

Native Cursor ACP is installed and the ACP probe passes. Server-side headless execution is not currently proven, so treat Cursor as an ACP/IDE-session lane unless real session evidence exists.

### AntiGravity

Server CLI detection is not a headless path, but the real AntiGravity IDE/MCP session path works. The WebMCP proof task `ops_c9ba89c1196f` completed on 2026-09-03 with `docs/ANTIGRAVITY_EXECUTION_PROOF.md` and passing bridge/app checks. Keep the UI honest about session/IDE execution rather than claiming a server CLI.

## 5. Canonical Provider Execution Fabric — important remaining gap

Shared InnerOS runtime contains:

`platform/inneros_core_runtime/provider_execution_fabric.py`

with `execute_provider_task(...)` and canonical providers:

- `local_qwen`
- `codex`
- `cursor`
- `antigravity`

Important truth:

- local Qwen supports validated file operations -> Local Execution Plane -> tests -> commit;
- Codex provider-fabric code currently has a cheap process-lifecycle smoke based on `codex --version`; that smoke is not itself a coding task;
- Cursor/AntiGravity launch semantics remain session/adapter-dependent;
- `execute_provider_task` exists in runtime code but is not currently exposed as a callable public MCP tool in the tool catalog discovered by this WebMCP adapter.

Therefore the final engineering goal is **not to fake four identical green lanes**. The goal is to expose/consume the real provider execution lifecycle where supported and preserve honest delivery/session states where not.

## 6. Current P0 coordination

Canonical task:

- `ops_70329af7e11f`
- correlation: `webmcp-final-chat-provider-20260903`
- title: `P0 unify WebMCP chat and canonical provider execution`

Current branch/worktree for final provider wiring:

- branch: `chatgpt/webmcp-provider-execution-wire-20260903`
- worktree: `/home/rlopez/inneros/inneros_core/var/local_execution/worktrees/Rafa-Innerchispa__inneros-webmcp/chatgpt__webmcp-provider-execution-wire-20260903`

Related probe:

- Codex task `ops_a879452905ed`
- correlation `webmcp-canonical-provider-probe-20260903`

Do not create duplicate tasks for this same final bridge.

## 7. DMX / physical-world extension — real but OPTIONAL

AntiGravity completed the separate DMX task `ops_178492245ef3`.

Evidence reports:

- repo: `Rafa-Innerchispa/inneros-dmx-engine`
- `AG-57_dmx_artnet_orchestrator`
- `AG-32_home_assistant_bridge`
- 9 fixtures mapped
- Art-Net universe 0
- safe bounded scenes only
- exposed contract includes `dmx_status`, `dmx_set_scene`, `dmx_blackout`, `ha_turn_on_light`, `ha_call_service`

DMX could be an excellent optional WebMCP physical-world proof, but **do not add it before the core coding demo is stable**. The primary challenge story remains: WebMCP controls a real AI coding workforce with proof. DMX is a later "same control plane, physical system" extension.

## 8. Recommended final demo flow

Primary demo should stay short and undeniable:

1. Open `https://webmcp.creatorcore.ai` in ChatGPT integrated browser.
2. Show that ChatGPT discovers the 8 Site Tools.
3. In the unified chat, ask local Qwen for a small safe coding improvement.
4. Show Qwen answer in the same conversation.
5. Select an execution lane.
6. Dispatch.
7. Show server request ID and durable dispatch ID.
8. Follow `get_execution_trace`.
9. Follow `get_evidence`.
10. Claim completion only if backend evidence says completed/PASS.

Strongest desired external lane for the recording is Codex because headless/auth capability is confirmed and a prior real coding proof exists.

## 9. Submission truth rules

Never claim:

- inbox delivery == execution;
- queued == running;
- configured == reachable;
- reachable == completed;
- Cursor server headless if only ACP/session evidence exists;
- AntiGravity CLI execution if only IDE/session transport exists;
- a provider smoke such as `codex --version` is a coding change.

Always prefer request IDs, dispatch IDs, process/session proof, test output, commits and backend evidence.

## 10. Deadline / ownership

The WebMCP Challenge deadline is 2026-09-03 15:00 Ecuador time.

The owner handles video and final Devpost submission. Do **not** submit automatically.

WebMCP product repo ownership stays with the WebMCP ChatGPT lane during final closure. Alpaca and shared InnerOS platform work are separate lanes and must not overwrite this repo.

## 11. Next exact actions

1. Finish canonical external-provider wiring or document the exact MCP exposure blocker.
2. Run `npm test` and Node syntax checks.
3. Run one public end-to-end Codex dispatch from WebMCP and require a durable dispatch ID plus terminal evidence if execution completes.
4. Verify public unified chat and WebMCP Site Tool discovery once more.
5. Freeze the repo/site after owner review and final recording.

Do not expand scope before these five items are complete.
