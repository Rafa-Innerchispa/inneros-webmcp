import { installBrowserWebMCP } from '/webmcp.js';

const $ = (id) => document.getElementById(id);
const traceEl = $('trace');
const resultEl = $('result');
let lastDispatchId = '';

function safeDetail(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return ''; }
}

function addTrace(event) {
  const empty = traceEl.querySelector('.empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = `event ${event.state || 'info'}`;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = event.title || 'Event';
  const detail = document.createElement('p');
  detail.textContent = safeDetail(event.detail || '');
  body.append(title, detail);
  row.append(time, body);
  traceEl.prepend(row);
}

async function invoke(name, input = {}, { trace = true } = {}) {
  if (trace) addTrace({ title: `WebMCP → ${name}`, detail: input, state: 'info' });
  const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (trace) {
    addTrace({
      title: `${name} · ${data.state || (data.ok ? 'ok' : 'error')}`,
      detail: data.blocker || data.error || data.route || 'Backend response received.',
      state: data.ok ? 'ok' : (data.state || 'blocked')
    });
  }
  return data;
}

function renderAgents(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  $('agents').replaceChildren(...agents.map((agent) => {
    const card = document.createElement('article');
    const dot = document.createElement('span');
    dot.className = `dot ${agent.ready === false ? 'off' : ''}`;
    const text = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = agent.label || agent.id || 'Agent';
    const small = document.createElement('small');
    const parts = [agent.transport, agent.capability, agent.cost, agent.verification].filter(Boolean);
    small.textContent = parts.join(' · ') || 'Live capability';
    text.append(strong, small);
    card.append(dot, text);
    return card;
  }));
  $('fabricState').textContent = data?.live ? 'Live fabric' : 'Configured lanes';
}

function renderMission(data) {
  $('missionSummary').hidden = false;
  const route = data?.route || {};
  $('selectedResource').textContent = route.provider || route.providerId || data?.agent || 'Pending';
  $('selectedModel').textContent = [route.model, route.runtime].filter(Boolean).join(' · ') || 'Pending';
  $('externalCost').textContent = route.externalCost || (data?.policy === 'local_first' ? 'Local-first' : 'Pending');
  $('evidenceState').textContent = data?.state === 'completed' ? 'Verified' : 'Pending verification';
  lastDispatchId = data?.dispatchId || '';
  $('refreshEvidence').hidden = !lastDispatchId;
  resultEl.textContent = JSON.stringify(data, null, 2);
  if (Array.isArray(data?.trace)) {
    for (const step of data.trace.slice().reverse()) {
      addTrace({ title: `${step.stage || 'mission'} · ${step.state || 'info'}`, detail: step.detail || '', state: step.state || 'info' });
    }
  }
}

async function refreshEvidence() {
  if (!lastDispatchId) return;
  const trace = await invoke('get_execution_trace', { dispatchId: lastDispatchId });
  const evidence = await invoke('get_evidence', { dispatchId: lastDispatchId });
  const state = evidence?.state || trace?.state || 'unknown';
  $('evidenceState').textContent = state === 'completed' || state === 'pass' ? 'Verified' : state;
  resultEl.textContent = JSON.stringify({ trace, evidence }, null, 2);
  if (Array.isArray(trace?.trace)) {
    for (const step of trace.trace.slice().reverse()) {
      addTrace({ title: `trace · ${step.stage || step.state || 'event'}`, detail: step.detail || step, state: step.state || 'info' });
    }
  }
}

async function boot() {
  try {
    const healthResponse = await fetch('/api/health');
    const health = await healthResponse.json();
    $('health').textContent = health.ok ? 'Bridge: online' : 'Bridge: unavailable';
    $('adapterState').textContent = health.adapter?.mode === 'mcp_loopback' ? 'MCP loopback' : (health.adapter?.mode || 'Unavailable');
    $('adapterDetail').textContent = health.adapter?.configured ? 'Private backend connected' : 'Adapter not connected';
    $('toolCount').textContent = `${health.webmcpTools || 0} tools`;

    const cfRay = healthResponse.headers.get('cf-ray');
    const serverHeader = healthResponse.headers.get('server') || '';
    const cloudflareDetected = Boolean(cfRay) || /cloudflare/i.test(serverHeader);
    $('edgeState').textContent = cloudflareDetected ? 'Cloudflare · live' : 'Direct / local';
    $('edgeDetail').textContent = cloudflareDetected ? `Edge detected${cfRay ? ` · ${cfRay.split('-')[0]}` : ''}` : 'Awaiting public edge';

    const policy = await fetch('/api/policy').then((r) => r.json());
    const agents = await invoke('list_agents', {}, { trace: false });
    renderAgents(agents?.agents ? agents : { agents: policy.agents || [], live: false });

    const registration = installBrowserWebMCP(invoke);
    $('mcpBadge').textContent = registration.supported ? `${registration.registered.length} WebMCP tools registered` : 'Browser WebMCP unavailable';
    $('mcpBadge').classList.toggle('ok', registration.supported);
    addTrace({
      title: 'Mission Control initialized',
      detail: registration.supported ? 'WebMCP tool registration succeeded.' : 'Standard browser mode. WebMCP API not present.',
      state: registration.supported ? 'ok' : 'info'
    });
  } catch (error) {
    $('health').textContent = 'Bridge: unavailable';
    $('adapterState').textContent = 'Unavailable';
    addTrace({ title: 'Boot failed', detail: error.message, state: 'blocked' });
  }
}

$('missionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = {
    project: $('project').value,
    policy: $('policy').value,
    instruction: $('instruction').value
  };
  const data = await invoke('resolve_project_blocker', input);
  renderMission(data);
});

$('refreshEvidence').addEventListener('click', refreshEvidence);
$('clearTrace').addEventListener('click', () => {
  traceEl.innerHTML = '<div class="empty">No execution events yet.</div>';
});

boot();
