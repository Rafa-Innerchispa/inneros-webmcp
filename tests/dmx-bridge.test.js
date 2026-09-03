import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWLISTED_DMX_SCENES,
  DEFAULT_DMX_SCENES,
  extractSupportedScenes,
  getDmxStatus,
  resolveDmxApiUrl,
  runDmxBlackout,
  setDmxScene
} from '../src/dmx-bridge.js';

test('dmx api url accepts only loopback backends', () => {
  assert.equal(resolveDmxApiUrl({ INNEROS_DMX_API_URL: 'http://127.0.0.1:18796' }), 'http://127.0.0.1:18796');
  assert.equal(resolveDmxApiUrl({ INNEROS_DMX_API_URL: 'http://192.168.1.5:18796' }), '');
  assert.equal(resolveDmxApiUrl({ INNEROS_DMX_API_URL: 'https://example.com' }), '');
});

test('extractSupportedScenes consumes backend registry fields', () => {
  assert.deepEqual(
    extractSupportedScenes({ supported_scenes: ['Rainbow', 'flash_all_demo'] }),
    ['rainbow', 'flash_all_demo', 'blackout']
  );
  assert.deepEqual(
    extractSupportedScenes({ supportedScenes: ['police'] }),
    ['police', 'blackout']
  );
  assert.deepEqual(extractSupportedScenes({}), DEFAULT_DMX_SCENES);
});

test('dmx status sanitizes private topology and uses dynamic scenes', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        ok: true,
        current_effect: 'rainbow',
        running: true,
        target_ip: '192.168.1.10',
        supported_scenes: ['rainbow', 'flash_all_demo', 'blackout']
      };
    }
  });
  const result = await getDmxStatus({
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:18796' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.agent, 'AG-59_dmx_artnet_orchestrator');
  assert.equal(result.currentEffect, 'rainbow');
  assert.deepEqual(result.supportedScenes, ['rainbow', 'flash_all_demo', 'blackout']);
  assert.equal('target_ip' in result, false);
});

test('dmx scene rejects non-allowlisted scenes', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/status')) {
      return { ok: true, async json() { return { supported_scenes: ['rainbow', 'blackout'] }; } };
    }
    throw new Error('should not call scene endpoint');
  };
  const result = await setDmxScene({ scene: 'raw_channel_512' }, {
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:18796' },
    fetchImpl
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'scene_not_allowlisted');
  assert.deepEqual(result.allowlistedScenes, ['rainbow', 'blackout']);
});

test('dmx scene accepts newly registered validated scene from backend', async () => {
  let scenePath = '';
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/api/status')) {
      return { ok: true, async json() { return { supported_scenes: ['flash_all_demo', 'blackout'] }; } };
    }
    scenePath = url;
    assert.equal(options.method, 'POST');
    return { ok: true, async json() { return { ok: true, mode: 'flash_all_demo' }; } };
  };
  const result = await setDmxScene({ scene: 'flash_all_demo' }, {
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:18796' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.match(scenePath, /\/api\/scene$/);
});

test('dmx blackout calls private engine endpoint', async () => {
  let path = '';
  const fetchImpl = async (url, options) => {
    path = url;
    assert.equal(options.method, 'POST');
    return { ok: true, async json() { return { ok: true, action: 'blackout' }; } };
  };
  const result = await runDmxBlackout({
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:18796' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.match(path, /\/api\/blackout$/);
});

test('legacy allowlist export remains available', () => {
  assert.deepEqual(ALLOWLISTED_DMX_SCENES, DEFAULT_DMX_SCENES);
});


test('dmx create scene registers a structured scene without physical execution', async () => {
  const { createDmxScene } = await import('../src/dmx-bridge.js');
  let body = null;
  const fetchImpl = async (url, options = {}) => {
    assert.match(String(url), /\/api\/scenes\/register$/);
    assert.equal(options.method, 'POST');
    body = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          action: 'scene_registered',
          scene: 'aurora_pulse',
          supported_scenes: ['rainbow', 'aurora_pulse', 'blackout']
        };
      }
    };
  };
  const result = await createDmxScene({
    name: 'aurora_pulse',
    label: 'Aurora Pulse',
    loops: 2,
    steps: [
      { target: 'all', color: 'morado', brightness: 180, duration_ms: 700 },
      { target: 'all', color: 'azul', brightness: 160, duration_ms: 700 }
    ]
  }, {
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:18796' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'registered');
  assert.equal(result.physicalExecutionClaimed, false);
  assert.equal(body.name, 'aurora_pulse');
  assert.deepEqual(result.supportedScenes, ['rainbow', 'aurora_pulse', 'blackout']);
});
