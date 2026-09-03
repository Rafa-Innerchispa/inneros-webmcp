import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeTool, ALLOWED_AGENTS, ALLOWED_ACTIONS } from '../src/bridge.js';
import { TOOL_NAMES, registerInnerOSWebMCP } from '../src/webmcp.js';
import { buildMcpHeaders, parseMcpPayload, resolveAdapterUrls } from '../src/inneros-adapter.js';

test('registers all WebMCP tools when browser API exists', () => {
  const seen = [];
  const context = { registerTool(tool) { seen.push(tool); } };
  const result = registerInnerOSWebMCP(context, async () => ({ ok: true }));
  assert.equal(result.supported, true);
  assert.deepEqual(result.registered, TOOL_NAMES);
  assert.equal(seen.length, TOOL_NAMES.length);
  assert.equal(TOOL_NAMES.length, 13);
  assert.ok(seen.every((tool) => typeof tool.execute === 'function'));
  assert.ok(seen.some((tool) => tool.name === 'ask_inneros_copilot'));
  assert.ok(seen.some((tool) => tool.name === 'create_project_workspace'));
});

test('unsupported browser is explicit', () => {
  assert.deepEqual(registerInnerOSWebMCP(undefined, async () => ({})), { supported: false, registered: [] });
});

test('policy remains narrow and project creation is explicit', () => {
  assert.deepEqual(ALLOWED_AGENTS, ['codex','cursor','antigravity','local']);
  assert.deepEqual(ALLOWED_ACTIONS, ['inspect','dispatch','status','evidence','resolve','create_project']);
});

test('adapter endpoint resolution is ordered deduplicated and failover-ready', () => {
  assert.deepEqual(resolveAdapterUrls({
    INNEROS_ADAPTER_URLS: 'https://primary.example, https://secondary.example/',
    INNEROS_ADAPTER_URL: 'https://primary.example/',
    INNEROS_ADAPTER_FALLBACK_URL: 'https://tertiary.example/'
  }), [
    'https://primary.example',
    'https://secondary.example',
    'https://tertiary.example'
  ]);
});

test('mcp loopback includes server-side api key when configured', () => {
  assert.equal(buildMcpHeaders({ INNEROS_ADAPTER_TOKEN: 'secret-token' })['X-API-Key'], 'secret-token');
  assert.equal(buildMcpHeaders({ MCP_API_KEY: 'mcp-key', INNEROS_ADAPTER_TOKEN: 'adapter-key' })['X-API-Key'], 'mcp-key');
  assert.equal(buildMcpHeaders({}, 'session-1')['mcp-session-id'], 'session-1');
  assert.equal(Object.hasOwn(buildMcpHeaders({}), 'X-API-Key'), false);
});

test('mcp sse payload parser preserves tool error envelopes', () => {
  const parsed = parseMcpPayload(`event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"Unauthorized"}],"isError":true}}\n`);
  assert.equal(parsed.result.isError, true);
  assert.equal(parsed.result.content[0].text, 'Unauthorized');
});

test('rejects non-allowlisted agent', async () => {
  const result = await invokeTool('dispatch_agent_action', { agent: 'shell', instruction: 'run anything' });
  assert.equal(result.state, 'rejected');
  assert.equal(result.error, 'agent_not_allowlisted');
});

test('copilot never falls through to execution', async () => {
  const result = await invokeTool('ask_inneros_copilot', { project: 'inneros-webmcp', message: 'write a function' });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.error, 'local_copilot_not_configured');
});

test('project creation validates names before any live write', async () => {
  const result = await invokeTool('create_project_workspace', { project: '../escape' });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'rejected');
  assert.equal(result.error, 'project_name_invalid');
});

test('never fakes success without live adapter', async () => {
  const result = await invokeTool('dispatch_agent_action', { agent: 'local', project: 'inneros-webmcp', instruction: 'inspect status' });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'blocked');
  assert.equal(result.blocker, 'judge_safe_inneros_adapter_not_connected');
  const trace = await invokeTool('get_execution_trace', { dispatchId: result.dispatchId });
  assert.equal(trace.ok, true);
  assert.equal(trace.trace[0].state, 'blocked');
});

test('resolve_project_blocker is truthful until the live adapter exists', async () => {
  const result = await invokeTool('resolve_project_blocker', { project: 'inneros-alpha-alpaca', policy: 'local_first' });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'blocked');
  assert.equal(result.policy, 'local_first');
  assert.equal(result.trace[0].stage, 'diagnose');
  assert.equal(result.trace[0].state, 'blocked');
});

test('unknown tool rejected', async () => {
  const result = await invokeTool('execute_shell', {});
  assert.equal(result.error, 'tool_not_allowlisted');
});

test('DMX designed-scene aliases normalize before AG-59 validation', async () => {
  const { normalizeDmxDesignedScene } = await import('../src/bridge.js');
  const normalized = normalizeDmxDesignedScene({
    name: 'recording_preview',
    label: 'Recording Preview',
    loops: 2,
    steps: [
      { target: 'all lights', color: 'purple', brightness: 128, duration_ms: 750 },
      { target: 'all', color: 'blue', brightness: 128, duration_ms: 750 },
      { target: 'disco ball', color: 'white', brightness: 100, duration_ms: 700 }
    ]
  });
  assert.equal(normalized.steps[0].target, 'all');
  assert.equal(normalized.steps[0].color, 'morado');
  assert.equal(normalized.steps[1].color, 'azul');
  assert.equal(normalized.steps[2].target, 'bola_disco');
  assert.equal(normalized.steps[2].color, 'blanco');
});
