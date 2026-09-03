import { adapterConfigured, callInnerOS } from './inneros-adapter.js';
import { askInnerOSCopilot, copilotStatus, designDmxScene } from './copilot.js';
import { dmxStatus, getDmxStatus, setDmxScene, runDmxBlackout, createDmxScene } from './dmx-bridge.js';

const AGENTS = Object.freeze([
  { id: 'codex', label: 'Codex', transport: 'headless', capability: 'CLI execution', verification: 'verified adapter' },
  { id: 'cursor', label: 'Cursor', transport: 'remote inbox', capability: 'IDE delivery', verification: 'no fake headless' },
  { id: 'antigravity', label: 'AntiGravity', transport: 'remote inbox', capability: 'IDE delivery', verification: 'live execution requires returned session evidence' },
  { id: 'local', label: 'Local AMD', transport: 'local vLLM / A2A', capability: 'Qwen3-Coder 30B', verification: '$0 external inference' }
]);
const ALLOWED_AGENTS = Object.freeze(AGENTS.map((agent) => agent.id));
const ALLOWED_ACTIONS = Object.freeze(['inspect','dispatch','status','evidence','resolve','create_project']);
const dispatches = new Map();

function safeText(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function safeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-16).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: safeText(item?.content, 5000)
  })).filter((item) => item.content);
}

const DMX_COLOR_ALIASES = Object.freeze({
  red: 'rojo', green: 'verde', blue: 'azul', yellow: 'amarillo',
  purple: 'morado', violet: 'violeta', magenta: 'magenta', pink: 'rosa',
  cyan: 'cian', turquoise: 'turquesa', orange: 'naranja', amber: 'ambar',
  gold: 'dorado', white: 'blanco', lime: 'lima', off: 'blackout', black: 'blackout'
});
const DMX_TARGET_ALIASES = Object.freeze({
  all: 'all', 'all lights': 'all', todas: 'todas',
  pars: 'tachos', par: 'tachos', tachos: 'tachos',
  beams: 'beams', beam: 'beams',
  spiders: 'pulpos', spider: 'pulpos', pulpos: 'pulpos',
  'disco ball': 'bola_disco', bola_disco: 'bola_disco'
});

export function normalizeDmxDesignedScene(scene = {}) {
  return {
    ...scene,
    steps: Array.isArray(scene.steps) ? scene.steps.map((step) => {
      const rawColor = String(step?.color || '').trim().toLowerCase();
      const rawTarget = String(step?.target || '').trim().toLowerCase();
      return {
        ...step,
        color: DMX_COLOR_ALIASES[rawColor] || rawColor,
        target: DMX_TARGET_ALIASES[rawTarget] || rawTarget
      };
    }) : []
  };
}

function unavailable(tool, detail = 'Judge-safe InnerOS runtime adapter is not connected yet.') {
  return { ok: false, state: 'unavailable', tool, detail, source: 'inneros-webmcp-bridge' };
}

async function liveOrUnavailable(tool, input, fallbackDetail) {
  if (!adapterConfigured()) return unavailable(tool, fallbackDetail);
  return callInnerOS(tool, input);
}

export function getPolicy() {
  return {
    agents: AGENTS,
    actions: ALLOWED_ACTIONS,
    executionPolicy: 'approval_then_local_first',
    adapterConfigured: adapterConfigured(),
    copilot: copilotStatus(),
    dmx: dmxStatus(),
    writesRequireBridge: true,
    truthRule: 'conversation never equals execution; running/completed require backend evidence'
  };
}

