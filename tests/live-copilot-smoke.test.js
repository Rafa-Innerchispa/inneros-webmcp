import test from 'node:test';
import assert from 'node:assert/strict';

test('live WebMCP service reaches the local coding model', { skip: Boolean(process.env.CI) }, async () => {
  const response = await fetch('http://127.0.0.1:5195/api/tools/ask_inneros_copilot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
