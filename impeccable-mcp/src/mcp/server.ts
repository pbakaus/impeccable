import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerImpeccablePrompts } from './prompts.js';
import { registerImpeccableResources } from './resources.js';
import { registerImpeccableTools } from './tools.js';

export const serverInstructions = 'Use this MCP server as a bridge to the real Impeccable skill, not as a separate workflow implementation. Call impeccable_start first for UI/design requests, fetch the returned command and register references, then call impeccable_workflow before generating UI. Use impeccable_detect_markup and impeccable_checkpoint as explicit bridge support when native Impeccable hooks are unavailable. This server is read-only and does not edit client workspace files.';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'impeccable-mcp',
    version: '0.1.0',
  }, {
    instructions: serverInstructions,
  });
  registerImpeccableTools(server as never);
  registerImpeccableResources(server as never);
  registerImpeccablePrompts(server as never);
  return server;
}
