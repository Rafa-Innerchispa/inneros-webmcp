export const TOOL_DEFINITIONS = {
  list_agents: { description: 'List available public-safe agent runtimes.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  get_project_status: { description: 'Read status for an allowlisted project.', inputSchema: { type: 'object', properties: { project: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['project'], additionalProperties: false } },
  inspect_blockers: { description: 'Inspect truthful blockers for a project or task.', inputSchema: { type: 'object', properties: { project: { type: 'string', maxLength: 120 }, taskId: { type: 'string', maxLength: 160 } }, additionalProperties: false } },
  dispatch_agent_action: { description: 'Dispatch to Codex, Cursor, AntiGravity, or local runtime.', inputSchema: { type: 'object', properties: { agent: { type: 'string', enum: ['codex','cursor','antigravity','local'] }, project: { type: 'string', maxLength: 120 }, taskId: { type: 'string', maxLength: 160 }, instruction: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['agent','instruction'], additionalProperties: false } },
  get_execution_trace: { description: 'Read truthful sanitized execution state for a dispatch.', inputSchema: { type: 'object', properties: { dispatchId: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['dispatchId'], additionalProperties: false } },
  get_evidence: { description: 'Retrieve sanitized evidence for a task or dispatch.', inputSchema: { type: 'object', properties: { taskId: { type: 'string', maxLength: 160 }, dispatchId: { type: 'string', maxLength: 200 } }, additionalProperties: false } }
};
export const TOOL_NAMES = Object.freeze(Object.keys(TOOL_DEFINITIONS));
export function registerInnerOSWebMCP(modelContext, invoke) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') return { supported: false, registered: [] };
  const registered = [];
  for (const name of TOOL_NAMES) {
    modelContext.registerTool({ name, ...TOOL_DEFINITIONS[name], execute: async (input = {}) => invoke(name, input) });
    registered.push(name);
  }
  return { supported: true, registered };
}
export function installBrowserWebMCP(invoke) { return registerInnerOSWebMCP(globalThis.document?.modelContext, invoke); }
