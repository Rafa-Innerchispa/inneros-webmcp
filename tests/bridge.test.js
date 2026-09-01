import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeTool, ALLOWED_AGENTS, ALLOWED_ACTIONS } from '../src/bridge.js';
import { TOOL_NAMES, registerInnerOSWebMCP } from '../src/webmcp.js';

test('registers all WebMCP tools when browser API exists', () => {
  const seen = [];
  const context = { registerTool(tool) { seen.push(tool); } };
  const result = registerInnerOSWebMCP(context, async () => ({ ok: true }));
  assert.equal(result.supported, true);
  assert.deepEqual(result.registered, TOOL_NAMES);
  assert.equal(seen.length, 7);
  assert.ok(seen.every((tool) => typeof tool.execute === 'function'));
});

test('unsupported browser is explicit', () => {
  assert.deepEqual(registerInnerOSWebMCP(undefined, async () => ({})), { supported: false, registered: [] });
});

test('policy remains narrow', () => {
  assert.deepEqual(ALLOWED_AGENTS, ['codex','cursor','antigravity','local']);
  assert.deepEqual(ALLOWED_ACTIONS, ['inspect','dispatch','status','evidence','resolve']);
});

test('rejects non-allowlisted agent', async () => {
  const result = await invokeTool('dispatch_agent_action', { agent: 'shell', instruction: 'run anything' });
  assert.equal(result.state, 'rejected');
  assert.equal(result.error, 'agent_not_allowlisted');
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
