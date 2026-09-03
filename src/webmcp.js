export const TOOL_NAMES = [
  'ask_inneros_copilot',
  'list_agents',
  'get_project_status',
  'create_project_workspace',
  'inspect_blockers',
  'dispatch_agent_action',
  'resolve_project_blocker',
  'get_execution_trace',
  'get_evidence',
  'dmx_create_scene',
  'dmx_status',
  'dmx_set_scene',
  'dmx_blackout'
];

const historyItem = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['user', 'assistant'] },
    content: { type: 'string', maxLength: 5000 }
  },
  required: ['role', 'content'],
  additionalProperties: false
};

const definitions = {
  ask_inneros_copilot: {
    description: 'Ask the local InnerOS coding copilot using bounded conversation history and optional project-file context. This tool never claims code execution.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', maxLength: 120 },
        message: { type: 'string', maxLength: 4000 },
        history: { type: 'array', maxItems: 16, items: historyItem },
        context: { type: 'string', maxLength: 50000 }
      },
      required: ['message'],
      additionalProperties: false
    }
  },
  list_agents: {
    description: 'List agent runtimes and verified capabilities exposed by the public-safe InnerOS bridge.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  get_project_status: {
    description: 'Read the current status of an allowlisted project.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', maxLength: 120 } }, required: ['project'], additionalProperties: false }
  },
  create_project_workspace: {
    description: 'Create a bounded local Git development project under the canonical Projects workspace and register it in InnerOS Project Runtime. This does not create a cloud or GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{1,47}$' },
        description: { type: 'string', maxLength: 500 }
      },
      required: ['project'],
      additionalProperties: false
    }
  },
  inspect_blockers: {
    description: 'Inspect truthful blockers for an allowlisted project or task.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', maxLength: 120 }, taskId: { type: 'string', maxLength: 160 } }, additionalProperties: false }
  },
  dispatch_agent_action: {
    description: 'Dispatch an approved coding action to Codex, Cursor, AntiGravity, or the local InnerOS runtime and return a real dispatch reference.',
    inputSchema: { type: 'object', properties: { agent: { type: 'string', enum: ['codex','cursor','antigravity','local'] }, project: { type: 'string', maxLength: 120 }, taskId: { type: 'string', maxLength: 160 }, instruction: { type: 'string', maxLength: 10000 } }, required: ['agent','instruction'], additionalProperties: false }
  },
  resolve_project_blocker: {
    description: 'After approval, diagnose/route a coding task through the cheapest capable allowlisted local-first resource and return trace/evidence references.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', maxLength: 120 }, policy: { type: 'string', enum: ['local_first','best_available'], default: 'local_first' }, instruction: { type: 'string', maxLength: 10000 } }, required: ['project'], additionalProperties: false }
  },
  get_execution_trace: {
    description: 'Read sanitized backend-confirmed execution events for a dispatched action.',
    inputSchema: { type: 'object', properties: { dispatchId: { type: 'string', maxLength: 200 } }, required: ['dispatchId'], additionalProperties: false }
  },
  get_evidence: {
    description: 'Retrieve sanitized completion evidence for a task or dispatch.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', maxLength: 160 }, dispatchId: { type: 'string', maxLength: 200 } }, additionalProperties: false }
  },
  dmx_create_scene: {
    description: 'After explicit approval, use the private local Qwen model to design one bounded declarative lighting scene, validate it again in AG-59, and register it without physically running it.',
    inputSchema: { type: 'object', properties: { description: { type: 'string', maxLength: 1800 } }, required: ['description'], additionalProperties: false }
  },
  dmx_status: {
    description: 'Read-only status for the allowlisted AG-59 DMX stage orchestrator (fixture count, current effect, supported scenes). Never exposes private network topology.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  dmx_set_scene: {
    description: 'Apply an allowlisted DMX scene through AG-59 / inneros-dmx-engine. Scene must be reported by dmx_status supportedScenes (trusted local registry) or blackout.',
    inputSchema: { type: 'object', properties: { scene: { type: 'string', maxLength: 64 }, speed: { type: 'number', minimum: 0.1, maximum: 3 } }, required: ['scene'], additionalProperties: false }
  },
  dmx_blackout: {
    description: 'Immediate safe blackout for all allowlisted DMX fixtures through AG-59.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
};

export function registerInnerOSWebMCP(modelContext, invoke) {
  if (!modelContext?.registerTool) return { supported: false, registered: [] };
  const registered = [];
  for (const name of TOOL_NAMES) {
    modelContext.registerTool({ name, ...definitions[name], execute: async (input = {}) => invoke(name, input) });
    registered.push(name);
  }
  return { supported: true, registered };
}

export function installBrowserWebMCP(invoke) {
  return registerInnerOSWebMCP(globalThis.document?.modelContext, invoke);
}
