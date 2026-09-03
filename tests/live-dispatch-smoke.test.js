import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAuthHeaders } from './live-auth-helper.js';

test('live WebMCP dispatch creates a durable local A2A task', { skip: Boolean(process.env.CI) }, async () => {
  const authHeaders = await liveAuthHeaders();
  const dispatchResponse = await fetch('http://127.0.0.1:5195/api/tools/dispatch_agent_action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      agent: 'local',
      project: 'inneros-webmcp',
      instruction: 'Read-only smoke verification: inspect the project status and report one concise finding. Do not modify files.'
    })
  });
  const dispatch = await dispatchResponse.json();
  assert.equal(dispatchResponse.status, 200);
  assert.equal(dispatch.ok, true);
  assert.ok(typeof dispatch.dispatchId === 'string' && dispatch.dispatchId.length > 10);
  assert.equal(dispatch.transport, 'a2a');
  assert.equal(dispatch.executionClaimed, false);
  assert.equal(dispatch.proof?.backend, 'mcp_loopback');
  assert.match(dispatch.proof?.requestId || '', /^wmcp_req_/);

  const traceResponse = await fetch('http://127.0.0.1:5195/api/tools/get_execution_trace', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({ dispatchId: dispatch.dispatchId })
  });
  const trace = await traceResponse.json();
  assert.notEqual(trace.state, 'not_found');
  assert.equal(trace.dispatchId, dispatch.dispatchId);
  assert.ok(Array.isArray(trace.trace));
});
