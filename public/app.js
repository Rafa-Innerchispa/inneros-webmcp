import { installBrowserWebMCP } from '/webmcp.js';

const $ = (id) => document.getElementById(id);
const traceEl = $('trace');
const resultEl = $('result');
const FLOW_IDS = ['archHuman', 'archWebmcp', 'archBridge', 'archMcp', 'archExecutor', 'archEvidence'];
const LANE_DEFAULTS = [
  { id: 'local', label: 'Local AMD', transport: 'vLLM + durable A2A', capability: 'Qwen3-Coder + local execution', verification: 'runtime health is verified separately' },
  { id: 'codex', label: 'Codex', transport: 'verified adapter', capability: 'coding execution lane', verification: 'process evidence required' },
  { id: 'cursor', label: 'Cursor', transport: 'native ACP', capability: 'IDE coding agent', verification: 'ACP lifecycle evidence' },
  { id: 'antigravity', label: 'AntiGravity', transport: 'IDE / headless bridge', capability: 'coding task lane', verification: 'session evidence required' }
];

let lastDispatchId = '';
let lastCopilotPrompt = '';
let lastExecutionBrief = '';
let evidenceTimer = null;
let evidenceBusy = false;

function safeDetail(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return ''; }
}

function short(value, max = 110) {
  const s = safeDetail(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function setFlowStage(id, { confirmed = false, degraded = false } = {}) {
  const target = FLOW_IDS.indexOf(id);
  if (target < 0) return;
  FLOW_IDS.forEach((flowId, index) => {
    const el = $(flowId);
    if (!el) return;
    el.classList.remove('active', 'degraded');
    if (index < target) el.classList.add('verified');
    if (index === target) {
      el.classList.toggle('verified', confirmed && !degraded);
      el.classList.toggle('degraded', degraded);
      el.classList.add('active');
    }
  });
  document.querySelectorAll('.arch-link').forEach((link, index) => {
    link.classList.toggle('flowing', index === target - 1 || (target === 0 && index === 0));
  });
}

function settleFlow() {
  FLOW_IDS.forEach((id) => $(id)?.classList.remove('active'));
  document.querySelectorAll('.arch-link').forEach((link) => link.classList.remove('flowing'));
}

function addTrace(event) {
  const empty = traceEl.querySelector('.empty');
  if (empty) empty.remove();

  const row = document.createElement('article');
  row.className = `event ${event.state || 'info'}`;

  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const body = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'event-head';
  const title = document.createElement('strong');
  title.textContent = event.title || 'Event';
  const source = document.createElement('span');
  source.className = `source-chip ${event.confirmed ? 'confirmed' : ''}`;
  source.textContent = event.confirmed ? `${event.source || 'BACKEND'} · CONFIRMED` : (event.source || 'BROWSER');
  head.append(title, source);

  const detail = document.createElement('p');
  detail.textContent = short(event.detail || '', 320);
  body.append(head, detail);

  const metaValues = [
    event.requestId ? `request ${event.requestId}` : '',
    event.dispatchId ? `dispatch ${event.dispatchId}` : '',
    event.deliveryState ? `delivery ${event.deliveryState}` : '',
    event.executionState ? `execution ${event.executionState}` : '',
    event.transport ? `transport ${event.transport}` : '',
    Number.isFinite(event.latencyMs) ? `${event.latencyMs} ms` : '',
    event.backend ? `backend ${event.backend}` : ''
  ].filter(Boolean);
  if (metaValues.length) {
    const meta = document.createElement('div');
    meta.className = 'event-meta';
    for (const value of metaValues) {
      const span = document.createElement('span');
      span.textContent = value;
      meta.append(span);
    }
    body.append(meta);
  }

  row.append(time, body);
  traceEl.prepend(row);
}

function updateProof(data, response, clientLatencyMs) {
  const proof = data?.proof || {};
  const requestId = proof.requestId || response?.headers?.get('x-inneros-request-id') || '';
  const backend = proof.backend || response?.headers?.get('x-inneros-adapter') || '';
  const latency = Number.isFinite(proof.latencyMs) ? proof.latencyMs : clientLatencyMs;
  if (requestId) $('proofRequest').textContent = requestId;
  if (backend) $('proofBackend').textContent = backend;
  if (Number.isFinite(latency)) $('proofLatency').textContent = `${latency} ms`;
  const dispatchId = data?.dispatchId || '';
  if (dispatchId) $('proofDispatch').textContent = dispatchId;
  return { requestId, backend, latencyMs: latency };
}

function renderReturnedTrace(data) {
  if (!Array.isArray(data?.trace)) return;
  for (const step of data.trace.slice().reverse()) {
    addTrace({
      title: `${step.stage || 'backend'} · ${step.state || 'info'}`,
      detail: step.detail || step,
      state: step.state || 'info',
      source: step.stage === 'dispatch' ? 'A2A' : 'MCP',
      confirmed: true,
      dispatchId: data.dispatchId || ''
    });
  }
}

function requestFlowStage(name) {
  if (name === 'get_execution_trace' || name === 'get_evidence') return 'archEvidence';
  if (name === 'dispatch_agent_action' || name === 'resolve_project_blocker') return 'archMcp';
  return 'archWebmcp';
}

function responseFlowStage(name, data) {
  if (name === 'get_execution_trace' || name === 'get_evidence') return 'archEvidence';
  if (name === 'dispatch_agent_action' || name === 'resolve_project_blocker') return data?.dispatchId ? 'archExecutor' : 'archMcp';
  if (name === 'ask_inneros_copilot') return 'archBridge';
  return 'archBridge';
}

async function invoke(name, input = {}, { trace = true } = {}) {
  const requestStage = requestFlowStage(name);
  setFlowStage(requestStage);

  if (trace) {
    addTrace({
      title: `Tool request · ${name}`,
      detail: name === 'ask_inneros_copilot' ? { project: input.project, message: short(input.message, 90) } : input,
      state: 'info',
      source: 'BROWSER',
      confirmed: false
    });
  }

  const started = performance.now();
  const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  const clientLatencyMs = Math.round(performance.now() - started);
  let data;
  try { data = await response.json(); }
  catch { data = { ok: false, state: 'error', error: 'invalid_backend_json' }; }

  const proof = updateProof(data, response, clientLatencyMs);
  setFlowStage(responseFlowStage(name, data), { confirmed: Boolean(data?.ok), degraded: !data?.ok });

  if (trace) {
    addTrace({
      title: `${name} · ${data.state || (data.ok ? 'ok' : 'error')}`,
      detail: data.error || data.blocker || data.message || data.route || 'Backend response received.',
      state: data.ok ? (data.state || 'ok') : (data.state || 'blocked'),
      source: 'BACKEND',
      confirmed: true,
      requestId: proof.requestId,
      latencyMs: proof.latencyMs,
      backend: proof.backend,
      dispatchId: data.dispatchId || '',
      deliveryState: data.deliveryState || data.delivery_state || '',
      executionState: data.executionState || data.execution_state || '',
      transport: data.transport || data.route?.provider || ''
    });
  }
  renderReturnedTrace(data);
  window.setTimeout(settleFlow, 900);
  return data;
}


function formatDmxSceneLabel(scene = '') {
  return String(scene).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function refreshDmxSceneSelector(supportedScenes = []) {
  const select = $('dmxScene');
  if (!select || !Array.isArray(supportedScenes) || !supportedScenes.length) return;
  const selectable = supportedScenes.filter((scene) => scene && scene !== 'blackout');
  if (!selectable.length) return;
  const current = select.value;
  select.replaceChildren(...selectable.map((scene) => {
    const option = document.createElement('option');
    option.value = scene;
    option.textContent = formatDmxSceneLabel(scene);
    return option;
  }));
  if (selectable.includes(current)) select.value = current;
}

function bubble(role, label, message) {
  const article = document.createElement('article');
  article.className = `bubble ${role}`;
  const meta = document.createElement('span');
  meta.className = 'bubble-label';
  meta.textContent = label;
  const p = document.createElement('p');
  p.textContent = message;
  article.append(meta, p);
  $('copilotMessages').append(article);
  $('copilotMessages').scrollTop = $('copilotMessages').scrollHeight;
  return article;
}

function mergedLanes(data) {
  const live = new Map((Array.isArray(data?.agents) ? data.agents : []).map((agent) => [agent.id, agent]));
  return LANE_DEFAULTS.map((fallback) => ({ ...fallback, ...(live.get(fallback.id) || {}) }));
}

function laneState(agent, returnedByBackend) {
  if (!returnedByBackend) return { label: 'DISCOVERING', className: 'unknown' };
  const transport = String(agent.transport || '').toLowerCase();
  if (agent.ready === false) return { label: 'UNAVAILABLE', className: 'off' };
  if (/remote inbox|ide inbox|acp inbox/.test(transport)) return { label: 'REMOTE INBOX', className: 'unknown' };
  if (agent.ready === true) return { label: 'READY', className: 'ready' };
  if (/degraded|partial/.test(String(agent.verification || '').toLowerCase())) return { label: 'DEGRADED', className: 'off' };
  return { label: 'CONFIGURED', className: 'unknown' };
}

function isCasualPrompt(text = '') {
  const normalized = String(text).trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > 80) return false;
  return /^(hola|hello|hi|hey|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|thanks|thank you|gracias)[!.?\s]*$/.test(normalized);
}

function renderAgents(data) {
  const backendIds = new Set((Array.isArray(data?.agents) ? data.agents : []).map((agent) => agent.id));
  const agents = mergedLanes(data);
  $('agents').replaceChildren(...agents.map((agent) => {
    const state = laneState(agent, backendIds.has(agent.id));
    const card = document.createElement('article');
    card.dataset.agent = agent.id || '';
    card.classList.add(`lane-${state.className}`);

    const dot = document.createElement('span');
    dot.className = `dot ${state.className === 'off' ? 'off' : state.className === 'unknown' ? 'unknown' : ''}`;

    const text = document.createElement('div');
    const header = document.createElement('div');
    header.className = 'lane-title';
    const strong = document.createElement('strong');
    strong.textContent = agent.label || agent.id || 'Agent';
    const chip = document.createElement('span');
    chip.className = `lane-state ${state.className}`;
    chip.textContent = state.label;
    header.append(strong, chip);

    const small = document.createElement('small');
    const parts = [agent.transport, agent.capability, agent.cost, agent.verification].filter(Boolean);
    small.textContent = parts.join(' · ') || 'Backend-reported capability';
    text.append(header, small);
    card.append(dot, text);

    if (agent.id) {
      card.addEventListener('click', () => {
        $('executorTarget').value = agent.id;
        document.querySelectorAll('#agents article').forEach((el) => el.classList.toggle('selected', el === card));
        setFlowStage('archExecutor');
        addTrace({ title: `Execution lane selected · ${agent.label}`, detail: `Target set to ${agent.id}. This does not claim execution.`, state: 'info', source: 'BROWSER', confirmed: false });
        window.setTimeout(settleFlow, 700);
      });
    }
    return card;
  }));
  $('fabricState').textContent = data?.live ? 'Live fabric confirmed' : 'Provider discovery partial';
  if (data?.live) {
    $('archMcp')?.classList.add('verified');
    $('archExecutor')?.classList.add('verified');
  }
}

function renderMission(data, target = 'auto') {
  $('missionSummary').hidden = false;
  const route = data?.route || {};
  const resource = route.provider || route.providerId || data?.agent || (target === 'auto' ? 'InnerOS router' : target) || 'Pending';
  $('selectedResource').textContent = resource;
  const model = [route.model, route.runtime].filter(Boolean).join(' · ');
  $('selectedModel').textContent = model || (resource === 'local' || target === 'local' ? 'Qwen3-Coder / A2A' : 'Provider runtime');
  $('missionState').textContent = data?.state || 'unknown';
  $('evidenceState').textContent = ['completed', 'pass'].includes(String(data?.state).toLowerCase()) ? 'Verified' : 'Pending verification';
  lastDispatchId = data?.dispatchId || '';
  $('dispatchId').textContent = lastDispatchId || 'No dispatch returned';
  $('proofDispatch').textContent = lastDispatchId || 'None';
  $('refreshEvidence').hidden = !lastDispatchId;
  resultEl.textContent = JSON.stringify(data, null, 2);
  if (lastDispatchId) {
    setFlowStage('archExecutor', { confirmed: true });
    startEvidencePolling();
  }
}

function terminalState(value = '') {
  return ['completed', 'pass', 'failed', 'error', 'rejected', 'cancelled'].includes(String(value).toLowerCase());
}

async function refreshEvidence({ silent = false } = {}) {
  if (!lastDispatchId || evidenceBusy) return '';
  evidenceBusy = true;
  try {
    setFlowStage('archEvidence');
    const trace = await invoke('get_execution_trace', { dispatchId: lastDispatchId }, { trace: !silent });
    const evidence = await invoke('get_evidence', { dispatchId: lastDispatchId }, { trace: !silent });
    const state = evidence?.state || trace?.state || 'unknown';
    $('missionState').textContent = state;
    $('evidenceState').textContent = terminalState(state) && !['failed', 'error', 'rejected', 'cancelled'].includes(String(state).toLowerCase()) ? 'Verified' : state;
    resultEl.textContent = JSON.stringify({ trace, evidence }, null, 2);
    if (Array.isArray(trace?.trace)) renderReturnedTrace(trace);
    if (terminalState(state)) {
      setFlowStage('archEvidence', { confirmed: ['completed', 'pass'].includes(String(state).toLowerCase()), degraded: ['failed', 'error', 'rejected', 'cancelled'].includes(String(state).toLowerCase()) });
      addTrace({
        title: `Evidence state · ${state}`,
        detail: evidence?.evidence || 'Backend evidence endpoint returned terminal state.',
        state,
        source: 'EVIDENCE',
        confirmed: true,
        dispatchId: lastDispatchId,
        requestId: evidence?.proof?.requestId || ''
      });
    }
    return state;
  } finally {
    evidenceBusy = false;
  }
}

function startEvidencePolling() {
  if (evidenceTimer) clearInterval(evidenceTimer);
  let attempts = 0;
  evidenceTimer = setInterval(async () => {
    attempts += 1;
    const state = await refreshEvidence({ silent: true });
    if (terminalState(state) || attempts >= 12) {
      clearInterval(evidenceTimer);
      evidenceTimer = null;
    }
  }, 2500);
}

async function askCopilot(event) {
  event.preventDefault();
  const prompt = $('copilotPrompt').value.trim();
  if (!prompt) return;
  const project = $('project').value.trim() || 'inneros-webmcp';
  lastCopilotPrompt = prompt;
  lastExecutionBrief = '';
  $('executePlan').disabled = true;
  bubble('user', 'YOU', prompt);
  $('copilotPrompt').value = '';
  $('askCopilot').disabled = true;
  $('askCopilot').textContent = 'Local model thinking…';
  setFlowStage('archHuman', { confirmed: true });
  window.setTimeout(() => setFlowStage('archWebmcp'), 120);

  try {
    const data = await invoke('ask_inneros_copilot', { project, message: prompt });
    if (data.ok) {
      bubble('assistant', `${data.provider || 'LOCAL AMD'} · ${data.model || 'QWEN3-CODER'} · ${data.backend || 'local_vllm'}`, data.message);
      const casual = isCasualPrompt(prompt);
      lastExecutionBrief = casual ? '' : (data.executionBrief || prompt);
      $('executePlan').disabled = casual;
      if (casual) {
        addTrace({
          title: 'Casual chat only · no dispatch',
          detail: 'Greeting or small talk stays on local_vllm. Execution remains disabled until an explicit execute action.',
          state: 'info',
          source: 'BROWSER',
          confirmed: false,
          backend: data.backend || 'local_vllm'
        });
      }
      $('modelLabel').textContent = `${data.provider || 'Local AMD'} · ${data.runtime || 'vLLM'}`;
      $('copilotBadge').textContent = 'Local Qwen3-Coder · response confirmed';
      $('copilotBadge').classList.add('ok');
      $('modelPill').classList.remove('degraded');
    } else {
      bubble('error', 'COPILOT ERROR', data.error || 'Local model unavailable.');
      $('copilotBadge').textContent = 'Local Qwen3-Coder · unavailable';
      $('copilotBadge').classList.remove('ok');
      $('modelPill').classList.add('degraded');
    }
  } catch (error) {
    bubble('error', 'COPILOT ERROR', error.message || 'Request failed.');
    $('copilotBadge').textContent = 'Local Qwen3-Coder · request failed';
    $('copilotBadge').classList.remove('ok');
    $('modelPill').classList.add('degraded');
    addTrace({ title: 'Copilot request failed', detail: error.message, state: 'error', source: 'BROWSER' });
  } finally {
    $('askCopilot').disabled = false;
    $('askCopilot').textContent = 'Ask local model';
  }
}

async function executePlan() {
  const project = $('project').value.trim() || 'inneros-webmcp';
  const target = $('executorTarget').value;
  const instruction = (lastExecutionBrief || lastCopilotPrompt || '').slice(0, 2000);
  if (!instruction) return;
  $('executePlan').disabled = true;
  $('executePlan').textContent = 'Dispatching…';
  setFlowStage('archMcp');
  try {
    const data = target === 'auto'
      ? await invoke('resolve_project_blocker', { project, policy: 'local_first', instruction })
      : await invoke('dispatch_agent_action', { agent: target, project, instruction });
    renderMission(data, target);
    if (data?.dispatchId) {
      bubble('assistant', 'INNEROS ROUTER', `Task accepted by ${data?.route?.provider || data?.agent || target}. Dispatch ID: ${data.dispatchId}. Delivery is not completion; the trace now follows backend evidence until the task reaches a terminal state.`);
    } else if (!data?.ok) {
      bubble('error', 'INNEROS ROUTER', data?.error || data?.blocker || 'The selected lane could not accept the task.');
    }
  } finally {
    $('executePlan').disabled = false;
    $('executePlan').textContent = 'Execute proposed plan';
  }
}

async function ensureAuthenticated() {
  const auth = await fetch('/api/auth/status').then((r) => r.json()).catch(() => ({ ok: true, authenticated: true }));
  if (auth?.auth?.required && !auth.authenticated) {
    window.location.replace('/login.html');
    return false;
  }
  $('logoutBtn').hidden = !auth?.auth?.required;
  return true;
}

async function boot() {
  try {
    if (!(await ensureAuthenticated())) return;
    const started = performance.now();
    const healthResponse = await fetch('/api/health');
    const health = await healthResponse.json();
    const healthMs = Math.round(performance.now() - started);
    $('health').textContent = health.ok ? 'Bridge: online' : 'Bridge: unavailable';
    $('adapterState').textContent = health.adapter?.mode === 'mcp_loopback' ? 'MCP loopback · live' : (health.adapter?.mode || 'Unavailable');
    $('adapterDetail').textContent = health.adapter?.configured ? 'Private backend connected' : 'Adapter not connected';
    $('toolCount').textContent = `${health.webmcpTools || 0} WebMCP`;
    $('dmxState').textContent = health.dmx?.configured ? 'AG-59 bridge configured' : 'DMX API not configured';
    $('copilotBadge').textContent = health.copilot?.configured ? 'Local Qwen3-Coder · configured · verify on Ask' : 'Local copilot not configured';
    $('copilotBadge').classList.toggle('ok', false);
    if (health.copilot?.model) $('modelLabel').textContent = `${health.copilot.provider || 'Local AMD'} · ${health.copilot.runtime || 'vLLM'} · configured`;

    const cfRay = healthResponse.headers.get('cf-ray');
    const serverHeader = healthResponse.headers.get('server') || '';
    const cloudflareDetected = Boolean(cfRay) || /cloudflare/i.test(serverHeader);
    $('edgeState').textContent = cloudflareDetected ? 'Cloudflare · live' : 'Direct / local';
    $('edgeDetail').textContent = cloudflareDetected ? `Edge confirmed${cfRay ? ` · ray ${cfRay.split('-')[0]}` : ''}` : 'No Cloudflare header detected';
    addTrace({
      title: cloudflareDetected ? 'Cloudflare edge handshake' : 'Direct origin detected',
      detail: cloudflareDetected ? `Public request reached Cloudflare and returned from InnerOS in ${healthMs} ms.` : 'Health response did not include a Cloudflare edge marker.',
      state: health.ok ? 'ok' : 'blocked',
      source: 'EDGE',
      confirmed: cloudflareDetected,
      requestId: cfRay ? cfRay.split('-')[0] : '',
      latencyMs: healthMs,
      backend: health.adapter?.mode || ''
    });
    if (health.adapter?.configured) {
      $('archBridge')?.classList.add('verified');
      addTrace({ title: 'Private bridge health', detail: `Adapter mode: ${health.adapter.mode}. Private backend is configured without exposing its endpoint.`, state: 'ok', source: 'BACKEND', confirmed: true, backend: health.adapter.mode });
    }

    const policy = await fetch('/api/policy').then((r) => r.json());
    const agents = await invoke('list_agents', {});
    renderAgents(agents?.agents ? agents : { agents: policy.agents || [], live: false });

    const registration = installBrowserWebMCP(invoke);
    if (registration.supported) {
      $('mcpBadge').textContent = `ChatGPT WebMCP · ${registration.registered.length} Site Tools live`;
      $('mcpBadge').classList.add('ok');
      $('archWebmcp')?.classList.add('verified');
    } else {
      $('mcpBadge').textContent = 'Standard browser · Site Tools activate inside ChatGPT';
      $('mcpBadge').classList.remove('ok');
    }
    addTrace({
      title: registration.supported ? 'Browser registered WebMCP Site Tools' : 'Standard-browser compatibility mode',
      detail: registration.supported
        ? `${registration.registered.length} tools registered through document.modelContext.registerTool.`
        : `This browser does not expose document.modelContext. Nothing is broken: open this same URL in ChatGPT’s integrated browser to use the ${health.webmcpTools || 11} Site Tools.`,
      state: registration.supported ? 'ok' : 'info',
      source: 'BROWSER',
      confirmed: false
    });
    if (health.dmx?.configured) {
      try {
        const dmx = await invoke('dmx_status', {});
        if (dmx.ok) await refreshDmxSceneSelector(dmx.supportedScenes || []);
      } catch { /* non-fatal boot refresh */ }
    }
    setFlowStage('archHuman', { confirmed: true });
    window.setTimeout(settleFlow, 900);
  } catch (error) {
    $('health').textContent = 'Bridge: unavailable';
    $('adapterState').textContent = 'Unavailable';
    addTrace({ title: 'Boot failed', detail: error.message, state: 'blocked', source: 'BROWSER' });
  }
}

$('copilotForm').addEventListener('submit', askCopilot);
$('executePlan').addEventListener('click', executePlan);
$('logoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/login.html');
});
$('dmxStatusBtn')?.addEventListener('click', async () => {
  const data = await invoke('dmx_status', {});
  $('dmxState').textContent = data.ok ? `AG-59 ready · ${data.fixtureCount || 9} fixtures · effect ${data.currentEffect || 'idle'}` : `DMX unavailable · ${data.error || 'unknown'}`;
  if (data.ok) await refreshDmxSceneSelector(data.supportedScenes || []);
  bubble('assistant', 'AG-59 DMX', data.ok ? `Stage status: ${data.running ? 'running' : 'idle'}. Supported scenes: ${(data.supportedScenes || []).join(', ')}.` : `DMX unavailable: ${data.error || 'engine offline'}`);
});
$('dmxSceneBtn')?.addEventListener('click', async () => {
  const scene = $('dmxScene')?.value || 'rainbow';
  const data = await invoke('dmx_set_scene', { scene });
  bubble(data.ok ? 'assistant' : 'error', 'AG-59 DMX', data.ok ? `Applied scene ${scene}.` : `Scene blocked: ${data.error || data.state}`);
  if (data.ok) $('dmxState').textContent = `AG-59 applied · ${scene}`;
});
$('dmxBlackoutBtn')?.addEventListener('click', async () => {
  const data = await invoke('dmx_blackout', {});
  bubble(data.ok ? 'assistant' : 'error', 'AG-59 DMX', data.ok ? 'Blackout applied.' : `Blackout failed: ${data.error || data.state}`);
  if (data.ok) $('dmxState').textContent = 'AG-59 blackout applied';
});
$('refreshEvidence').addEventListener('click', () => refreshEvidence({ silent: false }));
$('clearTrace').addEventListener('click', () => {
  traceEl.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'Waiting for live events.';
  traceEl.append(empty);
});

