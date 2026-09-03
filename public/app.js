import { installBrowserWebMCP } from '/webmcp.js';
import { initDmxExperience, applyDmxRegistry, onSceneRegistered, renderScenePreview } from './dmx-ux.js';

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
        if (dmx.ok) applyDmxRegistry(dmx);
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
// DMX controls: initDmxExperience()
$('refreshEvidence').addEventListener('click', () => refreshEvidence({ silent: false }));
$('clearTrace').addEventListener('click', () => {
  traceEl.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'Waiting for live events.';
  traceEl.append(empty);
});

initDmxExperience({ invoke, bubble, addTrace });
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
    applyDmxRegistry({ ok: true, supportedScenes: scenes, sceneCatalog: data?.sceneCatalog || [] });

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
      onSceneRegistered(data);
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


// Cockpit V2: explicit executor selection UI. Lane cards are real selectors;
// the animated architecture rail remains telemetry only.
function executorLabel(value = '') {
  const labels = {
    auto: 'AUTO · local-first',
    local: 'LOCAL AMD · headless A2A',
    codex: 'CODEX · headless',
    cursor: 'CURSOR · remote inbox',
    antigravity: 'ANTIGRAVITY · remote inbox'
  };
  return labels[value] || String(value || 'AUTO').toUpperCase();
}

