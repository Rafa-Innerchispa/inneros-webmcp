const ADAPTER_URL = (process.env.INNEROS_ADAPTER_URL || '').replace(/\/$/, '');
const ADAPTER_TOKEN = process.env.INNEROS_ADAPTER_TOKEN || '';
const TIMEOUT_MS = Number(process.env.INNEROS_ADAPTER_TIMEOUT_MS || 8000);

const ALLOWED_REMOTE_TOOLS = new Set([
  'list_agents',
  'get_project_status',
  'inspect_blockers',
  'dispatch_agent_action',
  'resolve_project_blocker',
  'get_execution_trace',
  'get_evidence'
]);

export function adapterConfigured() {
  return Boolean(ADAPTER_URL);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const blocked = /token|secret|password|authorization|credential|private.?key/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, child]) => [key, sanitize(child)]));
}

export async function callInnerOS(tool, input = {}) {
  if (!ALLOWED_REMOTE_TOOLS.has(tool)) return { ok: false, state: 'rejected', error: 'adapter_tool_not_allowlisted' };
  if (!ADAPTER_URL) return { ok: false, state: 'unavailable', error: 'inneros_adapter_not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (ADAPTER_TOKEN) headers.authorization = `Bearer ${ADAPTER_TOKEN}`;
    const response = await fetch(`${ADAPTER_URL}/tools/${encodeURIComponent(tool)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: controller.signal
    });
    const body = sanitize(await response.json());
    if (!response.ok) return { ok: false, state: body.state || 'unavailable', error: body.error || 'inneros_adapter_error', detail: body.detail };
    return body;
  } catch (error) {
    return { ok: false, state: 'unavailable', error: error.name === 'AbortError' ? 'inneros_adapter_timeout' : 'inneros_adapter_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
