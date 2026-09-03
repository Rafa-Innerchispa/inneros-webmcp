import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function loadRuntimeEnv() {
  const env = { ...process.env };
  const envPath = process.env.WEBMCP_LIVE_ENV_FILE || path.join(os.homedir(), '.config', 'inneros', 'inneros-webmcp.env');
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    if (!(key in env)) env[key] = line.slice(idx + 1);
  }
  return env;
}

export async function liveAuthHeaders(baseUrl = 'http://127.0.0.1:5195') {
  const health = await fetch(`${baseUrl}/api/health`);
  if (!health.ok) throw new Error(`live health failed: ${health.status}`);
  const status = await health.json();
  if (!status?.auth?.required) return {};

  const env = loadRuntimeEnv();
  const bearer = String(env.WEBMCP_JUDGE_TOKEN || '').trim();
  if (bearer) return { authorization: `Bearer ${bearer}` };

  const username = String(env.WEBMCP_JUDGE_USERNAME || '').trim();
  const password = String(env.WEBMCP_JUDGE_PASSWORD || '');
  if (!username || !password) throw new Error('live auth is required but judge credentials are unavailable to the smoke test');

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const payload = await login.json().catch(() => ({}));
  if (!login.ok || !payload?.ok) throw new Error(`live judge login failed: ${login.status}`);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('live judge login returned no session cookie');
  return { cookie };
}
