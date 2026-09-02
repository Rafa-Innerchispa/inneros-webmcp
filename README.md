# InnerOS WebMCP

Agent-native coding and operations control plane for the OpenAI WebMCP Challenge.

## What it does
InnerOS WebMCP turns a browser page into a safe agent operations surface. A WebMCP-capable agent can talk to a local coding model, inspect projects, find blockers, route work to approved runtimes, dispatch actions, and retrieve truthful execution evidence without clicking through a human-only UI.

The judge experience is deliberately simple:

> Ask the local coding model for a change, choose an execution lane (or let InnerOS route it), dispatch the job, and watch backend-confirmed trace and evidence appear.

The original autonomous mission flow is still available through WebMCP:

> Inspect the project, identify the current blocker, resolve it using the cheapest capable resource, run bounded verification, and return evidence.

## Pre-existing before the WebMCP Challenge
- InnerOS multi-agent orchestration
- MCP/A2A coordination and durable tasks
- Codex, Cursor and AntiGravity provider adapters
- local-first model/resource routing
- task evidence, heartbeats and Global Live Trace concepts

## Built for the WebMCP Challenge
- Browser-native WebMCP registrations
- Public-safe server bridge
- Mission Control UI with proof-oriented Global Live Trace
- Local Qwen3-Coder Copilot exposed through WebMCP
- Selectable execution lanes: Local A2A, Codex, Cursor, AntiGravity, or automatic local-first routing
- Semantic blocker-resolution workflow
- Truthful execution trace and evidence UX
- Per-request proof metadata (request ID, backend, latency and dispatch ID)
- Direct loopback MCP adapter with a fixed internal allowlist
- Output sanitization for topology, paths, sessions and secrets
- Cloudflare Worker edge-attestation implementation
- Live local-model and durable-A2A smoke tests
- Challenge-specific tests and deployment path

## WebMCP tools
The browser registers exactly eight high-level tools through `document.modelContext.registerTool(...)`:

- `ask_inneros_copilot`
- `list_agents`
- `get_project_status`
- `inspect_blockers`
- `dispatch_agent_action`
- `resolve_project_blocker`
- `get_execution_trace`
- `get_evidence`

The public surface stays intentionally small. InnerOS can orchestrate a much larger internal A2A fabric without exposing raw internal agent cards or private infrastructure to the browser.

### Proposal is not execution
`ask_inneros_copilot` reaches a local Qwen3-Coder model through a private vLLM endpoint. The model answers in English and returns an execution brief, but the tool is explicitly forbidden from claiming that files changed, tests passed, or a deployment happened.

Actual execution begins only through `dispatch_agent_action` or `resolve_project_blocker`. A successful dispatch returns a durable dispatch ID. Completion is then read independently through `get_execution_trace` and `get_evidence`.

This separation is visible in the UI: browser-side events are labeled separately from `BACKEND · CONFIRMED` events.

## Execution lanes
Mission Control reports the current capability state instead of painting every provider as equally active:

- **Local AMD** — local Qwen3-Coder through vLLM plus durable A2A execution; preferred under local-first policy.
- **Codex** — routed through the verified adapter/A2A delivery path; delivery and execution states remain separate.
- **Cursor** — native ACP integration; no fake headless claim.
- **AntiGravity** — IDE/headless bridge when available; completion requires returned evidence.

A green capability indicator means the backend reports that lane as available. It does **not** mean a job has already executed.

## Verifiable proof path
Every `/api/tools/:tool` call receives server-side proof metadata:

- `requestId`
- WebMCP tool name
- bridge identity
- backend used (`mcp_loopback` or `local_vllm`)
- server timestamp
- server latency
- whether execution is actually being claimed

The same request ID is returned through `x-inneros-request-id`, while `x-inneros-adapter` and `Server-Timing` make the request observable outside the visual UI.

For dispatched jobs, the UI additionally shows the durable A2A/IDE dispatch ID and polls the evidence endpoints instead of declaring success optimistically.

## Direct local InnerOS bridge
For the judge deployment, the operational fabric stays local. The WebMCP server runs on the local Intel node and connects to the private InnerOS MCP runtime only through loopback:

```bash
PORT=5195 \
INNEROS_MCP_URL=http://127.0.0.1:8102/mcp \
INNEROS_COPILOT_URL=http://127.0.0.1:18000/v1/chat/completions \
INNEROS_COPILOT_MODEL=QuantTrio/Qwen3-Coder-30B-A3B-Instruct-AWQ \
npm start
```

`INNEROS_MCP_URL` accepts loopback hosts only. The Copilot configuration accepts private/local hosts only. The bridge has a fixed internal MCP allowlist and sanitizes public responses before returning them to the browser.

## Security and truthfulness
- Browser JavaScript never receives private MCP or model credentials.
- The browser cannot call arbitrary internal MCP tools.
- Private IPs, filesystem paths, sessions, credentials and secret-like fields are removed from public responses.
- Configured capability is never presented as completed execution.
- The local Copilot can propose code but cannot claim it executed.
- Execution trace and completion evidence are retrieved from live backend state.
- Higher-impact host/cloud mutations remain behind audited approval boundaries.
- Local-first routing is visible instead of silently escalating to an external paid provider.

## Cloudflare edge
The local origin remains private behind Cloudflare Tunnel. Cloudflare provides the public HTTPS edge, DNS controls and origin shielding while InnerOS stays local.

The repository also includes `src/cloudflare-worker.js`, a minimal Cloudflare Worker implementation for **edge attestation**. It returns only safe Cloudflare runtime metadata such as edge colo/country/ASN and explicitly identifies the origin model as `private-local-origin`. It does not proxy MCP credentials or expose the private InnerOS runtime.

Worker configuration is provided in `wrangler.toml`; additional deployment notes are in `docs/cloudflare-worker-config.md`.

## Tests and live proof

```bash
npm test
npm start
```

The normal unit suite covers WebMCP registration, bridge restrictions, sanitization, the Copilot truth boundary and Cloudflare edge attestation. On the live local deployment, the suite also includes two smoke checks (skipped in generic CI):

1. the WebMCP service reaches the real local Qwen3-Coder/vLLM backend and returns a proof request ID without claiming execution;
2. `dispatch_agent_action` creates a real durable local A2A task and its dispatch ID can immediately be queried through the trace endpoint.

The current local deployment has passed the full 20-test suite including both live smoke checks.

## Public judge deployment

`https://webmcp.creatorcore.ai`

Cloudflare terminates the public edge and tunnels traffic to the local WebMCP service. The private MCP and model endpoints are never published directly.

## Demo focus
The strongest judge flow is one coherent coding interaction rather than a catalog of features:

1. Open Mission Control in a WebMCP-capable browser.
2. Ask the local Qwen3-Coder Copilot to propose a small coding change.
3. Watch the request return with a real request ID, backend label and latency.
4. Choose Local, Codex, Cursor or AntiGravity, or leave routing on Auto/local-first.
5. Dispatch the proposed execution brief through WebMCP.
6. Watch the durable dispatch ID appear.
7. Follow backend-confirmed MCP/A2A state in Global Live Trace.
8. Retrieve completion evidence instead of trusting a UI success message.
9. Cloudflare provides the public edge while the AI fabric, local model and MCP runtime remain private.

**Eight WebMCP tools. A local coding model. Multiple execution lanes. One control plane with proof.**
