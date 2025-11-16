import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { transformGemini } from '../../../scripts/lib/transformers/gemini.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-gemini');

describe('transformGemini', () => {
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
    
    transformGemini(commands, skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/commands'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini'))).toBe(true);
  });

  test('should convert command to TOML format', () => {
    const commands = [
      {
        name: 'test-command',
        description: 'A test command',
        args: [],
        body: 'Command body content.'
      }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'gemini/commands/test-command.toml');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toContain('description = "A test command"');
    expect(content).toContain('prompt = """');
    expect(content).toContain('Command body content.');
    expect(content).toContain('"""');
  });

  test('should replace {{argname}} placeholders with {{args}}', () => {
    const commands = [
      {
        name: 'normalize',
        description: 'Normalize design',
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Please normalize {{target}} to match the design system.'
      }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/commands/normalize.toml'), 'utf-8');
    expect(content).toContain('{{args}}');
    expect(content).not.toContain('{{target}}');
  });

  test('should replace multiple different placeholders with {{args}}', () => {
    const commands = [
      {
        name: 'multi-arg',
        description: 'Multiple args',
        args: [],
        body: 'Process {{input}} and output to {{output}} with {{format}}.'
      }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/commands/multi-arg.toml'), 'utf-8');
    const argsMatches = content.match(/\{\{args\}\}/g);
    expect(argsMatches).toHaveLength(3);
  });

  test('should escape quotes in description', () => {
    const commands = [
      {
        name: 'with-quotes',
        description: 'A command with "quotes" in description',
        args: [],
        body: 'Body content.'
      }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/commands/with-quotes.toml'), 'utf-8');
    expect(content).toContain('description = "A command with \\"quotes\\" in description"');
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
    
    transformGemini([], skills, TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'gemini/GEMINI.test-skill.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toBe('Skill instructions here.');
  });

  test('should create main GEMINI.md with imports', () => {
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
    
    transformGemini([], skills, TEST_DIR);
    
    const geminiMdPath = path.join(TEST_DIR, 'gemini/GEMINI.md');
    expect(fs.existsSync(geminiMdPath)).toBe(true);
    
    const content = fs.readFileSync(geminiMdPath, 'utf-8');
    expect(content).toContain('# Gemini Context');
    expect(content).toContain('frontend-design');
    expect(content).toContain('Create distinctive, production-grade frontend interfaces');
    expect(content).toContain('@./GEMINI.frontend-design.md');
    expect(content).toContain('backend-api');
    expect(content).toContain('@./GEMINI.backend-api.md');
  });

  test('should handle multiple commands', () => {
    const commands = [
      { name: 'cmd1', description: 'Command 1', args: [], body: 'Body 1' },
      { name: 'cmd2', description: 'Command 2', args: [], body: 'Body 2' },
      { name: 'cmd3', description: 'Command 3', args: [], body: 'Body 3' }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/commands/cmd1.toml'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/commands/cmd2.toml'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/commands/cmd3.toml'))).toBe(true);
  });

  test('should clean existing directory before writing', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'gemini/commands'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'gemini/commands/old.toml'), 'old');
    
    const commands = [{ name: 'new', description: 'New', args: [], body: 'New' }];
    transformGemini(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/commands/old.toml'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/commands/new.toml'))).toBe(true);
  });

  test('should preserve multiline body in TOML triple-quoted strings', () => {
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
    
    transformGemini(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/commands/multiline.toml'), 'utf-8');
    expect(content).toContain('First line.\n\nSecond line');
    expect(content).toContain('- Bullet 1\n- Bullet 2');
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;
    
    const commands = [{ name: 'cmd1', description: 'Test', args: [], body: 'body' }];
    const skills = [{ name: 'skill1', description: 'Test', license: '', body: 'body' }];
    
    transformGemini(commands, skills, TEST_DIR);
    
    console.log = originalLog;
    
    expect(consoleMock).toHaveBeenCalledWith('✓ Gemini: 1 commands (TOML), 1 skills (modular)');
  });

  test('should handle empty arrays', () => {
    transformGemini([], [], TEST_DIR);
    
    const commandFiles = fs.readdirSync(path.join(TEST_DIR, 'gemini/commands'));
    expect(commandFiles).toHaveLength(0);
    
    // Should still create GEMINI.md even with no skills
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/GEMINI.md'))).toBe(true);
  });

  test('should create proper TOML structure', () => {
    const commands = [
      {
        name: 'test',
        description: 'Test command',
        args: [],
        body: 'Test body'
      }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/commands/test.toml'), 'utf-8');
    
    // Check for proper TOML structure
    const lines = content.split('\n');
    expect(lines[0]).toMatch(/^description = /);
    expect(lines[1]).toBe('prompt = """');
    expect(lines[lines.length - 1]).toBe('"""');
  });

  test('should handle body without placeholders', () => {
    const commands = [
      {
        name: 'no-placeholders',
        description: 'No args',
        args: [],
        body: 'Just plain text without any placeholders.'
      }
    ];
    
    transformGemini(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/commands/no-placeholders.toml'), 'utf-8');
    expect(content).toContain('Just plain text without any placeholders.');
    expect(content).not.toContain('{{args}}');
  });

  test('GEMINI.md should have proper structure', () => {
    const skills = [
      { name: 'skill1', description: 'First skill', license: '', body: 'body1' }
    ];
    
    transformGemini([], skills, TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/GEMINI.md'), 'utf-8');
    
    expect(content).toContain('# Gemini Context');
    expect(content).toContain('## Available Skills');
    expect(content).toContain('## How Skills Work');
    expect(content).toContain('### skill1');
    expect(content).toContain('**When to use**: First skill');
  });
});

