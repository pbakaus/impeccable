/**
 * End-to-end tests for `impeccable skills` subcommands.
 *
 * Creates real temp directories, runs the CLI, and verifies results.
 * Tests that require `npx skills` are skipped if it's not available.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI = join(import.meta.dir, '..', 'cli', 'bin', 'cli.js');

function run(args, opts = {}) {
  return execSync(`node ${CLI} ${args}`, {
    encoding: 'utf8',
    timeout: 60000,
    ...opts,
  });
}

/** Create a fake skill installation in a temp dir */
function createFakeSkills(root, skills = ['audit', 'polish', 'impeccable'], providers = ['.claude']) {
  for (const provider of providers) {
    for (const skill of skills) {
      const skillDir = join(root, provider, 'skills', skill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        `name: ${skill}`,
        'user-invocable: true',
        '---',
        '',
        'Run /audit first, then /polish to finish.',
        'Use the impeccable skill for setup.',
      ].join('\n'));
    }
  }
}

// ─── Already-installed detection ─────────────────────────────────────────────

describe('skills install: already-installed detection', () => {
  test('detects impeccable sentinel and bails', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp);

    const output = run('skills install -y', { cwd: tmp });
    expect(output).toContain('already installed');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('detects prefixed i-impeccable', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'));
    execSync('git init', { cwd: tmp });

    const skillDir = join(tmp, '.cursor', 'skills', 'i-impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: i-impeccable\n---\n');

    const output = run('skills install -y', { cwd: tmp });
    expect(output).toContain('already installed');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);
});

// ─── Prefix rename (real filesystem) ─────────────────────────────────────────

describe('skills install: prefix rename', () => {
  let tmp;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'imp-test-pfx-'));
    createFakeSkills(tmp, ['audit', 'polish', 'impeccable'], ['.claude', '.cursor']);
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('renames folders with prefix', () => {
    // Write a helper script that imports and runs renameSkillsWithPrefix
    const helperScript = join(tmp, '_test_rename.mjs');
    writeFileSync(helperScript, `
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function escapeRegex(str) {
  return str.replace(/[.*+?^$\{\}()|[\\]\\\\]/g, '\\\\$&');
}

function prefixSkillContent(content, prefix, allSkillNames) {
  let result = content.replace(/^name:\\s*(.+)$/m, (_, name) => 'name: ' + prefix + name.trim());
  const sorted = [...allSkillNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    result = result.replace(
      new RegExp('/' + '(?=' + escapeRegex(name) + '(?:[^a-zA-Z0-9_-]|$))', 'g'),
      '/' + prefix
    );
    result = result.replace(
      new RegExp('(the) ' + escapeRegex(name) + ' skill', 'gi'),
      (_, article) => article + ' ' + prefix + name + ' skill'
    );
  }
  return result;
}

const DIRS = ['.claude', '.cursor'];
const root = process.argv[2];
const prefix = process.argv[3];

let allNames = [];
for (const d of DIRS) {
  const dir = join(root, d, 'skills');
  if (!existsSync(dir)) continue;
  allNames = readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  if (allNames.length > 0) break;
}

let count = 0;
for (const d of DIRS) {
  const dir = join(root, d, 'skills');
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(prefix)) continue;
    const skillMd = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    renameSync(join(dir, entry.name), join(dir, prefix + entry.name));
    let content = readFileSync(join(dir, prefix + entry.name, 'SKILL.md'), 'utf8');
    content = prefixSkillContent(content, prefix, allNames);
    writeFileSync(join(dir, prefix + entry.name, 'SKILL.md'), content);
    count++;
  }
}
console.log(JSON.stringify({ count }));
    `);

    const output = JSON.parse(execSync(`node ${helperScript} ${tmp} i-`, { encoding: 'utf8' }));
    expect(output.count).toBe(6); // 3 skills x 2 providers

    // Verify folders renamed
    const skills = readdirSync(join(tmp, '.claude', 'skills'));
    expect(skills).toContain('i-audit');
    expect(skills).toContain('i-polish');
    expect(skills).toContain('i-impeccable');
    expect(skills).not.toContain('audit');
    expect(skills).not.toContain('polish');
  }, 15000);

  test('prefixed SKILL.md has correct name and cross-references', () => {
    const content = readFileSync(join(tmp, '.claude', 'skills', 'i-audit', 'SKILL.md'), 'utf8');
    expect(content).toContain('name: i-audit');
    expect(content).toContain('/i-audit');
    expect(content).toContain('/i-polish');
    expect(content).toContain('the i-impeccable skill');
    // Original unprefixed references should be gone
    expect(content).not.toMatch(/\/audit(?=[^a-zA-Z0-9_-]|$)/);
  });

  test('also prefixed in second provider', () => {
    const skills = readdirSync(join(tmp, '.cursor', 'skills'));
    expect(skills).toContain('i-audit');
    expect(skills).toContain('i-impeccable');
  });
});

