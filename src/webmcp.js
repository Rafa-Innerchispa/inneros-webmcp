export const TOOL_NAMES = [
  'ask_inneros_copilot',
  'list_agents',
  'get_project_status',
  'inspect_blockers',
  'dispatch_agent_action',
  'resolve_project_blocker',
  'get_execution_trace',
  'get_evidence'
];

const definitions = {
  ask_inneros_copilot: {
    description: 'Ask the local InnerOS coding copilot for an English-only coding answer and execution brief. This tool never claims code execution.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', maxLength: 120 },
        message: { type: 'string', maxLength: 4000 }
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
  inspect_blockers: {
    description: 'Inspect truthful blockers for an allowlisted project or task.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', maxLength: 120 }, taskId: { type: 'string', maxLength: 160 } }, additionalProperties: false }
  },
  dispatch_agent_action: {
    description: 'Dispatch an allowlisted coding action to Codex, Cursor, AntiGravity, or the local InnerOS runtime and return a real dispatch reference.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['codex','cursor','antigravity','local'] },
        project: { type: 'string', maxLength: 120 },
        taskId: { type: 'string', maxLength: 160 },
        instruction: { type: 'string', maxLength: 2000 }
      },
      required: ['agent','instruction'],
      additionalProperties: false
    }
  },
  resolve_project_blocker: {
    description: 'Diagnose a project blocker, select the cheapest capable allowlisted resource under local-first policy, dispatch the repair, and return trace/evidence references.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', maxLength: 120 },
        policy: { type: 'string', enum: ['local_first','best_available'], default: 'local_first' },
        instruction: { type: 'string', maxLength: 2000 }
      },
      required: ['project'],
      additionalProperties: false
    }
  },
  get_execution_trace: {
    description: 'Read sanitized backend-confirmed execution events for a dispatched action.',
    inputSchema: { type: 'object', properties: { dispatchId: { type: 'string', maxLength: 200 } }, required: ['dispatchId'], additionalProperties: false }
  },
  get_evidence: {
    description: 'Retrieve sanitized completion evidence for a task or dispatch.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', maxLength: 160 }, dispatchId: { type: 'string', maxLength: 200 } }, additionalProperties: false }
  }
};

export function registerInnerOSWebMCP(modelContext, invoke) {
  if (!modelContext?.registerTool) return { supported: false, registered: [] };
  const registered = [];
  for (const name of TOOL_NAMES) {
    modelContext.registerTool({
      name,
      ...definitions[name],
      execute: async (input = {}) => invoke(name, input)
    });
    registered.push(name);
  }
  return { supported: true, registered };
}

export function installBrowserWebMCP(invoke) {
  return registerInnerOSWebMCP(globalThis.document?.modelContext, invoke);
}
