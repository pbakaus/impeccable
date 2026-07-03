import { describe, expect, it } from 'vitest';
import { buildAgentSkillMarkdown } from '../src/impeccable/flatten-skill.js';
import { readImpeccableSource } from '../src/impeccable/source.js';

describe('Agent skill markdown generator', () => {
  it('produces one standalone Markdown skill guide without unresolved source placeholders', async () => {
    const markdown = buildAgentSkillMarkdown(await readImpeccableSource());
    expect(markdown).toMatch(/^---\nname: impeccable-mcp\n/m);
    expect(markdown).toContain('description:');
    expect(markdown).toContain('@Impeccable');
    expect(markdown).toContain('cannot include `scripts/`, `reference/`, `assets/`');
    expect(markdown).toContain('before_generation');
    expect(markdown).toContain('after_generation');
    expect(markdown).toContain('before_final');
    expect(markdown).not.toContain('{{scripts_path}}');
    expect(markdown).not.toContain('{{command_prefix}}');
    expect(markdown).not.toMatch(/\]\(reference\//);
  });
});
