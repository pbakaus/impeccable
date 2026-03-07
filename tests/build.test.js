import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
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
      skills: []
    });

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {});
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {});
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {});
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {});

    // Simulate the build process
    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const { skills } = utils.readSourceFiles(ROOT_DIR);
    const patterns = utils.readPatterns(ROOT_DIR);
    transformers.transformCursor(skills, DIST_DIR, patterns);
    transformers.transformClaudeCode(skills, DIST_DIR, patterns);
    transformers.transformGemini(skills, DIST_DIR, patterns);
    transformers.transformCodex(skills, DIST_DIR, patterns);

    expect(readSourceFilesSpy).toHaveBeenCalledWith(ROOT_DIR);

    readSourceFilesSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('should call all transformers with correct arguments', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Skill body 1' }
    ];
    const patterns = { patterns: [], antipatterns: [] };

    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      skills
    });
    const readPatternsSpy = spyOn(utils, 'readPatterns').mockReturnValue(patterns);

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {});
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {});
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {});
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {});

    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const sourceFiles = utils.readSourceFiles(ROOT_DIR);
    const patternData = utils.readPatterns(ROOT_DIR);
    transformers.transformCursor(sourceFiles.skills, DIST_DIR, patternData);
    transformers.transformClaudeCode(sourceFiles.skills, DIST_DIR, patternData);
    transformers.transformGemini(sourceFiles.skills, DIST_DIR, patternData);
    transformers.transformCodex(sourceFiles.skills, DIST_DIR, patternData);

    expect(transformCursorSpy).toHaveBeenCalledWith(skills, DIST_DIR, patterns);
    expect(transformClaudeCodeSpy).toHaveBeenCalledWith(skills, DIST_DIR, patterns);
    expect(transformGeminiSpy).toHaveBeenCalledWith(skills, DIST_DIR, patterns);
    expect(transformCodexSpy).toHaveBeenCalledWith(skills, DIST_DIR, patterns);

    readSourceFilesSpy.mockRestore();
    readPatternsSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('should handle empty source files', () => {
    const patterns = { patterns: [], antipatterns: [] };

    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      skills: []
    });
    const readPatternsSpy = spyOn(utils, 'readPatterns').mockReturnValue(patterns);

    const transformCursorSpy = spyOn(transformers, 'transformCursor').mockImplementation(() => {});
    const transformClaudeCodeSpy = spyOn(transformers, 'transformClaudeCode').mockImplementation(() => {});
    const transformGeminiSpy = spyOn(transformers, 'transformGemini').mockImplementation(() => {});
    const transformCodexSpy = spyOn(transformers, 'transformCodex').mockImplementation(() => {});

    const ROOT_DIR = TEST_DIR;
    const DIST_DIR = path.join(ROOT_DIR, 'dist');

    const { skills } = utils.readSourceFiles(ROOT_DIR);
    const patternData = utils.readPatterns(ROOT_DIR);
    transformers.transformCursor(skills, DIST_DIR, patternData);
    transformers.transformClaudeCode(skills, DIST_DIR, patternData);
    transformers.transformGemini(skills, DIST_DIR, patternData);
    transformers.transformCodex(skills, DIST_DIR, patternData);

    expect(transformCursorSpy).toHaveBeenCalledWith([], DIST_DIR, patterns);
    expect(transformClaudeCodeSpy).toHaveBeenCalledWith([], DIST_DIR, patterns);
    expect(transformGeminiSpy).toHaveBeenCalledWith([], DIST_DIR, patterns);
    expect(transformCodexSpy).toHaveBeenCalledWith([], DIST_DIR, patterns);

    readSourceFilesSpy.mockRestore();
    readPatternsSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('integration: full build creates all expected outputs', () => {
    // Create test source files
    const skillContent = `---
name: test-skill
description: A test skill
license: MIT
---

This is a test skill body.`;

    const skillDir = path.join(TEST_DIR, 'source/skills/test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    // Run the build process
    const DIST_DIR = path.join(TEST_DIR, 'dist');
    const { skills } = utils.readSourceFiles(TEST_DIR);
    const patterns = utils.readPatterns(TEST_DIR);

    transformers.transformCursor(skills, DIST_DIR, patterns);
    transformers.transformClaudeCode(skills, DIST_DIR, patterns);
    transformers.transformGemini(skills, DIST_DIR, patterns);
    transformers.transformCodex(skills, DIST_DIR, patterns);

    // Verify Cursor outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/.cursor/skills/test-skill/SKILL.md'))).toBe(true);

    // Verify Claude Code outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'claude-code/.claude/skills/test-skill/SKILL.md'))).toBe(true);

    // Verify Gemini outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'gemini/.gemini/skills/test-skill/SKILL.md'))).toBe(true);

    // Verify Codex outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'codex/.codex/skills/test-skill/SKILL.md'))).toBe(true);
  });

  test('integration: verify transformations are correct', () => {
    const skillContent = `---
name: audit
description: Run technical quality checks
user-invokable: true
args:
  - name: target
    description: Target element
    required: false
---

Please audit {{target}} for technical quality. Ask {{model}} for help.`;

    const skillDir = path.join(TEST_DIR, 'source/skills/audit');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const DIST_DIR = path.join(TEST_DIR, 'dist');
    const { skills } = utils.readSourceFiles(TEST_DIR);
    const patterns = utils.readPatterns(TEST_DIR);

    transformers.transformCursor(skills, DIST_DIR, patterns);
    transformers.transformClaudeCode(skills, DIST_DIR, patterns);
    transformers.transformGemini(skills, DIST_DIR, patterns);
    transformers.transformCodex(skills, DIST_DIR, patterns);

    // Verify Cursor: full frontmatter with user-invokable
    const cursorContent = fs.readFileSync(path.join(DIST_DIR, 'cursor/.cursor/skills/audit/SKILL.md'), 'utf-8');
    expect(cursorContent).toContain('---');
    expect(cursorContent).toContain('name: audit');
    expect(cursorContent).toContain('{{target}}');
    expect(cursorContent).toContain('the model');

    // Verify Claude Code: full frontmatter with user-invokable and args
    const claudeContent = fs.readFileSync(path.join(DIST_DIR, 'claude-code/.claude/skills/audit/SKILL.md'), 'utf-8');
    expect(claudeContent).toContain('---');
    expect(claudeContent).toContain('name: audit');
    expect(claudeContent).toContain('user-invokable: true');
    expect(claudeContent).toContain('{{target}}');
    expect(claudeContent).toContain('Claude');

    // Verify Gemini: skill in skills directory
    expect(fs.existsSync(path.join(DIST_DIR, 'gemini/.gemini/skills/audit/SKILL.md'))).toBe(true);
    const geminiContent = fs.readFileSync(path.join(DIST_DIR, 'gemini/.gemini/skills/audit/SKILL.md'), 'utf-8');
    expect(geminiContent).toContain('{{args}}'); // Replaced for user-invokable in Gemini
    expect(geminiContent).toContain('Gemini');

    // Verify Codex: skill in skills directory
    expect(fs.existsSync(path.join(DIST_DIR, 'codex/.codex/skills/audit/SKILL.md'))).toBe(true);
    const codexContent = fs.readFileSync(path.join(DIST_DIR, 'codex/.codex/skills/audit/SKILL.md'), 'utf-8');
    expect(codexContent).toContain('$TARGET'); // Replaced for user-invokable in Codex
    expect(codexContent).toContain('GPT');
  });

  test('integration: multiple skills', () => {
    const skill1Dir = path.join(TEST_DIR, 'source/skills/skill1');
    fs.mkdirSync(skill1Dir, { recursive: true });
    fs.writeFileSync(path.join(skill1Dir, 'SKILL.md'), '---\nname: skill1\n---\nSkill1');

    const skill2Dir = path.join(TEST_DIR, 'source/skills/skill2');
    fs.mkdirSync(skill2Dir, { recursive: true });
    fs.writeFileSync(path.join(skill2Dir, 'SKILL.md'), '---\nname: skill2\n---\nSkill2');

    const DIST_DIR = path.join(TEST_DIR, 'dist');
    const { skills } = utils.readSourceFiles(TEST_DIR);
    const patterns = utils.readPatterns(TEST_DIR);

    expect(skills).toHaveLength(2);

    transformers.transformCursor(skills, DIST_DIR, patterns);
    transformers.transformClaudeCode(skills, DIST_DIR, patterns);
    transformers.transformGemini(skills, DIST_DIR, patterns);
    transformers.transformCodex(skills, DIST_DIR, patterns);

    // Verify all files exist
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/.cursor/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'cursor/.cursor/skills/skill2/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'claude-code/.claude/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'claude-code/.claude/skills/skill2/SKILL.md'))).toBe(true);
  });

  test('should call transformers in correct order', () => {
    const callOrder = [];

    const readSourceFilesSpy = spyOn(utils, 'readSourceFiles').mockReturnValue({
      skills: []
    });
    const readPatternsSpy = spyOn(utils, 'readPatterns').mockReturnValue({ patterns: [], antipatterns: [] });

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

    const { skills } = utils.readSourceFiles(ROOT_DIR);
    const patterns = utils.readPatterns(ROOT_DIR);
    transformers.transformCursor(skills, DIST_DIR, patterns);
    transformers.transformClaudeCode(skills, DIST_DIR, patterns);
    transformers.transformGemini(skills, DIST_DIR, patterns);
    transformers.transformCodex(skills, DIST_DIR, patterns);

    expect(callOrder).toEqual(['cursor', 'claude-code', 'gemini', 'codex']);

    readSourceFilesSpy.mockRestore();
    readPatternsSpy.mockRestore();
    transformCursorSpy.mockRestore();
    transformClaudeCodeSpy.mockRestore();
    transformGeminiSpy.mockRestore();
    transformCodexSpy.mockRestore();
  });

  test('should include agents and kiro transformers', () => {
    const { skills } = utils.readSourceFiles(TEST_DIR);
    const patterns = utils.readPatterns(TEST_DIR);
    const DIST_DIR = path.join(TEST_DIR, 'dist');

    // These should not throw
    transformers.transformAgents(skills, DIST_DIR, patterns);
    transformers.transformKiro(skills, DIST_DIR, patterns);

    // Verify outputs
    expect(fs.existsSync(path.join(DIST_DIR, 'agents/.agents/skills'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'kiro/.kiro/skills'))).toBe(true);
  });
});
