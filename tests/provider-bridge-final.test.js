import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalIdeEvidence, canonicalIdeState, findIdeDispatchPayload, resolveProjectBinding } from '../src/inneros-adapter.js';

test('execution accepts a verified local Git workspace even without a remote repo', () => {
  const remoteBound = resolveProjectBinding({
    ok: true,
    exists: true,
    is_git: true,
    project_path: '/home/rlopez/projects/inneros-webmcp',
    project: { project_id: 'inneros-webmcp', repo: 'Rafa-Innerchispa/inneros-webmcp' }
  }, 'inneros-webmcp');
  assert.equal(remoteBound.ok, true);
  assert.equal(remoteBound.repo, 'Rafa-Innerchispa/inneros-webmcp');
  assert.equal(remoteBound.branch, 'main');
  assert.match(remoteBound.worktree, /inneros-webmcp$/);

  const localOnly = resolveProjectBinding({
    ok: true,
    exists: true,
    is_git: true,
    project_path: '/home/rlopez/projects/new-local-project',
    project: { project_id: 'new-local-project' }
  }, 'new-local-project');
  assert.equal(localOnly.ok, true);
  assert.equal(localOnly.repo, '');
  assert.equal(localOnly.branch, 'main');
  assert.match(localOnly.worktree, /new-local-project$/);

  const missing = resolveProjectBinding({ ok: true, exists: true, is_git: false, project: {} }, 'missing');
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

test('finds IDE dispatch payload through nested FastMCP envelopes', () => {
  const expected = {
    ok: true,
    dispatch_id: 'ide_1234567890abcdef',
    delivery_state: 'delivered_to_inbox',
    execution_state: 'queued'
  };
  const nested = {
    result: {
      structuredContent: {
        result: JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(expected) }]
        })
      }
    }
  };
  assert.deepEqual(findIdeDispatchPayload(nested), expected);
});
