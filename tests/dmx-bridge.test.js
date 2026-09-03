import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWLISTED_DMX_SCENES,
  getDmxStatus,
  resolveDmxApiUrl,
  runDmxBlackout,
  setDmxScene
} from '../src/dmx-bridge.js';

test('dmx api url accepts only private backends', () => {
  assert.equal(resolveDmxApiUrl({ INNEROS_DMX_API_URL: 'http://127.0.0.1:8096' }), 'http://127.0.0.1:8096');
  assert.equal(resolveDmxApiUrl({ INNEROS_DMX_API_URL: 'http://192.168.1.5:8096' }), 'http://192.168.1.5:8096');
  assert.equal(resolveDmxApiUrl({ INNEROS_DMX_API_URL: 'https://example.com' }), '');
});

test('dmx status sanitizes private topology', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { ok: true, current_effect: 'rainbow', running: true, target_ip: '192.168.1.10' };
    }
  });
  const result = await getDmxStatus({
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:8096' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.agent, 'AG-57_dmx_artnet_orchestrator');
  assert.equal(result.currentEffect, 'rainbow');
  assert.equal('target_ip' in result, false);
});

test('dmx scene rejects non-allowlisted scenes', async () => {
  const result = await setDmxScene({ scene: 'raw_channel_512' }, {
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:8096' },
    fetchImpl: async () => { throw new Error('should not call'); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'scene_not_allowlisted');
  assert.deepEqual(result.allowlistedScenes, ALLOWLISTED_DMX_SCENES);
});

test('dmx blackout calls private engine endpoint', async () => {
  let path = '';
  const fetchImpl = async (url, options) => {
    path = url;
    assert.equal(options.method, 'POST');
    return { ok: true, async json() { return { ok: true, action: 'blackout' }; } };
  };
  const result = await runDmxBlackout({
    env: { INNEROS_DMX_API_URL: 'http://127.0.0.1:8096' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.match(path, /\/api\/blackout$/);
});
