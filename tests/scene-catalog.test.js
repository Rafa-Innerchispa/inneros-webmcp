import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneCatalog, inferSceneTags } from '../src/scene-catalog.js';

test('buildSceneCatalog prefers dynamic labels', () => {
  const catalog = buildSceneCatalog(['rainbow', 'aurora_pulse'], {
    aurora_pulse: { label: 'Aurora Pulse', dynamic: true }
  });
  assert.equal(catalog[1].label, 'Aurora Pulse');
});

test('inferSceneTags marks pulse scenes', () => {
  assert.ok(inferSceneTags('flash_all_demo', { dynamic: true }).includes('pulse'));
});
