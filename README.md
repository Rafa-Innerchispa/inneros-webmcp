# InnerOS WebMCP Mission Control

**Browser-native AI orchestration with local models, multi-agent execution, live evidence, and safe real-world control.**

Built for the **OpenAI WebMCP Challenge**.

- Live judge app: `https://webmcp.creatorcore.ai`
- Public repository: `https://github.com/Rafa-Innerchispa/inneros-webmcp`
- License: MIT
- Canonical release branch: `main`

## What InnerOS WebMCP does

InnerOS WebMCP turns a WebMCP-capable browser into a controlled entry point for an existing InnerOS multi-agent system.

A judge can have a normal conversation with a local coding model, inspect the agent fabric, explicitly dispatch approved work, follow the real delivery/execution state, retrieve evidence, and control allowlisted physical DMX lighting scenes without exposing private infrastructure to the browser.

The core flow is:

```text
Human / WebMCP client
        |
        v
InnerOS WebMCP Mission Control
        |
        +--> Local Qwen3-Coder 30B (vLLM / AMD)
        |
        +--> InnerOS MCP + A2A execution fabric
        |       +--> Local execution
        |       +--> Cursor remote inbox / interactive IDE
        |       +--> AntiGravity remote inbox / interactive IDE
        |       +--> Codex headless adapter (owner spend policy applies)
        |
        +--> Global Live Trace + durable evidence
        |
        +--> AG-59 safe DMX orchestration
```

The browser request, model response, task delivery, actual execution, and completion evidence are deliberately treated as different states. InnerOS does not turn a successful HTTP request into a fake `COMPLETED` badge.

## Existing project vs. challenge-period work

InnerOS existed before the WebMCP Challenge. The challenge work is a meaningful new browser-native interaction and execution layer rather than a reskin of the existing product.

### Pre-existing before the challenge

- InnerOS multi-agent architecture
- MCP and A2A coordination
- durable operations tasks and evidence concepts
- local-first model/resource routing
- integrations with development agents such as Cursor, AntiGravity, and Codex
- Home Assistant / physical automation foundations

### Built or materially extended during the WebMCP submission period

- native `document.modelContext.registerTool(...)` registrations
- a public-safe WebMCP server bridge
- a unified conversational Mission Control UI
- local Qwen3-Coder Copilot through vLLM on AMD hardware
- explicit conversation-vs-execution semantics (`hello` does not dispatch work)
- authenticated judge access with server-side session handling
- durable WebMCP-to-MCP/A2A dispatch IDs
- Global Live Trace and evidence retrieval
- truthful provider modes instead of hard-coded `ACTIVE` states
- Cloudflare Worker edge attestation
- output sanitization for secrets, paths, sessions, and private topology
- AG-59 DMX integration with allowlisted high-level physical actions
- live and regression tests for WebMCP, auth, model, edge, dispatch contracts, and DMX

## 11 WebMCP tools

The current judge surface registers **11 high-level tools**. The public toolset is intentionally small even though the private InnerOS MCP fabric is much larger.

### Conversation and software operations

1. `ask_inneros_copilot`
2. `list_agents`
3. `get_project_status`
4. `inspect_blockers`
5. `dispatch_agent_action`
6. `resolve_project_blocker`
7. `get_execution_trace`
8. `get_evidence`

### Safe physical-world DMX control

9. `dmx_status`
10. `dmx_set_scene`
11. `dmx_blackout`

No browser tool exposes arbitrary DMX channels, universes, private LAN addresses, raw shell execution, or unrestricted internal MCP access.

## Local AI: Qwen3-Coder on AMD

`ask_inneros_copilot` reaches a private local model rather than a browser-side simulation:

- Provider: Local AMD
- Runtime: vLLM
- Model: `QuantTrio/Qwen3-Coder-30B-A3B-Instruct-AWQ`
- External inference cost for the local lane: $0

The Copilot can converse and propose work, but it is explicitly forbidden from claiming that code executed. A casual greeting remains a conversation. Execution requires an explicit dispatch action.

## Provider modes are truthful

Mission Control distinguishes **capability**, **delivery**, and **execution**.

| Provider | Current integration model | What the UI may truthfully claim |
| --- | --- | --- |
| Local Qwen | Local vLLM + InnerOS execution fabric | `READY / HEADLESS` when health is live |
| Codex | Verified headless CLI adapter | `READY / HEADLESS`; owner spend policy may freeze invocation |
| Cursor | Durable IDE inbox + interactive Cursor session | `REMOTE INBOX` unless a real running session is proven |
| AntiGravity | Durable IDE inbox / fleet bridge | `REMOTE INBOX` unless a real coding runner is proven |

