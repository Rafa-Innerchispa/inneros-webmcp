import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authStatus,
  authenticateRequest,
  createSession,
  hashPassword,
  login,
  readSession,
  sessionCookie
} from '../src/auth.js';

test('auth fails closed when required but credentials missing', () => {
  const status = authStatus({ WEBMCP_AUTH_REQUIRED: 'true' });
  assert.equal(status.required, true);
  assert.equal(status.configured, false);
  assert.equal(status.failClosed, true);
  const auth = authenticateRequest({ headers: {} }, { WEBMCP_AUTH_REQUIRED: 'true' });
  assert.equal(auth.ok, false);
  assert.equal(auth.error, 'auth_not_configured');
});

test('auth allows anonymous access when not required', () => {
  const auth = authenticateRequest({ headers: {} }, { WEBMCP_AUTH_REQUIRED: 'false' });
  assert.equal(auth.ok, true);
  assert.equal(auth.anonymous, true);
});

test('login creates signed session cookie for valid judge credentials', () => {
  const env = {
    WEBMCP_AUTH_REQUIRED: 'true',
    WEBMCP_SESSION_SECRET: 'test-secret',
    WEBMCP_JUDGE_USERNAME: 'judge',
    WEBMCP_JUDGE_PASSWORD: 'demo-pass'
  };
  const result = login('judge', 'demo-pass', { headers: {}, socket: { remoteAddress: '127.0.0.1' } }, env);
  assert.equal(result.ok, true);
  assert.match(result.token, /\./);
  const cookie = sessionCookie(result.token, env);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const req = { headers: { cookie: cookie.split(';')[0] } };
  const session = readSession(req, env);
  assert.equal(session.sub, 'judge');
});

test('login rejects invalid credentials without exposing details', () => {
  const env = {
    WEBMCP_AUTH_REQUIRED: 'true',
    WEBMCP_SESSION_SECRET: 'test-secret',
    WEBMCP_JUDGE_USERNAME: 'judge',
    WEBMCP_JUDGE_PASSWORD: 'demo-pass'
  };
  const result = login('judge', 'wrong', { headers: {}, socket: { remoteAddress: '127.0.0.1' } }, env);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_credentials');
});

test('hashPassword produces scrypt format', () => {
  const hashed = hashPassword('secret');
  assert.match(hashed, /^scrypt\$/);
});
