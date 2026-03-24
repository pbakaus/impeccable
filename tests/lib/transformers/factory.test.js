import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { createTransformer } from '../../../scripts/lib/transformers/factory.js';
import { parseFrontmatter } from '../../../scripts/lib/utils.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-factory');

// Minimal config using 'cursor' as provider (has existing PROVIDER_PLACEHOLDERS)
const baseConfig = {
  provider: 'cursor',
  configDir: '.test',
  displayName: 'Test Provider',
  frontmatterFields: [],
};

describe('createTransformer factory', () => {
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
    const transform = createTransformer(baseConfig);
    transform([], TEST_DIR);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills'))).toBe(true);
  });

  test('should always emit name and description', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{ name: 'test', description: 'A test skill', body: 'Body.' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter.name).toBe('test');
    expect(parsed.frontmatter.description).toBe('A test skill');
    expect(parsed.body).toBe('Body.');
  });

  test('should only emit allowlisted fields', () => {
    const config = { ...baseConfig, frontmatterFields: ['license'] };
    const transform = createTransformer(config);
    const skills = [{
      name: 'test',
      description: 'Test',
      license: 'MIT',
      compatibility: 'all',
      metadata: 'meta',
      body: 'Body'
    }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter.license).toBe('MIT');
    expect(parsed.frontmatter.compatibility).toBeUndefined();
    expect(parsed.frontmatter.metadata).toBeUndefined();
  });

  test('should skip empty optional fields', () => {
    const config = { ...baseConfig, frontmatterFields: ['license'] };
    const transform = createTransformer(config);
    const skills = [{ name: 'test', description: 'Test', license: '', body: 'Body' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter.license).toBeUndefined();
  });

  test('should emit user-invocable as true when skill is user-invocable', () => {
    const config = { ...baseConfig, frontmatterFields: ['user-invocable'] };
    const transform = createTransformer(config);
    const skills = [{ name: 'test', description: 'Test', userInvocable: true, body: 'Body' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter['user-invocable']).toBe(true);
  });

  test('should not emit user-invocable when skill is not user-invocable', () => {
    const config = { ...baseConfig, frontmatterFields: ['user-invocable'] };
    const transform = createTransformer(config);
    const skills = [{ name: 'test', description: 'Test', userInvocable: false, body: 'Body' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter['user-invocable']).toBeUndefined();
  });

  test('should emit argument-hint only when user-invocable', () => {
    const config = { ...baseConfig, frontmatterFields: ['argument-hint'] };
    const transform = createTransformer(config);

    // User-invocable with hint
    const skills1 = [{ name: 'test', description: 'Test', userInvocable: true, argumentHint: '[target]', body: 'Body' }];
    transform(skills1, TEST_DIR);
    let content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    let parsed = parseFrontmatter(content);
    expect(parsed.frontmatter['argument-hint']).toBe('[target]');

    // Non-user-invocable with hint
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    const skills2 = [{ name: 'test', description: 'Test', userInvocable: false, argumentHint: '[target]', body: 'Body' }];
    transform(skills2, TEST_DIR);
    content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    parsed = parseFrontmatter(content);
    expect(parsed.frontmatter['argument-hint']).toBeUndefined();
  });

  test('should apply bodyTransform after placeholder replacement', () => {
    const config = {
      ...baseConfig,
      bodyTransform: (body) => body.replace(/PLACEHOLDER/, 'TRANSFORMED'),
    };
    const transform = createTransformer(config);
    const skills = [{ name: 'test', description: 'Test', body: 'PLACEHOLDER content' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('TRANSFORMED content');
  });

  test('should support prefix option', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{ name: 'audit', description: 'Audit', userInvocable: true, body: 'Body' }];
    transform(skills, TEST_DIR, { prefix: 'i-', outputSuffix: '-prefixed' });

    const outputPath = path.join(TEST_DIR, 'cursor-prefixed/.test/skills/i-audit/SKILL.md');
    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toContain('name: i-audit');
  });

  test('should copy reference files', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{
      name: 'test',
      description: 'Test',
      body: 'Body',
      references: [
        { name: 'ref1', content: 'Reference 1 content', filePath: '/fake/ref1.md' },
        { name: 'ref2', content: 'Reference 2 content', filePath: '/fake/ref2.md' },
      ]
    }];
    transform(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills/test/reference/ref1.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills/test/reference/ref2.md'))).toBe(true);
    const ref1 = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/reference/ref1.md'), 'utf-8');
    expect(ref1).toBe('Reference 1 content');
  });

  test('should clean existing directory before writing', () => {
    const transform = createTransformer(baseConfig);
    const existingDir = path.join(TEST_DIR, 'cursor/.test/skills/old');
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, 'SKILL.md'), 'old');

    const skills = [{ name: 'new', description: 'New', body: 'New' }];
    transform(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills/old/SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills/new/SKILL.md'))).toBe(true);
  });

  test('should log correct summary', () => {
    const consoleMock = mock(() => {});
    const originalLog = console.log;
    console.log = consoleMock;

    const transform = createTransformer(baseConfig);
    const skills = [
      { name: 's1', description: 'Test', userInvocable: true, body: 'body' },
      { name: 's2', description: 'Test', userInvocable: false, body: 'body' }
    ];
    transform(skills, TEST_DIR);

    console.log = originalLog;
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('✓ Test Provider:'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('2 skills'));
    expect(consoleMock).toHaveBeenCalledWith(expect.stringContaining('1 user-invocable'));
  });

  test('should handle empty skills array', () => {
    const transform = createTransformer(baseConfig);
    transform([], TEST_DIR);

    const skillDirs = fs.readdirSync(path.join(TEST_DIR, 'cursor/.test/skills'));
    expect(skillDirs).toHaveLength(0);
  });

  test('should replace {{model}} placeholder', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{ name: 'test', description: 'Test', body: 'Ask {{model}} for help.' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Ask the model for help.');
  });

  test('should replace {{config_file}} placeholder', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{ name: 'test', description: 'Test', body: 'See {{config_file}}.' }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('See .cursorrules.');
  });

  test('should handle multiple skills', () => {
    const transform = createTransformer(baseConfig);
    const skills = [
      { name: 'skill1', description: 'Skill 1', body: 'Body 1' },
      { name: 'skill2', description: 'Skill 2', body: 'Body 2' },
    ];
    transform(skills, TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills/skill1/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'cursor/.test/skills/skill2/SKILL.md'))).toBe(true);
  });

  test('should preserve multiline body content', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{
      name: 'test',
      description: 'Test',
      body: `First paragraph.\n\nSecond paragraph.\n\n- List item 1\n- List item 2`
    }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    const parsed = parseFrontmatter(content);
    expect(parsed.body).toContain('First paragraph.');
    expect(parsed.body).toContain('Second paragraph.');
    expect(parsed.body).toContain('- List item 1');
  });

  test('should emit all spec fields when configured', () => {
    const config = {
      ...baseConfig,
      frontmatterFields: ['user-invocable', 'argument-hint', 'license', 'compatibility', 'metadata', 'allowed-tools'],
    };
    const transform = createTransformer(config);
    const skills = [{
      name: 'test',
      description: 'Test',
      userInvocable: true,
      argumentHint: '[target]',
      license: 'MIT',
      compatibility: 'claude-code',
      metadata: 'v1',
      allowedTools: 'Bash,Edit',
      body: 'Body'
    }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('user-invocable: true');
    expect(content).toContain('argument-hint:');
    expect(content).toContain('license: MIT');
    expect(content).toContain('compatibility: claude-code');
    expect(content).toContain('metadata: v1');
    expect(content).toContain('allowed-tools: Bash,Edit');
  });
});
