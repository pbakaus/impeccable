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
    const commands = [];
    const skills = [];
    
    transformCodex(commands, skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/prompts'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex'))).toBe(true);
  });

  test('should create command with custom frontmatter format', () => {
    const commands = [
      {
        name: 'test-command',
        description: 'A test command',
        args: [],
        body: 'Command body content.'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'codex/prompts/test-command.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter.description).toBe('A test command');
    expect(parsed.body).toBe('Command body content.');
  });

  test('should create argument-hint for required args', () => {
    const commands = [
      {
        name: 'with-args',
        description: 'Command with args',
        args: [
          { name: 'target', description: 'Target', required: true },
          { name: 'output', description: 'Output', required: true }
        ],
        body: 'Body'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/with-args.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter['argument-hint']).toBe('<target> <output>');
  });

  test('should create argument-hint for optional args', () => {
    const commands = [
      {
        name: 'optional-args',
        description: 'Command with optional args',
        args: [
          { name: 'format', description: 'Format', required: false }
        ],
        body: 'Body'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/optional-args.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter['argument-hint']).toBe('[FORMAT=<value>]');
  });

  test('should create argument-hint with mixed required and optional args', () => {
    const commands = [
      {
        name: 'mixed-args',
        description: 'Mixed args',
        args: [
          { name: 'input', description: 'Input', required: true },
          { name: 'format', description: 'Format', required: false },
          { name: 'output', description: 'Output', required: true }
        ],
        body: 'Body'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/mixed-args.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter['argument-hint']).toBe('<input> [FORMAT=<value>] <output>');
  });

  test('should transform {{argname}} to $ARGNAME', () => {
    const commands = [
      {
        name: 'normalize',
        description: 'Normalize',
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Please normalize {{target}} to match the design system.'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/normalize.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.body).toContain('$TARGET');
    expect(parsed.body).not.toContain('{{target}}');
  });

  test('should transform multiple different placeholders', () => {
    const commands = [
      {
        name: 'multi-arg',
        description: 'Multiple args',
        args: [],
        body: 'Process {{input}} and output to {{output}} with {{format}}.'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/multi-arg.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.body).toContain('$INPUT');
    expect(parsed.body).toContain('$OUTPUT');
    expect(parsed.body).toContain('$FORMAT');
  });

  test('should create modular skill files', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'Skill instructions here.'
      }
    ];
    
    transformCodex([], skills, TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'codex/AGENTS.test-skill.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toBe('Skill instructions here.');
  });

  test('should create main AGENTS.md with routing instructions', () => {
    const skills = [
      {
        name: 'frontend-design',
        description: 'Create distinctive, production-grade frontend interfaces',
        license: 'MIT',
        body: 'Frontend design instructions.'
      },
      {
        name: 'backend-api',
        description: 'Design robust API endpoints',
        license: 'Apache',
        body: 'Backend API instructions.'
      }
    ];
    
    transformCodex([], skills, TEST_DIR);
    
    const agentsMdPath = path.join(TEST_DIR, 'codex/AGENTS.md');
    expect(fs.existsSync(agentsMdPath)).toBe(true);
    
    const content = fs.readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('# Codex Agent Instructions');
    expect(content).toContain('## Available Skills');
    expect(content).toContain('### frontend-design');
    expect(content).toContain('**When to use**: Create distinctive, production-grade frontend interfaces');
    expect(content).toContain('**Read**: `AGENTS.frontend-design.md`');
    expect(content).toContain('### backend-api');
    expect(content).toContain('**Read**: `AGENTS.backend-api.md`');
  });

  test('should handle multiple commands', () => {
    const commands = [
      { name: 'cmd1', description: 'Command 1', args: [], body: 'Body 1' },
      { name: 'cmd2', description: 'Command 2', args: [], body: 'Body 2' },
      { name: 'cmd3', description: 'Command 3', args: [], body: 'Body 3' }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/prompts/cmd1.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/prompts/cmd2.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/prompts/cmd3.md'))).toBe(true);
  });

  test('should clean existing directory before writing', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'codex/prompts'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'codex/prompts/old.md'), 'old');
    
    const commands = [{ name: 'new', description: 'New', args: [], body: 'New' }];
    transformCodex(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/prompts/old.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/prompts/new.md'))).toBe(true);
  });

  test('should handle commands without args', () => {
    const commands = [
      {
        name: 'no-args',
        description: 'No args command',
        args: [],
        body: 'Body content'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/no-args.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.frontmatter['argument-hint']).toBeUndefined();
  });

  test('should preserve multiline body', () => {
    const commands = [
      {
        name: 'multiline',
        description: 'Test',
        args: [],
        body: `First line.

Second line after blank.

- Bullet 1
- Bullet 2`
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/multiline.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.body).toContain('First line.\n\nSecond line');
    expect(parsed.body).toContain('- Bullet 1\n- Bullet 2');
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;
    
    const commands = [{ name: 'cmd1', description: 'Test', args: [], body: 'body' }];
    const skills = [{ name: 'skill1', description: 'Test', license: '', body: 'body' }];
    
    transformCodex(commands, skills, TEST_DIR);
    
    console.log = originalLog;
    
    expect(consoleMock).toHaveBeenCalledWith('✓ Codex: 1 prompts, 1 skills (modular)');
  });

  test('should handle empty arrays', () => {
    transformCodex([], [], TEST_DIR);
    
    const promptFiles = fs.readdirSync(path.join(TEST_DIR, 'codex/prompts'));
    expect(promptFiles).toHaveLength(0);
    
    // Should still create AGENTS.md even with no skills
    expect(fs.existsSync(path.join(TEST_DIR, 'codex/AGENTS.md'))).toBe(true);
  });

  test('should handle body without placeholders', () => {
    const commands = [
      {
        name: 'no-placeholders',
        description: 'No placeholders',
        args: [],
        body: 'Just plain text without any placeholders.'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/no-placeholders.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.body).toBe('Just plain text without any placeholders.');
  });

  test('AGENTS.md should have proper structure', () => {
    const skills = [
      { name: 'skill1', description: 'First skill', license: '', body: 'body1' }
    ];
    
    transformCodex([], skills, TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/AGENTS.md'), 'utf-8');
    
    expect(content).toContain('# Codex Agent Instructions');
    expect(content).toContain('## Available Skills');
    expect(content).toContain('## How to Use Skills');
    expect(content).toContain('### skill1');
    expect(content).toContain('**When to use**: First skill');
    expect(content).toContain('**Read**: `AGENTS.skill1.md`');
  });

  test('should handle arg names with hyphens', () => {
    const commands = [
      {
        name: 'hyphen-arg',
        description: 'Test',
        args: [],
        body: 'Process {{my-input}} and {{output-file}}.'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/hyphen-arg.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    
    expect(parsed.body).toContain('$MY-INPUT');
    expect(parsed.body).toContain('$OUTPUT-FILE');
  });

  test('should create proper frontmatter structure', () => {
    const commands = [
      {
        name: 'test',
        description: 'Test command',
        args: [{ name: 'arg1', description: 'Arg 1', required: true }],
        body: 'Body'
      }
    ];
    
    transformCodex(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'codex/prompts/test.md'), 'utf-8');
    
    expect(content).toContain('---');
    expect(content).toContain('description: Test command');
    expect(content).toContain('argument-hint: <arg1>');
  });
});

