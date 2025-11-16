import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { transformCursor } from '../../../scripts/lib/transformers/cursor.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-cursor');

describe('transformCursor', () => {
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
    
    transformCursor(commands, skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/rules'))).toBe(true);
  });

  test('should strip frontmatter from commands and output body only', () => {
    const commands = [
      {
        name: 'test-command',
        description: 'A test command',
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'This is the command body content.'
      }
    ];
    const skills = [];
    
    transformCursor(commands, skills, TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'cursor/commands/test-command.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toBe('This is the command body content.');
    expect(content).not.toContain('---');
    expect(content).not.toContain('name:');
    expect(content).not.toContain('description:');
  });

  test('should strip frontmatter from skills and output body only', () => {
    const commands = [];
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'These are the skill instructions.'
      }
    ];
    
    transformCursor(commands, skills, TEST_DIR);
    
    const outputPath = path.join(TEST_DIR, 'cursor/rules/test-skill.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    
    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toBe('These are the skill instructions.');
    expect(content).not.toContain('---');
    expect(content).not.toContain('license:');
  });

  test('should handle multiple commands', () => {
    const commands = [
      { name: 'cmd1', description: 'Command 1', args: [], body: 'Body 1' },
      { name: 'cmd2', description: 'Command 2', args: [], body: 'Body 2' },
      { name: 'cmd3', description: 'Command 3', args: [], body: 'Body 3' }
    ];
    const skills = [];
    
    transformCursor(commands, skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands/cmd1.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands/cmd2.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands/cmd3.md'))).toBe(true);
  });

  test('should handle multiple skills', () => {
    const commands = [];
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Skill body 1' },
      { name: 'skill2', description: 'Skill 2', license: 'Apache', body: 'Skill body 2' }
    ];
    
    transformCursor(commands, skills, TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/rules/skill1.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/rules/skill2.md'))).toBe(true);
  });

  test('should clean existing directory before writing', () => {
    // Create a pre-existing file
    fs.mkdirSync(path.join(TEST_DIR, 'cursor/commands'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'cursor/commands/old-file.md'), 'old content');
    
    const commands = [
      { name: 'new-cmd', description: 'New', args: [], body: 'New body' }
    ];
    
    transformCursor(commands, [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands/old-file.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands/new-cmd.md'))).toBe(true);
  });

  test('should handle commands with placeholder args in body', () => {
    const commands = [
      {
        name: 'normalize',
        description: 'Normalize design',
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Please normalize {{target}} to match the design system.'
      }
    ];
    
    transformCursor(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/commands/normalize.md'), 'utf-8');
    // Cursor transformer should preserve the body as-is
    expect(content).toBe('Please normalize {{target}} to match the design system.');
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;
    
    const commands = [{ name: 'cmd1', description: '', args: [], body: 'body1' }];
    const skills = [{ name: 'skill1', description: '', license: '', body: 'body1' }];
    
    transformCursor(commands, skills, TEST_DIR);
    
    console.log = originalLog;
    
    expect(consoleMock).toHaveBeenCalledWith('✓ Cursor: 1 commands, 1 skills (downgraded)');
  });

  test('should handle empty commands and skills arrays', () => {
    transformCursor([], [], TEST_DIR);
    
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/commands'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/rules'))).toBe(true);
    
    const commandFiles = fs.readdirSync(path.join(TEST_DIR, 'cursor/commands'));
    const ruleFiles = fs.readdirSync(path.join(TEST_DIR, 'cursor/rules'));
    
    expect(commandFiles).toHaveLength(0);
    expect(ruleFiles).toHaveLength(0);
  });

  test('should preserve line breaks and formatting in body', () => {
    const commands = [
      {
        name: 'formatted',
        description: 'Test',
        args: [],
        body: `Line 1

Line 3 after blank line

- Bullet 1
- Bullet 2

End.`
      }
    ];
    
    transformCursor(commands, [], TEST_DIR);
    
    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/commands/formatted.md'), 'utf-8');
    expect(content).toContain('Line 1\n\nLine 3');
    expect(content).toContain('- Bullet 1\n- Bullet 2');
  });
});

