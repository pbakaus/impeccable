import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerImpeccableResources } from './resources.js';
import { registerImpeccableTools } from './tools.js';

export const serverInstructions = 'Use Impeccable as a MCP-compatible design workflow operator. Before generating UI, call impeccable_workflow. After generating or revising UI, call impeccable_checkpoint. Before finalizing, call impeccable_checkpoint with before_final. This server is read-only and does not edit client workspace files.';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'impeccable-mcp',
    version: '0.1.0',
  }, {
    instructions: serverInstructions,
  });
  registerImpeccableTools(server as never);
  registerImpeccableResources(server as never);
  return server;
}
