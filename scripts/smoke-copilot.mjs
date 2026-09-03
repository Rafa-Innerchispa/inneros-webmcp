const base = process.env.WEBMCP_SMOKE_URL || 'http://127.0.0.1:5195';
const url = `${base.replace(/\/$/, '')}/api/tools/ask_inneros_copilot`;
const started = Date.now();
const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    project: 'inneros-webmcp',
    message: 'Reply briefly with a safe plan to add one read-only status field and one focused test. Do not execute anything.'
  })
});
const data = await response.json();
if (!response.ok || !data.ok || data.state !== 'answered' || !data.message || data.executionClaimed !== false) {
  console.error(JSON.stringify({ status: response.status, data }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  state: data.state,
  provider: data.provider,
  runtime: data.runtime,
  model: data.model,
  executionClaimed: data.executionClaimed,
  requestId: data.proof?.requestId || response.headers.get('x-inneros-request-id'),
  backend: data.proof?.backend || response.headers.get('x-inneros-adapter'),
  serverLatencyMs: data.proof?.latencyMs,
  wallLatencyMs: Date.now() - started,
  answerPreview: data.message.slice(0, 180),
  executionBrief: data.executionBrief
}, null, 2));
