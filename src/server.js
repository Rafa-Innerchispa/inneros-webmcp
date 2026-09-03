import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { invokeTool, getPolicy } from './bridge.js';
import { adapterStatus } from './inneros-adapter.js';
import { copilotStatus } from './copilot.js';
import { TOOL_NAMES } from './webmcp.js';
import {
  authStatus,
  authenticateRequest,
  login,
  sessionCookie,
  clearSessionCookie
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);

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
  ['/login.html',['login.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/webmcp.js',['../src/webmcp.js','text/javascript; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']]
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const auth = authenticateRequest(req);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const status = authStatus();
      return json(res, 200, {
        ok: !status.failClosed,
        service: 'inneros-webmcp',
        webmcpTools: TOOL_NAMES.length,
        auth: status,
        adapter: adapterStatus(),
        copilot: copilotStatus()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const status = authStatus();
      return json(res, 200, { ok: !status.failClosed, authenticated: auth.ok, auth: status });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(req);
      const result = login(String(body.username || ''), String(body.password || ''), req);
      if (!result.ok) return json(res, result.error === 'too_many_attempts' ? 429 : 401, result);
      return json(res, 200, { ok: true, state: result.state, username: result.username }, {
        'set-cookie': sessionCookie(result.token)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      return json(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
    }

    if (req.method === 'GET' && url.pathname === '/api/policy') {
      if (!auth.ok) return json(res, 401, { ok: false, state: 'rejected', error: auth.error || 'unauthorized' });
      return json(res, 200, { ok: true, ...getPolicy(), tools: TOOL_NAMES });
    }

    if (req.method === 'GET' && url.pathname === '/api/provider-status') {
      if (!auth.ok) return json(res, 401, { ok: false, state: 'rejected', error: auth.error || 'unauthorized' });
      const agents = await invokeTool('list_agents', {});
      return json(res, 200, { ok: true, live: Boolean(agents?.live), agents: agents?.agents || [] });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/tools/')) {
      if (!auth.ok) return json(res, 401, { ok: false, state: 'rejected', error: auth.error || 'unauthorized' });
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
      const status = authStatus();
      const isLogin = url.pathname === '/login.html';
      if (status.required && !auth.ok && !isLogin && url.pathname !== '/styles.css') {
        res.writeHead(302, { location: '/login.html', 'cache-control': 'no-store' });
        return res.end();
      }
      if (isLogin && auth.ok) {
        res.writeHead(302, { location: '/', 'cache-control': 'no-store' });
        return res.end();
      }
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
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
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

server.listen(PORT, '0.0.0.0', () => {
  const status = authStatus();
  if (status.failClosed) {
    console.warn('WEBMCP auth required but credentials/secret missing — privileged routes fail closed.');
  }
  console.log(`InnerOS WebMCP listening on http://0.0.0.0:${PORT}`);
});
