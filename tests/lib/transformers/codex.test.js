import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { transformCodex } from '../../../scripts/lib/transformers/codex.js';
import { parseFrontmatter } from '../../../scripts/lib/utils.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-codex');

describe('transformCodex', () => {
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

  test('should create correct directory structure', () => {
    const skills = [];

    transformCodex(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'codex/.codex/skills'))).toBe(true);
  });

  test('should create skill files with frontmatter and body in .codex/skills/ directory', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'Skill instructions here.'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'codex/.codex/skills/test-skill/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.name).toBe('test-skill');
    expect(parsed.frontmatter.description).toBe('A test skill');
    expect(parsed.body).toBe('Skill instructions here.');
  });

  test('should create argument-hint for required args', () => {
    const skills = [
      {
        name: 'with-args',
        description: 'Command with args',
        userInvokable: true,
        args: [
          { name: 'target', description: 'Target', required: true },
          { name: 'output', description: 'Output', required: true }
        ],
        body: 'Body'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/with-args/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBe('<target> <output>');
  });

  test('should create argument-hint for optional args', () => {
    const skills = [
      {
        name: 'optional-args',
        description: 'Command with optional args',
        userInvokable: true,
        args: [
          { name: 'format', description: 'Format', required: false }
        ],
        body: 'Body'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/optional-args/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBe('[FORMAT=<value>]');
  });

  test('should create argument-hint with mixed required and optional args', () => {
    const skills = [
      {
        name: 'mixed-args',
        description: 'Mixed args',
        userInvokable: true,
        args: [
          { name: 'input', description: 'Input', required: true },
          { name: 'format', description: 'Format', required: false },
          { name: 'output', description: 'Output', required: true }
        ],
        body: 'Body'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/mixed-args/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBe('<input> [FORMAT=<value>] <output>');
  });

  test('should transform {{argname}} to $ARGNAME for user-invokable skills', () => {
    const skills = [
      {
        name: 'normalize',
        description: 'Normalize',
        userInvokable: true,
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Please normalize {{target}} to match the design system.'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/normalize/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.body).toContain('$TARGET');
    expect(parsed.body).not.toContain('{{target}}');
  });

  test('should transform multiple different placeholders', () => {
    const skills = [
      {
        name: 'multi-arg',
        description: 'Multiple args',
        userInvokable: true,
        args: [],
        body: 'Process {{input}} and output to {{output}} with {{format}}.'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/multi-arg/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.body).toContain('$INPUT');
    expect(parsed.body).toContain('$OUTPUT');
    expect(parsed.body).toContain('$FORMAT');
  });

  test('should handle multiple skills', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Body 1' },
      { name: 'skill2', description: 'Skill 2', license: 'Apache', body: 'Body 2' },
      { name: 'skill3', description: 'Skill 3', license: 'MIT', body: 'Body 3' }
    ];

    transformCodex(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'codex/.codex/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/.codex/skills/skill2/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/.codex/skills/skill3/SKILL.md'))).toBe(true);
  });

  test('should copy reference files', () => {
    const skills = [
      {
        name: 'frontend-design',
        description: 'Design skill',
        license: 'MIT',
        body: 'Design instructions.',
        references: [
          { name: 'typography', content: 'Typography reference', filePath: '/fake/path/typography.md' }
        ]
      }
    ];

    transformCodex(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'codex/.codex/skills/frontend-design/reference/typography.md'))).toBe(true);

    const typoContent = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/frontend-design/reference/typography.md'), 'utf-8');
    expect(typoContent).toBe('Typography reference');
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;

    const skills = [
      { name: 'skill1', description: 'Test', license: '', userInvokable: true, body: 'body' },
      { name: 'skill2', description: 'Test', license: '', userInvokable: false, body: 'body' }
    ];

    transformCodex(skills, TEST_DIR);

    console.log = originalLog;

    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('✓ Codex:'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 skills'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('1 user-invokable'));
  });

  test('should handle empty arrays', () => {
    transformCodex([], TEST_DIR);

    const skillDirs = fs.readdirSync(path.join(TEST_DIR, 'codex/.codex/skills'));
    expect(skillDirs).toHaveLength(0);
  });

  test('should handle user-invokable skills without args', () => {
    const skills = [
      {
        name: 'no-args',
        description: 'No args command',
        userInvokable: true,
        args: [],
        body: 'Body content'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/no-args/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBeUndefined();
  });

  test('should preserve multiline body', () => {
    const skills = [
      {
        name: 'multiline',
        description: 'Test',
        license: '',
        body: `First line.

Second line after blank.

- Bullet 1
- Bullet 2`
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/multiline/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.body).toContain('First line.\n\nSecond line');
    expect(parsed.body).toContain('- Bullet 1\n- Bullet 2');
  });

  test('should support prefix option', () => {
    const skills = [
      { name: 'audit', description: 'Audit', license: '', userInvokable: true, body: 'Audit body' }
    ];

    transformCodex(skills, TEST_DIR, null, { prefix: 'i-', outputSuffix: '-prefixed' });

    expect(fs.existsSync(path.join(TEST_DIR, 'codex-prefixed/.codex/skills/i-audit/SKILL.md'))).toBe(true);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex-prefixed/.codex/skills/i-audit/SKILL.md'), 'utf-8');
    expect(content).toContain('name: i-audit');
  });

  test('should replace {{model}} placeholder', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        license: '',
        body: 'Ask {{model}} for help.'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Ask GPT for help.');
  });

  test('should replace {{config_file}} placeholder', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        license: '',
        body: 'See {{config_file}} for more.'
      }
    ];

    transformCodex(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/.codex/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('See AGENTS.md for more.');
  });
});
