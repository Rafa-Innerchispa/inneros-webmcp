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

export function isDmxSceneCreationIntent(value = '') {
  const message = String(value || '').toLowerCase();
  return /(crea|crear|cree|nueva|nuevo|create|make|build|design)/.test(message)
    && /(escena|scene|efecto|effect)/.test(message)
    && /(dmx|luz|luces|light|lights|iluminaci[oó]n)/.test(message);
}

export async function askInnerOSCopilot(input = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const cfg = resolveCopilotConfig(env);
  const message = text(input.message, 4000);
  const project = text(input.project, 120) || 'inneros-webmcp';
  if (!message) return { ok: false, state: 'rejected', error: 'message_required' };
  if (!cfg.configured) return { ok: false, state: 'unavailable', error: 'local_copilot_not_configured' };
  const dmxSceneIntent = isDmxSceneCreationIntent(message);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.INNEROS_COPILOT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const system = [
    'You are InnerOS Copilot inside a WebMCP coding mission control.',
    'Respond ONLY in English even when the user writes in another language.',
    'You are connected to a local coding model, but you do NOT execute code yourself.',
    'Never claim that files changed, tests passed, or a deployment happened unless execution evidence is supplied by the system.',
    'Be concise and useful: explain the approach, mention important risks, and propose concrete implementation steps or code when appropriate.',
    dmxSceneIntent
      ? 'This request is a governed native AG-59 DMX scene-creation action. Do NOT propose raw DMX addresses, raw channels, RGB channel writes, strobe frequencies, or flashes faster than 650ms per full-stage step. At the time of this reply NO scene has been created or registered yet. Never claim created, registered, complete, applied, or executed. Explain that AUTO will attempt safe design and registration immediately after this reply, while physical light execution remains a separate Apply Scene action.'
      : '',
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
    const responseMessage = dmxSceneIntent
      ? 'Native AG-59 DMX scene creation detected. No scene has been registered yet. In AUTO, InnerOS will now ask the local Qwen scene designer for a bounded definition, normalize and validate it, then request AG-59 registration. The physical lights will remain idle until you press Apply scene.'
      : content;
    const brief = dmxSceneIntent
      ? text(`Design and register a safe bounded AG-59 DMX scene from this user request: ${message}`, 900)
      : executionBrief(content);
    return {
      ok: true,
      state: 'answered',
      provider: cfg.provider,
      runtime: cfg.runtime,
      model: cfg.model,
      language: 'en',
      message: responseMessage,
      executionBrief: brief,
      nativeAction: dmxSceneIntent ? 'dmx_create_scene' : '',
      autoRunnable: dmxSceneIntent,
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

function extractJsonObject(content = '') {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

export async function designDmxScene(description, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const cfg = resolveCopilotConfig(env);
  const request = text(description, 1800);
  if (!request) return { ok: false, state: 'rejected', error: 'description_required' };
  if (!cfg.configured) return { ok: false, state: 'unavailable', error: 'local_copilot_not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.INNEROS_COPILOT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const system = [
    'You design one safe declarative DMX lighting scene for InnerOS.',
    'Return ONE JSON object only. No markdown and no explanation.',
    'Schema: {"name":"lower_snake_case","label":"Human Label","loops":1,"steps":[{"target":"all","color":"morado","brightness":180,"duration_ms":700}]}.',
    'name must match ^[a-z0-9_]{1,48}$.',
    'target must be one of all,todas,tachos,beams,pulpos,bola_disco.',
    'color must be one of rojo,verde,azul,amarillo,magenta,fucsia,cian,celeste,turquesa,naranja,ambar,dorado,violeta,morado,purpura,rosa,rosado,lima,blanco,blanco_calido,blanco_frio,neon,cyberpunk,blackout or #RRGGBB.',
    'brightness is integer 0..255. loops 1..4. steps 1..8.',
    'For target all/todas every duration_ms must be at least 650. For other groups use at least 250.',
    'Never create rapid strobe, raw DMX channels, fixture addresses, or more than 20 seconds total duration.',
    'If the user asks for flashing, interpret it as slow alternating pulses at 650ms or slower.',
    'If the user explicitly gives a scene name, preserve that human name in label and normalize it to lower_snake_case for name. Example: "flash blue" becomes label "Flash Blue" and name "flash_blue".',
    'If the user asks for a flash/pulse in a color, alternate that requested color with blackout. For full-stage target all/todas, every step must be at least 650ms.',
    'Use blackout with brightness 0 for an off step.'
  ].join(' ');
  try {
    const response = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: request }], temperature: 0.1, max_tokens: 700, stream: false }),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, state: 'unavailable', error: `local_copilot_http_${response.status}` };
    const data = await response.json();
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || '');
    if (!parsed || typeof parsed !== 'object') return { ok: false, state: 'rejected', error: 'dmx_scene_json_invalid' };
    const name = text(parsed.name, 48).toLowerCase();
    const label = text(parsed.label, 80);
    const loops = Number(parsed.loops);
    const steps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, 8) : [];
    if (!/^[a-z0-9_]{1,48}$/.test(name) || !label || !Number.isInteger(loops) || loops < 1 || loops > 4 || !steps.length) {
      return { ok: false, state: 'rejected', error: 'dmx_scene_shape_invalid' };
    }
    return { ok: true, state: 'designed', provider: cfg.provider, runtime: cfg.runtime, model: cfg.model, scene: { name, label, loops, steps }, executionClaimed: false };
  } catch (error) {
    return { ok: false, state: 'unavailable', error: error?.name === 'AbortError' ? 'local_copilot_timeout' : 'local_copilot_request_failed' };
  } finally {
    clearTimeout(timer);
  }
}
