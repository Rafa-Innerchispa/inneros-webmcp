# InnerOS WebMCP

Agent-native development, orchestration, evidence, and physical-control plane for the OpenAI WebMCP Challenge.

## What it does

InnerOS WebMCP turns a browser page into a governed AI development cockpit. A WebMCP-capable agent can converse with a **local Qwen3-Coder model on AMD/vLLM**, refine a plan over multiple turns, create local Git project workspaces, attach PDFs or source code as read-only context, dictate prompts through **local Whisper**, choose an execution lane, explicitly approve the final plan, dispatch work, create bounded lighting scenes, control **physical AG-59 DMX stage lighting**, and retrieve truthful execution evidence without exposing the private InnerOS fabric.

The central interaction rule is deliberately simple:

> **Conversation is deliberation. Approval is the execution boundary.**

You may keep chatting, changing requirements, adding documents, or switching executors. Nothing is programmed, registered, or physically executed until **Approve & Execute Plan** is pressed.

**Delivery is not execution. Registration is not physical execution.** A dispatch ID only proves that a job was accepted. A newly registered DMX scene is selectable, but the lights do not run until `dmx_set_scene` / **Apply scene** is invoked.

## Origin and why it matters

InnerOS existed before the WebMCP Challenge as a local-first multi-agent coordination fabric with MCP, A2A, durable operations, evidence, provider routing, and physical automation. The challenge work adds a browser-native WebMCP product layer: structured Site Tools, Mission Control, a public-safe bridge, project workspaces, multimodal development context, and truthful proof semantics.

Cloudflare terminates the public HTTPS edge at `https://webmcp.creatorcore.ai` and tunnels to a **private local origin**. The local Qwen model, Whisper transcription service, MCP runtime, project workspaces, and DMX engine remain private.

## Built for the WebMCP Challenge

- Browser-native WebMCP registrations (**13 Site Tools**)
- Public-safe Node.js bridge with a fixed internal MCP allowlist
- Compact recording cockpit with chat on the left and **Global Live Trace** on the right
- Local **Qwen3-Coder-30B-A3B-Instruct-AWQ** Copilot via private vLLM on AMD
- Real multi-turn conversation context instead of a one-message illusion
- Explicit **Approve & Execute Plan** gate before any coding/native write
- **Create Project** → bounded local Git workspace under the canonical Projects root
- PDF/source-code attachments as persistent, project-scoped, read-only Copilot context
- **Local Whisper** voice dictation through an on-prem ASR service; browser speech recognition is only an explicit fallback
- Selectable execution lanes: Local A2A, Codex, Cursor, AntiGravity, or automatic local-first routing
- Truthful delivery / claimed / running / completed semantics
- **AG-59 DMX** physical-world integration
- Dynamic trusted scene discovery and hot selector refresh
- Local-AI scene creation: natural language → approval → bounded JSON → AG-59 validation → live registration → selector discovery → separate physical execution
- Per-request proof metadata: request ID, backend, latency, dispatch ID
- Sanitization for topology, paths, sessions, and secrets
- Cloudflare edge attestation
- Unit and live smoke tests

## WebMCP tools (13)

The browser registers exactly these high-level tools through `document.modelContext.registerTool(...)`:

| Tool | Purpose |
|---|---|
| `ask_inneros_copilot` | Local Qwen conversation + bounded execution brief; accepts recent history and read-only project context; never claims execution |
| `list_agents` | Live provider/fabric capability truth |
| `get_project_status` | Verified project runtime/Git workspace binding |
| `create_project_workspace` | Explicitly create a bounded local Git development workspace under Projects; no surprise GitHub/cloud repo |
| `inspect_blockers` | Truthful blockers for project/task |
| `dispatch_agent_action` | After approval, dispatch to Local / Codex / Cursor / AntiGravity |
| `resolve_project_blocker` | After approval, route coding work under local-first policy |
| `get_execution_trace` | Backend-confirmed execution events |
| `get_evidence` | Sanitized terminal evidence |
| `dmx_create_scene` | After approval, local Qwen designs a bounded scene; AG-59 validates and registers it without running lights |
| `dmx_status` | AG-59 status and trusted dynamic scene catalog |
| `dmx_set_scene` | Physically execute a currently registered scene |
| `dmx_blackout` | Immediate safe blackout |

The public surface stays intentionally small. InnerOS orchestrates a much larger internal MCP/A2A fabric without exposing raw internal tools.

## Development workspace

### Create Project

The **Project** field selects an InnerOS project. Typing a name alone never creates anything. **Create Project** is an explicit write that:

1. validates a bounded project slug;
2. creates `/home/rlopez/projects/<project>` through the trusted Local Project Bootstrap primitive;
3. initializes a local Git repository on `main`;
4. registers the workspace in InnerOS Project Runtime;
5. does **not** create a GitHub/cloud remote automatically.

Existing registered Git projects work too. Before any approved coding dispatch, Mission Control re-validates that the selected project exists and is a real Git workspace.

### PDF and source-code context

Authenticated users can attach bounded PDFs and common source/text formats. Attachments are stored privately per project under the local development context store. Text/code is decoded directly. Text PDFs are extracted locally; a bounded PDF fallback is available when the system extractor is unavailable. Scanned/image-only PDFs are stored but are not falsely presented as readable text until OCR is available.

The local Copilot receives recent chat turns plus bounded attachment text as **read-only context**. After approval, a bounded portion of that same project context follows the execution brief to the selected executor.

### Voice

The browser records microphone audio with `MediaRecorder` and sends it to the authenticated WebMCP origin. The server forwards audio only over loopback to the already-running local Whisper ASR service and returns the transcript to the chat composer. Voice is **dictation only**. The transcript remains editable and is not sent to Qwen until the user submits it; it is never executed until approval.

