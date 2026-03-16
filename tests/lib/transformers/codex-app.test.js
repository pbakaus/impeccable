import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { transformCodexApp } from '../../../scripts/lib/transformers/codex-app.js';
import { parseFrontmatter } from '../../../scripts/lib/utils.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-codex-app');

describe('transformCodexApp', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should create the .agents/skills directory for Codex app output', () => {
    transformCodexApp([], TEST_DIR);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex-app/.agents/skills'))).toBe(true);
  });

  test('should create codex-app skills with agent-style frontmatter', () => {
    const skills = [
      {
        name: 'audit',
        description: 'Audit command',
        userInvokable: true,
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Check {{target}} and see {{config_file}}.'
      }
    ];

    transformCodexApp(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'codex-app/.agents/skills/audit/SKILL.md');
    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.name).toBe('audit');
    expect(parsed.frontmatter['user-invokable']).toBe(true);
    expect(parsed.frontmatter['argument-hint']).toBe('[TARGET=<value>]');
    expect(parsed.body).toContain('AGENTS.md');
  });

  test('should copy reference files with Codex app placeholders', () => {
    const skills = [
      {
        name: 'frontend-design',
        description: 'Design skill',
        body: 'Body.',
        references: [
          { name: 'ref', content: 'Use {{model}} with {{config_file}}.', filePath: '/fake/ref.md' }
        ]
      }
    ];

    transformCodexApp(skills, TEST_DIR);

    const refContent = fs.readFileSync(
      path.join(TEST_DIR, 'codex-app/.agents/skills/frontend-design/reference/ref.md'),
      'utf-8'
    );

    expect(refContent).toContain('Use GPT with AGENTS.md.');
  });
});
