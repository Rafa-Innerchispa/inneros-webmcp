# InnerOS WebMCP

Agent-native coding, orchestration, evidence, and physical-control plane for the OpenAI WebMCP Challenge.

## What it does

InnerOS WebMCP turns a browser page into a safe agent operations surface. A WebMCP-capable agent can talk to a **local Qwen3-Coder model on AMD/vLLM**, inspect projects, route work to approved runtimes, dispatch actions, create bounded lighting scenes, control **physical AG-59 DMX stage lighting**, and retrieve truthful execution evidence without exposing the private InnerOS fabric.

The judge experience is deliberately simple:

> Ask the local model for a change, explicitly execute it, watch backend-confirmed evidence, and optionally create a brand-new DMX scene that immediately appears in Mission Control before you physically run it.

**Delivery is not execution. Registration is not physical execution.** A dispatch ID only proves that a job was accepted. A newly created scene is registered and selectable, but the lights do not run until `dmx_set_scene` / **Apply scene** is invoked.

## Origin and why it matters

InnerOS existed before the WebMCP Challenge as a local-first multi-agent coordination fabric with MCP, A2A, durable operations, evidence, provider routing, and physical automation. The challenge work adds a browser-native WebMCP product layer: structured Site Tools, Mission Control, a public-safe bridge, and truthful proof semantics.

Cloudflare terminates the public HTTPS edge at `https://webmcp.creatorcore.ai` and tunnels to a **private local origin**. The local model, MCP runtime, and DMX engine remain private.

## Built for the WebMCP Challenge

- Browser-native WebMCP registrations (**12 Site Tools**)
- Public-safe Node.js bridge with a fixed internal MCP allowlist
- Compact recording cockpit with chat on the left and **Global Live Trace** on the right
- Local **Qwen3-Coder-30B-A3B-Instruct-AWQ** Copilot via private vLLM on AMD
- Selectable execution lanes: Local A2A, Codex, Cursor, AntiGravity, or automatic local-first routing
- Truthful delivery / claimed / running / completed semantics
- **AG-59 DMX** physical-world integration
- Dynamic trusted scene discovery and hot selector refresh
- **Local-AI scene creation:** natural language → bounded JSON → AG-59 validation → live registration → selector discovery → separate physical execution
- Per-request proof metadata: request ID, backend, latency, dispatch ID
- Sanitization for topology, paths, sessions, and secrets
- Cloudflare edge attestation
- Unit and live smoke tests

## WebMCP tools (12)

The browser registers exactly these high-level tools through `document.modelContext.registerTool(...)`:

| Tool | Purpose |
|---|---|
| `ask_inneros_copilot` | Local Qwen answer + execution brief; never claims execution |
| `list_agents` | Live provider/fabric capability truth |
| `get_project_status` | Verified project runtime binding |
| `inspect_blockers` | Truthful blockers for project/task |
| `dispatch_agent_action` | Dispatch to Local / Codex / Cursor / AntiGravity |
| `resolve_project_blocker` | Diagnose and route under policy |
| `get_execution_trace` | Backend-confirmed execution events |
| `get_evidence` | Sanitized terminal evidence |
| `dmx_create_scene` | Local Qwen designs a bounded scene; AG-59 validates and registers it without running lights |
| `dmx_status` | AG-59 status and trusted dynamic scene catalog |
| `dmx_set_scene` | Physically execute a currently registered scene |
| `dmx_blackout` | Immediate safe blackout |

The public surface stays intentionally small. InnerOS orchestrates a much larger internal MCP/A2A fabric without exposing raw internal tools.

## Proposal, registration, and execution are different states

`ask_inneros_copilot` reaches local Qwen through private vLLM. It can reason and prepare an execution brief but cannot claim files changed or tests passed.

For normal coding work, execution begins only when an execution tool returns a durable dispatch ID; terminal state is independently retrieved through `get_execution_trace` and `get_evidence`.

For DMX creation, `dmx_create_scene` is a governed write with a different boundary:

