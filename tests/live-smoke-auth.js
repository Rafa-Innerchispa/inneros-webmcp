const DEFAULT_LIVE_URL = 'http://127.0.0.1:5195';

function cookieHeaderFromResponse(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie().map((part) => part.split(';')[0]).filter(Boolean).join('; ');
  }
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0] : '';
}

export async function prepareLiveSmokeAuth(baseUrl = process.env.WEBMCP_LIVE_URL || DEFAULT_LIVE_URL) {
  let statusResponse;
  try {
    statusResponse = await fetch(`${baseUrl}/api/auth/status`);
  } catch {
    return { kind: 'skip', reason: `live WebMCP unreachable at ${baseUrl}` };
  }

  let status = {};
  try {
    status = await statusResponse.json();
  } catch {
    return { kind: 'skip', reason: 'live WebMCP auth/status returned non-JSON response' };
  }

  const authRequired = Boolean(status.auth?.required);
  const baseHeaders = { 'content-type': 'application/json' };
  if (!authRequired) return { kind: 'ok', baseUrl, headers: baseHeaders };

  const username = String(process.env.WEBMCP_TEST_USERNAME || '').trim();
  const password = String(process.env.WEBMCP_TEST_PASSWORD || '').trim();
  if (!username || !password) {
    return {
      kind: 'skip',
      reason: 'auth required for live smoke; set WEBMCP_TEST_USERNAME and WEBMCP_TEST_PASSWORD'
    };
  }

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ username, password })
  });
  let login = {};
  try {
    login = await loginResponse.json();
  } catch {
    return { kind: 'skip', reason: 'live smoke login returned non-JSON response' };
  }
  if (!loginResponse.ok || login.ok !== true) {
    return { kind: 'skip', reason: 'live smoke login rejected; check WEBMCP_TEST credentials' };
  }

  const cookie = cookieHeaderFromResponse(loginResponse);
  if (!cookie) {
    return { kind: 'skip', reason: 'live smoke login succeeded but no session cookie was returned' };
  }

  return {
    kind: 'ok',
    baseUrl,
    headers: { ...baseHeaders, cookie }
  };
}

export function applyLiveSmokeSkip(testContext, auth) {
  if (auth.kind === 'skip') testContext.skip(auth.reason);
}
