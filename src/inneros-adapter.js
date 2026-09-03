const TIMEOUT_MS = Number(process.env.INNEROS_ADAPTER_TIMEOUT_MS || 8000);
const MAX_RESPONSE_BYTES = Number(process.env.INNEROS_ADAPTER_MAX_BYTES || 262144);
const ADAPTER_TOKEN = process.env.INNEROS_ADAPTER_TOKEN || '';

const PUBLIC_TOOLS = new Set([
  'list_agents',
  'get_project_status',
  'inspect_blockers',
  'dispatch_agent_action',
  'resolve_project_blocker',
  'get_execution_trace',
  'get_evidence'
]);

export const DIRECT_MCP_TOOL_ALLOWLIST = Object.freeze([
  'inneros_agent_fabric_status',
  'project_runtime_status',
  'dev_swarm_watchdog_summary',
  'resource_fabric_route',
  'a2a_dispatch',
  'a2a_task_status',
  'ide_dispatch_task',
  'ide_task_status'
]);
const DIRECT_MCP_TOOLS = new Set(DIRECT_MCP_TOOL_ALLOWLIST);

export function resolveAdapterUrls(env = process.env) {
  const candidates = [
    ...(env.INNEROS_ADAPTER_URLS || '').split(','),
    env.INNEROS_ADAPTER_URL || '',
    env.INNEROS_ADAPTER_FALLBACK_URL || ''
  ];
  return [...new Set(candidates.map((value) => value.trim().replace(/\/$/, '')).filter(Boolean))];
}

export function resolveMcpUrl(env = process.env) {
  const value = String(env.INNEROS_MCP_URL || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1';
    if (!loopback || !['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function directMcpConfigured() {
  return Boolean(resolveMcpUrl());
}

export function adapterConfigured() {
  return directMcpConfigured() || resolveAdapterUrls().length > 0;
}

export function adapterStatus() {
  const direct = directMcpConfigured();
  const endpoints = resolveAdapterUrls();
  return {
    configured: direct || endpoints.length > 0,
    mode: direct ? 'mcp_loopback' : (endpoints.length ? 'http_adapter' : 'none'),
    endpointCount: direct ? 1 : endpoints.length,
    failover: !direct && endpoints.length > 1
  };
}

function redactString(value) {
  return value
    .replace(/\b(?:127\.0\.0\.1|localhost|192\.168\.\d{1,3}\.\d{1,3})\b/gi, '[redacted-host]')
    .replace(/\/home\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g, '[redacted-path]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]');
}

export function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  const blocked = /token|secret|password|authorization|credential|private.?key|session|(^|_)url$|(^|_)path$|paths|trusted_roots|host$/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, child]) => [key, sanitizePublic(child)]));
}

export function parseMcpPayload(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  let last = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    last = JSON.parse(payload);
  }
  return last;
}

async function readLimited(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('inneros_response_too_large');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('inneros_response_too_large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

export function buildMcpHeaders(env = process.env, sessionId = '') {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const token = String(env.INNEROS_ADAPTER_TOKEN || ADAPTER_TOKEN || '').trim();
  if (token) headers['X-API-Key'] = token;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return headers;
}

async function mcpPost(url, body, sessionId = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = buildMcpHeaders(process.env, sessionId);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const text = await readLimited(response);
    return { response, rpc: parseMcpPayload(text), text };
  } finally {
    clearTimeout(timer);
  }
}

async function openMcpSession(url) {
  const init = await mcpPost(url, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'inneros-webmcp', version: '0.2.0' }
    }
  });
  if (!init.response.ok) throw new Error(`inneros_mcp_initialize_http_${init.response.status}`);
  const sessionId = init.response.headers.get('mcp-session-id') || '';
  if (!sessionId) throw new Error('inneros_mcp_session_missing');
  const ready = await mcpPost(url, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId);
  if (![200, 202, 204].includes(ready.response.status)) throw new Error(`inneros_mcp_initialized_http_${ready.response.status}`);
  return sessionId;
}

