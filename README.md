# InnerOS WebMCP

Agent-native web operations console for the OpenAI WebMCP Challenge.

## Challenge goal
Expose a safe, browser-native WebMCP surface that lets an AI agent inspect and operate real InnerOS workflows instead of relying on human-only UI clicks.

## Pre-existing before the WebMCP Challenge
- InnerOS multi-agent orchestration
- MCP/A2A coordination and durable tasks
- Codex, Cursor and AntiGravity provider adapters
- local-first model/resource routing
- task evidence, heartbeats and Global Live Trace concepts

## Built for the WebMCP Challenge
- WebMCP browser tool registrations
- public-safe InnerOS bridge
- agent operations web console
- allowlisted browser-to-agent actions
- WebMCP-specific execution trace and evidence UX
- challenge-specific tests/evals and deployment

## WebMCP tools
- `list_agents`
- `get_project_status`
- `inspect_blockers`
- `dispatch_agent_action`
- `get_execution_trace`
- `get_evidence`

All write actions are allowlisted and must return truthful execution state. No private credentials or internal network topology are exposed.
