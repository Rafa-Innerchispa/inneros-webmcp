# InnerOS WebMCP

Agent-native web operations console for the OpenAI WebMCP Challenge.

## What it does
InnerOS WebMCP turns a browser page into a safe agent operations surface. A WebMCP-capable agent can inspect projects, find blockers, route work to approved runtimes, dispatch actions, and retrieve truthful execution evidence without clicking through a human-only UI.

The challenge build is intentionally centered on one strong mission flow:

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
- Mission Control UI with Global Live Trace
- Semantic blocker-resolution workflow
- Truthful execution trace and evidence UX
- Direct loopback MCP adapter with a fixed internal allowlist
- Output sanitization for topology, paths, sessions and secrets
- Cloudflare Worker edge attestation
- Challenge-specific tests and deployment path

## WebMCP tools
The browser registers exactly seven high-level tools through `document.modelContext.registerTool(...)`:

- `list_agents`
- `get_project_status`
- `inspect_blockers`
- `dispatch_agent_action`
- `resolve_project_blocker`
- `get_execution_trace`
- `get_evidence`

The public surface is deliberately small. InnerOS can orchestrate a much larger internal A2A fabric without exposing raw internal agent cards or private infrastructure to the browser.

## Direct local InnerOS bridge
For the judge deployment, the preferred architecture keeps the operational fabric local. The WebMCP server runs on the local Intel node and connects to the private InnerOS MCP runtime only through loopback:

```bash
PORT=5195 \
INNEROS_MCP_URL=http://127.0.0.1:8102/mcp \
npm start
```

`INNEROS_MCP_URL` accepts loopback hosts only. The bridge has a fixed internal allowlist and sanitizes public responses before returning them to the browser.

## Security and truthfulness
- Browser JavaScript never receives private MCP credentials.
- The browser cannot call arbitrary internal MCP tools.
- Private IPs, filesystem paths, sessions, credentials and secret-like fields are removed from public responses.
- Configured capability is never presented as completed execution.
- Execution trace and completion evidence are retrieved from live backend state.
- Higher-impact host/cloud mutations remain behind audited approval boundaries.
- Local-first routing is visible instead of silently escalating to an external paid provider.

## Cloudflare edge
The local origin is designed to remain private behind Cloudflare Tunnel. Cloudflare provides the public HTTPS edge, DNS/WAF controls and origin shielding while InnerOS stays local.

The repository also includes `src/cloudflare-worker.js`, a minimal Cloudflare Worker used as **edge attestation**. It returns only safe Cloudflare runtime metadata such as edge colo/country/ASN and explicitly identifies the origin model as `private-local-origin`. It does not proxy MCP credentials or expose the private InnerOS runtime.

Worker configuration is provided in `wrangler.toml`; additional deployment notes are in `docs/cloudflare-worker-config.md`.

## Run locally

```bash
npm test
npm start
```

Open `http://localhost:3000`. In a WebMCP-capable browser, the page registers the tools through `document.modelContext.registerTool(...)`; standard browsers show the same Mission Control in fallback mode.

## Demo focus
The judge should see one coherent story rather than a catalog of features:

1. Open the Mission Control in a WebMCP-capable browser.
2. Ask the agent to inspect a project and resolve its current blocker.
3. InnerOS checks live project state.
4. Resource Fabric selects the cheapest capable route under local-first policy.
5. A durable agent action is dispatched.
6. The Global Live Trace shows backend-confirmed state.
7. The agent retrieves verification evidence.
8. Cloudflare provides the public edge while the AI fabric remains private and local.

**Seven WebMCP tools. A real multi-agent fabric behind them. One human-readable control plane.**
