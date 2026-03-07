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
    const skills = [];

    transformCursor(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills'))).toBe(true);
  });

  test('should create skill with frontmatter and body', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill',
        license: 'MIT',
        body: 'Skill instructions here.'
      }
    ];

    transformCursor(skills, TEST_DIR);

    const outputPath = path.join(TEST_DIR, 'cursor/.cursor/skills/test-skill/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('name: test-skill');
    expect(content).toContain('description: A test skill');
    expect(content).toContain('license: MIT');
    expect(content).toContain('Skill instructions here.');
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

    transformCursor(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.cursor/skills/no-license-skill/SKILL.md'), 'utf-8');
    expect(content).not.toContain('license:');
  });

  test('should handle multiple skills', () => {
    const skills = [
      { name: 'skill1', description: 'Skill 1', license: 'MIT', body: 'Skill body 1' },
      { name: 'skill2', description: 'Skill 2', license: 'Apache', body: 'Skill body 2' }
    ];

    transformCursor(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/skill2/SKILL.md'))).toBe(true);
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

    transformCursor(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/frontend-design/reference/typography.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/frontend-design/reference/color.md'))).toBe(true);

    const typoContent = fs.readFileSync(path.join(TEST_DIR, 'cursor/.cursor/skills/frontend-design/reference/typography.md'), 'utf-8');
    expect(typoContent).toBe('Typography reference');
  });

  test('should handle skills without references', () => {
    const skills = [
      {
        name: 'simple-skill',
        description: 'Simple',
        license: '',
        body: 'Body',
        references: []
      }
    ];

    transformCursor(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/simple-skill/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/simple-skill/reference'))).toBe(false);
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;

    const skills = [
      { name: 'skill1', description: '', license: '', userInvokable: true, body: 'body1' },
      { name: 'skill2', description: '', license: '', userInvokable: false, body: 'body2' }
    ];

    transformCursor(skills, TEST_DIR);

    console.log = originalLog;

    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('✓ Cursor:'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 skills'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('1 user-invokable'));
  });

  test('should handle empty skills array', () => {
    transformCursor([], TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills'))).toBe(true);
  });

  test('should preserve line breaks and formatting in body', () => {
    const skills = [
      {
        name: 'formatted',
        description: 'Test',
        license: '',
        body: `Line 1

Line 3 after blank line

- Bullet 1
- Bullet 2

End.`
      }
    ];

    transformCursor(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.cursor/skills/formatted/SKILL.md'), 'utf-8');
    expect(content).toContain('Line 1\n\nLine 3');
    expect(content).toContain('- Bullet 1\n- Bullet 2');
  });

  test('should support prefix option', () => {
    const skills = [
      { name: 'audit', description: 'Audit', license: '', body: 'Audit body' }
    ];

    transformCursor(skills, TEST_DIR, null, { prefix: 'i-', outputSuffix: '-prefixed' });

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor-prefixed/.cursor/skills/i-audit/SKILL.md'))).toBe(true);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor-prefixed/.cursor/skills/i-audit/SKILL.md'), 'utf-8');
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

    transformCursor(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.cursor/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Ask the model for help.');
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

    transformCursor(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.cursor/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('See .cursorrules for more.');
  });

  test('should replace {{ask_instruction}} placeholder', () => {
    const skills = [
      {
        name: 'test',
        description: 'Test',
        license: '',
        body: 'When unsure, {{ask_instruction}}'
      }
    ];

    transformCursor(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.cursor/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('When unsure, ask the user directly to clarify what you cannot infer.');
  });

  test('should clean existing directory before writing', () => {
    // Create a pre-existing file structure
    const existingDir = path.join(TEST_DIR, 'cursor/.cursor/skills/old-skill');
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, 'SKILL.md'), 'old content');

    const skills = [
      { name: 'new-skill', description: 'New', license: '', body: 'New body' }
    ];

    transformCursor(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/old-skill/SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.cursor/skills/new-skill/SKILL.md'))).toBe(true);
  });
});
