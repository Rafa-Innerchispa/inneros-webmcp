# InnerOS WebMCP — Continuity Handoff

This document is a public-safe continuity snapshot for the final WebMCP Challenge push.

## Current public state

- Live app: `https://webmcp.creatorcore.ai`
- Public repository: `Rafa-Innerchispa/inneros-webmcp`
- Default branch: `main`
- License: MIT
- Current handoff base commit: `b8afefb291412b5cf3000ae99b6adee0d951f4d9`
- ChatGPT integrated browser has already discovered **8 Site Tools** from the page.

## Product concept

InnerOS exposes a small WebMCP-native control plane for a larger agent/execution fabric.

Primary flow:

`Human -> WebMCP -> InnerOS -> MCP/A2A -> selected executor -> verification -> evidence`

The page includes a local coding copilot, execution-lane selection, backend-confirmed trace events, and evidence retrieval.

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

- WebMCP tool discovery in ChatGPT Site Tools is proven.
- Local coding-model inference through the public WebMCP service is proven.
- Durable local A2A dispatch and trace lookup are proven.
- A real Codex programming execution was proven independently on an isolated branch with tests and commit evidence.
- Cloudflare Tunnel/DNS serve the public application while the privileged origin remains private.
- Cloudflare Worker edge attestation is deployed and available at `/edge/attest`.
- External IDE dispatch is bound to a verified project repository instead of empty repo/branch values.
- Terminal truth prefers canonical execution evidence rather than treating inbox delivery as execution.

## Latest integration issue and fix

The last major live defect found before this handoff was that a Codex-targeted WebMCP dispatch was backend-confirmed and queued, but the public response lost the durable `ide_...` dispatch ID even though the underlying InnerOS IDE bridge created one correctly.

Root cause: nested/serialized FastMCP result envelopes were not fully normalized before extracting `dispatch_id`.

The current `main` includes the related envelope/dispatch recovery fixes, culminating in:

`b8afefb291412b5cf3000ae99b6adee0d951f4d9` — **Recover IDE dispatch IDs through nested FastMCP envelopes**

## Next required verification

Do not redesign the product before completing this sequence:

1. Confirm the running public service has reloaded the current `main` commit.
2. Send a safe `dispatch_agent_action` to Codex for the WebMCP project.
3. Require the public response to contain a durable `dispatchId` beginning with `ide_`.
4. Use that same ID with `get_execution_trace` and `get_evidence`.
5. Require a real terminal execution result with evidence before showing completion.
6. Re-run the flow from ChatGPT's integrated browser using the discovered Site Tools.

The strongest final demo is:

`ChatGPT Site Tools -> local Copilot -> dispatch -> durable ID -> execution trace -> evidence`

## Execution-lane truthfulness

The UI may expose Local, Codex, Cursor, and AntiGravity as capability lanes, but they must not be presented as equivalent execution states.

- **Local**: real local inference + durable A2A path proven.
- **Codex**: real programming proof exists; final public WebMCP path needs the durable-ID/terminal-E2E verification above.
- **Cursor**: keep state truthful unless an active ACP/session produces execution evidence.
- **AntiGravity**: keep state truthful unless its active session produces execution evidence.

`delivered` / `queued` must never be rendered as `running` or `completed`.

## UI principles already established

- Put the coding interaction high on the first screen.
- Show the Human -> WebMCP -> InnerOS -> execution flow visually and animate/highlight actual activity.
- Separate browser-local events from backend-confirmed events.
- Show request IDs, backend, latency, dispatch IDs, trace and evidence where available.
- Use a subtle professional moving background, not decorative noise.
- If `document.modelContext` is unavailable in an ordinary browser, explain that the WebMCP browser API is unavailable in that context rather than presenting it as a product failure.

## Scope discipline for final hours

Do not make unrelated integrations a requirement for submission. A clean, truthful single execution path is stronger than several decorative integrations.

Optional physical/DMX or additional agent integrations should only be added after the core coding E2E is stable and only if they are real, safe, reversible and low-risk.

## Submission ownership

The project owner is handling the final demo video and final Devpost Submit. This repository work should not automatically submit or replace the owner's final submission choices.
