import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLiveSmokeAuth } from './live-smoke-auth.js';

test('prepareLiveSmokeAuth skips when auth is required without test credentials', async () => {
  const originalUsername = process.env.WEBMCP_TEST_USERNAME;
  const originalPassword = process.env.WEBMCP_TEST_PASSWORD;
  delete process.env.WEBMCP_TEST_USERNAME;
  delete process.env.WEBMCP_TEST_PASSWORD;

  const auth = await prepareLiveSmokeAuth('http://127.0.0.1:1');
  assert.equal(auth.kind, 'skip');
  assert.match(auth.reason, /unreachable|auth required/i);

  process.env.WEBMCP_TEST_USERNAME = originalUsername;
  process.env.WEBMCP_TEST_PASSWORD = originalPassword;
});
