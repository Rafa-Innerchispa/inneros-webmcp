import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.WEBMCP_LIVE_URL || 'http://127.0.0.1:5195';

async function authCookieOrSkip(t) {
  const statusResponse = await fetch(`${BASE_URL}/api/auth/status`);
  const status = await statusResponse.json();
  if (!status?.auth?.required) return '';

  const username = process.env.WEBMCP_TEST_USERNAME;
  const password = process.env.WEBMCP_TEST_PASSWORD;
  if (!username || !password) {
    t.skip('live service requires auth; set WEBMCP_TEST_USERNAME/WEBMCP_TEST_PASSWORD for authenticated smoke');
    return null;
  }

  const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(loginResponse.status, 200, 'dedicated live test credentials must authenticate');
  return (loginResponse.headers.get('set-cookie') || '').split(';')[0];
}

function headers(cookie) {
  return {
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {})
  };
}

test('live WebMCP dispatch creates a durable local A2A task', { skip: Boolean(process.env.CI) }, async (t) => {
  const cookie = await authCookieOrSkip(t);
  if (cookie === null) return;

  const dispatchResponse = await fetch(`${BASE_URL}/api/tools/dispatch_agent_action`, {
    method: 'POST',
    headers: headers(cookie),
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

  const traceResponse = await fetch(`${BASE_URL}/api/tools/get_execution_trace`, {
    method: 'POST',
    headers: headers(cookie),
    body: JSON.stringify({ dispatchId: dispatch.dispatchId })
  });
  const trace = await traceResponse.json();
  assert.notEqual(trace.state, 'not_found');
  assert.equal(trace.dispatchId, dispatch.dispatchId);
  assert.ok(Array.isArray(trace.trace));
});
