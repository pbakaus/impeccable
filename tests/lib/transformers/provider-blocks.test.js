import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { createTransformer } from '../../../scripts/lib/transformers/factory.js';

const TEST_DIR = path.join(process.cwd(), 'test-tmp-provider-block-transformer');

const baseConfig = {
  provider: 'cursor',
  providerTags: ['cursor'],
  configDir: '.test',
  displayName: 'Test Provider',
  frontmatterFields: [],
};

describe('provider block transformer integration', () => {
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

  test('compiles provider blocks in skill bodies', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{
      name: 'test',
      description: 'Test',
      body: [
        'Shared guidance.',
        '<cursor>',
        'Cursor-only guidance.',
        '</cursor>',
        '<codex>',
        'Codex-only guidance.',
        '</codex>',
      ].join('\n')
    }];
    transform(skills, TEST_DIR);

    const content = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/SKILL.md'), 'utf-8');
    expect(content).toContain('Shared guidance.');
    expect(content).toContain('Cursor-only guidance.');
    expect(content).not.toContain('Codex-only guidance.');
    expect(content).not.toContain('<cursor>');
  });

  test('compiles provider blocks in reference files', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{
      name: 'test',
      description: 'Test',
      body: 'Body',
      references: [
        {
          name: 'ref',
          filePath: '/fake/ref.md',
          content: [
            'Shared reference.',
            '<cursor>',
            'Cursor reference.',
            '</cursor>',
            '<codex>',
            'Codex reference.',
            '</codex>',
          ].join('\n')
        },
      ]
    }];
    transform(skills, TEST_DIR);

    const ref = fs.readFileSync(path.join(TEST_DIR, 'cursor/.test/skills/test/reference/ref.md'), 'utf-8');
    expect(ref).toContain('Shared reference.');
    expect(ref).toContain('Cursor reference.');
    expect(ref).not.toContain('Codex reference.');
    expect(ref).not.toContain('<cursor>');
  });

  test('compiles provider blocks in generated agents', () => {
    const config = {
      ...baseConfig,
      provider: 'codex',
      providerTags: ['codex'],
      agentFormat: 'codex-toml',
    };
    const transform = createTransformer(config);
    const skills = [{
      name: 'test',
      description: 'Test',
      body: 'Body',
      agents: [{
        name: 'review-helper',
        codexName: 'review_helper',
        description: 'Review helper',
        body: [
          'Shared agent guidance.',
          '<codex>',
          'Codex agent guidance.',
          '</codex>',
          '<claude-code>',
          'Claude agent guidance.',
          '</claude-code>',
        ].join('\n')
      }]
    }];
    transform(skills, TEST_DIR);

    const agent = fs.readFileSync(path.join(TEST_DIR, 'codex/.test/agents/review_helper.toml'), 'utf-8');
    expect(agent).toContain('Shared agent guidance.');
    expect(agent).toContain('Codex agent guidance.');
    expect(agent).not.toContain('Claude agent guidance.');
    expect(agent).not.toContain('<codex>');
  });

  test('writes nested script artifacts', () => {
    const transform = createTransformer(baseConfig);
    const skills = [{
      name: 'test',
      description: 'Test',
      body: 'Body',
      scripts: [
        { name: 'detect.mjs', content: 'export {};\n' },
        { name: 'detector/detect-antipatterns.mjs', content: 'export const bundled = true;\n' },
      ],
    }];
    transform(skills, TEST_DIR);

    const detector = path.join(TEST_DIR, 'cursor/.test/skills/test/scripts/detector/detect-antipatterns.mjs');
    expect(fs.existsSync(detector)).toBe(true);
    expect(fs.readFileSync(detector, 'utf-8')).toContain('bundled = true');
  });
});