export function unwrapMcpResult(rpc) {
  if (!rpc) throw new Error('inneros_mcp_empty_response');
  if (rpc.error) throw new Error(`inneros_mcp_rpc_${rpc.error.code || 'error'}`);
  const result = rpc.result || {};
  if (result.isError) {
    const message = Array.isArray(result.content)
      ? result.content.map((item) => item?.text || '').filter(Boolean).join(' ').slice(0, 160)
      : 'tool_error';
    throw new Error(`inneros_mcp_tool_error:${message || 'tool_error'}`);
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const structured = result.structuredContent;
    if (typeof structured.result === 'string') {
      try {
        const parsed = JSON.parse(structured.result);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* fall through to the structured envelope */ }
    }
    if (structured.result && typeof structured.result === 'object' && !Array.isArray(structured.result)) return structured.result;
    if (typeof structured.data === 'string') {
      try {
        const parsed = JSON.parse(structured.data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* fall through to the structured envelope */ }
    }
    if (structured.data && typeof structured.data === 'object' && !Array.isArray(structured.data)) return structured.data;
    return structured;
  }
  if (Array.isArray(result.content)) {
    const texts = result.content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text);
    for (const text of texts) {
      try { return JSON.parse(text); } catch { /* keep looking */ }
    }
    if (texts.length) return { text: texts.join('\n') };
  }
  return result;
}

export function findIdeDispatchPayload(value, depth = 0) {
  if (depth > 7 || value == null) return null;
  let current = value;
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
    try { current = JSON.parse(trimmed); } catch { return null; }
  }
  if (Array.isArray(current)) {
    for (const item of current) {
      const found = findIdeDispatchPayload(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!current || typeof current !== 'object') return null;
  if (typeof current.dispatch_id === 'string' && current.dispatch_id.startsWith('ide_')) return current;

  const preferred = ['structuredContent', 'result', 'data', 'content', 'text'];
  for (const key of preferred) {
    if (!(key in current)) continue;
    const found = findIdeDispatchPayload(current[key], depth + 1);
    if (found) return found;
  }
  for (const [key, child] of Object.entries(current)) {
    if (preferred.includes(key)) continue;
    const found = findIdeDispatchPayload(child, depth + 1);
    if (found) return found;
  }
  return null;
}

async function callMcpTool(name, args = {}) {
  if (!DIRECT_MCP_TOOLS.has(name)) throw new Error('inneros_internal_tool_not_allowlisted');
  const url = resolveMcpUrl();
  if (!url) throw new Error('inneros_mcp_loopback_not_configured');
  let effectiveArgs = args;
  if (name === 'ide_dispatch_task' && !String(args.repo || '').trim()) {
    const projectId = String(args.project_id || '').trim();
    if (!projectId) throw new Error('verified_project_binding_required');
    const runtime = await callMcpTool('project_runtime_status', { project_id: projectId, node: 'primary' });
    const binding = resolveProjectBinding(runtime, projectId);
    if (!binding.ok) throw new Error(binding.error || 'verified_project_binding_required');
    effectiveArgs = { ...args, repo: binding.repo, branch: binding.branch };
    delete effectiveArgs.project_id;
  }
  const sessionId = await openMcpSession(url);
  const call = await mcpPost(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: effectiveArgs } }, sessionId);
  if (!call.response.ok) throw new Error(`inneros_mcp_call_http_${call.response.status}`);
  const result = unwrapMcpResult(call.rpc);
  if (name === 'ide_dispatch_task') {
    const dispatchPayload = findIdeDispatchPayload(call.rpc) || findIdeDispatchPayload(result);
    if (dispatchPayload) return dispatchPayload;
  }
  if (name === 'ide_task_status') {
    return { ...result, execution_state: canonicalIdeState(result), evidence: canonicalIdeEvidence(result) };
  }
  return result;
}

