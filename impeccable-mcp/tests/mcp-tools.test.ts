import { describe, expect, it } from 'vitest';
import { serverInstructions } from '../src/mcp/server.js';
import { manifest, searchSource, toolNames } from '../src/mcp/tools.js';
import { resourceUris } from '../src/mcp/resources.js';
import { promptNames } from '../src/mcp/prompts.js';

describe('MCP tool contract', () => {
  it('declares expected read-only tool names', () => {
    expect(toolNames).toEqual([
      'impeccable_start',
      'impeccable_manifest',
      'impeccable_skill_markdown',
      'impeccable_workflow',
      'impeccable_checkpoint',
      'impeccable_detect_markup',
      'search',
      'fetch',
    ]);
  });

  it('starts server instructions with operational checkpoint guidance', () => {
    expect(serverInstructions.slice(0, 512)).toContain('Call impeccable_start first');
    expect(serverInstructions).toContain('bridge to the real Impeccable skill');
    expect(serverInstructions).toContain('read-only');
  });

  it('returns source-backed manifest and search results', async () => {
    const data = await manifest();
    expect(data.source.packageName).toBe('impeccable');
    expect(data.commands).toContain('shape');
    const results = await searchSource('shape');
    expect(results.some((result) => result.id === 'reference:shape')).toBe(true);
  });

  it('declares expected resource URIs', () => {
    expect(resourceUris).toContain('impeccable://source/entrypoint');
    expect(resourceUris).toContain('impeccable://source/skill');
    expect(resourceUris).toContain('impeccable://generic-client/skill');
  });

  it('declares expected prompts', () => {
    expect(promptNames).toEqual(['use-impeccable']);
  });
});
