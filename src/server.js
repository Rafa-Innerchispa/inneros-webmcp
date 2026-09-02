import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { invokeTool, getPolicy } from './bridge.js';
import { adapterStatus } from './inneros-adapter.js';
import { copilotStatus } from './copilot.js';
import { TOOL_NAMES } from './webmcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.WEBMCP_JUDGE_TOKEN || '';

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12000) throw new Error('body_too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

function authorized(req) {
  return !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;
}

function proofFor(tool, result, requestId, latencyMs) {
  const adapter = adapterStatus();
  const backend = tool === 'ask_inneros_copilot' ? 'local_vllm' : adapter.mode;
  return {
    requestId,
    tool,
    channel: 'webmcp',
    bridge: 'inneros-webmcp',
    backend,
    backendConfirmed: true,
    executionClaimed: Boolean(result?.executionClaimed),
    serverAt: new Date().toISOString(),
    latencyMs
  };
}

const staticFiles = new Map([
  ['/',['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/webmcp.js',['../src/webmcp.js','text/javascript; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']]
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        service: 'inneros-webmcp',
        webmcpTools: TOOL_NAMES.length,
        authRequired: Boolean(TOKEN),
        adapter: adapterStatus(),
        copilot: copilotStatus()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/policy') {
      return json(res, 200, { ok: true, ...getPolicy(), tools: TOOL_NAMES });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/tools/')) {
      if (!authorized(req)) return json(res, 401, { ok: false, state: 'rejected', error: 'unauthorized' });
      const tool = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
      if (!TOOL_NAMES.includes(tool)) return json(res, 404, { ok: false, state: 'rejected', error: 'tool_not_found' });
      const requestId = `wmcp_req_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const started = Date.now();
      const result = await invokeTool(tool, await readJson(req));
      const latencyMs = Date.now() - started;
      const proof = proofFor(tool, result, requestId, latencyMs);
      return json(res, result.ok ? 200 : 409, { ...result, proof }, {
        'x-inneros-request-id': requestId,
        'x-inneros-adapter': proof.backend,
        'server-timing': `inneros;dur=${latencyMs}`
      });
    }

    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [relative, type] = staticFiles.get(url.pathname);
      const file = path.resolve(PUBLIC_DIR, relative);
      const allowed = file.startsWith(PUBLIC_DIR) || file === path.resolve(__dirname, 'webmcp.js');
      if (!allowed) return json(res, 403, { ok: false, error: 'forbidden' });
      const content = await fs.readFile(file);
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
      });
      return res.end(content);
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return json(res, error?.message === 'body_too_large' ? 413 : 400, {
      ok: false,
      state: 'rejected',
      error: error?.message || 'bad_request'
    });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`InnerOS WebMCP listening on http://0.0.0.0:${PORT}`));
