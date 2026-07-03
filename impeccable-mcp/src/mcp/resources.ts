import { buildAgentSkillMarkdown } from '../impeccable/flatten-skill.js';
import { readImpeccableSource } from '../impeccable/source.js';

type ResourceRegistrar = {
  registerResource?: (
    name: string,
    uri: string,
    metadata: Record<string, unknown>,
    handler: (uri: URL) => Promise<unknown>,
  ) => void;
};

function textResource(uri: URL, text: string, mimeType = 'text/markdown') {
  return {
    contents: [{ uri: uri.href, text, mimeType }],
  };
}

export const resourceUris = [
  'impeccable://source/skill',
  'impeccable://source/harnesses',
  'impeccable://source/commands',
  'impeccable://generic-client/skill',
  'impeccable://generic-client/connector-setup',
] as const;

export function registerImpeccableResources(server: ResourceRegistrar): void {
  if (typeof server.registerResource !== 'function') return;

  server.registerResource(
    'source-skill',
    'impeccable://source/skill',
    { title: 'Impeccable Skill Source', mimeType: 'text/markdown' },
    async (uri) => textResource(uri, (await readImpeccableSource()).skillMarkdown),
  );
  server.registerResource(
    'source-harnesses',
    'impeccable://source/harnesses',
    { title: 'Impeccable Harness Docs', mimeType: 'text/markdown' },
    async (uri) => textResource(uri, (await readImpeccableSource()).harnessesMarkdown),
  );
  server.registerResource(
    'source-commands',
    'impeccable://source/commands',
    { title: 'Impeccable Command Metadata', mimeType: 'application/json' },
    async (uri) => textResource(uri, JSON.stringify((await readImpeccableSource()).commandMetadata, null, 2), 'application/json'),
  );
  server.registerResource(
    'generic-client-skill',
    'impeccable://generic-client/skill',
    { title: 'Impeccable Generic Client Skill', mimeType: 'text/markdown' },
    async (uri) => textResource(uri, buildAgentSkillMarkdown(await readImpeccableSource())),
  );
  server.registerResource(
    'generic-client-connector-setup',
    'impeccable://generic-client/connector-setup',
    { title: 'Impeccable MCP Connector Setup', mimeType: 'text/markdown' },
    async (uri) => textResource(uri, 'Connect to the hosted `/mcp` endpoint and provide `x-impeccable-mcp-key` when configured.'),
  );
}
