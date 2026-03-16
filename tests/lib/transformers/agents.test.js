import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { transformAgents } from '../../../scripts/lib/transformers/agents.js';
import { parseFrontmatter } from '../../../scripts/lib/utils.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-agents');

describe('transformAgents', () => {
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
    transformAgents([], TEST_DIR);
    expect(fs.existsSync(path.join(TEST_DIR, 'agents/.agents/skills'))).toBe(true);
  });

  test('should create skill with full frontmatter', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'Skill instructions.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'agents/.agents/skills/test-skill/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.name).toBe('test-skill');
    expect(parsed.frontmatter.description).toBe('A test skill');
    expect(parsed.body).toBe('Skill instructions.');
  });

  test('should add user-invokable flag for user-invokable skills', () => {
    const skills = [
      {
        name: 'audit',
        description: 'Audit command',
        userInvokable: true,
        body: 'Audit the code.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/audit/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['user-invokable']).toBe(true);
  });

  test('should not add user-invokable flag for non-user-invokable skills', () => {
    const skills = [
      {
        name: 'helper',
        description: 'Helper skill',
        body: 'Helper body.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/helper/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['user-invokable']).toBeUndefined();
  });

  test('should create argument-hint for required args', () => {
    const skills = [
      {
        name: 'with-args',
        description: 'Command with args',
        userInvokable: true,
        args: [
          { name: 'target', description: 'Target', required: true },
          { name: 'format', description: 'Format', required: false }
        ],
        body: 'Process {{target}} in {{format}}.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/with-args/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBe('<target> [FORMAT=<value>]');
  });

  test('should not add argument-hint for skills without args', () => {
    const skills = [
      {
        name: 'no-args',
        description: 'No args',
        userInvokable: true,
        args: [],
        body: 'Simple body.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/no-args/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBeUndefined();
  });

  test('should not add argument-hint for non-user-invokable skills with args', () => {
    const skills = [
      {
        name: 'internal',
        description: 'Internal skill',
        userInvokable: false,
        args: [{ name: 'target', description: 'Target', required: true }],
        body: 'Body.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/internal/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['argument-hint']).toBeUndefined();
  });

  test('should handle multiple skills', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', body: 'Body 1' },
      { name: 'skill2', description: 'Skill 2', body: 'Body 2' },
      { name: 'skill3', description: 'Skill 3', body: 'Body 3' }
    ];

    transformAgents(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'agents/.agents/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'agents/.agents/skills/skill2/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'agents/.agents/skills/skill3/SKILL.md'))).toBe(true);
  });

  test('should replace {{model}} placeholder', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        body: 'Ask {{model}} for help.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Ask the model for help.');
  });

  test('should replace {{config_file}} placeholder', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        body: 'See {{config_file}} for details.'
      }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('See your project instruction file (AGENTS.md or .github/copilot-instructions.md) for details.');
  });

  test('should replace {{available_commands}} placeholder', () => {
    const skills = [
      { name: 'audit', description: 'Audit', userInvokable: true, body: 'Available: {{available_commands}}' },
      { name: 'polish', description: 'Polish', userInvokable: true, body: 'Polish body.' }
    ];

    transformAgents(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/audit/SKILL.md'), 'utf-8');
    expect(content).toContain('Available: /audit, /polish');
  });

  test('should copy reference files', () => {
    const skills = [
      {
        name: 'frontend-design',
        description: 'Design skill',
        body: 'Design instructions.',
        references: [
          { name: 'typography', content: 'Typography reference', filePath: '/fake/path/typography.md' },
          { name: 'color', content: 'Color reference', filePath: '/fake/path/color.md' }
        ]
      }
    ];

    transformAgents(skills, TEST_DIR);

    const typoPath = path.join(TEST_DIR, 'agents/.agents/skills/frontend-design/reference/typography.md');
    const colorPath = path.join(TEST_DIR, 'agents/.agents/skills/frontend-design/reference/color.md');

    expect(fs.existsSync(typoPath)).toBe(true);
    expect(fs.existsSync(colorPath)).toBe(true);
    expect(fs.readFileSync(typoPath, 'utf-8')).toBe('Typography reference');
  });

  test('should replace placeholders in reference files', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        body: 'Body.',
        references: [
          { name: 'ref', content: 'Use {{model}} with {{config_file}}.', filePath: '/fake/ref.md' }
        ]
      }
    ];

    transformAgents(skills, TEST_DIR);

    const refContent = fs.readFileSync(path.join(TEST_DIR, 'agents/.agents/skills/test/reference/ref.md'), 'utf-8');
    expect(refContent).toContain('Use the model with your project instruction file (AGENTS.md or .github/copilot-instructions.md).');
  });

  test('should support prefix option', () => {
    const skills = [
      { name: 'audit', description: 'Audit', userInvokable: true, body: 'Audit body' }
    ];

    transformAgents(skills, TEST_DIR, null, { prefix: 'i-', outputSuffix: '-prefixed' });

    const outputPath = path.join(TEST_DIR, 'agents-prefixed/.agents/skills/i-audit/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toContain('name: i-audit');
  });

  test('should prefix skill references in body when prefix is set', () => {
    const skills = [
      { name: 'audit', description: 'Audit', userInvokable: true, body: 'Run /polish after the audit skill.' },
      { name: 'polish', description: 'Polish', userInvokable: true, body: 'Polish body.' }
    ];

    transformAgents(skills, TEST_DIR, null, { prefix: 'i-', outputSuffix: '-prefixed' });

    const content = fs.readFileSync(path.join(TEST_DIR, 'agents-prefixed/.agents/skills/i-audit/SKILL.md'), 'utf-8');
    expect(content).toContain('/i-polish');
    expect(content).toContain('the i-audit skill');
  });

  test('should clean existing directory before writing', () => {
    const existingDir = path.join(TEST_DIR, 'agents/.agents/skills/old');
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, 'SKILL.md'), 'old');

    const skills = [{ name: 'new', description: 'New', body: 'New' }];
    transformAgents(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'agents/.agents/skills/old/SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'agents/.agents/skills/new/SKILL.md'))).toBe(true);
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;

    const skills = [
      { name: 'skill1', description: 'Test', userInvokable: true, body: 'body' },
      { name: 'skill2', description: 'Test', userInvokable: false, body: 'body' }
    ];

    transformAgents(skills, TEST_DIR);

    console.log = originalLog;

    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('✓ Agents:'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 skills'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('1 user-invokable'));
  });

  test('should log reference file count', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;

    const skills = [
      {
        name: 'test',
        description: 'Test',
        body: 'Body.',
        references: [
          { name: 'ref1', content: 'Ref 1', filePath: '/fake/ref1.md' },
          { name: 'ref2', content: 'Ref 2', filePath: '/fake/ref2.md' }
        ]
      }
    ];

    transformAgents(skills, TEST_DIR);

    console.log = originalLog;

    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 reference files'));
  });

  test('should handle empty skills array', () => {
    transformAgents([], TEST_DIR);

    const skillDirs = fs.readdirSync(path.join(TEST_DIR, 'agents/.agents/skills'));
    expect(skillDirs).toHaveLength(0);
  });
});
