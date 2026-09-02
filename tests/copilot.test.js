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