function publicAgentList(fabric = {}) {
  const bridge = fabric.layers?.ide_task_bridge || {};
  const acp = fabric.layers?.acp || {};
  const codexSmoke = acp.codex_adapter_smoke || {};
  const cursorProbe = acp.cursor_acp_probe || {};
  return {
    ok: fabric.ok !== false,
    state: fabric.status || 'ready',
    live: true,
    fabricVersion: fabric.fabric_version || 'inneros_agent_fabric',
    agents: [
      {
        id: 'local', label: 'Local AMD', transport: 'vLLM + durable A2A', ready: true,
        capability: 'Qwen3-Coder 30B + local execution', cost: '$0 external inference',
        verification: 'live MCP fabric'
      },
      {
        id: 'codex', label: 'Codex', transport: 'A2A → verified adapter',
        ready: Boolean(acp.ok && codexSmoke.ok), capability: 'coding task delivery',
        verification: codexSmoke.ide_bridge?.execution_state || 'adapter verification required'
      },
      {
        id: 'cursor', label: 'Cursor', transport: 'native ACP · remote inbox',
        ready: Boolean(bridge.ok && cursorProbe.ok), capability: 'IDE coding agent',
        verification: cursorProbe.status === 'PASS' ? 'ACP probe PASS' : 'ACP probe unavailable',
        headlessClaimed: false,
        deliveryState: bridge.ok ? 'remote_inbox' : 'unavailable'
      },
      {
        id: 'antigravity', label: 'AntiGravity', transport: 'IDE/headless bridge · remote inbox',
        ready: Boolean(bridge.ok), capability: 'coding task delivery',
        verification: bridge.ok ? 'bridge online · evidence required' : 'bridge unavailable',
        deliveryState: bridge.ok ? 'remote_inbox' : 'unavailable'
      }
    ],
    blockers: Array.isArray(fabric.blockers) ? fabric.blockers.slice(0, 10) : []
  };
}

function publicProject(data = {}, project) {
  const p = data.project || {};
  return {
    ok: data.ok !== false,
    state: data.exists === false ? 'not_found' : 'ready',
    project: p.project_id || project,
    repo: p.repo || null,
    exists: Boolean(data.exists),
    isGit: Boolean(data.is_git),
    policyClass: p.policy_class || null,
    writeScope: p.write_scope || null,
    node: data.node || 'primary'
  };
}

function publicRoute(data = {}) {
  const selected = data.selected || {};
  return {
    providerId: selected.provider?.provider_id || selected.model?.provider_id || null,
    provider: selected.provider?.label || null,
    localFirst: selected.provider?.local_first !== false,
    runtime: selected.model?.runtime || null,
    model: selected.model?.model_name || selected.provider?.preferred_model || null,
    externalCost: selected.provider?.local_first === false ? 'external' : '$0'
  };
}

function dispatchId(prefix = 'wmcp') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function resolveProjectBinding(data = {}, requestedProject = '') {
  const project = data.project || {};
  const repo = String(project.repo || '').trim();
  const branch = String(project.default_branch || project.defaultBranch || project.base_ref || project.baseRef || 'main').trim();
  if (data.ok === false || data.exists === false || !repo) {
    return {
      ok: false,
      state: 'blocked',
      error: 'verified_project_binding_required',
      project: project.project_id || requestedProject || null
    };
  }
  return { ok: true, project: project.project_id || requestedProject, repo, branch };
}

export function canonicalIdeState(status = {}) {
  const opsState = String(status.ops_status || '').toLowerCase();
  const executionState = String(status.execution_state || '').toLowerCase();
  const terminalOpsStates = new Set(['completed', 'failed', 'cancelled', 'rejected', 'blocked']);
  if (terminalOpsStates.has(opsState)) return opsState;
  return executionState || opsState || 'unknown';
}

export function canonicalIdeEvidence(status = {}) {
  const opsEvidence = status.ops_evidence && typeof status.ops_evidence === 'object' ? status.ops_evidence : {};
  const executionEvidence = status.evidence && typeof status.evidence === 'object' ? status.evidence : {};
  if (Object.keys(opsEvidence).length) return opsEvidence;
  return executionEvidence;
}

