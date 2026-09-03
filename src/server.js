import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { invokeTool, getPolicy } from './bridge.js';
import { adapterStatus } from './inneros-adapter.js';
import { copilotStatus } from './copilot.js';
import { dmxStatus } from './dmx-bridge.js';
import { TOOL_NAMES } from './webmcp.js';
import {
  authStatus,
  authenticateRequest,
  login,
  sessionCookie,
  clearSessionCookie
} from './auth.js';

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);
const CONTEXT_ROOT = process.env.WEBMCP_CONTEXT_ROOT || '/home/rlopez/projects/.webmcp-context';
const MAX_UPLOAD_BODY = 8 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 60000;
const CODE_EXTENSIONS = new Set([
  '.txt','.md','.json','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.html','.htm','.css','.scss',
  '.sql','.yaml','.yml','.toml','.sh','.java','.kt','.go','.rs','.c','.cc','.cpp','.h','.hpp','.cs','.php',
  '.rb','.swift','.xml','.csv','.ini','.conf','.properties','.vue','.svelte'
]);

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 12000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

function safeProjectId(value = '') {
  const project = String(value).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,47}$/.test(project) ? project : '';
}

function safeFilename(value = '') {
  const base = path.basename(String(value || 'attachment')).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return base || 'attachment';
}