1. Local Qwen designs a declarative scene from natural language.
2. Common model aliases such as `purple` / `blue` are normalized to the canonical trusted palette.
3. AG-59 validates the scene again: names, targets, colors, brightness, loop count, step count, total duration, and minimum flash timing.
4. AG-59 atomically registers it in the live scene catalog.
5. Mission Control discovers it automatically and selects it.
6. **No physical light output occurs yet.**
7. The user presses **Apply scene**, which invokes `dmx_set_scene` and only then drives the fixtures.

Raw DMX channel writes, arbitrary fixture addresses, and rapid full-stage strobe are never accepted from public/model input.

## Execution lanes

Mission Control renders what the live provider fabric proves instead of painting every lane green:

| Lane | Mode | Notes |
|---|---|---|
| **Local AMD** | READY · headless | Qwen3-Coder via vLLM + local-first A2A |
| **Codex** | READY · headless when live fabric proves it | Process evidence required |
| **Cursor** | REMOTE INBOX unless headless is proven | Delivery is not execution |
| **AntiGravity** | REMOTE INBOX unless a real runnable session is proven | Completion requires returned evidence |

## Global Live Trace: proof, not theater

The trace deliberately separates browser intent from backend confirmation:

- `BROWSER` rows are client-side intent/UI events and are **not** presented as backend proof.
- `BACKEND · CONFIRMED` rows come from actual server responses.
- Dispatched jobs are followed through backend trace/evidence APIs rather than timer-driven fake success.
- A scene-registry change is shown as confirmed only after AG-59 reports the new catalog from the trusted backend.

Every `/api/tools/:tool` call receives proof metadata including request ID, tool name, backend, server timestamp, latency, and whether execution is actually being claimed.

## AG-59 DMX safety contract

Dynamic scenes are stored as validated high-level primitives only. The registry enforces:

- scene names `^[a-z0-9_]{1,48}$`
- allowlisted target groups only
- canonical colors / safe hex colors only
- brightness 0–255
- bounded loops and steps
- bounded total duration
- minimum **500 ms** for full-stage alternating steps; the local AI prompt is even more conservative at **650 ms**
- no raw channel numbers, private addresses, or topology from public input

The live registry is re-read on status/apply, so a newly registered scene becomes discoverable without editing the HTML selector.

## Recommended recording flow

1. Open `https://webmcp.creatorcore.ai` and authenticate.
2. Show the compact cockpit: DMX + four lanes + fixed chat on the left, Global Live Trace on the right.
3. Type a scene that does not exist, for example: **“Create a new DMX lighting scene called Aurora Pulse. All lights should alternate slowly between purple and blue. Keep it smooth and safe.”**
4. Local Qwen answers in the chat. Click **Execute proposed plan**.
5. WebMCP detects the DMX-creation intent and calls `dmx_create_scene`.
6. Global Live Trace shows the backend-confirmed registration.
7. The new scene appears automatically in the DMX selector and is selected.
8. Explain that registration did not run the physical lights.
9. Click **Apply scene**. The physical fixtures now execute the newly created scene.
10. Click **Blackout**.
11. Optionally demonstrate a coding dispatch and its durable trace/evidence separately.

## Direct local bridge

```bash
PORT=5195 \
INNEROS_MCP_URL=http://127.0.0.1:8102/mcp \
INNEROS_COPILOT_URL=http://127.0.0.1:18000/v1/chat/completions \
INNEROS_COPILOT_MODEL=QuantTrio/Qwen3-Coder-30B-A3B-Instruct-AWQ \
INNEROS_DMX_API_URL=http://127.0.0.1:18796 \
npm start
```

Credentials remain server-side. The browser never receives raw MCP, model, or DMX credentials.

## Tests

```bash
npm test
```

The current suite covers auth, WebMCP registration, bridge restrictions, Copilot truth boundaries, local-model DMX design, dynamic registry consumption, scene registration without physical execution, provider projection semantics, and Cloudflare edge attestation. Live smoke tests require dedicated test credentials when judge authentication is enabled and otherwise skip explicitly rather than failing with misleading 401s.

## Public judge deployment

`https://webmcp.creatorcore.ai`

**Twelve WebMCP tools. Local Qwen3-Coder. Four execution lanes. Live evidence. AG-59 physical DMX. One governed control plane.**
