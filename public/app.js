import { installBrowserWebMCP } from '/webmcp.js';

const $ = (id) => document.getElementById(id);
const traceEl = $('trace');
const resultEl = $('result');
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

function markArch(id, state = 'verified') {
  const el = $(id);
  if (!el) return;
  el.classList.remove('verified', 'active');
  if (state) el.classList.add(state);
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
  detail.textContent = short(event.detail || '', 300);
  body.append(head, detail);

  const metaValues = [
    event.requestId ? `request ${event.requestId}` : '',
    event.dispatchId ? `dispatch ${event.dispatchId}` : '',
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

async function invoke(name, input = {}, { trace = true } = {}) {
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
      dispatchId: data.dispatchId || ''
    });
  }
  renderReturnedTrace(data);
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

function renderAgents(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  $('agents').replaceChildren(...agents.map((agent) => {
    const card = document.createElement('article');
    card.dataset.agent = agent.id || '';
    const dot = document.createElement('span');
    dot.className = `dot ${agent.ready === false ? 'off' : ''}`;
    const text = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = agent.label || agent.id || 'Agent';
    const small = document.createElement('small');
    const parts = [agent.transport, agent.capability, agent.cost, agent.verification].filter(Boolean);
    small.textContent = parts.join(' · ') || 'Backend-reported capability';
    text.append(strong, small);
    card.append(dot, text);
    if (agent.id) {
      card.addEventListener('click', () => {
        $('executorTarget').value = agent.id;
        document.querySelectorAll('#agents article').forEach((el) => el.classList.toggle('selected', el === card));
      });
    }
    return card;
  }));
  $('fabricState').textContent = data?.live ? 'Live fabric confirmed' : 'Configured lanes only';
  if (data?.live) {
    markArch('archMcp', 'verified');
    markArch('archExecutor', 'verified');
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
  $('evidenceState').textContent = ['completed','pass'].includes(data?.state) ? 'Verified' : 'Pending verification';
  lastDispatchId = data?.dispatchId || '';
  $('dispatchId').textContent = lastDispatchId || 'No dispatch returned';
  $('proofDispatch').textContent = lastDispatchId || 'None';
  $('refreshEvidence').hidden = !lastDispatchId;
  resultEl.textContent = JSON.stringify(data, null, 2);
  if (lastDispatchId) {
    markArch('archExecutor', 'active');
    startEvidencePolling();
  }
}

function terminalState(value = '') {
  return ['completed','pass','failed','error','rejected','cancelled'].includes(String(value).toLowerCase());
}

async function refreshEvidence({ silent = false } = {}) {
  if (!lastDispatchId || evidenceBusy) return '';
  evidenceBusy = true;
  try {
    const trace = await invoke('get_execution_trace', { dispatchId: lastDispatchId }, { trace: !silent });
    const evidence = await invoke('get_evidence', { dispatchId: lastDispatchId }, { trace: !silent });
    const state = evidence?.state || trace?.state || 'unknown';
    $('missionState').textContent = state;
    $('evidenceState').textContent = terminalState(state) && !['failed','error','rejected','cancelled'].includes(String(state).toLowerCase()) ? 'Verified' : state;
    resultEl.textContent = JSON.stringify({ trace, evidence }, null, 2);
    if (Array.isArray(trace?.trace)) renderReturnedTrace(trace);
    if (terminalState(state)) {
      markArch('archEvidence', ['completed','pass'].includes(String(state).toLowerCase()) ? 'verified' : 'active');
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
  markArch('archWebmcp', 'active');
  markArch('archBridge', 'active');

  try {
    const data = await invoke('ask_inneros_copilot', { project, message: prompt });
    if (data.ok) {
      bubble('assistant', `${data.provider || 'LOCAL AMD'} · ${data.model || 'QWEN3-CODER'}`, data.message);
      lastExecutionBrief = data.executionBrief || prompt;
      $('executePlan').disabled = false;
      $('modelLabel').textContent = `${data.provider || 'Local AMD'} · ${data.runtime || 'vLLM'}`;
      markArch('archWebmcp', 'verified');
      markArch('archBridge', 'verified');
    } else {
      bubble('error', 'COPILOT ERROR', data.error || 'Local model unavailable.');
    }
  } catch (error) {
    bubble('error', 'COPILOT ERROR', error.message || 'Request failed.');
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
  markArch('archMcp', 'active');
  try {
    const data = target === 'auto'
      ? await invoke('resolve_project_blocker', { project, policy: 'local_first', instruction })
      : await invoke('dispatch_agent_action', { agent: target, project, instruction });
    renderMission(data, target);
    if (data?.dispatchId) {
      bubble('assistant', 'INNEROS ROUTER', `Execution dispatched to ${data?.route?.provider || data?.agent || target}. Dispatch ID: ${data.dispatchId}. The trace panel will poll backend evidence; no completion is claimed until the evidence endpoint confirms it.`);
      markArch('archMcp', 'verified');
    }
  } finally {
    $('executePlan').disabled = false;
    $('executePlan').textContent = 'Execute proposed plan';
  }
}

async function boot() {
  try {
    const started = performance.now();
    const healthResponse = await fetch('/api/health');
    const health = await healthResponse.json();
    const healthMs = Math.round(performance.now() - started);
    $('health').textContent = health.ok ? 'Bridge: online' : 'Bridge: unavailable';
    $('adapterState').textContent = health.adapter?.mode === 'mcp_loopback' ? 'MCP loopback · live' : (health.adapter?.mode || 'Unavailable');
    $('adapterDetail').textContent = health.adapter?.configured ? 'Private backend connected' : 'Adapter not connected';
    $('toolCount').textContent = `${health.webmcpTools || 0} WebMCP`;
    $('copilotBadge').textContent = health.copilot?.configured ? 'Local Qwen3-Coder · ready' : 'Local copilot unavailable';
    $('copilotBadge').classList.toggle('ok', Boolean(health.copilot?.configured));
    if (health.copilot?.model) $('modelLabel').textContent = `${health.copilot.provider || 'Local AMD'} · ${health.copilot.runtime || 'vLLM'}`;

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
      markArch('archBridge', 'verified');
      addTrace({ title: 'Private bridge health', detail: `Adapter mode: ${health.adapter.mode}. Private backend is configured without exposing its endpoint.`, state: 'ok', source: 'BACKEND', confirmed: true, backend: health.adapter.mode });
    }

    const policy = await fetch('/api/policy').then((r) => r.json());
    const agents = await invoke('list_agents', {});
    renderAgents(agents?.agents ? agents : { agents: policy.agents || [], live: false });

    const registration = installBrowserWebMCP(invoke);
    $('mcpBadge').textContent = registration.supported ? `${registration.registered.length} WebMCP tools registered` : 'WebMCP browser API not present';
    $('mcpBadge').classList.toggle('ok', registration.supported);
    if (registration.supported) markArch('archWebmcp', 'verified');
    addTrace({
      title: registration.supported ? 'Browser registered WebMCP tools' : 'Standard browser compatibility mode',
      detail: registration.supported ? `${registration.registered.length} tools registered through document.modelContext.registerTool.` : 'This browser does not expose document.modelContext. The same page remains usable for manual demo; ChatGPT WebMCP can discover the tools.',
      state: registration.supported ? 'ok' : 'info',
      source: 'BROWSER',
      confirmed: false
    });
  } catch (error) {
    $('health').textContent = 'Bridge: unavailable';
    $('adapterState').textContent = 'Unavailable';
    addTrace({ title: 'Boot failed', detail: error.message, state: 'blocked', source: 'BROWSER' });
  }
}

$('copilotForm').addEventListener('submit', askCopilot);
$('executePlan').addEventListener('click', executePlan);
$('refreshEvidence').addEventListener('click', () => refreshEvidence({ silent: false }));
$('clearTrace').addEventListener('click', () => {
  traceEl.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'Waiting for live events.';
  traceEl.append(empty);
});

boot();