export async function invokeTool(name, input = {}) {
  if (name === 'ask_inneros_copilot') {
    const project = safeText(input.project, 120) || 'inneros-webmcp';
    const message = safeText(input.message, 4000);
    const history = safeHistory(input.history);
    const context = safeText(input.context, 50000);
    if (!message) return { ok: false, state: 'rejected', error: 'message_required' };
    return askInnerOSCopilot({ project, message, history, context });
  }

  if (name === 'list_agents') {
    if (adapterConfigured()) return callInnerOS(name, {});
    return { ok: true, state: 'ready', agents: AGENTS, live: false };
  }

  if (name === 'get_project_status') {
    const project = safeText(input.project, 120);
    if (!project) return { ok: false, state: 'rejected', error: 'project_required' };
    return liveOrUnavailable(name, { project }, `No judge-safe live project adapter is connected for ${project}.`);
  }

  if (name === 'create_project_workspace') {
    const project = safeText(input.project, 48).toLowerCase();
    const description = safeText(input.description, 500);
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(project)) {
      return { ok: false, state: 'rejected', error: 'project_name_invalid' };
    }
    return liveOrUnavailable(name, { project, description }, 'Project bootstrap requires the live InnerOS project runtime bridge.');
  }

  if (name === 'inspect_blockers') {
    const project = safeText(input.project, 120);
    const taskId = safeText(input.taskId, 160);
    if (!project && !taskId) return { ok: false, state: 'rejected', error: 'project_or_task_required' };
    return liveOrUnavailable(name, { project, taskId }, 'No judge-safe live blocker adapter is connected.');
  }

  if (name === 'resolve_project_blocker') {
    const project = safeText(input.project, 120);
    if (!project) return { ok: false, state: 'rejected', error: 'project_required' };
    const policy = safeText(input.policy, 40) || 'local_first';
    if (!['local_first','best_available'].includes(policy)) return { ok: false, state: 'rejected', error: 'policy_not_allowlisted' };
    const instruction = safeText(input.instruction, 10000) || 'Diagnose the current blocker and resolve it safely.';
    if (adapterConfigured()) return callInnerOS(name, { project, policy, instruction });
    const dispatchId = `wmcp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const record = {
      dispatchId, agent: null, project, instruction, policy, state: 'blocked',
      blocker: 'judge_safe_inneros_adapter_not_connected', createdAt: new Date().toISOString(),
      trace: [
        { stage: 'diagnose', state: 'blocked', detail: 'Live blocker adapter required before diagnosis can be claimed.' },
        { stage: 'route', state: 'pending', detail: `Policy: ${policy}` },
        { stage: 'dispatch', state: 'pending', detail: 'No agent dispatch performed.' },
        { stage: 'verify', state: 'pending', detail: 'No evidence available.' }
      ], evidence: []
    };
    dispatches.set(dispatchId, record);
    return { ok: false, ...record };
  }

  if (name === 'dispatch_agent_action') {
    const agent = safeText(input.agent, 40).toLowerCase();
    const instruction = safeText(input.instruction, 10000);
    const project = safeText(input.project, 120) || null;
    const taskId = safeText(input.taskId, 160) || null;
    if (!ALLOWED_AGENTS.includes(agent)) return { ok: false, state: 'rejected', error: 'agent_not_allowlisted' };
    if (!instruction) return { ok: false, state: 'rejected', error: 'instruction_required' };
    if (adapterConfigured()) return callInnerOS(name, { agent, project, taskId, instruction });
    const dispatchId = `wmcp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const record = {
      dispatchId, agent, project, taskId, instruction,
      state: 'blocked', blocker: 'judge_safe_inneros_adapter_not_connected', createdAt: new Date().toISOString(),
      trace: [{ stage: 'dispatch', state: 'blocked', detail: 'No external execution claimed without a live adapter.' }], evidence: []
    };
    dispatches.set(dispatchId, record);
    return { ok: false, ...record };
  }

  if (name === 'get_execution_trace') {
    const dispatchId = safeText(input.dispatchId, 200);
    if (!dispatchId) return { ok: false, state: 'rejected', error: 'dispatch_required' };
    if (adapterConfigured()) return callInnerOS(name, { dispatchId });
    const record = dispatches.get(dispatchId);
    if (!record) return { ok: false, state: 'not_found', error: 'dispatch_not_found' };
    return { ok: true, state: record.state, dispatchId, trace: record.trace || [] };
  }

  if (name === 'get_evidence') {
    const dispatchId = safeText(input.dispatchId, 200);
    const taskId = safeText(input.taskId, 160);
    if (adapterConfigured()) return callInnerOS(name, { dispatchId, taskId });
    if (dispatchId) {
      const record = dispatches.get(dispatchId);
      if (!record) return { ok: false, state: 'not_found', error: 'dispatch_not_found' };
      return { ok: true, dispatchId, evidence: record.evidence, state: record.state };
    }
    return unavailable(name);
  }

  if (name === 'dmx_create_scene') {
    const description = safeText(input.description, 1800);
    if (!description) return { ok: false, state: 'rejected', error: 'description_required' };
    const designed = await designDmxScene(description);
    if (!designed.ok) return designed;
    const normalizedScene = normalizeDmxDesignedScene(designed.scene);
    const registered = await createDmxScene(normalizedScene);
    if (!registered.ok) return registered;
    return {
      ...registered,
      designer: { provider: designed.provider, runtime: designed.runtime, model: designed.model },
      designedScene: normalizedScene,
      executionClaimed: true,
      physicalExecutionClaimed: false
    };
  }

  if (name === 'dmx_status') return getDmxStatus();
  if (name === 'dmx_set_scene') return setDmxScene(input);
  if (name === 'dmx_blackout') return runDmxBlackout();
  return { ok: false, state: 'rejected', error: 'tool_not_allowlisted' };
}

export { ALLOWED_AGENTS, ALLOWED_ACTIONS };
