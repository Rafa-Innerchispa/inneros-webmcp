import crypto from 'node:crypto';

const SESSION_COOKIE = 'inneros_webmcp_session';
const SESSION_TTL_MS = Number(process.env.WEBMCP_SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const MAX_FAILS = Number(process.env.WEBMCP_AUTH_MAX_FAILS || 8);
const FAIL_WINDOW_MS = Number(process.env.WEBMCP_AUTH_FAIL_WINDOW_MS || 15 * 60 * 1000);

const failBuckets = new Map();

function authRequired(env = process.env) {
  return String(env.WEBMCP_AUTH_REQUIRED || '').toLowerCase() === 'true';
}

function sessionSecret(env = process.env) {
  return String(env.WEBMCP_SESSION_SECRET || env.WEBMCP_JUDGE_TOKEN || '').trim();
}

function judgeUsername(env = process.env) {
  return String(env.WEBMCP_JUDGE_USERNAME || 'judge').trim();
}

function judgePassword(env = process.env) {
  return String(env.WEBMCP_JUDGE_PASSWORD || '').trim();
}

function judgePasswordHash(env = process.env) {
  return String(env.WEBMCP_JUDGE_PASSWORD_HASH || '').trim();
}

export function authStatus(env = process.env) {
  const required = authRequired(env);
  const secret = sessionSecret(env);
  const username = judgeUsername(env);
  const hasPassword = Boolean(judgePassword(env) || judgePasswordHash(env));
  const configured = !required || (Boolean(secret) && hasPassword);
  return {
    required,
    configured,
    failClosed: required && !configured,
    usernameConfigured: Boolean(username),
    sessionTtlMs: SESSION_TTL_MS
  };
}

function hashPassword(password, salt = '') {
  const effectiveSalt = salt || crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(password, effectiveSalt, 32).toString('hex');
  return `scrypt$${effectiveSalt}$${digest}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, digest] = stored.split('$');
    if (!salt || !digest) return false;
    const attempt = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(attempt, 'hex'));
  }
  return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(password));
}

function signPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySignedToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown';
  return ip;
}

function registerFailure(key) {
  const now = Date.now();
  const bucket = failBuckets.get(key) || { count: 0, resetAt: now + FAIL_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + FAIL_WINDOW_MS;
  }
  bucket.count += 1;
  failBuckets.set(key, bucket);
  return bucket.count;
}

function isRateLimited(key) {
  const bucket = failBuckets.get(key);
  if (!bucket) return false;
  if (Date.now() > bucket.resetAt) {
    failBuckets.delete(key);
    return false;
  }
  return bucket.count >= MAX_FAILS;
}

export function parseCookies(header = '') {
  return String(header).split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

export function readSession(req, env = process.env) {
  const secret = sessionSecret(env);
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySignedToken(cookies[SESSION_COOKIE], secret);
}

export function createSession(username, env = process.env) {
  const secret = sessionSecret(env);
  const payload = { sub: username, exp: Date.now() + SESSION_TTL_MS, iat: Date.now() };
  return signPayload(payload, secret);
}

export function sessionCookie(token, env = process.env) {
  const secure = String(env.WEBMCP_COOKIE_SECURE || 'true').toLowerCase() !== 'false';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(env = process.env) {
  const secure = String(env.WEBMCP_COOKIE_SECURE || 'true').toLowerCase() !== 'false';
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function authenticateRequest(req, env = process.env) {
  const status = authStatus(env);
  if (!status.required) return { ok: true, anonymous: true, status };
  if (status.failClosed) return { ok: false, error: 'auth_not_configured', status };
  const bearer = String(req.headers.authorization || '');
  const tokenAuth = String(env.WEBMCP_JUDGE_TOKEN || '').trim();
  if (tokenAuth && bearer === `Bearer ${tokenAuth}`) return { ok: true, via: 'bearer', status };
  const session = readSession(req, env);
  if (session?.sub) return { ok: true, via: 'session', user: session.sub, status };
  return { ok: false, error: 'unauthorized', status };
}

export function login(username, password, req, env = process.env) {
  const status = authStatus(env);
  if (!status.required) return { ok: true, skipped: true, status };
  if (status.failClosed) return { ok: false, state: 'blocked', error: 'auth_not_configured', status };
  const key = clientKey(req);
  if (isRateLimited(key)) return { ok: false, state: 'blocked', error: 'too_many_attempts', status };

  const expectedUser = judgeUsername(env);
  const plain = judgePassword(env);
  const storedHash = judgePasswordHash(env);
  const validUser = username === expectedUser;
  let validPass = false;
  if (storedHash) validPass = verifyPassword(password, storedHash);
  else if (plain) validPass = password === plain;
  if (!validUser || !validPass) {
    registerFailure(key);
    return { ok: false, state: 'rejected', error: 'invalid_credentials', status };
  }
  failBuckets.delete(key);
  const token = createSession(expectedUser, env);
  return { ok: true, state: 'authenticated', token, username: expectedUser, status };
}

export { SESSION_COOKIE, hashPassword };
