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
    const commands = [];
    const skills = [];
    
    transformClaudeCode(commands, skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/commands'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/skills'))).toBe(true);
  });

  test('should preserve full frontmatter for commands', () => {
    const commands = [
      {
        name: 'test-command',
        description: 'A test command',
        args: [
          { name: 'target', description: 'The target', required: false },
          { name: 'output', description: 'Output format', required: true }
        ],
        body: 'Command body here.'
      }
    ];
    
    transformClaudeCode(commands, [], TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'claude-code/commands/test-command.md');
    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter.name).toBe('test-command');
    expect(parsed.frontmatter.description).toBe('A test command');
    expect(parsed.frontmatter.args).toBeArray();
    expect(parsed.frontmatter.args).toHaveLength(2);
    expect(parsed.frontmatter.args[0].name).toBe('target');
    expect(parsed.frontmatter.args[1].required).toBe(true);
    expect(parsed.body).toBe('Command body here.');
  });

  test('should handle commands without args', () => {
    const commands = [
      {
        name: 'simple-cmd',
        description: 'Simple command',
        args: [],
        body: 'Simple body.'
      }
    ];
    
    transformClaudeCode(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/commands/simple-cmd.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter.name).toBe('simple-cmd');
    expect(parsed.frontmatter.args).toBeUndefined();
  });

  test('should create skills in subdirectories with SKILL.md filename', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'Skill instructions.'
      }
    ];
    
    transformClaudeCode([], skills, TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'claude-code/skills/test-skill/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter.name).toBe('test-skill');
    expect(parsed.frontmatter.description).toBe('A test skill');
    expect(parsed.frontmatter.license).toBe('MIT');
    expect(parsed.body).toBe('Skill instructions.');
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
    
    transformClaudeCode([], skills, TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/skills/no-license-skill/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter.license).toBeUndefined();
  });

  test('should handle multiple commands', () => {
    const commands = [
      { name: 'cmd1', description: 'Command 1', args: [], body: 'Body 1' },
      { name: 'cmd2', description: 'Command 2', args: [], body: 'Body 2' },
      { name: 'cmd3', description: 'Command 3', args: [], body: 'Body 3' }
    ];
    
    transformClaudeCode(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/commands/cmd1.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/commands/cmd2.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/commands/cmd3.md'))).toBe(true);
  });

  test('should handle multiple skills', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Body 1' },
      { name: 'skill2', description: 'Skill 2', license: 'Apache', body: 'Body 2' }
    ];
    
    transformClaudeCode([], skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/skills/skill2/SKILL.md'))).toBe(true);
  });

  test('should clean existing directory before writing', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'claude-code/commands'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'claude-code/commands/old.md'), 'old');
    
    const commands = [{ name: 'new', description: 'New', args: [], body: 'New' }];
    transformClaudeCode(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/commands/old.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'claude-code/commands/new.md'))).toBe(true);
  });

  test('should preserve {{placeholder}} syntax in body', () => {
    const commands = [
      {
        name: 'with-placeholder',
        description: 'Has placeholder',
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Process {{target}} and generate output.'
      }
    ];
    
    transformClaudeCode(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/commands/with-placeholder.md'), 'utf-8');
    expect(content).toContain('{{target}}');
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;
    
    const commands = [{ name: 'cmd1', description: 'Test', args: [], body: 'body' }];
    const skills = [{ name: 'skill1', description: 'Test', license: '', body: 'body' }];
    
    transformClaudeCode(commands, skills, TEST_DIR);
    
    console.log = originalLog;
    
    expect(consoleMock).toHaveBeenCalledWith('✓ Claude Code: 1 commands, 1 skills');
  });

  test('should handle empty arrays', () => {
    transformClaudeCode([], [], TEST_DIR);
    
    const commandFiles = fs.readdirSync(path.join(TEST_DIR, 'claude-code/commands'));
    const skillDirs = fs.readdirSync(path.join(TEST_DIR, 'claude-code/skills'));
    
    expect(commandFiles).toHaveLength(0);
    expect(skillDirs).toHaveLength(0);
  });

  test('should format frontmatter correctly with args', () => {
    const commands = [
      {
        name: 'test',
        description: 'Test command',
        args: [
          { name: 'arg1', description: 'First arg', required: true },
          { name: 'arg2', description: 'Second arg', required: false }
        ],
        body: 'Body'
      }
    ];
    
    transformClaudeCode(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/commands/test.md'), 'utf-8');
    
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
    const commands = [
      {
        name: 'multiline',
        description: 'Test',
        args: [],
        body: `First paragraph.

Second paragraph with details.

- List item 1
- List item 2`
      }
    ];
    
    transformClaudeCode(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'claude-code/commands/multiline.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.body).toContain('First paragraph.');
    expect(parsed.body).toContain('Second paragraph');
    expect(parsed.body).toContain('- List item 1');
  });
});

