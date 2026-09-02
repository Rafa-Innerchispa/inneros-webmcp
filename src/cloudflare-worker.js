const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff'
});

export function edgeAttestation(request) {
  const cf = request?.cf || {};
  return {
    ok: true,
    service: 'inneros-webmcp-edge',
    provider: 'cloudflare-workers',
    role: 'public-edge-attestation',
    originModel: 'private-local-origin',
    colo: typeof cf.colo === 'string' ? cf.colo : null,
    country: typeof cf.country === 'string' ? cf.country : null,
    continent: typeof cf.continent === 'string' ? cf.continent : null,
    asn: Number.isFinite(cf.asn) ? cf.asn : null,
    timestamp: new Date().toISOString()
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/edge/attest')) {
      return json(edgeAttestation(request));
    }
    return json({ ok: false, error: 'not_found' }, 404);
  }
};