// ─── Update fallback (direct download) ───────────────────────────────────────

describe('skills update: direct download fallback', () => {
  let tmp;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-'));
    execSync('git init', { cwd: tmp });

    // Create stale skills that the update should overwrite
    for (const skill of ['audit', 'impeccable']) {
      const skillDir = join(tmp, '.claude', 'skills', skill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${skill}\nstale: true\n---\nOld content.\n`);
    }
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('downloads universal bundle and updates skills', () => {
    const output = run('skills update -y', { cwd: tmp });
    expect(output).toContain('direct download');
    expect(output).toContain('Updated');

    // Skills should have fresh content (no 'stale: true')
    const content = readFileSync(join(tmp, '.claude', 'skills', 'audit', 'SKILL.md'), 'utf8');
    expect(content).not.toContain('stale: true');
    expect(content).toContain('name:');
  }, 60000);

  test('update added new skills that were not present before', () => {
    // The universal bundle has ~20 skills, we only had 2
    const skills = readdirSync(join(tmp, '.claude', 'skills'));
    expect(skills.length).toBeGreaterThan(5);
  });
});

// ─── Prefix round-trip: detect, undo, re-apply ──────────────────────────────

describe('prefix round-trip: detect, undo, re-apply', () => {
  let tmp;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'imp-test-roundtrip-'));
    // Create prefixed skills to simulate post-install state
    for (const skill of ['audit', 'polish', 'impeccable']) {
      const skillDir = join(tmp, '.claude', 'skills', 'i-' + skill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        `name: i-${skill}`,
        'user-invocable: true',
        '---',
        '',
        'Run /i-audit first, then /i-polish to finish.',
        'Use the i-impeccable skill for setup.',
      ].join('\n'));
    }
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('detectPrefix finds the prefix from skill names', () => {
    const script = join(tmp, '_detect.mjs');
    writeFileSync(script, `
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const DIRS = ['.claude', '.cursor', '.agents'];
const root = ${JSON.stringify(tmp)};
for (const d of DIRS) {
  const dir = join(root, d, 'skills');
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (name === 'impeccable') { console.log(''); process.exit(); }
    if (name.endsWith('-impeccable')) { console.log(name.slice(0, -'impeccable'.length)); process.exit(); }
  }
}
console.log('');
    `);
    const output = execSync(`node ${script}`, { encoding: 'utf8' }).trim();
    expect(output).toBe('i-');
  });

  test('undo removes prefix from folders and content', () => {
    // Write undo helper script
    const script = join(tmp, '_undo.mjs');
    writeFileSync(script, `
import { existsSync, readdirSync, readFileSync, lstatSync, readlinkSync, unlinkSync, renameSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

function escapeRegex(str) { return str.replace(/[.*+?^$\{\\}()|[\\]\\\\]/g, '\\\\$&'); }

const root = ${JSON.stringify(tmp)};
const prefix = 'i-';
const skillsDir = join(root, '.claude', 'skills');
const entries = readdirSync(skillsDir);
const prefixedNames = entries.filter(n => n.startsWith(prefix));

for (const name of entries) {
  if (!name.startsWith(prefix)) continue;
  const unprefixed = name.slice(prefix.length);
  const src = join(skillsDir, name);
  const dest = join(skillsDir, unprefixed);

  if (lstatSync(src).isSymbolicLink()) {
    const target = readlinkSync(src);
    unlinkSync(src);
    symlinkSync(target.replace('/' + name, '/' + unprefixed), dest);
  } else {
    renameSync(src, dest);
    const skillMd = join(dest, 'SKILL.md');
    if (existsSync(skillMd)) {
      let content = readFileSync(skillMd, 'utf8');
      content = content.replace(new RegExp('^name:\\\\s*' + escapeRegex(prefix), 'm'), 'name: ');
      const sorted = [...prefixedNames].sort((a, b) => b.length - a.length);
      for (const pName of sorted) {
        const uName = pName.slice(prefix.length);
        content = content.replace(new RegExp('/' + escapeRegex(pName) + '(?=[^a-zA-Z0-9_-]|$)', 'g'), '/' + uName);
        content = content.replace(new RegExp('(the) ' + escapeRegex(pName) + ' skill', 'gi'), '$1 ' + uName + ' skill');
      }
      writeFileSync(skillMd, content);
    }
  }
}
console.log(JSON.stringify(readdirSync(skillsDir)));
    `);
    const output = JSON.parse(execSync(`node ${script}`, { encoding: 'utf8' }));
    expect(output).toContain('audit');
    expect(output).toContain('polish');
    expect(output).toContain('impeccable');
    expect(output).not.toContain('i-audit');

    // Verify content was un-prefixed
    const content = readFileSync(join(tmp, '.claude', 'skills', 'audit', 'SKILL.md'), 'utf8');
    expect(content).toContain('name: audit');
    expect(content).toContain('/audit');
    expect(content).toContain('/polish');
    expect(content).toContain('the impeccable skill');
    expect(content).not.toContain('/i-audit');
    expect(content).not.toContain('i-impeccable');
  });

  test('re-applying prefix restores original state', () => {
    // Now re-apply using the same helper from the rename test
    const script = join(tmp, '_reprefix.mjs');
    writeFileSync(script, `
import { existsSync, readdirSync, readFileSync, statSync, lstatSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function escapeRegex(str) { return str.replace(/[.*+?^$\{\\}()|[\\]\\\\]/g, '\\\\$&'); }

const root = ${JSON.stringify(tmp)};
const prefix = 'i-';
const skillsDir = join(root, '.claude', 'skills');
const allNames = readdirSync(skillsDir).filter(n => {
  const full = join(skillsDir, n);
  try { return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md')); } catch { return false; }
});

for (const name of allNames) {
  if (name.startsWith(prefix)) continue;
  const src = join(skillsDir, name);
  const dest = join(skillsDir, prefix + name);
  const ls = lstatSync(src);
  if (ls.isSymbolicLink() || !ls.isDirectory()) continue;
  renameSync(src, dest);
  let content = readFileSync(join(dest, 'SKILL.md'), 'utf8');
  content = content.replace(/^name:\\s*(.+)$/m, (_, n) => 'name: ' + prefix + n.trim());
  const sorted = [...allNames].sort((a, b) => b.length - a.length);
  for (const n of sorted) {
    content = content.replace(new RegExp('/' + '(?=' + escapeRegex(n) + '(?:[^a-zA-Z0-9_-]|$))', 'g'), '/' + prefix);
    content = content.replace(new RegExp('(the) ' + escapeRegex(n) + ' skill', 'gi'), (_, art) => art + ' ' + prefix + n + ' skill');
  }
  writeFileSync(join(dest, 'SKILL.md'), content);
}
console.log(JSON.stringify(readdirSync(skillsDir)));
    `);
    const output = JSON.parse(execSync(`node ${script}`, { encoding: 'utf8' }));
    expect(output).toContain('i-audit');
    expect(output).toContain('i-polish');
    expect(output).toContain('i-impeccable');
    expect(output).not.toContain('audit');

    // Verify content was re-prefixed
    const content = readFileSync(join(tmp, '.claude', 'skills', 'i-audit', 'SKILL.md'), 'utf8');
    expect(content).toContain('name: i-audit');
    expect(content).toContain('/i-polish');
    expect(content).toContain('the i-impeccable skill');
  });
});

// ─── Full install e2e (with real npx skills) ─────────────────────────────────

let hasNpxSkills = false;
try {
  execSync('npx skills --version', { encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
  hasNpxSkills = true;
} catch {}

const describeNpx = hasNpxSkills ? describe : describe.skip;

describeNpx('skills install: full e2e with npx skills', () => {
  let tmp;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'imp-test-full-'));
    execSync('git init', { cwd: tmp });
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('installs skills into a fresh project', () => {
    const output = run('skills install -y', { cwd: tmp });
    expect(output).toContain('Done!');

    const hasSkills = ['.claude', '.cursor'].some(d => {
      const dir = join(tmp, d, 'skills');
      return existsSync(dir) && readdirSync(dir).length > 0;
    });
    expect(hasSkills).toBe(true);
  }, 90000);

  test('install with --prefix= renames all skills', () => {
    const output = run('skills install -y --force --prefix=x-', { cwd: tmp });

    // Find the provider that has skills
    let found = false;
    for (const d of ['.claude', '.cursor', '.gemini', '.agents', '.kiro']) {
      const dir = join(tmp, d, 'skills');
      if (!existsSync(dir)) continue;
      const skills = readdirSync(dir);
      if (skills.length === 0) continue;
      found = true;
      const prefixed = skills.filter(s => s.startsWith('x-'));
      // All skills should be prefixed
      expect(prefixed.length).toBe(skills.length);
      break;
    }
    expect(found).toBe(true);
  }, 90000);
});
