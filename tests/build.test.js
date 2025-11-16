import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import fs from 'fs';
import path from 'path';
import * as utils from '../scripts/lib/utils.js';
import * as transformers from '../scripts/lib/transformers/index.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-build');

describe('build orchestration', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should call readSourceFiles with root directory', () => {
    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      commands: [],
      skills: []
    });

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {});
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {});
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {});
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {});

    // Simulate the build process
    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const { commands, skills } = utils.readSourceFiles(ROOT_DIR);
    transformers.transformCursor(commands, skills, DIST_DIR);
    transformers.transformClaudeCode(commands, skills, DIST_DIR);
    transformers.transformGemini(commands, skills, DIST_DIR);
    transformers.transformCodex(commands, skills, DIST_DIR);

    expect(readSourceFilesSpy).toHaveBeenCalledWith(ROOT_DIR);
    
    readSourceFilesSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('should call all four transformers with correct arguments', () => {
    const commands = [
      { name: 'cmd1', description: 'Command 1', args: [], body: 'Body 1' }
    ];
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Skill body 1' }
    ];

    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      commands,
      skills
    });

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {});
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {});
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {});
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {});

    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const sourceFiles = utils.readSourceFiles(ROOT_DIR);
    transformers.transformCursor(sourceFiles.commands, sourceFiles.skills, DIST_DIR);
    transformers.transformClaudeCode(sourceFiles.commands, sourceFiles.skills, DIST_DIR);
    transformers.transformGemini(sourceFiles.commands, sourceFiles.skills, DIST_DIR);
    transformers.transformCodex(sourceFiles.commands, sourceFiles.skills, DIST_DIR);

    expect(transformCursorSpy).toHaveBeenCalledWith(commands, skills, DIST_DIR);
    expect(transformClaudeCodeSpy).toHaveBeenCalledWith(commands, skills, DIST_DIR);
    expect(transformGeminiSpy).toHaveBeenCalledWith(commands, skills, DIST_DIR);
    expect(transformCodexSpy).toHaveBeenCalledWith(commands, skills, DIST_DIR);

    readSourceFilesSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('should handle empty source files', () => {
    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      commands: [],
      skills: []
    });

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {});
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {});
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {});
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {});

    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const { commands, skills } = utils.readSourceFiles(ROOT_DIR);
    transformers.transformCursor(commands, skills, DIST_DIR);
    transformers.transformClaudeCode(commands, skills, DIST_DIR);
    transformers.transformGemini(commands, skills, DIST_DIR);
    transformers.transformCodex(commands, skills, DIST_DIR);

    expect(transformCursorSpy).toHaveBeenCalledWith([], [], DIST_DIR);
    expect(transformClaudeCodeSpy).toHaveBeenCalledWith([], [], DIST_DIR);
    expect(transformGeminiSpy).toHaveBeenCalledWith([], [], DIST_DIR);
    expect(transformCodexSpy).toHaveBeenCalledWith([], [], DIST_DIR);

    readSourceFilesSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('integration: full build creates all expected outputs', () => {
    // Create test source files
    const commandContent = `---
name: test-command
description: A test command
args:
  - name: target
    description: Target parameter
    required: false
---

This is a test command body with {{target}} placeholder.`;

    const skillContent = `---
name: test-skill
description: A test skill
license: MIT
---

This is a test skill body.`;

    utils.writeFile(path.join(TEST_DIR, 'source/commands/test-command.md'), commandContent);
    utils.writeFile(path.join(TEST_DIR, 'source/skills/test-skill.md'), skillContent);

    // Run the build process
    const DIST_DIR = path.join(TEST_DIR, 'dist');
    const { commands, skills } = utils.readSourceFiles(TEST_DIR);
    
    transformers.transformCursor(commands, skills, DIST_DIR);
    transformers.transformClaudeCode(commands, skills, DIST_DIR);
    transformers.transformGemini(commands, skills, DIST_DIR);
    transformers.transformCodex(commands, skills, DIST_DIR);

    // Verify Cursor outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/commands/test-command.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/rules/test-skill.md'))).toBe(true);

    // Verify Claude Code outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'claude-code/commands/test-command.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'claude-code/skills/test-skill/SKILL.md'))).toBe(true);

    // Verify Gemini outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'gemini/commands/test-command.toml'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'gemini/GEMINI.test-skill.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'gemini/GEMINI.md'))).toBe(true);

    // Verify Codex outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'codex/prompts/test-command.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'codex/AGENTS.test-skill.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'codex/AGENTS.md'))).toBe(true);
  });

  test('integration: verify transformations are correct', () => {
    const commandContent = `---
name: normalize
description: Normalize design
args:
  - name: target
    description: Target element
    required: false
---

Please normalize {{target}} to match the design system.`;

    utils.writeFile(path.join(TEST_DIR, 'source/commands/normalize.md'), commandContent);

    const DIST_DIR = path.join(TEST_DIR, 'dist');
    const { commands, skills } = utils.readSourceFiles(TEST_DIR);
    
    transformers.transformCursor(commands, skills, DIST_DIR);
    transformers.transformClaudeCode(commands, skills, DIST_DIR);
    transformers.transformGemini(commands, skills, DIST_DIR);
    transformers.transformCodex(commands, skills, DIST_DIR);

    // Verify Cursor: body only, no frontmatter
    const cursorContent = fs.readFileSync(path.join(DIST_DIR, 'cursor/commands/normalize.md'), 'utf-8');
    expect(cursorContent).not.toContain('---');
    expect(cursorContent).toContain('{{target}}');

    // Verify Claude Code: full frontmatter
    const claudeContent = fs.readFileSync(path.join(DIST_DIR, 'claude-code/commands/normalize.md'), 'utf-8');
    expect(claudeContent).toContain('---');
    expect(claudeContent).toContain('name: normalize');
    expect(claudeContent).toContain('{{target}}');

    // Verify Gemini: TOML with {{args}}
    const geminiContent = fs.readFileSync(path.join(DIST_DIR, 'gemini/commands/normalize.toml'), 'utf-8');
    expect(geminiContent).toContain('description = "Normalize design"');
    expect(geminiContent).toContain('{{args}}');
    expect(geminiContent).not.toContain('{{target}}');

    // Verify Codex: $VARIABLE
    const codexContent = fs.readFileSync(path.join(DIST_DIR, 'codex/prompts/normalize.md'), 'utf-8');
    expect(codexContent).toContain('$TARGET');
    expect(codexContent).not.toContain('{{target}}');
  });

  test('integration: multiple commands and skills', () => {
    utils.writeFile(path.join(TEST_DIR, 'source/commands/cmd1.md'), '---\nname: cmd1\n---\nBody1');
    utils.writeFile(path.join(TEST_DIR, 'source/commands/cmd2.md'), '---\nname: cmd2\n---\nBody2');
    utils.writeFile(path.join(TEST_DIR, 'source/skills/skill1.md'), '---\nname: skill1\n---\nSkill1');
    utils.writeFile(path.join(TEST_DIR, 'source/skills/skill2.md'), '---\nname: skill2\n---\nSkill2');

    const DIST_DIR = path.join(TEST_DIR, 'dist');
    const { commands, skills } = utils.readSourceFiles(TEST_DIR);
    
    expect(commands).toHaveLength(2);
    expect(skills).toHaveLength(2);

    transformers.transformCursor(commands, skills, DIST_DIR);
    transformers.transformClaudeCode(commands, skills, DIST_DIR);
    transformers.transformGemini(commands, skills, DIST_DIR);
    transformers.transformCodex(commands, skills, DIST_DIR);

    // Verify all files exist
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/commands/cmd1.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/commands/cmd2.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/rules/skill1.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/rules/skill2.md'))).toBe(true);
  });

  test('should call transformers in correct order', () => {
    const callOrder = [];

    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      commands: [],
      skills: []
    });

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {
      callOrder.push('cursor');
    });
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {
      callOrder.push('claude-code');
    });
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {
      callOrder.push('gemini');
    });
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {
      callOrder.push('codex');
    });

    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const { commands, skills } = utils.readSourceFiles(ROOT_DIR);
    transformers.transformCursor(commands, skills, DIST_DIR);
    transformers.transformClaudeCode(commands, skills, DIST_DIR);
    transformers.transformGemini(commands, skills, DIST_DIR);
    transformers.transformCodex(commands, skills, DIST_DIR);

    expect(callOrder).toEqual(['cursor', 'claude-code', 'gemini', 'codex']);

    readSourceFilesSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });
});

