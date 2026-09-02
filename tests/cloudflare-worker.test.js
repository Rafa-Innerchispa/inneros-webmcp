import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { edgeAttestation } from '../src/cloudflare-worker.js';

test('edge attestation exposes only safe Cloudflare metadata', () => {
  const attestation = edgeAttestation({ cf: { colo: 'MIA', country: 'US', continent: 'NA', asn: 13335, city: 'Miami' } });
  assert.equal(attestation.ok, true);
  assert.equal(attestation.provider, 'cloudflare-workers');
  assert.equal(attestation.colo, 'MIA');
  assert.equal(attestation.country, 'US');
  assert.equal(attestation.asn, 13335);
  assert.equal('city' in attestation, false);
  assert.equal(attestation.originModel, 'private-local-origin');
});

test('worker health endpoint returns edge attestation', async () => {
  const response = await worker.fetch({ method: 'GET', url: 'https://example.workers.dev/health', cf: { colo: 'MIA', country: 'US' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'inneros-webmcp-edge');
  assert.equal(body.role, 'public-edge-attestation');
});
