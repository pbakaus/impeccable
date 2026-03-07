import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { transformClaudeCode } from '../../../scripts/lib/transformers/claude-code.js';
import { parseFrontmatter } from '../../../scripts/lib/utils.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-claude');

describe('transformClaudeCode', () => {
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

    transformClaudeCode(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills'))).toBe(true);
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

    transformClaudeCode(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'claude-code/.claude/skills/test-skill/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.name).toBe('test-skill');
    expect(parsed.frontmatter.description).toBe('A test skill');
    expect(parsed.frontmatter.license).toBe('MIT');
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

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/audit/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter['user-invokable']).toBe(true);
  });

  test('should include args in frontmatter for user-invokable skills', () => {
    const skills = [
      {
        name: 'test-command',
        description: 'A test command',
        userInvokable: true,
        args: [
          { name: 'target', description: 'The target', required: false },
          { name: 'output', description: 'Output format', required: true }
        ],
        body: 'Command body here.'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'claude-code/.claude/skills/test-command/SKILL.md');
    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.args).toBeArray();
    expect(parsed.frontmatter.args).toHaveLength(2);
    expect(parsed.frontmatter.args[0].name).toBe('target');
    expect(parsed.frontmatter.args[1].required).toBe(true);
  });

  test('should handle skills without args', () => {
    const skills = [
      {
        name: 'simple-skill',
        description: 'Simple skill',
        userInvokable: true,
        args: [],
        body: 'Simple body.'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/simple-skill/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.args).toBeUndefined();
  });

  test('should handle skills without license', () => {
    const skills = [
      {
        name: 'no-license-skill',
        description: 'Skill without license',
        license: '',
        body: 'Body content.'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/no-license-skill/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.license).toBeUndefined();
  });

  test('should handle multiple skills', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Body 1' },
      { name: 'skill2', description: 'Skill 2', license: 'Apache', body: 'Body 2' }
    ];

    transformClaudeCode(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills/skill2/SKILL.md'))).toBe(true);
  });

  test('should clean existing directory before writing', () => {
    // Create a pre-existing file structure
    const existingDir = path.join(TEST_DIR, 'claude-code/.claude/skills/old');
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, 'SKILL.md'), 'old');

    const skills = [{ name: 'new', description: 'New', license: '', body: 'New' }];
    transformClaudeCode(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills/old/SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills/new/SKILL.md'))).toBe(true);
  });

  test('should preserve {{placeholder}} syntax in body', () => {
    const skills = [
      {
        name: 'with-placeholder',
        description: 'Has placeholder',
        userInvokable: true,
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Process {{target}} and generate output.'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/with-placeholder/SKILL.md'), 'utf-8');
    expect(content).toContain('{{target}}');
  });

  test('should copy reference files', () => {
    const skills = [
      {
        name: 'frontend-design',
        description: 'Design skill',
        license: 'MIT',
        body: 'Design instructions.',
        references: [
          { name: 'typography', content: 'Typography reference', filePath: '/fake/path/typography.md' },
          { name: 'color', content: 'Color reference', filePath: '/fake/path/color.md' }
        ]
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills/frontend-design/reference/typography.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/.claude/skills/frontend-design/reference/color.md'))).toBe(true);

    const typoContent = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/frontend-design/reference/typography.md'), 'utf-8');
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

    transformClaudeCode(skills, TEST_DIR);

    console.log = originalLog;

    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('✓ Claude Code:'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 skills'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('1 user-invokable'));
  });

  test('should handle empty arrays', () => {
    transformClaudeCode([], TEST_DIR);

    const skillDirs = fs.readdirSync(path.join(TEST_DIR, 'claude-code/.claude/skills'));
    expect(skillDirs).toHaveLength(0);
  });

  test('should format frontmatter correctly with args', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test command',
        userInvokable: true,
        args: [
          { name: 'arg1', description: 'First arg', required: true },
          { name: 'arg2', description: 'Second arg', required: false }
        ],
        body: 'Body'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/test/SKILL.md'), 'utf-8');

    expect(content).toContain('---');
    expect(content).toContain('name: test');
    expect(content).toContain('description: Test command');
    expect(content).toContain('args:');
    expect(content).toContain('- name: arg1');
    expect(content).toContain('description: First arg');
    expect(content).toContain('required: true');
    expect(content).toContain('- name: arg2');
    expect(content).toContain('required: false');
  });

  test('should preserve multiline body content', () => {
    const skills = [
      {
        name: 'multiline',
        description: 'Test',
        license: '',
        body: `First paragraph.

Second paragraph with details.

- List item 1
- List item 2`
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/multiline/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);

    expect(parsed.body).toContain('First paragraph.');
    expect(parsed.body).toContain('Second paragraph');
    expect(parsed.body).toContain('- List item 1');
  });

  test('should support prefix option', () => {
    const skills = [
      { name: 'audit', description: 'Audit', license: '', userInvokable: true, body: 'Audit body' }
    ];

    transformClaudeCode(skills, TEST_DIR, null, { prefix: 'i-', outputSuffix: '-prefixed' });

    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code-prefixed/.claude/skills/i-audit/SKILL.md'))).toBe(true);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code-prefixed/.claude/skills/i-audit/SKILL.md'), 'utf-8');
    expect(content).toContain('name: i-audit');
  });

  test('should include compatibility in frontmatter', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        compatibility: 'claude-code',
        body: 'Body'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('compatibility: claude-code');
  });

  test('should include allowed-tools in frontmatter', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        allowedTools: 'Bash,Edit',
        body: 'Body'
      }
    ];

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('allowed-tools: Bash,Edit');
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

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Ask Claude for help.');
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

    transformClaudeCode(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/.claude/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('See CLAUDE.md for more.');
  });
});
