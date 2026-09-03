const DEFAULT_TIMEOUT_MS = Number(process.env.INNEROS_DMX_TIMEOUT_MS || 8000);

export const ALLOWLISTED_DMX_SCENES = Object.freeze([
  'rainbow',
  'frenzy',
  'police',
  'fire',
  'chill_lounge',
  'morado_uv',
  'rojo_sangre',
  'blackout'
]);

const SCENE_ALIASES = Object.freeze({
  morado_uv: { kind: 'color', color: 'morado', target: 'todas' },
  rojo_sangre: { kind: 'color', color: 'rojo', target: 'todas' }
});

const DMX_AGENT_ID = 'AG-59_dmx_artnet_orchestrator';

function loopbackHostname(hostname = '') {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function resolveDmxApiUrl(env = process.env) {
  const raw = String(env.INNEROS_DMX_API_URL || 'http://127.0.0.1:18796').trim();
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !loopbackHostname(url.hostname)) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function dmxConfigured(env = process.env) {
  return Boolean(resolveDmxApiUrl(env));
}

export function dmxStatus(env = process.env) {
  return {
    configured: dmxConfigured(env),
    agent: DMX_AGENT_ID,
    coordinatingAgent: 'AG-32_home_assistant_bridge',
    allowlistedScenes: ALLOWLISTED_DMX_SCENES,
    executionClaimed: false
  };
}

function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (typeof value === 'string') {
    return value
      .replace(/\b(?:127\.0\.0\.1|localhost|192\.168\.\d{1,3}\.\d{1,3})\b/gi, '[redacted-host]')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[redacted-host]');
  }
  if (!value || typeof value !== 'object') return value;
  const blocked = /ip|host|target_ip|url|path|token|secret|password/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, child]) => [key, sanitizePublic(child)]));
}

async function dmxFetch(path, options = {}, env = process.env, fetchImpl = fetch) {
  const base = resolveDmxApiUrl(env);
  if (!base) return { ok: false, state: 'unavailable', error: 'dmx_api_not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}${path}`, { ...options, signal: controller.signal });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      return { ok: false, state: 'unavailable', error: `dmx_api_http_${response.status}`, detail: sanitizePublic(data) };
    }
    return { ok: true, state: 'ready', ...sanitizePublic(data) };
  } catch (error) {
    return {
      ok: false,
      state: 'unavailable',
      error: error?.name === 'AbortError' ? 'dmx_api_timeout' : 'dmx_api_unreachable'
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getDmxStatus(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  if (!dmxConfigured(env)) {
    return { ok: false, state: 'unavailable', error: 'dmx_api_not_configured', agent: DMX_AGENT_ID };
  }
  const live = await dmxFetch('/api/status', {}, env, fetchImpl);
  if (!live.ok) return live;
  return {
    ok: true,
    state: 'ready',
    agent: DMX_AGENT_ID,
    coordinatingAgent: 'AG-32_home_assistant_bridge',
    engine: 'inneros-dmx-engine',
    fixtureCount: 9,
    supportedScenes: ALLOWLISTED_DMX_SCENES,
    currentEffect: live.current_effect || live.currentEffect || null,
    running: Boolean(live.running),
    executionClaimed: false
  };
}

export async function setDmxScene(input = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const scene = String(input.scene || input.mode || '').trim().toLowerCase();
  if (!ALLOWLISTED_DMX_SCENES.includes(scene)) {
    return { ok: false, state: 'rejected', error: 'scene_not_allowlisted', allowlistedScenes: ALLOWLISTED_DMX_SCENES };
  }
  if (scene === 'blackout') return runDmxBlackout(options);

  const alias = SCENE_ALIASES[scene];
  if (alias?.kind === 'color') {
    const result = await dmxFetch('/api/color', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ color: alias.color, target: alias.target, brightness: 255 })
    }, env, fetchImpl);
    return result.ok
      ? { ok: true, state: 'applied', scene, action: 'color', color: alias.color, target: alias.target, agent: DMX_AGENT_ID, executionClaimed: true }
      : result;
  }

  const result = await dmxFetch('/api/scene', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: scene, speed: Number(input.speed) || 1.0 })
  }, env, fetchImpl);
  return result.ok
    ? { ok: true, state: 'applied', scene, action: 'effect', agent: DMX_AGENT_ID, executionClaimed: true }
    : result;
}

export async function runDmxBlackout(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const result = await dmxFetch('/api/blackout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, env, fetchImpl);
  return result.ok
    ? { ok: true, state: 'applied', action: 'blackout', agent: DMX_AGENT_ID, executionClaimed: true }
    : result;
}
