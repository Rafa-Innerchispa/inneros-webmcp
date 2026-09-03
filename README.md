# InnerOS WebMCP

Agent-native coding and operations control plane for the OpenAI WebMCP Challenge.

## What it does

InnerOS WebMCP turns a browser page into a safe agent operations surface. A WebMCP-capable agent can talk to a **local Qwen3-Coder model on AMD/vLLM**, inspect projects, find blockers, route work to approved runtimes, dispatch actions, control **physical AG-59 DMX stage lighting**, and retrieve truthful execution evidence without clicking through a human-only UI.

The judge experience is deliberately simple:

> Ask the local coding model for a change, choose an execution lane (or let InnerOS route it), dispatch the job, watch backend-confirmed trace and evidence appear, and optionally trigger a validated physical DMX action.

**Delivery is not execution.** A dispatch ID means the backend accepted the job. Completion is read independently through `get_execution_trace` and `get_evidence`.

## Origin and why it matters

InnerOS started as a multi-agent coordination fabric (MCP, A2A, durable ops, evidence) long before the WebMCP Challenge. WebMCP adds the missing browser-native surface: structured Site Tools, a Mission Control UI, and a public-safe bridge so agents can orchestrate real work without exposing private topology, credentials, or raw MCP catalogs.

Cloudflare terminates the public HTTPS edge (`webmcp.creatorcore.ai`) and tunnels to a **private local origin** on the Intel node. The local model, MCP runtime, and DMX engine never publish their endpoints directly.

## Pre-existing before the WebMCP Challenge

- InnerOS multi-agent orchestration and durable RACB ops
- MCP/A2A coordination and task evidence
- Codex, Cursor and AntiGravity provider adapters
- Local-first model/resource routing
- Global Live Trace and heartbeat semantics

## Built for the WebMCP Challenge

- Browser-native WebMCP registrations (11 Site Tools)
- Public-safe server bridge with fixed internal MCP allowlist
- Mission Control UI with proof-oriented Global Live Trace
- Local **Qwen3-Coder-30B-A3B-Instruct-AWQ** Copilot via private vLLM on AMD (tunneled to local origin)
- Selectable execution lanes: Local A2A, Codex, Cursor, AntiGravity, or automatic local-first routing
- **AG-59 DMX** integration: `dmx_status`, `dmx_set_scene`, `dmx_blackout` through trusted local registry scenes only
- Semantic blocker-resolution workflow
- Truthful execution trace and evidence UX
- Per-request proof metadata (request ID, backend, latency, dispatch ID)
- Output sanitization for topology, paths, sessions and secrets
- Cloudflare Worker edge-attestation implementation
- Live local-model and durable-A2A smoke tests (when run against live deployment)

## WebMCP tools (11)

The browser registers **eleven** high-level tools through `document.modelContext.registerTool(...)`:

| Tool | Purpose |
|------|---------|
| `ask_inneros_copilot` | Local Qwen coding answer + execution brief (never claims execution) |
| `list_agents` | Live provider/fabric capability truth |
| `get_project_status` | Verified project runtime binding |
| `inspect_blockers` | Truthful blockers for project or task |
| `dispatch_agent_action` | Dispatch to Local / Codex / Cursor / AntiGravity |
| `resolve_project_blocker` | Diagnose, route, dispatch repair under policy |
| `get_execution_trace` | Backend-confirmed execution events |
| `get_evidence` | Sanitized completion evidence |
| `dmx_status` | AG-59 stage status + **dynamic supported scenes** from local engine |
| `dmx_set_scene` | Apply a scene currently reported by trusted local DMX registry |
| `dmx_blackout` | Immediate safe blackout |

The public surface stays intentionally small. InnerOS orchestrates a much larger internal A2A fabric without exposing raw agent cards or private infrastructure to the browser.

### Proposal is not execution

`ask_inneros_copilot` reaches local Qwen through a private vLLM endpoint. The model returns an execution brief but **cannot** claim that files changed, tests passed, or a deployment happened.

Actual execution begins only through `dispatch_agent_action` or `resolve_project_blocker`. DMX physical action requires an allowlisted scene from `dmx_status` (plus blackout).

## Execution lanes (truthful modes)

Mission Control reports capability state from live provider fabric — not hardcoded green badges:

| Lane | Mode | Notes |
|------|------|-------|
| **Local AMD** | READY · headless | Qwen3-Coder via vLLM + durable A2A; preferred under local-first policy |
| **Codex** | READY · headless | Verified adapter/A2A path when fabric reports ready |
| **Cursor** | REMOTE INBOX | Native ACP / IDE inbox; **no fake headless claim** unless live proof exists |
| **AntiGravity** | REMOTE INBOX | IDE/headless bridge when available; completion requires evidence |

A green capability indicator means the backend reports that lane as **available**. It does **not** mean a job has already executed.

## AG-59 DMX (physical world)

DMX routes through **AG-59** (`inneros-dmx-engine`) on a loopback-only API. The public page:

- Reads status and **supported scenes** from the trusted local engine registry (`supported_scenes` / `supportedScenes`)
- Repopulates the scene selector from live backend status
- Rejects arbitrary scene names not currently reported (plus dedicated blackout)
- Never exposes raw channel writes, private IPs, or topology

Scene registry hot-reloads on the DMX engine side; WebMCP consumes whatever validated scenes the engine reports.

## Verifiable proof path

Every `/api/tools/:tool` call receives server-side proof metadata:

- `requestId`, tool name, bridge identity
- backend used (`mcp_loopback` or `local_vllm`)
- server timestamp, latency
- whether execution is actually being claimed

For dispatched jobs, the UI shows the durable A2A/IDE dispatch ID and polls evidence endpoints instead of declaring success optimistically.

## Demo flow (recommended recording)

1. Open Mission Control at `https://webmcp.creatorcore.ai` and authenticate as judge.
2. Ask the local Qwen Copilot to propose a small coding change — note request ID and latency.
3. Dispatch to **Local** or **Cursor** (with Cursor IDE + MCP session active for inbox delivery).
4. Follow **Global Live Trace**: queued → delivered → claimed → completed.
5. Refresh trace and evidence — backend-confirmed, not browser theater.
6. Optional: **DMX status** → apply an allowlisted scene → physical stage response.

## Direct local InnerOS bridge

For the judge deployment, the operational fabric stays local. The WebMCP server runs on the Intel node and connects to the private InnerOS MCP runtime only through loopback:

```bash
PORT=5195 \
INNEROS_MCP_URL=http://127.0.0.1:8102/mcp \
INNEROS_COPILOT_URL=http://127.0.0.1:18000/v1/chat/completions \
INNEROS_COPILOT_MODEL=QuantTrio/Qwen3-Coder-30B-A3B-Instruct-AWQ \
INNEROS_DMX_API_URL=http://127.0.0.1:18796 \
npm start
```

Loopback MCP calls authenticate with server-side `MCP_API_KEY` / `INNEROS_ADAPTER_TOKEN` via `X-API-Key` — never exposed to the browser.

## Security and truthfulness

- Browser JavaScript never receives private MCP, model, or DMX credentials.
- The browser cannot call arbitrary internal MCP tools.
- Private IPs, filesystem paths, sessions, credentials and secret-like fields are removed from public responses.
- Configured capability is never presented as completed execution.
- Local Copilot can propose code but cannot claim it executed.
- DMX scenes must come from the trusted local registry reported by `dmx_status`.
- Higher-impact host/cloud mutations remain behind audited approval boundaries.

## Cloudflare edge

The local origin remains private behind Cloudflare Tunnel. The repository includes `src/cloudflare-worker.js` for edge attestation (colo/country/ASN metadata only — no credential proxy).

## Tests

```bash
npm test
node --check public/app.js
node --check src/dmx-bridge.js
```

The unit suite covers WebMCP registration, bridge restrictions, sanitization, Copilot truth boundary, dynamic DMX scene registry consumption, and Cloudflare edge attestation. Two live smoke tests (`live-copilot-smoke`, `live-dispatch-smoke`) run only when the local WebMCP service and backends are reachable.

## Public judge deployment

`https://webmcp.creatorcore.ai`

Cloudflare terminates the public edge and tunnels traffic to the local WebMCP service. Private MCP, model, and DMX endpoints are never published directly.

**Eleven WebMCP tools. Local Qwen3-Coder. Four execution lanes. AG-59 DMX. One control plane with proof.**