`DELIVERED` is not `RUNNING`. `RUNNING` requires process/session/local-model proof. `COMPLETED` requires terminal evidence.

## Durable execution and evidence

Explicit work uses a durable identifier rather than a transient chat message.

```text
WebMCP request
  -> server request ID
  -> MCP/A2A or IDE dispatch ID
  -> delivery state
  -> execution state
  -> terminal evidence
```

`get_execution_trace` and `get_evidence` independently query backend state. This is the proof path judges can inspect instead of trusting an optimistic frontend message.

## Safe real-world automation: AG-59 DMX

WebMCP also demonstrates that the same architecture can bridge AI clients to physical systems.

AG-59 is the specialized DMX orchestrator coordinated with the broader InnerOS automation fabric. The browser only receives high-level allowlisted actions:

- read DMX status
- select an allowlisted scene
- blackout

Example allowlisted scenes include `rainbow`, `frenzy`, `police`, `fire`, `chill_lounge`, `morado_uv`, and `rojo_sangre`.

The DMX engine is private and loopback-bound. Public responses are sanitized and never disclose physical network topology.

## Judge authentication

The public Mission Control console is protected by a first-party judge login.

- credentials are configured server-side
- passwords are not committed to this repository
- sessions are server-issued
- privileged tool endpoints are protected server-side, not merely hidden in the UI

Judge credentials are supplied only in the private Devpost testing-instructions field.

## Cloudflare public edge, private local origin

The judge URL is served through Cloudflare while the AI/model/MCP/DMX backends remain private.

`src/cloudflare-worker.js` implements a deliberately narrow edge-attestation endpoint. It exposes only safe Cloudflare runtime information and does not proxy MCP credentials or private control surfaces.

Live edge proof:

```text
https://webmcp.creatorcore.ai/edge/attest
```

## Security and truth boundaries

- browser JavaScript never receives private MCP/model credentials
- browser users cannot call arbitrary internal MCP tools
- private IPs, filesystem paths, credentials, sessions, and secret-like fields are sanitized
- Copilot proposal is not execution
- task delivery is not task execution
- physical actions are allowlisted at a high level
- higher-impact infrastructure/cloud mutations remain behind separate approval boundaries
- local-first routing is visible rather than silently escalating to a paid external provider

## Running locally

```bash
npm test
npm start
```

The public repository intentionally does **not** contain production secrets or private network configuration. Runtime endpoints and credentials are injected server-side.

## Verification gates

Before the release is frozen for judging, the final branch is expected to pass:

```bash
npm test
node --check public/app.js
```

The suite covers:

- WebMCP registration
- narrow tool and agent allowlists
- casual-chat-no-dispatch semantics
- judge authentication
- MCP credential/header contract without exposing the secret
- local Copilot truth boundaries
- durable dispatch ID parsing
- canonical IDE state/evidence projection
- Cloudflare edge behavior
- DMX loopback restrictions and scene allowlist
- live local-model smoke verification
- live authenticated dispatch/trace verification when running against the judge runtime

## Recommended judge walkthrough

1. Open `https://webmcp.creatorcore.ai` in ChatGPT's in-app browser or Chrome with WebMCP enabled.
2. Sign in using the private credentials supplied in Devpost.
3. Type `Hello` in the unified chat. The local Qwen model should answer without dispatching anything.
4. Inspect the Site Tools exposed by WebMCP.
5. Use a read-only status/tool action and observe the backend-confirmed trace.
6. Explicitly dispatch a bounded task and note the durable dispatch ID.
7. Follow delivery/execution/evidence in Global Live Trace.
8. Use `dmx_status` and an allowlisted DMX scene to demonstrate physical-world control, then use `dmx_blackout`.
9. Inspect `/edge/attest` to see the Cloudflare/public-edge vs. private-origin architecture.

## Repository and branch policy

`main` is the only canonical judge/release branch. Development and proof branches are retained as auditable challenge-period evidence; they are **not** blindly merged after their work has already been superseded by `main`.

See [`docs/JUDGE_EVIDENCE_AND_BRANCHES.md`](docs/JUDGE_EVIDENCE_AND_BRANCHES.md) for the branch audit and evidence map.

## License

MIT License. See [`LICENSE`](LICENSE).

---

**11 WebMCP tools. Local AI. Multiple execution lanes. Durable proof. Physical-world control. One browser-native control plane.**