async function directCall(tool, input = {}) {
  if (tool === 'list_agents') return publicAgentList(await callMcpTool('inneros_agent_fabric_status', {}));

  if (tool === 'get_project_status') {
    const data = await callMcpTool('project_runtime_status', { project_id: input.project, node: 'primary' });
    return publicProject(data, input.project);
  }

  if (tool === 'inspect_blockers') {
    if (input.taskId) {
      const data = await callMcpTool('inneros_agent_fabric_status', { ops_task_id: input.taskId });
      return sanitizePublic({ ok: data.ok !== false, state: data.status || 'ready', taskId: input.taskId, blockers: data.blockers || [], layers: data.layers });
    }
    const project = await callMcpTool('project_runtime_status', { project_id: input.project, node: 'primary' });
    const watchdog = await callMcpTool('dev_swarm_watchdog_summary', { limit: 10 });
    return sanitizePublic({ ok: project.ok !== false, state: 'ready', project: publicProject(project, input.project), blockers: watchdog.anomalies || watchdog.blockers || [], watchdogStatus: watchdog.status || null });
  }

  if (tool === 'dispatch_agent_action') {
    const correlationId = dispatchId('wmcp');
    if (input.agent === 'local') {
      const a2aTaskId = dispatchId('wmcp_a2a');
      const data = await callMcpTool('a2a_dispatch', {
        agent_id: 'AG-45', title: `WebMCP: ${input.project || 'InnerOS'} action`,
        body: input.instruction, correlation_id: correlationId,
        context_id: input.project || 'inneros', priority: 'p0',
        related_project: input.project || 'inneros', dry_run: false,
        protocol_task_id: a2aTaskId
      });
      return sanitizePublic({ ok: data.ok !== false, state: 'queued', dispatchId: data.task?.a2a_task_id || a2aTaskId, agent: 'local', transport: 'a2a', executionClaimed: false, evidenceRequired: true });
    }
    const data = await callMcpTool('ide_dispatch_task', {
      ide: input.agent, title: `WebMCP: ${input.project || 'InnerOS'} action`, body: input.instruction,
      project_id: input.project, repo: '', branch: '', worktree: '', correlation_id: correlationId,
      priority: 'p0', from_agent: 'WEBMCP', require_evidence: true,
      approval_required: false, idempotency_key: correlationId
    });
    return sanitizePublic({ ok: data.ok !== false, state: data.execution_state || 'queued', dispatchId: data.dispatch_id, agent: input.agent, deliveryState: data.delivery_state, executionState: data.execution_state, transport: data.transport, executionClaimed: data.execution_state === 'running' || data.execution_state === 'completed' });
  }

  if (tool === 'resolve_project_blocker') {
    const project = await callMcpTool('project_runtime_status', { project_id: input.project, node: 'primary' });
    const route = await callMcpTool('resource_fabric_route', { project_id: input.project, task_class: 'coding', prefer_cloud: input.policy === 'best_available' });
    const a2aTaskId = dispatchId('wmcp_a2a');
    const instruction = input.instruction || 'Diagnose the current development blocker, resolve it safely, run bounded tests, and attach evidence.';
    const dispatched = await callMcpTool('a2a_dispatch', {
      agent_id: 'AG-45', title: `Resolve blocker: ${input.project}`, body: instruction,
      correlation_id: dispatchId('wmcp_resolve'), context_id: input.project,
      priority: 'p0', related_project: input.project, dry_run: false,
      protocol_task_id: a2aTaskId
    });
    const id = dispatched.task?.a2a_task_id || a2aTaskId;
    return sanitizePublic({
      ok: dispatched.ok !== false,
      state: 'queued',
      project: publicProject(project, input.project),
      policy: input.policy || 'local_first',
      route: publicRoute(route),
      dispatchId: id,
      trace: [
        { stage: 'diagnose', state: project.ok === false ? 'blocked' : 'pass', detail: 'Project runtime checked live.' },
        { stage: 'route', state: route.ok === false ? 'blocked' : 'pass', detail: `Selected ${publicRoute(route).provider || 'local-capable resource'} under ${(input.policy || 'local_first')} policy.` },
        { stage: 'dispatch', state: 'queued', detail: 'Durable A2A task submitted to Local Exec.' },
        { stage: 'verify', state: 'pending', detail: 'Completion evidence will be available through get_evidence.' }
      ]
    });
  }

  if (tool === 'get_execution_trace' || tool === 'get_evidence') {
    const id = input.dispatchId || input.taskId || '';
    if (!id) return { ok: false, state: 'rejected', error: 'dispatch_or_task_required' };
    if (id.startsWith('ide_')) {
      const status = await callMcpTool('ide_task_status', { dispatch_id: id });
      if (tool === 'get_execution_trace') return sanitizePublic({ ok: status.ok !== false, state: status.execution_state || status.ops_status || 'unknown', dispatchId: id, trace: [{ stage: 'delivery', state: status.delivery_state || 'unknown' }, { stage: 'execution', state: status.execution_state || status.ops_status || 'unknown' }] });
      return sanitizePublic({ ok: status.ok !== false, state: status.execution_state || status.ops_status || 'unknown', dispatchId: id, evidence: status.evidence || status.ops_evidence || {} });
    }
    const status = await callMcpTool('a2a_task_status', { a2a_task_id: id });
    if (tool === 'get_execution_trace') return sanitizePublic({ ok: status.ok !== false, state: status.state || status.status || 'unknown', dispatchId: id, trace: status.trace || status.history || status.state_history || [], task: status.task || {} });
    return sanitizePublic({ ok: status.ok !== false, state: status.state || status.status || 'unknown', dispatchId: id, evidence: status.evidence || status.artifacts || status.task?.evidence || {} });
  }

  return { ok: false, state: 'rejected', error: 'tool_not_allowlisted' };
}

