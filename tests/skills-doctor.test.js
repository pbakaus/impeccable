/**
 * Tests for `impeccable skills doctor` subcommand.
 *
 * Diagnoses misrouted global installs: when the upstream `npx skills`
 * lands the impeccable skill in `~/.agents/skills/` but Claude Code
 * needs `~/.claude/skills/`, doctor detects the mismatch and (with
 * `--fix`) creates the missing symlink. See vercel-labs/skills#851.
 */
import { describe, test, expect } from 'bun:test';
import { execSync } from 'child_process';
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  lstatSync,
  readlinkSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI = join(import.meta.dir, '..', 'cli', 'bin', 'cli.js');

function run(args, opts = {}) {
  return execSync(`node ${CLI} ${args}`, {
    encoding: 'utf8',
    timeout: 30000,
    ...opts,
  });
}

function makeSkill(home, providerDir, name = 'impeccable') {
  const dir = join(home, providerDir, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: impeccable\n---\n');
  return dir;
}

describe('skills doctor — diagnose mode', () => {
  test('reports clean state when no global impeccable installs exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-doctor-clean-'));
    const out = run('skills doctor', { env: { ...process.env, HOME: home } });
    expect(out).toMatch(/no.*impeccable.*found|nothing to check/i);
    rmSync(home, { recursive: true, force: true });
  });

  test('flags missing ~/.claude/skills/impeccable when ~/.agents/skills/impeccable exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-doctor-flag-'));
    makeSkill(home, '.agents');

    const out = run('skills doctor', { env: { ...process.env, HOME: home } });

    expect(out).toContain('.agents/skills/impeccable');
    expect(out).toMatch(/claude code|\.claude\/skills/i);
    expect(out).toMatch(/--fix/i);

    // Without --fix, no repair.
    expect(existsSync(join(home, '.claude', 'skills', 'impeccable'))).toBe(false);

    rmSync(home, { recursive: true, force: true });
  });

  test('reports clean when both ~/.agents and ~/.claude already have impeccable', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-doctor-both-'));
    makeSkill(home, '.agents');
    makeSkill(home, '.claude');

    const out = run('skills doctor', { env: { ...process.env, HOME: home } });
    expect(out).not.toMatch(/cannot see|missing/i);

    rmSync(home, { recursive: true, force: true });
  });
});

describe('skills doctor --fix', () => {
  test('creates symlink from ~/.claude/skills/impeccable to ~/.agents/skills/impeccable', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-doctor-fix-'));
    const source = makeSkill(home, '.agents');

    run('skills doctor --fix', { env: { ...process.env, HOME: home } });

    const target = join(home, '.claude', 'skills', 'impeccable');
    expect(existsSync(target)).toBe(true);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(source);

    rmSync(home, { recursive: true, force: true });
  });

  test('handles prefixed skill names (e.g. i-impeccable)', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-doctor-prefix-'));
    const source = makeSkill(home, '.agents', 'i-impeccable');

    run('skills doctor --fix', { env: { ...process.env, HOME: home } });

    const target = join(home, '.claude', 'skills', 'i-impeccable');
    expect(existsSync(target)).toBe(true);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(source);

    rmSync(home, { recursive: true, force: true });
  });

  test('is idempotent: running --fix twice does not error', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-doctor-idem-'));
    makeSkill(home, '.agents');

    run('skills doctor --fix', { env: { ...process.env, HOME: home } });
    run('skills doctor --fix', { env: { ...process.env, HOME: home } });

    const target = join(home, '.claude', 'skills', 'impeccable');
    expect(existsSync(target)).toBe(true);

    rmSync(home, { recursive: true, force: true });
  });
});
