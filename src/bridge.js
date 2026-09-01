const ALLOWED_AGENTS = Object.freeze(['codex','cursor','antigravity','local']);
const ALLOWED_ACTIONS = Object.freeze(['inspect','dispatch','status','evidence']);
const dispatches = new Map();

function safeText(value, max = 2000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function unavailable(tool, detail = 'InnerOS bridge is not connected to a judge-safe runtime yet.') { return { ok: false, state: 'unavailable', tool, detail, source: 'inneros-webmcp-bridge' }; }
export function getPolicy() { return { agents: ALLOWED_AGENTS, actions: ALLOWED_ACTIONS, writesRequireBridge: true }; }

export async function invokeTool(name, input = {}) {
  if (name === 'list_agents') return { ok: true, agents: ALLOWED_AGENTS.map((id) => ({ id, status: 'configured', executionState: 'unknown', note: 'Configured means exposed by policy, not currently running.' })) };
  if (name === 'get_project_status') {
    const project = safeText(input.project, 120);
    if (!project) return { ok: false, state: 'rejected', error: 'project_required' };
    return unavailable(name, `No judge-safe live status adapter is connected for project ${project}.`);
  }
  if (name === 'inspect_blockers') {
    if (!safeText(input.project,120) && !safeText(input.taskId,160)) return { ok:false, state:'rejected', error:'project_or_task_required' };
    return unavailable(name);
  }
  if (name === 'dispatch_agent_action') {
    const agent = safeText(input.agent,40).toLowerCase();
    const instruction = safeText(input.instruction,2000);
    if (!ALLOWED_AGENTS.includes(agent)) return { ok:false, state:'rejected', error:'agent_not_allowlisted' };
    if (!instruction) return { ok:false, state:'rejected', error:'instruction_required' };
    const dispatchId = `wmcp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const record = { dispatchId, agent, project:safeText(input.project,120)||null, taskId:safeText(input.taskId,160)||null, instruction, state:'blocked', blocker:'judge_safe_inneros_adapter_not_connected', createdAt:new Date().toISOString(), evidence:[] };
    dispatches.set(dispatchId, record);
    return { ok:false, ...record };
  }
  if (name === 'get_execution_trace') {
    const id = safeText(input.dispatchId,200); const record = dispatches.get(id);
    if (!record) return { ok:false, state:'not_found', error:'dispatch_not_found' };
    return { ok:true, dispatchId:id, trace:[{ at:record.createdAt, state:record.state, agent:record.agent, blocker:record.blocker }] };
  }
  if (name === 'get_evidence') {
    const id = safeText(input.dispatchId,200);
    if (id) { const record = dispatches.get(id); if (!record) return { ok:false, state:'not_found', error:'dispatch_not_found' }; return { ok:true, dispatchId:id, evidence:record.evidence, state:record.state }; }
    return unavailable(name);
  }
  return { ok:false, state:'rejected', error:'tool_not_allowlisted' };
}
export { ALLOWED_AGENTS, ALLOWED_ACTIONS };