If local Whisper is unavailable, Mission Control exposes browser speech recognition as an explicit fallback rather than silently pretending it is local.

## Conversation → approval → execution

1. Choose or create a verified project.
2. Attach PDF/code context if useful.
3. Type or dictate a request.
4. Local Qwen answers using recent conversation + project context.
5. Keep refining requirements for as many turns as needed.
6. Choose **AUTO**, **Local AMD**, **Codex**, **Cursor**, or **AntiGravity**.
7. Press **Approve & Execute Plan** only when satisfied.
8. InnerOS re-validates the project and dispatches the latest refined plan.
9. Global Live Trace follows backend evidence separately from browser intent.

## Execution lanes

Mission Control renders what the live provider fabric proves instead of painting every lane green:

| Lane | Mode | Notes |
|---|---|---|
| **AUTO** | local-first policy after approval | Native bounded capability when appropriate; otherwise cheapest capable local-first coding route |
| **Local AMD** | READY · headless | Qwen3-Coder via vLLM + local A2A/execution fabric |
| **Codex** | READY · headless when live fabric proves it | Provider execution fabric; process/evidence required |
| **Cursor** | REMOTE INBOX unless headless is proven | Delivery is not execution; IDE must claim the task |
| **AntiGravity** | REMOTE INBOX unless a real runnable session is proven | Completion requires returned evidence |

Explicit lane selection remains explicit. AUTO cannot silently hijack a task to a different named provider after the user selected one.

## Proposal, registration, and execution are different states

`ask_inneros_copilot` reaches local Qwen through private vLLM. It can reason and prepare an execution brief but cannot claim files changed, a project was created, tests passed, or a deployment happened.

For normal coding work, execution begins only after the approval gate returns a durable dispatch ID; terminal state is independently retrieved through `get_execution_trace` and `get_evidence`.

For DMX creation, the approval boundary is equally explicit:

1. Discuss/refine the desired scene with Qwen.
2. Press **Approve & Execute Plan**.
3. Local Qwen designs a declarative scene from the approved intent.
4. Common aliases such as `purple` / `blue` are normalized to the canonical trusted palette.
5. AG-59 validates names, targets, colors, brightness, loop count, step count, total duration, and minimum flash timing.
6. AG-59 atomically registers it in the live scene catalog.
7. Mission Control discovers/selects it.
8. **No physical light output occurs yet.**
9. Press **Apply scene**; only then does `dmx_set_scene` drive the fixtures.

Raw DMX channel writes, arbitrary fixture addresses, and rapid full-stage strobe are never accepted from public/model input.

## Global Live Trace: proof, not theater

The trace deliberately separates browser intent from backend confirmation:

- `BROWSER` rows are client-side intent/UI events and are **not** presented as backend proof.
- `BACKEND · CONFIRMED` rows come from actual server responses.
- Project creation is confirmed only after the runtime registry reports a real Git workspace.
- Dispatched jobs are followed through backend trace/evidence APIs rather than timer-driven fake success.
- A scene-registry change is confirmed only after AG-59 reports it.
- Voice transcription is labeled local only after the local Whisper proxy returns text.

Every `/api/tools/:tool` call receives proof metadata including request ID, tool name, backend, server timestamp, latency, and whether execution is actually being claimed.

## AG-59 DMX safety contract

Dynamic scenes are stored as validated high-level primitives only. The registry enforces:

- scene names `^[a-z0-9_]{1,48}$`
- allowlisted target groups only
- canonical colors / safe hex colors only
- brightness 0–255
- bounded loops and steps
- bounded total duration
- minimum **500 ms** for full-stage alternating steps; the local AI prompt is more conservative at **650 ms**
- no raw channel numbers, private addresses, or topology from public input

## Recommended recording flow

1. Open `https://webmcp.creatorcore.ai` and authenticate.
2. Show the execution lanes, Coding Chat, Global Live Trace, project controls, file/voice context, and DMX control.
3. Optionally type a fresh sandbox project name and press **Create Project**. Show the backend-confirmed local Git workspace.
4. Attach a small source file or text PDF and ask Qwen a question about it, or dictate a request using **Local voice**.
5. Refine the response once to demonstrate real conversation memory.
6. Choose an execution target.
7. Press **Approve & Execute Plan** and show the durable dispatch/trace/evidence.
8. For the physical demo, ask for a new DMX scene that does not exist, refine it, approve it, show it appear in the selector, explain that the lights are still idle, then press **Apply scene**.
9. Finish with **Blackout**.

## Direct local bridge

```bash
PORT=5195 \
INNEROS_MCP_URL=http://127.0.0.1:8102/mcp \
INNEROS_COPILOT_URL=http://127.0.0.1:18000/v1/chat/completions \
INNEROS_COPILOT_MODEL=QuantTrio/Qwen3-Coder-30B-A3B-Instruct-AWQ \
INNEROS_DMX_API_URL=http://127.0.0.1:18796 \
npm start
```

Credentials remain server-side. The browser never receives raw MCP, model, Whisper, or DMX credentials.

## Tests

```bash
npm test
```

The suite covers auth, WebMCP registration, project-creation boundaries, project/runtime verification, bridge restrictions, Copilot history and attachment context, approval-first semantics, local-model DMX design, dynamic registry consumption, scene registration without physical execution, provider projection semantics, Local Whisper wiring, and Cloudflare edge attestation. Authenticated live smoke tests require dedicated test credentials and otherwise skip explicitly rather than failing with misleading 401s.

## Public judge deployment

`https://webmcp.creatorcore.ai`

**Thirteen WebMCP tools. Local Qwen3-Coder. Local Whisper. Project workspaces. Four execution lanes. Live evidence. AG-59 physical DMX. One governed control plane.**
