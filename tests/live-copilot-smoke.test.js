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

test('live WebMCP service reaches the local coding model', { skip: Boolean(process.env.CI) }, async (t) => {
  const cookie = await authCookieOrSkip(t);
  if (cookie === null) return;

  const response = await fetch(`${BASE_URL}/api/tools/ask_inneros_copilot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify({
      project: 'inneros-webmcp',
      message: 'Reply briefly with a safe plan for one read-only status field and one focused test. Do not execute anything.'
    })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.state, 'answered');
  assert.equal(data.executionClaimed, false);
  assert.equal(data.backend, 'local_vllm');
  assert.equal(data.proof?.backend, 'local_vllm');
  assert.match(data.proof?.requestId || '', /^wmcp_req_/);
  assert.ok(typeof data.message === 'string' && data.message.length > 20);
  assert.ok(typeof data.executionBrief === 'string' && data.executionBrief.length > 10);
});
