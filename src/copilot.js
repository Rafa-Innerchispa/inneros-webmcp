const DEFAULT_TIMEOUT_MS = 45000;

function text(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function privateHostname(hostname = '') {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,2})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function resolveCopilotConfig(env = process.env) {
  const raw = text(env.INNEROS_COPILOT_URL, 500);
  const model = text(env.INNEROS_COPILOT_MODEL, 300) || 'QuantTrio/Qwen3-Coder-30B-A3B-Instruct-AWQ';
  if (!raw) return { configured: false, model, provider: 'Local AMD', runtime: 'vLLM' };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !privateHostname(url.hostname)) {
      return { configured: false, model, provider: 'Local AMD', runtime: 'vLLM' };
    }
    return { configured: true, url: url.toString(), model, provider: 'Local AMD', runtime: 'vLLM' };
  } catch {
    return { configured: false, model, provider: 'Local AMD', runtime: 'vLLM' };
  }
}

export function copilotStatus(env = process.env) {
  const cfg = resolveCopilotConfig(env);
  return {
    configured: cfg.configured,
    provider: cfg.provider,
    runtime: cfg.runtime,
    model: cfg.model,
    language: 'English only',
    executionClaimed: false
  };
}

function executionBrief(content) {
  const match = String(content || '').match(/EXECUTION BRIEF:\s*([\s\S]{1,900})$/i);
  return text(match?.[1] || content, 900);
}

export async function askInnerOSCopilot(input = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const cfg = resolveCopilotConfig(env);
  const message = text(input.message, 4000);
  const project = text(input.project, 120) || 'inneros-webmcp';
  if (!message) return { ok: false, state: 'rejected', error: 'message_required' };
  if (!cfg.configured) return { ok: false, state: 'unavailable', error: 'local_copilot_not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.INNEROS_COPILOT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const system = [
    'You are InnerOS Copilot inside a WebMCP coding mission control.',
    'Respond ONLY in English even when the user writes in another language.',
    'You are connected to a local coding model, but you do NOT execute code yourself.',
    'Never claim that files changed, tests passed, or a deployment happened unless execution evidence is supplied by the system.',
    'Be concise and useful: explain the approach, mention important risks, and propose concrete implementation steps or code when appropriate.',
    'End every answer with a single line beginning exactly with "EXECUTION BRIEF:" containing a compact instruction that another coding agent can execute.',
    `Current project: ${project}.`
  ].join(' ');

  try {
    const response = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message }
        ],
        temperature: 0.2,
        max_tokens: 1000,
        stream: false
      }),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, state: 'unavailable', error: `local_copilot_http_${response.status}` };
    const data = await response.json();
    const content = text(data?.choices?.[0]?.message?.content, 8000);
    if (!content) return { ok: false, state: 'unavailable', error: 'local_copilot_empty_response' };
    return {
      ok: true,
      state: 'answered',
      provider: cfg.provider,
      runtime: cfg.runtime,
      model: cfg.model,
      language: 'en',
      message: content,
      executionBrief: executionBrief(content),
      executionClaimed: false,
      backend: 'local_vllm'
    };
  } catch (error) {
    return {
      ok: false,
      state: 'unavailable',
      error: error?.name === 'AbortError' ? 'local_copilot_timeout' : 'local_copilot_request_failed'
    };
  } finally {
    clearTimeout(timer);
  }
}