boot();


// Unified chat UX: persistent browser history + automatic latest-message scroll.
const CHAT_HISTORY_KEY = 'inneros-webmcp-chat-v1';
const CHAT_HISTORY_LIMIT = 80;
let persistedChatHistory = [];

function readPersistedChatHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
    persistedChatHistory = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.role === 'string' && typeof item.message === 'string').slice(-CHAT_HISTORY_LIMIT)
      : [];
  } catch {
    persistedChatHistory = [];
  }
  return persistedChatHistory;
}

function updateHistoryState(message = '') {
  const state = $('historyState');
  if (!state) return;
  state.textContent = message || `${persistedChatHistory.length} messages saved in this browser.`;
}

function persistChatMessage(role, label, message) {
  persistedChatHistory.push({ role, label, message, at: new Date().toISOString() });
  persistedChatHistory = persistedChatHistory.slice(-CHAT_HISTORY_LIMIT);
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(persistedChatHistory));
    updateHistoryState();
  } catch {
    updateHistoryState('History is available for this session only.');
  }
}

function scrollChatToLatest() {
  const chat = $('copilotMessages');
  if (!chat) return;
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

const renderBubbleWithoutPersistence = bubble;
bubble = function persistentBubble(role, label, message) {
  const article = renderBubbleWithoutPersistence(role, label, message);
  persistChatMessage(role, label, message);
  scrollChatToLatest();
  return article;
};

function restoreChatHistory() {
  const history = readPersistedChatHistory();
  if (!history.length) {
    updateHistoryState('Chat history is saved in this browser.');
    scrollChatToLatest();
    return;
  }
  const chat = $('copilotMessages');
  chat.replaceChildren();
  for (const item of history) {
    renderBubbleWithoutPersistence(item.role, item.label || 'MESSAGE', item.message);
  }
  updateHistoryState();
  scrollChatToLatest();
}

function clearPersistedChatHistory() {
  persistedChatHistory = [];
  try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch { /* session can continue */ }
  lastCopilotPrompt = '';
  lastExecutionBrief = '';
  $('executePlan').disabled = true;
  const chat = $('copilotMessages');
  chat.replaceChildren();
  renderBubbleWithoutPersistence(
    'assistant',
    'INNEROS COPILOT',
    'Describe what you want to build or fix. I will answer here, in this same conversation, and prepare an execution brief. Then choose who executes it.'
  );
  updateHistoryState('Chat history cleared. New messages will be saved in this browser.');
  scrollChatToLatest();
}

$('clearChat')?.addEventListener('click', clearPersistedChatHistory);
$('copilotPrompt')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('copilotForm')?.requestSubmit();
  }
});