function unescapePdfString(value = '') {
  return value
    .replace(/\\([nrtbf()\\])/g, (_m, ch) => ({ n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', '(':'(', ')':')', '\\':'\\' }[ch] || ch))
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function heuristicPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const out = [];
  const single = /\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g;
  let match;
  while ((match = single.exec(raw)) && out.join('\n').length < MAX_CONTEXT_CHARS) out.push(unescapePdfString(match[1]));
  const arrays = /\[([^\]]{1,8000})\]\s*TJ/g;
  while ((match = arrays.exec(raw)) && out.join('\n').length < MAX_CONTEXT_CHARS) {
    const parts = [];
    const partRegex = /\(([^()]*(?:\\.[^()]*)*)\)/g;
    let part;
    while ((part = partRegex.exec(match[1]))) parts.push(unescapePdfString(part[1]));
    if (parts.length) out.push(parts.join(''));
  }
  return out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CONTEXT_CHARS);
}

async function extractPdfText(filePath, buffer) {
  try {
    const { stdout } = await execFile('pdftotext', ['-layout', filePath, '-'], {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    const text = String(stdout || '').trim().slice(0, MAX_CONTEXT_CHARS);
    if (text) return { text, extraction: 'pdftotext' };
  } catch {
    // Fixed-command local extractor is optional. Fall through to bounded heuristic extraction.
  }
  const text = heuristicPdfText(buffer);
  return { text, extraction: text ? 'pdf_heuristic' : 'pdf_no_text' };
}

async function verifyContextProject(project) {
  const status = await invokeTool('get_project_status', { project });
  return { ok: Boolean(status?.ok && status?.exists && status?.isGit), status };
}

async function saveProjectContext(body = {}) {
  const project = safeProjectId(body.project);
  if (!project) return { ok: false, state: 'rejected', error: 'project_name_invalid' };
  const verified = await verifyContextProject(project);
  if (!verified.ok) return { ok: false, state: 'blocked', error: 'verified_project_required' };

  const name = safeFilename(body.name);
  const mime = String(body.mime || 'application/octet-stream').slice(0, 120);
  const encoded = String(body.dataBase64 || '');
  if (!encoded || encoded.length > MAX_UPLOAD_BODY) return { ok: false, state: 'rejected', error: 'attachment_too_large' };
  let buffer;
  try { buffer = Buffer.from(encoded, 'base64'); } catch { return { ok: false, state: 'rejected', error: 'attachment_invalid_base64' }; }
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return { ok: false, state: 'rejected', error: 'attachment_too_large' };

  const ext = path.extname(name).toLowerCase();
  const isPdf = ext === '.pdf' || mime === 'application/pdf';
  const isText = mime.startsWith('text/') || CODE_EXTENSIONS.has(ext) || ['application/json','application/xml','application/javascript'].includes(mime);
  if (!isPdf && !isText) return { ok: false, state: 'rejected', error: 'attachment_type_not_supported' };
  if (isPdf && !buffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')) return { ok: false, state: 'rejected', error: 'pdf_signature_invalid' };

  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const dir = path.join(CONTEXT_ROOT, project);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${id}-${name}`);
  await fs.writeFile(filePath, buffer, { mode: 0o600 });

  let context = '';
  let extraction = 'text';
  if (isPdf) {
    const extracted = await extractPdfText(filePath, buffer);
    context = extracted.text;
    extraction = extracted.extraction;
  } else {
    context = buffer.toString('utf8').replace(/\u0000/g, '').slice(0, MAX_CONTEXT_CHARS);
  }

  const metadata = {
    id, project, name, mime, bytes: buffer.length, chars: context.length,
    extraction, context, createdAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(dir, `${id}.context.json`), JSON.stringify(metadata), { mode: 0o600 });
  return { ok: true, state: 'attached', attachment: metadata };
}

async function listProjectContext(projectValue) {
  const project = safeProjectId(projectValue);
  if (!project) return { ok: false, state: 'rejected', error: 'project_name_invalid' };
  const verified = await verifyContextProject(project);
  if (!verified.ok) return { ok: false, state: 'blocked', error: 'verified_project_required', attachments: [] };
  const dir = path.join(CONTEXT_ROOT, project);
  let names = [];
  try { names = await fs.readdir(dir); } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, state: 'ready', attachments: [] };
    throw error;
  }
  const metas = names.filter((name) => name.endsWith('.context.json')).slice(-12);
  const attachments = [];
  for (const meta of metas) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, meta), 'utf8'));
      attachments.push(parsed);
    } catch { /* ignore corrupt metadata */ }
  }
  attachments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { ok: true, state: 'ready', attachments };
}

const staticFiles = new Map([
  ['/',['index.html','text/html; charset=utf-8']],
  ['/login.html',['login.html','text/html; charset=utf-8']],
  ['/login.js',['login.js','text/javascript; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/webmcp.js',['../src/webmcp.js','text/javascript; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']],
  ['/dmx-ux.js',['dmx-ux.js','text/javascript; charset=utf-8']]
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
        copilot: copilotStatus(),
        dmx: dmxStatus(),
        developmentWorkspace: { projectCreate: true, attachments: true, voiceClient: true }
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

    if (req.method === 'POST' && url.pathname === '/api/voice/transcribe') {
      if (!auth.ok) return json(res, 401, { ok: false, state: 'rejected', error: auth.error || 'unauthorized' });
      const result = await transcribeVoice(await readJson(req, MAX_UPLOAD_BODY));
      return json(res, result.ok ? 200 : 503, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/context/upload') {
      if (!auth.ok) return json(res, 401, { ok: false, state: 'rejected', error: auth.error || 'unauthorized' });
      const result = await saveProjectContext(await readJson(req, MAX_UPLOAD_BODY));
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/context/list') {
      if (!auth.ok) return json(res, 401, { ok: false, state: 'rejected', error: auth.error || 'unauthorized' });
      const result = await listProjectContext(url.searchParams.get('project') || '');
      return json(res, result.ok ? 200 : 409, result);
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
      const result = await invokeTool(tool, await readJson(req, tool === 'ask_inneros_copilot' ? 80000 : 12000));
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
      if (status.required && !auth.ok && !isLogin && url.pathname !== '/styles.css' && url.pathname !== '/login.js') {
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


async function transcribeVoice(body = {}) {
  const encoded = String(body.dataBase64 || '');
  const mime = String(body.mime || 'audio/webm').slice(0, 120);
  if (!encoded || encoded.length > MAX_UPLOAD_BODY) return { ok: false, state: 'rejected', error: 'audio_too_large' };
  let buffer;
  try { buffer = Buffer.from(encoded, 'base64'); } catch { return { ok: false, state: 'rejected', error: 'audio_invalid_base64' }; }
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return { ok: false, state: 'rejected', error: 'audio_too_large' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const form = new FormData();
    form.append('audio_file', new Blob([buffer], { type: mime }), mime.includes('ogg') ? 'voice.ogg' : 'voice.webm');
    const response = await fetch('http://127.0.0.1:9001/asr?encode=true&task=transcribe&language=es&vad_filter=true&output=txt', {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, state: 'unavailable', error: `local_whisper_http_${response.status}` };
    const transcript = String(await response.text()).trim().slice(0, 12000);
    if (!transcript) return { ok: false, state: 'unavailable', error: 'local_whisper_empty_transcript' };
    return {
      ok: true,
      state: 'transcribed',
      transcript,
      provider: 'Local Whisper',
      runtime: 'whisper-asr-webservice',
      executionClaimed: false
    };
  } catch (error) {
    return { ok: false, state: 'unavailable', error: error?.name === 'AbortError' ? 'local_whisper_timeout' : 'local_whisper_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
