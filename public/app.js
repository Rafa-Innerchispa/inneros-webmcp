import { installBrowserWebMCP } from '/webmcp.js';

const $ = (id) => document.getElementById(id);
const traceEl = $('trace');
const resultEl = $('result');

function escapeHtml(value='') {
  return String(value).replace(/[&<>'\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
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
  title.textContent = event.title || '';
  const detail = document.createElement('p');
  detail.textContent = event.detail || '';
  body.append(title, detail);
  row.append(time, body);
  traceEl.prepend(row);
}

function setEvidence(data) {
  const rows = $('evidence').querySelectorAll('dd');
  rows[0].textContent = data.dispatchId || '—';
  rows[1].textContent = data.agent || '—';
  rows[2].textContent = data.state || '—';
  rows[3].textContent = data.evidence?.length ? `${data.evidence.length} verified item(s)` : (data.blocker || data.error || data.detail || 'No verified result yet.');
  const pill = $('evidenceState');
  const state = (data.state || 'waiting').toUpperCase();
  pill.textContent = state;
  pill.className = `state-pill ${state === 'COMPLETED' || state === 'READY' ? 'ok' : state === 'BLOCKED' || state === 'UNAVAILABLE' || state === 'REJECTED' ? 'bad' : 'neutral'}`;
}

async function invoke(name, input = {}) {
  addTrace({ title: `WebMCP → ${name}`, detail: JSON.stringify(input), state: 'info' });
  const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
  });
  const data = await response.json();
  const state = data.state || (data.ok ? 'ok' : 'error');
  addTrace({ title: `${name} · ${state}`, detail: data.blocker || data.detail || data.error || 'Completed', state: data.ok ? 'ok' : state });
  if (data.dispatchId || data.state) setEvidence(data);
  return data;
}

function renderAgents(agents) {
  const root = $('agents');
  root.replaceChildren();
  for (const agent of agents) {
    const article = document.createElement('article');
    const top = document.createElement('div');
    top.className = 'agent-top';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const strong = document.createElement('strong');
    strong.textContent = agent.label || agent.id;
    const transport = document.createElement('span');
    transport.className = 'transport';
    transport.textContent = agent.transport || 'configured';
    top.append(dot, strong, transport);
    const capability = document.createElement('p');
    capability.textContent = agent.capability || '';
    const small = document.createElement('small');
    small.textContent = agent.verification || 'state verified on query';
    article.append(top, capability, small);
    root.append(article);
  }
}

async function boot() {
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    $('health').textContent = health.ok ? 'Bridge: online' : 'Bridge: unavailable';
    $('toolCount').textContent = String(health.webmcpTools || 0);
    const policy = await fetch('/api/policy').then((r) => r.json());
    renderAgents(policy.agents || []);
    const registration = installBrowserWebMCP(invoke);
    $('mcpBadge').textContent = registration.supported ? `${registration.registered.length} tools registered` : 'WebMCP API unavailable';
    $('mcpBadge').classList.toggle('ok', registration.supported);
    addTrace({ title: 'Control room initialized', detail: registration.supported ? 'Browser exposed the registered WebMCP tools.' : 'Fallback browser mode. No WebMCP API detected.', state: registration.supported ? 'ok' : 'info' });
  } catch (error) {
    $('health').textContent = 'Bridge: unavailable';
    addTrace({ title: 'Boot failed', detail: error.message, state: 'blocked' });
  }
}

$('resolveForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = await invoke('resolve_project_blocker', { project: $('resolveProject').value, policy: 'local_first', instruction: $('resolveInstruction').value });
  resultEl.textContent = JSON.stringify(data, null, 2);
  if (Array.isArray(data.trace)) data.trace.forEach((item) => addTrace({ title: `${item.stage} · ${item.state}`, detail: item.detail, state: item.state }));
});

$('dispatchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = await invoke('dispatch_agent_action', { agent: $('agent').value, project: $('project').value, instruction: $('instruction').value });
  resultEl.textContent = JSON.stringify(data, null, 2);
});

$('clearTrace').addEventListener('click', () => { traceEl.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No execution events yet.' })); });

boot();
