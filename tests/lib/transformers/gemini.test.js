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
    const skills = [];

    transformGemini(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/.gemini/skills'))).toBe(true);
  });

  test('should create skill files with frontmatter and body in .gemini/skills/ directory', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'Skill instructions here.'
      }
    ];

    transformGemini(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'gemini/.gemini/skills/test-skill/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('name: test-skill');
    expect(content).toContain('description: A test skill');
    expect(content).toContain('Skill instructions here.');
  });

  test('should handle multiple skills', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Body 1' },
      { name: 'skill2', description: 'Skill 2', license: 'Apache', body: 'Body 2' },
      { name: 'skill3', description: 'Skill 3', license: 'MIT', body: 'Body 3' }
    ];

    transformGemini(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/.gemini/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/.gemini/skills/skill2/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/.gemini/skills/skill3/SKILL.md'))).toBe(true);
  });

  test('should handle user-invokable skills with args', () => {
    const skills = [
      {
        name: 'normalize',
        description: 'Normalize design',
        userInvokable: true,
        args: [{ name: 'target', description: 'Target', required: false }],
        body: 'Please normalize {{target}} to match the design system.'
      }
    ];

    transformGemini(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/.gemini/skills/normalize/SKILL.md'), 'utf-8');
    // For user-invokable skills, {{arg}} placeholders become {{args}}
    expect(content).toContain('{{args}}');
    expect(content).not.toContain('{{target}}');
  });

  test('should replace multiple different placeholders with {{args}} for user-invokable skills', () => {
    const skills = [
      {
        name: 'multi-arg',
        description: 'Multiple args',
        userInvokable: true,
        args: [],
        body: 'Process {{input}} and output to {{output}} with {{format}}.'
      }
    ];

    transformGemini(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/.gemini/skills/multi-arg/SKILL.md'), 'utf-8');
    const argsMatches = content.match(/\{\{args\}\}/g);
    expect(argsMatches).toHaveLength(3);
  });

  test('should not replace placeholders for non-user-invokable skills', () => {
    const skills = [
      {
        name: 'passive-skill',
        description: 'Passive skill',
        userInvokable: false,
        body: 'Process {{target}} normally.'
      }
    ];

    transformGemini(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/.gemini/skills/passive-skill/SKILL.md'), 'utf-8');
    expect(content).toContain('{{target}}');
    expect(content).not.toContain('{{args}}');
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

    transformGemini(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'gemini/.gemini/skills/frontend-design/reference/typography.md'))).toBe(true);

    const typoContent = fs.readFileSync(path.join(TEST_DIR, 'gemini/.gemini/skills/frontend-design/reference/typography.md'), 'utf-8');
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

    transformGemini(skills, TEST_DIR);

    console.log = originalLog;

    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('✓ Gemini:'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 skills'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('1 user-invokable'));
  });

  test('should handle empty arrays', () => {
    transformGemini([], TEST_DIR);

    const skillDirs = fs.readdirSync(path.join(TEST_DIR, 'gemini/.gemini/skills'));
    expect(skillDirs).toHaveLength(0);
  });

  test('should support prefix option', () => {
    const skills = [
      { name: 'audit', description: 'Audit', license: '', body: 'Audit body' }
    ];

    transformGemini(skills, TEST_DIR, null, { prefix: 'i-', outputSuffix: '-prefixed' });

    expect(fs.existsSync(path.join(TEST_DIR, 'gemini-prefixed/.gemini/skills/i-audit/SKILL.md'))).toBe(true);

    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini-prefixed/.gemini/skills/i-audit/SKILL.md'), 'utf-8');
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

    transformGemini(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/.gemini/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Ask Gemini for help.');
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

    transformGemini(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'gemini/.gemini/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('See GEMINI.md for more.');
  });
});
