import { buildSceneCatalog, formatSceneLabel } from './scene-catalog.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.INNEROS_DMX_TIMEOUT_MS || 8000);

export const DEFAULT_DMX_SCENES = Object.freeze([
  'rainbow',
  'frenzy',
  'police',
  'fire',
  'chill_lounge',
  'morado_uv',
  'rojo_sangre',
  'blackout'
]);

/** @deprecated use DEFAULT_DMX_SCENES */
export const ALLOWLISTED_DMX_SCENES = DEFAULT_DMX_SCENES;

const SCENE_ALIASES = Object.freeze({
  morado_uv: { kind: 'color', color: 'morado', target: 'todas' },
  rojo_sangre: { kind: 'color', color: 'rojo', target: 'todas' }
});

const DMX_AGENT_ID = 'AG-59_dmx_artnet_orchestrator';

function loopbackHostname(hostname = '') {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function normalizeSceneName(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function extractSupportedScenes(live = {}, fallback = DEFAULT_DMX_SCENES) {
  const raw = live.supported_scenes ?? live.supportedScenes ?? live.scenes;
  let scenes = [];
  if (Array.isArray(raw)) {
    scenes = raw.map(normalizeSceneName).filter(Boolean);
  }
  if (!scenes.length) scenes = [...fallback];
  const unique = [...new Set(scenes)];
  if (!unique.includes('blackout')) unique.push('blackout');
  return Object.freeze(unique);
}

export function extractDynamicScenes(live = {}) {
  const raw = live.dynamic_scenes ?? live.dynamicScenes ?? {};
  if (!raw || typeof raw !== 'object') return {};
  return sanitizePublic(raw);
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
    allowlistedScenes: DEFAULT_DMX_SCENES,
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
  const supportedScenes = extractSupportedScenes(live);
  const dynamicScenes = extractDynamicScenes(live);
  const sceneCatalog = buildSceneCatalog(supportedScenes, dynamicScenes);
  return {
    ok: true,
    state: 'ready',
    agent: DMX_AGENT_ID,
    coordinatingAgent: 'AG-32_home_assistant_bridge',
    engine: 'inneros-dmx-engine',
    fixtureCount: Number(live.fixture_count ?? live.fixtureCount) || 9,
    supportedScenes,
    dynamicScenes,
    sceneCatalog,
    currentEffect: live.current_effect || live.currentEffect || null,
    running: Boolean(live.running),
    executionClaimed: false
  };
}

export async function setDmxScene(input = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const scene = normalizeSceneName(input.scene || input.mode);
  if (!scene) {
    return { ok: false, state: 'rejected', error: 'scene_required' };
  }

  const status = await getDmxStatus({ env, fetchImpl });
  const allowedScenes = status.ok ? status.supportedScenes : DEFAULT_DMX_SCENES;
  if (!allowedScenes.includes(scene)) {
    return { ok: false, state: 'rejected', error: 'scene_not_allowlisted', allowlistedScenes: allowedScenes };
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
      ? { ok: true, state: 'applied', scene, label: formatSceneLabel(scene), action: 'color', color: alias.color, target: alias.target, agent: DMX_AGENT_ID, executionClaimed: true }
      : result;
  }

  const result = await dmxFetch('/api/scene', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: scene, speed: Number(input.speed) || 1.0 })
  }, env, fetchImpl);
  return result.ok
    ? { ok: true, state: 'applied', scene, label: formatSceneLabel(scene), action: 'effect', agent: DMX_AGENT_ID, executionClaimed: true }
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

export async function createDmxScene(input = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const name = normalizeSceneName(input.name);
  const label = String(input.label || '').trim().slice(0, 80);
  const loops = Number(input.loops);
  const steps = Array.isArray(input.steps) ? input.steps.slice(0, 24) : [];
  if (!name || !label || !Number.isInteger(loops) || !steps.length) {
    return { ok: false, state: 'rejected', error: 'invalid_scene_definition' };
  }
  const result = await dmxFetch('/api/scenes/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, scene: { label, loops, steps } })
  }, env, fetchImpl);
  if (!result.ok) return result;
  const supportedScenes = extractSupportedScenes(result);
  const dynamicScenes = extractDynamicScenes(result);
  const sceneCatalog = buildSceneCatalog(supportedScenes, dynamicScenes);
  return {
    ok: true,
    state: 'registered',
    scene: name,
    label,
    loops,
    steps,
    supportedScenes,
    dynamicScenes,
    sceneCatalog,
    agent: DMX_AGENT_ID,
    action: 'scene_registered',
    executionClaimed: true,
    physicalExecutionClaimed: false
  };
}
