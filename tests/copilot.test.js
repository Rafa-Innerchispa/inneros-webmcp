import test from 'node:test';
import assert from 'node:assert/strict';
import { askInnerOSCopilot, resolveCopilotConfig, copilotStatus } from '../src/copilot.js';

test('copilot accepts only private backend URLs', () => {
  assert.equal(resolveCopilotConfig({ INNEROS_COPILOT_URL: 'http://192.168.1.5:8000/v1/chat/completions' }).configured, true);
  assert.equal(resolveCopilotConfig({ INNEROS_COPILOT_URL: 'https://example.com/v1/chat/completions' }).configured, false);
  assert.equal(resolveCopilotConfig({ INNEROS_COPILOT_URL: '' }).configured, false);
});

test('copilot status never claims execution', () => {
  const status = copilotStatus({ INNEROS_COPILOT_URL: 'http://10.0.0.2:8000/v1/chat/completions' });
  assert.equal(status.configured, true);
  assert.equal(status.executionClaimed, false);
  assert.equal(status.language, 'English only');
});

test('copilot returns answer and bounded execution brief without claiming execution', async () => {
  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'I would add a health field and a focused test.\n\nEXECUTION BRIEF: Add a read-only status field and test it. Do not change unrelated files.' } }] };
      }
    };
  };
  const result = await askInnerOSCopilot({ project: 'inneros-webmcp', message: 'Improve health status' }, {
    env: {
      INNEROS_COPILOT_URL: 'http://192.168.1.5:8000/v1/chat/completions',
      INNEROS_COPILOT_MODEL: 'test-model',
      INNEROS_COPILOT_TIMEOUT_MS: '2000'
    },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.executionClaimed, false);
  assert.equal(result.executionBrief, 'Add a read-only status field and test it. Do not change unrelated files.');
  assert.equal(requestBody.model, 'test-model');
  assert.match(requestBody.messages[0].content, /Respond ONLY in English/);
  assert.match(requestBody.messages[0].content, /do NOT execute code yourself/);
});

test('copilot fails truthfully when not configured', async () => {
  const result = await askInnerOSCopilot({ message: 'write code' }, { env: {}, fetchImpl: async () => { throw new Error('should not call'); } });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.error, 'local_copilot_not_configured');
});


test('local model can design a bounded DMX scene as structured JSON without executing it', async () => {
  const { designDmxScene } = await import('../src/copilot.js');
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: JSON.stringify({
        name: 'aurora_pulse', label: 'Aurora Pulse', loops: 2,
        steps: [
          { target: 'all', color: 'morado', brightness: 180, duration_ms: 700 },
          { target: 'all', color: 'azul', brightness: 160, duration_ms: 700 }
        ]
      }) } }] };
    }
  });
  const result = await designDmxScene('Create an Aurora Pulse lighting scene', {
    env: { INNEROS_COPILOT_URL: 'http://127.0.0.1:18000/v1/chat/completions', INNEROS_COPILOT_MODEL: 'test-local-model' },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'designed');
  assert.equal(result.scene.name, 'aurora_pulse');
  assert.equal(result.executionClaimed, false);
});


test('DMX scene intent is tagged as a safe native AUTO action', async () => {
  const { isDmxSceneCreationIntent } = await import('../src/copilot.js');
  assert.equal(isDmxSceneCreationIntent('crea una escena nueva paera todas las luces demx que funiconen como flash en azul y ponle el nombre flash blue'), true);
  assert.equal(isDmxSceneCreationIntent('fix the README typo'), false);

  let requestBody = null;
  const result = await askInnerOSCopilot({
    project: 'inneros-webmcp',
    message: 'crea una escena nueva para todas las luces dmx que funcionen como flash en rojo y ponle el nombre flash rojo'
  }, {
    env: { INNEROS_COPILOT_URL: 'http://127.0.0.1:18000/v1/chat/completions', INNEROS_COPILOT_MODEL: 'test-model' },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, async json() { return { choices: [{ message: { content: 'AUTO can register this bounded AG-59 scene without running the fixtures.\nEXECUTION BRIEF: Register a safe slow red flash scene named Flash Rojo.' } }] }; } };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.nativeAction, 'dmx_create_scene');
  assert.equal(result.autoRunnable, true);
  assert.match(requestBody.messages[0].content, /Do NOT propose raw DMX addresses/);
  assert.match(requestBody.messages[0].content, /flashes faster than 650ms/);
});

test('DMX designer prompt preserves explicit names and converts flash to bounded color-blackout pulses', async () => {
  const { designDmxScene } = await import('../src/copilot.js');
  let requestBody = null;
  const result = await designDmxScene('crea flash azul y ponle el nombre flash blue', {
    env: { INNEROS_COPILOT_URL: 'http://127.0.0.1:18000/v1/chat/completions', INNEROS_COPILOT_MODEL: 'test-model' },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, async json() { return { choices: [{ message: { content: JSON.stringify({ name: 'flash_blue', label: 'Flash Blue', loops: 2, steps: [
        { target: 'all', color: 'azul', brightness: 220, duration_ms: 700 },
        { target: 'all', color: 'blackout', brightness: 0, duration_ms: 700 }
      ] }) } }] }; } };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.scene.name, 'flash_blue');
  assert.equal(result.scene.label, 'Flash Blue');
  assert.match(requestBody.messages[0].content, /preserve that human name/);
  assert.match(requestBody.messages[0].content, /alternate that requested color with blackout/);
});
