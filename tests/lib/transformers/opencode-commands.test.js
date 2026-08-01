import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { createTransformer } from '../../../scripts/lib/transformers/factory.js';
import { PROVIDERS } from '../../../scripts/lib/transformers/providers.js';

const config = PROVIDERS.opencode;
const transform = createTransformer(config);

const TEST_DIR = path.join(process.cwd(), 'test-tmp-opencode-commands');
const COMMAND_PATH = path.join(
  TEST_DIR,
  `${config.provider}/${config.configDir}/commands/impeccable.md`,
);

const SAMPLE_SKILL = {
  name: 'impeccable',
  description: 'Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface.',
  body: '# Impeccable\n\nSkill body here.',
  references: [],
  scripts: [],
  agents: [],
};

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

describe('opencode commands bridge', () => {
  test('emits .opencode/commands/impeccable.md alongside the skill', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    expect(fs.existsSync(COMMAND_PATH)).toBe(true);
  });

  test('command frontmatter uses only fields OpenCode recognises', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    const content = fs.readFileSync(COMMAND_PATH, 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    const lines = fm[1].split('\n').map(l => l.trim()).filter(Boolean);
    const keys = lines.map(l => l.split(':')[0]);
    // OpenCode only recognises: description, agent, model, variant, subtask (per
    // opencode/packages/core/src/v1/config/command.ts:5-13).
    const allowed = new Set(['description', 'agent', 'model', 'variant', 'subtask']);
    for (const key of keys) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  test('command description mirrors the skill description', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    const content = fs.readFileSync(COMMAND_PATH, 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/)[1];
    expect(fm).toContain(`description: "${SAMPLE_SKILL.description}`);
  });

  test('command body instructs the agent to load the impeccable skill', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    const content = fs.readFileSync(COMMAND_PATH, 'utf-8');
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    expect(body).toContain('skill({');
    expect(body).toContain("name: \"impeccable\"");
    expect(body).toContain('context.mjs');
    expect(body).toContain('$ARGUMENTS');
    expect(body).toContain('routing.md');
  });

  test('command declares agent: build and subtask: true', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    const content = fs.readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toMatch(/^agent: build$/m);
    expect(content).toMatch(/^subtask: true$/m);
  });

  test('does not emit Claude-only frontmatter fields on the command', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    const content = fs.readFileSync(COMMAND_PATH, 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/)[1];
    expect(fm).not.toMatch(/^version:/m);
    expect(fm).not.toMatch(/^user-invocable:/m);
    expect(fm).not.toMatch(/^argument-hint:/m);
    expect(fm).not.toMatch(/^allowed-tools:/m);
  });

  test('emits no command when the skill is empty', () => {
    transform([], TEST_DIR);
    expect(fs.existsSync(path.dirname(COMMAND_PATH))).toBe(false);
  });

  test('keeps emitting the skill alongside the command', () => {
    transform([SAMPLE_SKILL], TEST_DIR);
    const skillPath = path.join(
      TEST_DIR,
      `${config.provider}/${config.configDir}/skills/impeccable/SKILL.md`,
    );
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.existsSync(COMMAND_PATH)).toBe(true);
  });
});
