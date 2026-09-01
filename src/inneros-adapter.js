const TIMEOUT_MS = Number(process.env.INNEROS_ADAPTER_TIMEOUT_MS || 8000);
const ADAPTER_TOKEN = process.env.INNEROS_ADAPTER_TOKEN || '';

const ALLOWED_REMOTE_TOOLS = new Set([
  'list_agents',
  'get_project_status',
  'inspect_blockers',
  'dispatch_agent_action',
  'resolve_project_blocker',
  'get_execution_trace',
  'get_evidence'
]);

export function resolveAdapterUrls(env = process.env) {
  const candidates = [
    ...(env.INNEROS_ADAPTER_URLS || '').split(','),
    env.INNEROS_ADAPTER_URL || '',
    env.INNEROS_ADAPTER_FALLBACK_URL || ''
  ];
  return [...new Set(candidates.map((value) => value.trim().replace(/\/$/, '')).filter(Boolean))];
}

function urls() {
  return resolveAdapterUrls();
}

export function adapterConfigured() {
  return urls().length > 0;
}

export function adapterStatus() {
  return { configured: adapterConfigured(), endpointCount: urls().length, failover: urls().length > 1 };
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const blocked = /token|secret|password|authorization|credential|private.?key|url/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, child]) => [key, sanitize(child)]));
}

async function invokeEndpoint(baseUrl, tool, input, endpointIndex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (ADAPTER_TOKEN) headers.authorization = `Bearer ${ADAPTER_TOKEN}`;
    const response = await fetch(`${baseUrl}/tools/${encodeURIComponent(tool)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: controller.signal
    });
    let body = {};
    try { body = sanitize(await response.json()); } catch { body = {}; }
    if (response.ok) return { terminal: true, result: { ...body, adapterEndpoint: endpointIndex } };
    if ([502,503,504].includes(response.status)) {
      return { terminal: false, result: { ok: false, state: 'unavailable', error: `inneros_adapter_http_${response.status}`, adapterEndpoint: endpointIndex } };
    }
    return {
      terminal: true,
      result: { ok: false, state: body.state || 'unavailable', error: body.error || `inneros_adapter_http_${response.status}`, detail: body.detail, adapterEndpoint: endpointIndex }
    };
  } catch (error) {
    return {
      terminal: false,
      result: { ok: false, state: 'unavailable', error: error.name === 'AbortError' ? 'inneros_adapter_timeout' : 'inneros_adapter_unreachable', adapterEndpoint: endpointIndex }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function callInnerOS(tool, input = {}) {
  if (!ALLOWED_REMOTE_TOOLS.has(tool)) return { ok: false, state: 'rejected', error: 'adapter_tool_not_allowlisted' };
  const endpoints = urls();
  if (!endpoints.length) return { ok: false, state: 'unavailable', error: 'inneros_adapter_not_configured' };

  let last = { ok: false, state: 'unavailable', error: 'inneros_adapter_unreachable' };
  for (let index = 0; index < endpoints.length; index += 1) {
    const attempt = await invokeEndpoint(endpoints[index], tool, input, index);
    last = attempt.result;
    if (attempt.terminal) return { ...attempt.result, adapterAttempts: index + 1 };
  }
  return { ...last, adapterAttempts: endpoints.length, failoverExhausted: endpoints.length > 1 };
}