const chatObserver = new MutationObserver(scrollChatToLatest);
if ($('copilotMessages')) chatObserver.observe($('copilotMessages'), { childList: true });
restoreChatHistory();


// Hot scene discovery: keep the physical-control selector synced with AG-59
// without adding noisy periodic rows to Global Live Trace. A trace row is added
// only when the trusted backend registry actually changes.
let dmxRegistryFingerprint = '';
let dmxRegistryPollTimer = null;

async function pollDmxRegistry() {
  try {
    const response = await fetch('/api/tools/dmx_status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data.supportedScenes)) return;

    const scenes = data.supportedScenes.filter(Boolean);
    const fingerprint = scenes.join('|');
    if (!fingerprint) return;
    const changed = Boolean(dmxRegistryFingerprint) && fingerprint !== dmxRegistryFingerprint;
    dmxRegistryFingerprint = fingerprint;
    await refreshDmxSceneSelector(scenes);

    if (changed) {
      addTrace({
        title: 'AG-59 scene registry changed',
        detail: `Trusted backend now reports ${scenes.length} scenes: ${scenes.join(', ')}`,
        state: 'ready',
        source: 'BACKEND',
        confirmed: true,
        requestId: data?.proof?.requestId || '',
        backend: data?.proof?.backend || 'mcp_loopback'
      });
    }
  } catch {
    // Discovery is best-effort; explicit DMX Status remains available.
  }
}

function startDmxRegistryPolling() {
  if (dmxRegistryPollTimer) clearInterval(dmxRegistryPollTimer);
  pollDmxRegistry();
  dmxRegistryPollTimer = setInterval(pollDmxRegistry, 4000);
}

window.setTimeout(startDmxRegistryPolling, 1200);


function isDmxSceneCreationPrompt(text = '') {
  const value = String(text || '').toLowerCase();
  return /(crea|crear|cree|nueva|nuevo|create|make|build|design)/.test(value)
    && /(escena|scene|efecto|effect)/.test(value)
    && /(dmx|luz|luces|light|lights|iluminaci[oó]n)/.test(value);
}

async function interceptDmxSceneCreation(event) {
  if (!isDmxSceneCreationPrompt(lastCopilotPrompt)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = $('executePlan');
  button.disabled = true;
  button.textContent = 'Designing + registering scene…';
  setFlowStage('archWebmcp');
  try {
    const data = await invoke('dmx_create_scene', { description: lastCopilotPrompt });
    resultEl.textContent = JSON.stringify(data, null, 2);
    if (data.ok) {
      await refreshDmxSceneSelector(data.supportedScenes || []);
      const select = $('dmxScene');
      if (select && [...select.options].some((option) => option.value === data.scene)) select.value = data.scene;
      $('dmxState').textContent = `AG-59 registered · ${data.scene}`;
      bubble('assistant', 'AG-59 + LOCAL QWEN', `Scene ${data.label || data.scene} was designed by the local model, validated and registered by AG-59. It is now selected above. Registration did not physically run the lights; press Apply scene when you are ready.`);
      addTrace({
        title: `Scene ready to execute · ${data.scene}`,
        detail: 'Registration is confirmed. Physical execution remains separate until Apply scene is pressed.',
        state: 'registered',
        source: 'BACKEND',
        confirmed: true,
        requestId: data?.proof?.requestId || '',
        backend: data?.proof?.backend || 'local_vllm + dmx_loopback'
      });
    } else {
      bubble('error', 'AG-59 SCENE REGISTRY', `Scene creation blocked: ${data.error || data.state || 'validation failed'}.`);
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Execute proposed plan';
  }
}

$('executePlan')?.addEventListener('click', interceptDmxSceneCreation, { capture: true });

window.addEventListener('DOMContentLoaded', () => {
  const heroSub = document.querySelector('.recording-hero-copy .hero-sub');
  if (heroSub) heroSub.textContent = heroSub.textContent.replace(/\b11 WebMCP\b/g, '12 WebMCP');
  const toolCount = $('toolCount');
  if (toolCount && toolCount.textContent.trim() === '11 WebMCP') toolCount.textContent = '12 WebMCP';
});