async function invokeEndpoint(baseUrl, tool, input, endpointIndex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (ADAPTER_TOKEN) headers.authorization = `Bearer ${ADAPTER_TOKEN}`;
    const response = await fetch(`${baseUrl}/tools/${encodeURIComponent(tool)}`, {
      method: 'POST', headers, body: JSON.stringify(input), signal: controller.signal
    });
    let body = {};
    try { body = sanitizePublic(JSON.parse(await readLimited(response))); } catch { body = {}; }
    if (response.ok) return { terminal: true, result: { ...body, adapterEndpoint: endpointIndex } };
    if ([502, 503, 504].includes(response.status)) return { terminal: false, result: { ok: false, state: 'unavailable', error: `inneros_adapter_http_${response.status}`, adapterEndpoint: endpointIndex } };
    return { terminal: true, result: { ok: false, state: body.state || 'unavailable', error: body.error || `inneros_adapter_http_${response.status}`, detail: body.detail, adapterEndpoint: endpointIndex } };
  } catch (error) {
    return { terminal: false, result: { ok: false, state: 'unavailable', error: error.name === 'AbortError' ? 'inneros_adapter_timeout' : 'inneros_adapter_unreachable', adapterEndpoint: endpointIndex } };
  } finally {
    clearTimeout(timer);
  }
}

export async function callInnerOS(tool, input = {}) {
  if (!PUBLIC_TOOLS.has(tool)) return { ok: false, state: 'rejected', error: 'adapter_tool_not_allowlisted' };
  if (directMcpConfigured()) {
    try { return sanitizePublic(await directCall(tool, input)); }
    catch (error) {
      return { ok: false, state: 'unavailable', error: error.name === 'AbortError' ? 'inneros_mcp_timeout' : String(error.message || 'inneros_mcp_error').slice(0, 160) };
    }
  }

  const endpoints = resolveAdapterUrls();
  if (!endpoints.length) return { ok: false, state: 'unavailable', error: 'inneros_adapter_not_configured' };
  let last = { ok: false, state: 'unavailable', error: 'inneros_adapter_unreachable' };
  for (let index = 0; index < endpoints.length; index += 1) {
    const attempt = await invokeEndpoint(endpoints[index], tool, input, index);
    last = attempt.result;
    if (attempt.terminal) return { ...attempt.result, adapterAttempts: index + 1 };
  }
  return { ...last, adapterAttempts: endpoints.length, failoverExhausted: endpoints.length > 1 };
}

export async function __debugCallMcpToolForTests(name, args = {}) { return callMcpTool(name, args); }