function syncSelectedExecutorUI() {
  const select = $('executorTarget');
  if (!select) return;
  const value = select.value || 'auto';
  const label = executorLabel(value);
  if ($('selectedExecutorLabel')) $('selectedExecutorLabel').textContent = label;
  if ($('autoLaneBtn')) {
    $('autoLaneBtn').classList.toggle('selected', value === 'auto');
    $('autoLaneBtn').setAttribute('aria-pressed', value === 'auto' ? 'true' : 'false');
  }
  document.querySelectorAll('#agents article').forEach((card) => {
    const selected = card.dataset.agent === value;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

function decorateLaneCards() {
  document.querySelectorAll('#agents article').forEach((card) => {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Select execution lane ${card.dataset.agent || ''}`.trim());
  });
  syncSelectedExecutorUI();
}

$('autoLaneBtn')?.addEventListener('click', () => {
  $('executorTarget').value = 'auto';
  syncSelectedExecutorUI();
  addTrace({
    title: 'Execution routing · AUTO local-first',
    detail: 'InnerOS will choose the cheapest capable local-first route. This selection does not claim execution.',
    state: 'info', source: 'BROWSER', confirmed: false
  });
});

$('executorTarget')?.addEventListener('change', () => {
  syncSelectedExecutorUI();
  addTrace({
    title: `Execution target selected · ${executorLabel($('executorTarget').value)}`,
    detail: 'Executor selection changed. No task has executed yet.',
    state: 'info', source: 'BROWSER', confirmed: false
  });
});

$('agents')?.addEventListener('click', () => window.setTimeout(syncSelectedExecutorUI, 0));
$('agents')?.addEventListener('keydown', (event) => {
  const card = event.target.closest('article[data-agent]');
  if (!card || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  card.click();
  syncSelectedExecutorUI();
});

if ($('agents')) {
  const laneObserver = new MutationObserver(decorateLaneCards);
  laneObserver.observe($('agents'), { childList: true });
}
decorateLaneCards();


// AUTO native actions: bounded DMX scene creation can register immediately after
// the local Copilot identifies the intent. Registration never runs the fixtures.
let autoDmxRegistrationInFlight = false;
let autoDmxHandledPrompt = '';

function ensureNativeActionHint() {
  let hint = $('nativeActionHint');
  if (hint) return hint;
  hint = document.createElement('div');
  hint.id = 'nativeActionHint';
  hint.className = 'native-action-hint';
  hint.hidden = true;
  const context = document.querySelector('.recording-context-row');
  context?.insertAdjacentElement('afterend', hint);
  return hint;
}

function setNativeActionHint(message = '', state = 'info') {
  const hint = ensureNativeActionHint();
  hint.textContent = message;
  hint.dataset.state = state;
  hint.hidden = !message;
}

async function autoRegisterDmxSceneIfEligible() {
  const prompt = String(lastCopilotPrompt || '').trim();
  const target = $('executorTarget')?.value || 'auto';
  if (target !== 'auto') return;
  if (!isDmxSceneCreationPrompt(prompt)) return;
  if (!prompt || prompt === autoDmxHandledPrompt || autoDmxRegistrationInFlight) return;

  autoDmxHandledPrompt = prompt;
  autoDmxRegistrationInFlight = true;
  const executeButton = $('executePlan');
  setNativeActionHint('AUTO detected a native AG-59 action · designing and registering the scene locally. Physical execution remains manual.', 'active');
  $('selectedExecutorLabel').textContent = 'AUTO → Local Qwen + AG-59';
  addTrace({
    title: 'AUTO native action detected · dmx_create_scene',
    detail: 'InnerOS is designing and registering a bounded scene through Local Qwen + AG-59. This does not run the physical lights.',
    state: 'info',
    source: 'BROWSER',
    confirmed: false
  });
  if (executeButton) {
    executeButton.disabled = true;
    executeButton.textContent = 'AUTO · registering scene…';
  }

  try {
    const data = await invoke('dmx_create_scene', { description: prompt });
    resultEl.textContent = JSON.stringify(data, null, 2);
    if (data.ok) {
      onSceneRegistered(data);
      const select = $('dmxScene');
      if (select && [...select.options].some((option) => option.value === data.scene)) select.value = data.scene;
      $('dmxState').textContent = `AG-59 registered · ${data.scene}`;
      setNativeActionHint(`REGISTERED · ${data.label || data.scene} · selected above · press Apply scene to run the lights`, 'ready');
      bubble('assistant', 'AUTO · LOCAL QWEN + AG-59', `Created and registered ${data.label || data.scene}. The new scene is selected in DMX quick control. The lights have NOT run yet; press Apply scene when you want the physical execution.`);
      addTrace({
        title: `Native capability registered · ${data.scene}`,
        detail: 'AG-59 confirmed the scene in its trusted registry. Physical execution is still pending explicit Apply scene.',
        state: 'ready',
        source: 'BACKEND',
        confirmed: true,
        requestId: data?.proof?.requestId || '',
        backend: data?.proof?.backend || 'local_vllm + dmx_loopback'
      });
      lastExecutionBrief = '';
      if (executeButton) {
        executeButton.disabled = true;
        executeButton.textContent = 'Scene registered · use Apply scene';
      }
    } else {
      const duplicate = data.error === 'scene_already_exists';
      setNativeActionHint(duplicate ? `Scene already exists · ${data.scene || 'refresh DMX registry'}` : `AUTO registration blocked · ${data.error || data.state || 'validation failed'}`, duplicate ? 'info' : 'error');
      bubble(duplicate ? 'assistant' : 'error', 'AG-59 SCENE REGISTRY', duplicate ? `That scene already exists as ${data.scene || 'a registered scene'}. Refresh/select it above or use a different name.` : `Scene creation blocked: ${data.error || data.state || 'validation failed'}.`);
      if (executeButton) {
        executeButton.disabled = false;
        executeButton.textContent = 'Execute proposed plan';
      }
    }
  } catch (error) {
    setNativeActionHint(`AUTO registration failed · ${error.message || 'request failed'}`, 'error');
    bubble('error', 'AG-59 SCENE REGISTRY', `Scene registration failed: ${error.message || 'request failed'}.`);
    if (executeButton) {
      executeButton.disabled = false;
      executeButton.textContent = 'Execute proposed plan';
    }
  } finally {
    autoDmxRegistrationInFlight = false;
  }
}

// The assistant reply is the proof that the local Copilot completed its proposal.
// In AUTO, only the bounded native DMX registration path continues automatically.
const nativeAutoObserver = new MutationObserver((mutations) => {
  const assistantReplyAdded = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === 1 && node.matches?.('.bubble.assistant')));
  if (assistantReplyAdded) window.setTimeout(autoRegisterDmxSceneIfEligible, 0);
});
if ($('copilotMessages')) nativeAutoObserver.observe($('copilotMessages'), { childList: true });

// Explicit provider selection must stay explicit. Prevent the older AUTO-native
// click interceptor from hijacking a DMX prompt when Codex/Cursor/AntiGravity/local
// was intentionally chosen; the regular execution handler then dispatches that lane.
document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('#executePlan');
  if (!button) return;
  const target = $('executorTarget')?.value || 'auto';
  if (target === 'auto' || !isDmxSceneCreationPrompt(lastCopilotPrompt)) return;
  const originalPrompt = lastCopilotPrompt;
  lastCopilotPrompt = '';
  window.setTimeout(() => {
    if (!lastCopilotPrompt) lastCopilotPrompt = originalPrompt;
  }, 0);
}, true);

$('executorTarget')?.addEventListener('change', () => {
  autoDmxHandledPrompt = '';
  setNativeActionHint('', 'info');
});


// Make AUTO semantics explicit in the visible controls.
if ($('autoLaneBtn')) {
  $('autoLaneBtn').textContent = 'AUTO · native actions + local-first';
  $('autoLaneBtn').title = 'Safe native actions can run automatically; coding work is routed local-first.';
}
if ($('executorTarget')?.options?.[0]) $('executorTarget').options[0].textContent = 'Auto · native actions + InnerOS local-first';
if (($('executorTarget')?.value || 'auto') === 'auto' && $('selectedExecutorLabel')) $('selectedExecutorLabel').textContent = 'AUTO · native + local-first';


// Approval-first execution contract: conversation never mutates systems.
// The latest Copilot answer remains a candidate plan until the owner explicitly approves it.
nativeAutoObserver.disconnect();
$('executePlan')?.removeEventListener('click', executePlan);
$('executePlan')?.removeEventListener('click', interceptDmxSceneCreation, true);

async function verifyBoundProjectForApproval() {
  const project = $('project')?.value?.trim() || 'inneros-webmcp';
  const status = await invoke('get_project_status', { project });
  const valid = Boolean(status?.ok && status?.exists && status?.repo);
  if (valid) return { ok: true, project, status };
  bubble('error', 'PROJECT BINDING REQUIRED', `Project "${project}" is not bound to a verified repository/runtime. Typing a new name here does not create a project. Select an existing project before execution.`);
  setNativeActionHint('EXECUTION BLOCKED · project is not bound to a verified repo/runtime. No task was dispatched.', 'error');
  addTrace({
    title: `Execution blocked · unbound project ${project}`,
    detail: 'Project is a context/binding selector. Entering a new name does not bootstrap a repository or runtime.',
    state: 'blocked', source: 'BACKEND', confirmed: true
  });
  return { ok: false, project, status };
}

async function approvedExecutePlan(event) {
  event?.preventDefault?.();
  event?.stopImmediatePropagation?.();
  const button = $('executePlan');
  const instruction = (lastExecutionBrief || lastCopilotPrompt || '').slice(0, 2000);
  if (!instruction) return;

  const binding = await verifyBoundProjectForApproval();
  if (!binding.ok) return;
  const project = binding.project;
  const target = $('executorTarget')?.value || 'auto';

  button.disabled = true;
  button.textContent = 'Approved · dispatching…';
  setNativeActionHint(`APPROVED · executing the latest plan via ${executorLabel(target)}.`, 'active');

  try {
    if (target === 'auto' && isDmxSceneCreationPrompt(lastCopilotPrompt)) {
      button.textContent = 'Approved · registering scene…';
      const data = await invoke('dmx_create_scene', { description: lastCopilotPrompt });
      resultEl.textContent = JSON.stringify(data, null, 2);
      if (data.ok) {
        onSceneRegistered(data);
        const select = $('dmxScene');
        if (select && [...select.options].some((option) => option.value === data.scene)) select.value = data.scene;
        $('dmxState').textContent = `AG-59 registered · ${data.scene}`;
        setNativeActionHint(`REGISTERED · ${data.label || data.scene} · physical execution still requires Apply scene`, 'ready');
        bubble('assistant', 'APPROVED · LOCAL QWEN + AG-59', `Registered ${data.label || data.scene} after your approval. It is selected in DMX quick control. The lights have NOT run; Apply scene remains a separate physical action.`);
        addTrace({
          title: `Approved native capability registered · ${data.scene}`,
          detail: 'Owner approval preceded registration. AG-59 confirmed the registry change; physical execution remains separate.',
          state: 'ready', source: 'BACKEND', confirmed: true,
          requestId: data?.proof?.requestId || '', backend: data?.proof?.backend || 'local_vllm + dmx_loopback'
        });
        lastExecutionBrief = '';
        button.disabled = true;
        button.textContent = 'Plan executed · scene registered';
        return;
      }
      bubble('error', 'AG-59 SCENE REGISTRY', `Approved scene creation was blocked: ${data.error || data.state || 'validation failed'}.`);
      setNativeActionHint(`APPROVED ACTION BLOCKED · ${data.error || data.state || 'validation failed'}`, 'error');
      return;
    }

    setFlowStage('archMcp');
    const data = target === 'auto'
      ? await invoke('resolve_project_blocker', { project, policy: 'local_first', instruction })
      : await invoke('dispatch_agent_action', { agent: target, project, instruction });
    renderMission(data, target);
    if (data?.dispatchId) {
      bubble('assistant', 'INNEROS ROUTER', `Approved plan dispatched to ${data?.route?.provider || data?.agent || target}. Dispatch ID: ${data.dispatchId}. Delivery is not completion; Global Live Trace will follow backend evidence.`);
      setNativeActionHint(`DISPATCHED · ${executorLabel(target)} · waiting for execution evidence`, 'ready');
    } else if (!data?.ok) {
      bubble('error', 'INNEROS ROUTER', data?.error || data?.blocker || 'The selected lane could not accept the approved plan.');
      setNativeActionHint(`DISPATCH BLOCKED · ${data?.error || data?.blocker || 'lane unavailable'}`, 'error');
    }
  } finally {
    if (!button.textContent.startsWith('Plan executed')) {
      button.disabled = false;
      button.textContent = 'Approve & Execute Plan';
    }
  }
}

$('executePlan')?.addEventListener('click', approvedExecutePlan, true);

const approvalFirstObserver = new MutationObserver((mutations) => {
  const assistantReplyAdded = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === 1 && node.matches?.('.bubble.assistant')));
  if (!assistantReplyAdded || !lastCopilotPrompt || isCasualPrompt(lastCopilotPrompt)) return;
  setNativeActionHint('PLAN READY · continue chatting to refine it, or approve and execute the latest plan. Nothing has executed yet.', 'info');
  if ($('executePlan')) {
    $('executePlan').disabled = false;
    $('executePlan').textContent = 'Approve & Execute Plan';
  }
});
if ($('copilotMessages')) approvalFirstObserver.observe($('copilotMessages'), { childList: true });

if ($('autoLaneBtn')) {
  $('autoLaneBtn').textContent = 'AUTO · local-first';
  $('autoLaneBtn').title = 'Conversation never executes. After approval, InnerOS uses a native capability when appropriate or routes coding local-first.';
}
if ($('executorTarget')?.options?.[0]) $('executorTarget').options[0].textContent = 'Auto · InnerOS local-first after approval';
if (($('executorTarget')?.value || 'auto') === 'auto' && $('selectedExecutorLabel')) $('selectedExecutorLabel').textContent = 'AUTO · local-first';
if ($('executePlan')) $('executePlan').textContent = 'Approve & Execute Plan';
if ($('project')) {
  $('project').title = 'Existing InnerOS project ID / verified repo binding. Typing a new name does not create a project.';
}


// Development workspace: explicit project creation, persistent project context,
// real multi-turn Copilot context, and voice dictation. Conversation still never executes.
const devContext = { project: '', attachments: [] };

function contextText(limit = 45000) {
  let out = '';
  for (const item of devContext.attachments.slice(-8)) {
    const chunk = String(item.context || '');
    if (!chunk) continue;
    const header = `\n\n--- ATTACHMENT: ${item.name} (${item.extraction || 'text'}) ---\n`;
    if ((out + header).length >= limit) break;
    out += header + chunk.slice(0, Math.max(0, limit - out.length - header.length));
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

function conversationHistoryForModel() {
  return persistedChatHistory
    .filter((item) => item.role === 'user' || (item.role === 'assistant' && /LOCAL AMD|INNEROS COPILOT|QWEN/i.test(item.label || '')))
    .slice(-14)
    .map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.message || '').slice(0, 5000) }));
}

function renderAttachmentChips() {
  const host = $('attachmentChips');
  if (!host) return;
  host.replaceChildren(...devContext.attachments.map((item) => {
    const chip = document.createElement('span');
    chip.className = `context-chip ${item.context ? 'ready' : 'warning'}`;
    chip.title = `${item.name} · ${item.bytes || 0} bytes · ${item.extraction || 'unknown'} · ${item.chars || 0} text chars`;
    chip.textContent = item.context ? `${item.name} · ${item.chars || 0} chars` : `${item.name} · stored / no text`;
    return chip;
  }));
  const state = $('attachmentState');
  if (state) state.textContent = devContext.attachments.length
    ? `${devContext.attachments.length} project file${devContext.attachments.length === 1 ? '' : 's'} in Copilot context`
    : 'Attach PDF or code as read-only planning context.';
}

async function loadProjectAttachments(projectValue = '') {
  const project = String(projectValue || $('project')?.value || '').trim().toLowerCase();
  if (!project || !/^[a-z0-9][a-z0-9_-]{1,47}$/.test(project)) {
    devContext.project = '';
    devContext.attachments = [];
    renderAttachmentChips();
    return;
  }
  try {
    const response = await fetch(`/api/context/list?project=${encodeURIComponent(project)}`);
    const data = await response.json();
    if (data.ok) {
      devContext.project = project;
      devContext.attachments = Array.isArray(data.attachments) ? data.attachments : [];
    } else {
      devContext.project = project;
      devContext.attachments = [];
    }
  } catch {
    devContext.project = project;
    devContext.attachments = [];
  }
  renderAttachmentChips();
}

async function createProjectFromUi() {
  const project = String($('project')?.value || '').trim().toLowerCase();
  const status = $('projectActionState');
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(project)) {
    if (status) status.textContent = 'Use 2–48 lowercase letters/numbers, - or _.';
    return;
  }
  const button = $('createProjectBtn');
  if (button) { button.disabled = true; button.textContent = 'Creating…'; }
  if (status) status.textContent = 'Creating local Git workspace under Projects…';
  try {
    const data = await invoke('create_project_workspace', {
      project,
      description: 'Created from InnerOS WebMCP development workspace.'
    });
    if (data.ok) {
      if (status) status.textContent = `READY · ${project} · local Git · Projects workspace`;
      bubble('assistant', 'PROJECT RUNTIME', `Created ${project} as a local Git development workspace and registered it in InnerOS. No GitHub/cloud repository was created.`);
      setNativeActionHint(`PROJECT READY · ${project} · conversation can begin; execution still requires approval`, 'ready');
      await loadProjectAttachments(project);
    } else if (data.error === 'project_already_exists') {
      if (status) status.textContent = `EXISTS · ${project}`;
      await loadProjectAttachments(project);
    } else {
      if (status) status.textContent = `BLOCKED · ${data.error || data.state || 'creation failed'}`;
      bubble('error', 'PROJECT RUNTIME', `Project creation blocked: ${data.error || data.state || 'unknown error'}.`);
    }
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Create Project'; }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

async function uploadContextFile(file) {
  const project = String($('project')?.value || '').trim().toLowerCase();
  if (!project) return;
  const state = $('attachmentState');
  if (file.size > 5 * 1024 * 1024) {
    if (state) state.textContent = 'Attachment blocked · 5 MB maximum.';
    return;
  }
  if (state) state.textContent = `Reading ${file.name}…`;
  try {
    const dataBase64 = await fileToBase64(file);
    const response = await fetch('/api/context/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, name: file.name, mime: file.type || 'application/octet-stream', dataBase64 })
    });
    const data = await response.json();
    if (!data.ok) {
      if (state) state.textContent = `Attachment blocked · ${data.error || data.state}`;
      bubble('error', 'PROJECT CONTEXT', `Could not attach ${file.name}: ${data.error || data.state || 'upload failed'}.`);
      return;
    }
    devContext.project = project;
    devContext.attachments = [...devContext.attachments.filter((item) => item.id !== data.attachment.id), data.attachment].slice(-12);
    renderAttachmentChips();
    bubble('assistant', 'PROJECT CONTEXT', data.attachment.context
      ? `Attached ${data.attachment.name}. ${data.attachment.chars} text characters are now available to the local Copilot as read-only project context.`
      : `Stored ${data.attachment.name}, but no text could be extracted. Text PDFs and source files work immediately; scanned PDFs still need OCR.`);
    addTrace({
      title: `Project context attached · ${data.attachment.name}`,
      detail: `${data.attachment.extraction} · ${data.attachment.chars} chars · read-only planning context`,
      state: data.attachment.context ? 'ready' : 'info', source: 'BACKEND', confirmed: true
    });
  } catch (error) {
    if (state) state.textContent = `Attachment failed · ${error.message}`;
  }
}

async function conversationalAskCopilot() {
  const prompt = $('copilotPrompt')?.value?.trim() || '';
  if (!prompt) return;
  const project = $('project')?.value?.trim() || 'inneros-webmcp';
  const history = conversationHistoryForModel();
  const context = contextText();
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
    const data = await invoke('ask_inneros_copilot', { project, message: prompt, history, context });
    if (data.ok) {
      bubble('assistant', `${data.provider || 'LOCAL AMD'} · ${data.model || 'QWEN3-CODER'} · ${data.backend || 'local_vllm'}`, data.message);
      const casual = isCasualPrompt(prompt);
      lastExecutionBrief = casual ? '' : (data.executionBrief || prompt);
      $('executePlan').disabled = casual;
      $('modelLabel').textContent = `${data.provider || 'Local AMD'} · ${data.runtime || 'vLLM'}`;
      $('copilotBadge').textContent = `Local Qwen3-Coder · ${data.historyTurnsUsed || 0} prior turns · ${data.contextCharsUsed || 0} context chars`;
      $('copilotBadge').classList.add('ok');
      if (!casual) setNativeActionHint('PLAN READY · keep refining in chat, then Approve & Execute when satisfied. Nothing has executed.', 'info');
    } else {
      bubble('error', 'COPILOT ERROR', data.error || 'Local model unavailable.');
    }
  } catch (error) {
    bubble('error', 'COPILOT ERROR', error.message || 'Request failed.');
  } finally {
    $('askCopilot').disabled = false;
    $('askCopilot').textContent = 'Ask local model';
  }
}

async function verifyDevelopmentProject() {
  const project = $('project')?.value?.trim() || 'inneros-webmcp';
  const status = await invoke('get_project_status', { project });
  const valid = Boolean(status?.ok && status?.exists && status?.isGit);
  if (valid) return { ok: true, project, status };
  bubble('error', 'PROJECT REQUIRED', `Project "${project}" is not a verified Git workspace. Create it with Create Project or select an existing registered project.`);
  setNativeActionHint('EXECUTION BLOCKED · verified Git project required. No task was dispatched.', 'error');
  return { ok: false, project, status };
}

async function approvedExecuteWithContext() {
  const button = $('executePlan');
  const binding = await verifyDevelopmentProject();
  if (!binding.ok) return;
  const project = binding.project;
  const target = $('executorTarget')?.value || 'auto';
  const plan = (lastExecutionBrief || lastCopilotPrompt || '').slice(0, 3000);
  if (!plan) return;
  const attached = contextText(6500);
  const instruction = attached
    ? `${plan}\n\nREAD-ONLY ATTACHED PROJECT CONTEXT:\n${attached}`.slice(0, 10000)
    : plan;

  button.disabled = true;
  button.textContent = 'Approved · dispatching…';
  setNativeActionHint(`APPROVED · executing the latest refined plan via ${executorLabel(target)}.`, 'active');
  try {
    if (target === 'auto' && isDmxSceneCreationPrompt(lastCopilotPrompt)) {
      button.textContent = 'Approved · registering scene…';
      const data = await invoke('dmx_create_scene', { description: lastCopilotPrompt });
      resultEl.textContent = JSON.stringify(data, null, 2);
      if (data.ok) {
        onSceneRegistered(data);
        const select = $('dmxScene');
        if (select && [...select.options].some((option) => option.value === data.scene)) select.value = data.scene;
        $('dmxState').textContent = `AG-59 registered · ${data.scene}`;
        bubble('assistant', 'APPROVED · LOCAL QWEN + AG-59', `Registered ${data.label || data.scene} after approval. The lights have NOT run; Apply scene remains a separate physical action.`);
        setNativeActionHint(`REGISTERED · ${data.label || data.scene} · press Apply scene for physical execution`, 'ready');
        lastExecutionBrief = '';
        button.textContent = 'Plan executed · scene registered';
        return;
      }
      bubble('error', 'AG-59 SCENE REGISTRY', `Approved scene creation was blocked: ${data.error || data.state || 'validation failed'}.`);
      return;
    }

    const data = target === 'auto'
      ? await invoke('resolve_project_blocker', { project, policy: 'local_first', instruction })
      : await invoke('dispatch_agent_action', { agent: target, project, instruction });
    renderMission(data, target);
    if (data?.dispatchId) {
      bubble('assistant', 'INNEROS ROUTER', `Approved plan dispatched to ${data?.route?.provider || data?.agent || target}. Dispatch ID: ${data.dispatchId}. Delivery is not completion; evidence will update separately.`);
      setNativeActionHint(`DISPATCHED · ${executorLabel(target)} · waiting for execution evidence`, 'ready');
    } else if (!data?.ok) {
      bubble('error', 'INNEROS ROUTER', data?.error || data?.blocker || 'The selected lane could not accept the approved plan.');
    }
  } finally {
    if (!button.textContent.startsWith('Plan executed')) {
      button.disabled = false;
      button.textContent = 'Approve & Execute Plan';
    }
  }
}

function installDevelopmentWorkspaceUi() {
  const projectInput = $('project');
  if (projectInput && !$('createProjectBtn')) {
    const actions = document.createElement('div');
    actions.className = 'project-actions';
    actions.innerHTML = '<button id="checkProjectBtn" type="button" class="ghost compact-button">Check</button><button id="createProjectBtn" type="button" class="secondary compact-button">Create Project</button><span id="projectActionState">Existing project or create a local Git workspace.</span>';
    projectInput.insertAdjacentElement('afterend', actions);
    $('createProjectBtn').addEventListener('click', createProjectFromUi);
    $('checkProjectBtn').addEventListener('click', async () => {
      const project = projectInput.value.trim();
      const data = await invoke('get_project_status', { project });
      $('projectActionState').textContent = data?.exists ? `READY · ${data.project} · ${data.workspace || 'registered'}${data.repo ? ` · ${data.repo}` : ' · local Git'}` : `NOT FOUND · ${project}`;
      if (data?.exists) await loadProjectAttachments(project);
    });
    projectInput.addEventListener('change', () => loadProjectAttachments(projectInput.value));
  }

  const composer = document.querySelector('.recording-composer');
  if (composer && !$('contextToolbar')) {
    const toolbar = document.createElement('div');
    toolbar.id = 'contextToolbar';
    toolbar.className = 'context-toolbar';
    toolbar.innerHTML = '<div class="context-actions"><button id="attachFileBtn" type="button" class="ghost compact-button">＋ Attach PDF / code</button><button id="voiceBtn" type="button" class="ghost compact-button">🎙 Voice</button><input id="contextFileInput" type="file" hidden multiple accept=".pdf,.txt,.md,.json,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.html,.css,.sql,.yaml,.yml,.toml,.sh,.java,.kt,.go,.rs,.c,.cpp,.h,.hpp,.cs,.php,.rb,.swift,.xml,.csv,text/*,application/pdf,application/json"></div><span id="attachmentState">Attach PDF or code as read-only planning context.</span><div id="attachmentChips" class="context-chips"></div>';
    composer.insertBefore(toolbar, composer.firstChild);
    $('attachFileBtn').addEventListener('click', () => $('contextFileInput').click());
    $('contextFileInput').addEventListener('change', async (event) => {
      for (const file of [...event.target.files].slice(0, 6)) await uploadContextFile(file);
      event.target.value = '';
    });

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const recognition = new Recognition();
      recognition.lang = 'es-EC';
      recognition.interimResults = true;
      recognition.continuous = false;
      let base = '';
      recognition.onstart = () => { base = $('copilotPrompt').value.trim(); $('voiceBtn').textContent = '● Listening…'; };
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
        $('copilotPrompt').value = `${base}${base ? ' ' : ''}${transcript}`.trim();
      };
      recognition.onend = () => { $('voiceBtn').textContent = '🎙 Voice'; };
      recognition.onerror = () => { $('voiceBtn').textContent = '🎙 Voice'; };
      $('voiceBtn').title = 'Browser speech recognition fallback. Dictation only; it never executes a plan.';
      $('voiceBtn').addEventListener('click', () => recognition.start());
    } else {
      $('voiceBtn').disabled = true;
      $('voiceBtn').textContent = 'Voice unavailable';
    }
  }
  loadProjectAttachments($('project')?.value || 'inneros-webmcp');
}

// Capture before legacy listeners so there is one authoritative conversation/approval path.
document.addEventListener('submit', (event) => {
  if (event.target !== $('copilotForm')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  conversationalAskCopilot();
}, true);

document.addEventListener('click', (event) => {
  if (!event.target?.closest?.('#executePlan')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  approvedExecuteWithContext();
}, true);

verifyBoundProjectForApproval = verifyDevelopmentProject;
window.setTimeout(installDevelopmentWorkspaceUi, 0);


// Upgrade voice dictation to local Whisper first. Replacing the button removes the
// earlier browser-recognition listener; browser speech recognition is only an explicit fallback.
function installLocalWhisperVoice(attempt = 0) {
  const oldButton = $('voiceBtn');
  if (!oldButton) {
    if (attempt < 12) window.setTimeout(() => installLocalWhisperVoice(attempt + 1), 50);
    return;
  }
  const button = oldButton.cloneNode(true);
  oldButton.replaceWith(button);
  button.disabled = false;
  button.textContent = '🎙 Local voice';
  button.title = 'Record locally in the browser, transcribe through the on-prem Whisper service, and place the text in chat. Dictation never executes.';

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  function enableBrowserFallback() {
    if (!Recognition) {
      button.disabled = true;
      button.textContent = 'Voice unavailable';
      return;
    }
    button.textContent = '🎙 Browser fallback';
    button.title = 'Local Whisper was unavailable. This explicit fallback uses browser speech recognition; it still only dictates text.';
    button.onclick = () => {
      const recognition = new Recognition();
      recognition.lang = 'es-EC';
      recognition.interimResults = true;
      recognition.continuous = false;
      const base = $('copilotPrompt').value.trim();
      button.textContent = '● Browser listening…';
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
        $('copilotPrompt').value = `${base}${base ? ' ' : ''}${transcript}`.trim();
      };
      recognition.onend = () => { button.textContent = '🎙 Browser fallback'; };
      recognition.onerror = () => { button.textContent = '🎙 Browser fallback'; };
      recognition.start();
    };
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    enableBrowserFallback();
    return;
  }

  let recorder = null;
  let stream = null;
  let chunks = [];
  let recording = false;

  async function finishRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }

  button.onclick = async () => {
    if (recording) {
      recording = false;
      button.disabled = true;
      button.textContent = 'Transcribing locally…';
      await finishRecording();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = window.MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      recorder = new MediaRecorder(stream, { mimeType: preferred });
      chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream?.getTracks?.().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || preferred });
        try {
          const dataBase64 = await fileToBase64(blob);
          const response = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime: blob.type || preferred, dataBase64 })
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || 'local_whisper_failed');
          const existing = $('copilotPrompt').value.trim();
          $('copilotPrompt').value = `${existing}${existing ? ' ' : ''}${data.transcript}`.trim();
          button.disabled = false;
          button.textContent = '🎙 Local voice';
          if ($('attachmentState')) $('attachmentState').textContent = `Voice transcribed locally · ${data.transcript.length} chars · review before sending`;
          addTrace({
            title: 'Voice transcribed · Local Whisper',
            detail: `${data.transcript.length} characters inserted into the chat composer. No plan was sent or executed.`,
            state: 'ready', source: 'BACKEND', confirmed: true, backend: 'local_whisper'
          });
        } catch (error) {
          button.disabled = false;
          if ($('attachmentState')) $('attachmentState').textContent = `Local Whisper unavailable · ${error.message}. Browser fallback is now available explicitly.`;
          addTrace({
            title: 'Local Whisper unavailable', detail: error.message || 'transcription failed',
            state: 'blocked', source: 'BACKEND', confirmed: true, backend: 'local_whisper'
          });
          enableBrowserFallback();
        }
      };
      recorder.start();
      recording = true;
      button.textContent = '■ Stop & transcribe';
      if ($('attachmentState')) $('attachmentState').textContent = 'Recording for Local Whisper · click Stop & transcribe when finished';
    } catch (error) {
      recording = false;
      stream?.getTracks?.().forEach((track) => track.stop());
      if ($('attachmentState')) $('attachmentState').textContent = `Microphone unavailable · ${error.message}`;
      enableBrowserFallback();
    }
  };
}

window.setTimeout(() => installLocalWhisperVoice(), 80);


// Chat-first composer polish: familiar attach/mic/audio/send controls while preserving approval-first execution.
const composerIcons = Object.freeze({
  attach: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12.5 14.8 6.2a3.2 3.2 0 0 1 4.5 4.5l-8 8a5 5 0 0 1-7.1-7.1l8-8"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M9 21h6"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5Z"/><path d="M17 9.2a4 4 0 0 1 0 5.6M19.5 6.8a7.5 7.5 0 0 1 0 10.4"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  send: '<span class="send-label">Send</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></svg>'
});

let lastLocalModelReply = '';
let localReplyUtterance = null;

function setIconButton(button, icon, label, title = label) {
  if (!button) return;
  button.className = 'composer-icon-button';
  button.innerHTML = icon;
  button.setAttribute('aria-label', label);
  button.title = title;
}

function latestStoredLocalReply() {
  for (let i = persistedChatHistory.length - 1; i >= 0; i -= 1) {
    const item = persistedChatHistory[i];
    if (item?.role === 'assistant' && /LOCAL AMD|QWEN|INNEROS COPILOT/i.test(item.label || '')) return String(item.message || '');
  }
  return '';
}

function syncResponseAudioButtons() {
  const play = $('playResponseBtn');
  const stop = $('stopResponseBtn');
  const supported = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  if (play) play.disabled = !supported || !lastLocalModelReply;
  if (stop) stop.disabled = !supported || !window.speechSynthesis?.speaking;
  if (play) play.classList.toggle('active', Boolean(window.speechSynthesis?.speaking));
}

function stopLocalResponseAudio() {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  localReplyUtterance = null;
  syncResponseAudioButtons();
}

function playOrPauseLocalResponse() {
  if (!lastLocalModelReply || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  const synth = window.speechSynthesis;
  if (synth.speaking) {
    if (synth.paused) synth.resume();
    else synth.pause();
    syncResponseAudioButtons();
    return;
  }

  const spoken = lastLocalModelReply
    .replace(/\n?EXECUTION BRIEF:[\s\S]*$/i, '')
    .replace(/[`*_#]/g, '')
    .trim()
    .slice(0, 5000);
  if (!spoken) return;
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = /[áéíóúñ¿¡]/i.test(spoken) ? 'es-EC' : 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onstart = syncResponseAudioButtons;
  utterance.onpause = syncResponseAudioButtons;
  utterance.onresume = syncResponseAudioButtons;
  utterance.onend = () => { localReplyUtterance = null; syncResponseAudioButtons(); };
  utterance.onerror = () => { localReplyUtterance = null; syncResponseAudioButtons(); };
  localReplyUtterance = utterance;
  synth.speak(utterance);
  syncResponseAudioButtons();
}

function updateSendVisual(busy = false) {
  const send = $('askCopilot');
  if (!send) return;
  send.className = 'composer-send-button';
  send.innerHTML = composerIcons.send;
  send.disabled = busy;
  send.setAttribute('aria-label', busy ? 'Local model is responding' : 'Send to local model');
  send.title = busy ? 'Local model is responding' : 'Send to local model';
  const hint = $('sendHint');
  if (hint) hint.textContent = busy ? 'Local Qwen is responding…' : 'Enter to send · Shift+Enter for a new line';
}

function autoGrowComposer() {
  const textarea = $('copilotPrompt');
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(170, Math.max(64, textarea.scrollHeight))}px`;
}

function installChatComposerPolish(attempt = 0) {
  const composer = document.querySelector('.recording-composer');
  const attach = $('attachFileBtn');
  const voice = $('voiceBtn');
  const send = $('askCopilot');
  const execute = $('executePlan');
  if (!composer || !attach || !voice || !send || !execute) {
    if (attempt < 20) window.setTimeout(() => installChatComposerPolish(attempt + 1), 50);
    return;
  }
  if (composer.classList.contains('modern-composer')) return;
  composer.classList.add('modern-composer');

  const toolbar = $('contextToolbar');
  if (toolbar) {
    toolbar.className = 'attachment-tray';
    const actions = toolbar.querySelector('.context-actions');
    const fileInput = $('contextFileInput');
    if (fileInput && actions) toolbar.append(fileInput);
    actions?.remove();
  }

  const label = composer.querySelector('.composer-label');
  if (label) label.setAttribute('for', 'copilotPrompt');

  setIconButton(attach, composerIcons.attach, 'Attach PDF or code', 'Attach PDF or code');
  setIconButton(voice, composerIcons.mic, 'Dictate with Local Whisper', 'Dictate with Local Whisper');

  const controlRow = document.createElement('div');
  controlRow.className = 'composer-control-row';
  const iconTools = document.createElement('div');
  iconTools.className = 'composer-icon-tools';
  iconTools.setAttribute('aria-label', 'Message tools');
  iconTools.append(attach, voice);

  const play = document.createElement('button');
  play.id = 'playResponseBtn';
  play.type = 'button';
  setIconButton(play, composerIcons.speaker, 'Play or pause last local model response', 'Play / pause last local model response');
  play.addEventListener('click', playOrPauseLocalResponse);
  iconTools.append(play);

  const stop = document.createElement('button');
  stop.id = 'stopResponseBtn';
  stop.type = 'button';
  setIconButton(stop, composerIcons.stop, 'Stop response audio', 'Stop response audio');
  stop.addEventListener('click', stopLocalResponseAudio);
  iconTools.append(stop);

  const sendTools = document.createElement('div');
  sendTools.className = 'composer-send-tools';
  const sendHint = document.createElement('span');
  sendHint.id = 'sendHint';
  sendHint.textContent = 'Enter to send · Shift+Enter for a new line';
  sendTools.append(sendHint);
  updateSendVisual(false);
  sendTools.append(send);
  controlRow.append(iconTools, sendTools);

  const footer = composer.querySelector('.composer-footer');
  if (footer) {
    footer.className = 'composer-secondary-row';
    const actionRow = footer.querySelector('.action-row');
    actionRow?.remove();
    footer.append(execute);
    composer.insertBefore(controlRow, footer);
  } else {
    composer.append(controlRow);
    const secondary = document.createElement('div');
    secondary.className = 'composer-secondary-row';
    const history = composer.querySelector('.history-controls');
    if (history) secondary.append(history);
    secondary.append(execute);
    composer.append(secondary);
  }
  execute.classList.add('approval-button');
  execute.textContent = execute.disabled ? 'Approve & Execute Plan' : execute.textContent;

  const textarea = $('copilotPrompt');
  textarea?.addEventListener('input', autoGrowComposer);
  autoGrowComposer();

  lastLocalModelReply = latestStoredLocalReply();
  syncResponseAudioButtons();

  const heroSub = document.querySelector('.recording-hero-copy .hero-sub');
  if (heroSub) heroSub.textContent = heroSub.textContent.replace(/\b(?:11|12) WebMCP\b/g, '13 WebMCP');
  if ($('toolCount')) $('toolCount').textContent = '13 WebMCP';
}

// Override the earlier browser-recognition setup while keeping Local Whisper first and button-icon safe.
installLocalWhisperVoice = function polishedLocalWhisperVoice(attempt = 0) {
  const oldButton = $('voiceBtn');
  if (!oldButton) {
    if (attempt < 12) window.setTimeout(() => installLocalWhisperVoice(attempt + 1), 50);
    return;
  }
  const button = oldButton.cloneNode(true);
  oldButton.replaceWith(button);
  button.disabled = false;
  button.dataset.state = 'idle';
  button.setAttribute('aria-label', 'Dictate with Local Whisper');
  button.title = 'Dictate through the on-prem Whisper service. Dictation never sends or executes by itself.';

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  function setState(state, title) {
    button.dataset.state = state;
    button.setAttribute('aria-label', title);
    button.title = title;
  }
  function enableBrowserFallback() {
    if (!Recognition) {
      button.disabled = true;
      setState('unavailable', 'Voice unavailable');
      return;
    }
    setState('fallback', 'Local Whisper unavailable · click for browser speech-recognition fallback');
    button.onclick = () => {
      const recognition = new Recognition();
      recognition.lang = 'es-EC';
      recognition.interimResults = true;
      recognition.continuous = false;
      const base = $('copilotPrompt').value.trim();
      setState('recording', 'Browser fallback listening · click is not required to send');
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
        $('copilotPrompt').value = `${base}${base ? ' ' : ''}${transcript}`.trim();
        autoGrowComposer();
      };
      recognition.onend = () => setState('fallback', 'Local Whisper unavailable · browser speech-recognition fallback');
      recognition.onerror = () => setState('fallback', 'Local Whisper unavailable · browser speech-recognition fallback');
      recognition.start();
    };
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    enableBrowserFallback();
    return;
  }

  let recorder = null;
  let stream = null;
  let chunks = [];
  let recording = false;
  let autoStop = null;

  button.onclick = async () => {
    if (recording) {
      recording = false;
      if (autoStop) clearTimeout(autoStop);
      button.disabled = true;
      setState('transcribing', 'Transcribing locally with Whisper…');
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = window.MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      recorder = new MediaRecorder(stream, { mimeType: preferred });
      chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream?.getTracks?.().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || preferred });
        try {
          const dataBase64 = await fileToBase64(blob);
          const response = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime: blob.type || preferred, dataBase64 })
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || 'local_whisper_failed');
          const existing = $('copilotPrompt').value.trim();
          $('copilotPrompt').value = `${existing}${existing ? ' ' : ''}${data.transcript}`.trim();
          autoGrowComposer();
          button.disabled = false;
          setState('idle', 'Dictate with Local Whisper');
          if ($('attachmentState')) $('attachmentState').textContent = `Voice transcribed locally · ${data.transcript.length} chars · review before sending`;
          addTrace({ title: 'Voice transcribed · Local Whisper', detail: `${data.transcript.length} characters inserted into the composer. Nothing was sent or executed.`, state: 'ready', source: 'BACKEND', confirmed: true, backend: 'local_whisper' });
        } catch (error) {
          button.disabled = false;
          if ($('attachmentState')) $('attachmentState').textContent = `Local Whisper unavailable · ${error.message}. Browser fallback enabled.`;
          addTrace({ title: 'Local Whisper unavailable', detail: error.message || 'transcription failed', state: 'blocked', source: 'BACKEND', confirmed: true, backend: 'local_whisper' });
          enableBrowserFallback();
        }
      };
      recorder.start();
      recording = true;
      setState('recording', 'Recording · click again to stop and transcribe locally');
      if ($('attachmentState')) $('attachmentState').textContent = 'Recording for Local Whisper · click the microphone again to stop and transcribe';
      autoStop = window.setTimeout(() => {
        if (!recording) return;
        recording = false;
        button.disabled = true;
        setState('transcribing', 'Transcribing locally with Whisper…');
        if (recorder?.state !== 'inactive') recorder.stop();
      }, 45000);
    } catch (error) {
      recording = false;
      stream?.getTracks?.().forEach((track) => track.stop());
      if ($('attachmentState')) $('attachmentState').textContent = `Microphone unavailable · ${error.message}`;
      enableBrowserFallback();
    }
  };
};

// Keep the visible Send control intact while the local model answers and make the reply playable.
conversationalAskCopilot = async function polishedConversationalAskCopilot() {
  const prompt = $('copilotPrompt')?.value?.trim() || '';
  if (!prompt) return;
  const project = $('project')?.value?.trim() || 'inneros-webmcp';
  const history = conversationHistoryForModel();
  const context = contextText();
  lastCopilotPrompt = prompt;
  lastExecutionBrief = '';
  $('executePlan').disabled = true;
  bubble('user', 'YOU', prompt);
  $('copilotPrompt').value = '';
  autoGrowComposer();
  updateSendVisual(true);
  setFlowStage('archHuman', { confirmed: true });
  window.setTimeout(() => setFlowStage('archWebmcp'), 120);
  try {
    const data = await invoke('ask_inneros_copilot', { project, message: prompt, history, context });
    if (data.ok) {
      bubble('assistant', `${data.provider || 'LOCAL AMD'} · ${data.model || 'QWEN3-CODER'} · ${data.backend || 'local_vllm'}`, data.message);
      lastLocalModelReply = String(data.message || '');
      syncResponseAudioButtons();
      const casual = isCasualPrompt(prompt);
      lastExecutionBrief = casual ? '' : (data.executionBrief || prompt);
      $('executePlan').disabled = casual;
      $('modelLabel').textContent = `${data.provider || 'Local AMD'} · ${data.runtime || 'vLLM'}`;
      $('copilotBadge').textContent = `Local Qwen3-Coder · ${data.historyTurnsUsed || 0} prior turns · ${data.contextCharsUsed || 0} context chars`;
      $('copilotBadge').classList.add('ok');
      if (!casual) setNativeActionHint('PLAN READY · keep refining in chat, then Approve & Execute when satisfied. Nothing has executed.', 'info');
    } else {
      bubble('error', 'COPILOT ERROR', data.error || 'Local model unavailable.');
    }
  } catch (error) {
    bubble('error', 'COPILOT ERROR', error.message || 'Request failed.');
  } finally {
    updateSendVisual(false);
  }
};

window.setTimeout(() => installChatComposerPolish(), 150);
window.addEventListener('beforeunload', stopLocalResponseAudio);
