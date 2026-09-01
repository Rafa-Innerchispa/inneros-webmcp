# InnerOS WebMCP

Agent-native web operations console for the OpenAI WebMCP Challenge.

## What it does
InnerOS WebMCP turns a browser page into a safe agent operations surface. A WebMCP-capable agent can inspect projects, find blockers, route work to approved runtimes, and retrieve execution evidence without clicking through a human-only UI.

## Pre-existing before the WebMCP Challenge
- InnerOS multi-agent orchestration
- MCP/A2A coordination and durable tasks
- Codex, Cursor and AntiGravity provider adapters
- local-first model/resource routing
- task evidence, heartbeats and Global Live Trace concepts

## Built for the WebMCP Challenge
- Browser-native WebMCP registrations
- Public-safe server bridge
- Judge-facing Agent Control Room
- Semantic blocker-resolution workflow
- Truthful execution trace and evidence UX
- Server-side InnerOS adapter with allowlisted tools, output sanitization and timeouts
- Challenge-specific tests and deployment path

## WebMCP tools
- `list_agents`
- `get_project_status`
- `inspect_blockers`
- `dispatch_agent_action`
- `resolve_project_blocker`
- `get_execution_trace`
- `get_evidence`

## Security and truthfulness
Browser JavaScript never receives InnerOS credentials. The optional live adapter is configured server-side with `INNEROS_ADAPTER_URL` and `INNEROS_ADAPTER_TOKEN`. Only seven allowlisted operations can cross that boundary, sensitive key names are stripped from returned objects, requests time out, and the UI never claims execution when the adapter cannot prove it.

Without a live adapter, the demo remains intentionally explicit: read-only capability metadata is available, while real dispatch and resolution return `blocked` or `unavailable` rather than fake success.

## Run locally

```bash
npm test
npm start
```

Open `http://localhost:3000`. In a WebMCP-capable browser, the page registers the tools through `document.modelContext.registerTool(...)`; standard browsers show the same control room in fallback mode.

## Live adapter environment

```bash
INNEROS_ADAPTER_URL=https://your-judge-safe-adapter.example
INNEROS_ADAPTER_TOKEN=server-side-secret
npm start
```

The adapter endpoint is expected to expose `POST /tools/:tool` for the seven allowlisted operations. Do not point this public bridge directly at a broad private MCP credential.

## Demo focus
The primary flow is deliberately one strong action: ask InnerOS to check a project blocker, choose the cheapest capable resource under local-first policy, execute safely, and return trace plus evidence.
