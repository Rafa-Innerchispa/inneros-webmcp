import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalIdeEvidence, canonicalIdeState, resolveProjectBinding } from '../src/inneros-adapter.js';

test('external execution requires a verified project repo binding', () => {
  const bound = resolveProjectBinding({
    ok: true,
    exists: true,
    project: { project_id: 'inneros-webmcp', repo: 'Rafa-Innerchispa/inneros-webmcp' }
  }, 'inneros-webmcp');
  assert.equal(bound.ok, true);
  assert.equal(bound.repo, 'Rafa-Innerchispa/inneros-webmcp');
  assert.equal(bound.branch, 'main');

  const missing = resolveProjectBinding({ ok: true, exists: true, project: {} }, 'missing');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'verified_project_binding_required');
});

test('canonical ops completion overrides stale queued IDE projection', () => {
  assert.equal(canonicalIdeState({ execution_state: 'queued', ops_status: 'completed' }), 'completed');
  assert.deepEqual(
    canonicalIdeEvidence({ evidence: {}, ops_evidence: { sha: 'abc123', tests: 'PASS' } }),
    { sha: 'abc123', tests: 'PASS' }
  );
});
