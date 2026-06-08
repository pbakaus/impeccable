/**
 * End-to-end tests for `impeccable skills` subcommands.
 *
 * Creates real temp directories, runs the CLI, and verifies results.
 *
 * Deterministic install/update coverage uses a local universal bundle override
 * and runs in the default suite. Remote smoke blocks that download the
 * production universal bundle use `describeRemote` and run only under
 * `bun run test:cli-remote-e2e` (IMPECCABLE_CLI_REMOTE_E2E=1), skipping
 * gracefully when impeccable.style is unreachable.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, lstatSync, realpathSync, readlinkSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateUnprefixImpeccable } from '../cli/bin/commands/skills.mjs';

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

/** Write one fake skill dir with a SKILL.md naming itself. */
function writeSkill(root, provider, name) {
  const dir = join(root, provider, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\nRun /${name}.\n`);
}

function createFakeLinkSource(root, providers = ['.claude']) {
  for (const provider of providers) {
    writeSkill(join(root, '.impeccable', 'dist', 'universal'), provider, 'impeccable');
  }
}

function createFakeUniversalBundle(root, providers = ['.claude', '.agents', '.cursor']) {
  const bundleRoot = join(root, 'universal-bundle');
  for (const provider of providers) {
    const skillDir = join(bundleRoot, provider, 'skills', 'impeccable');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: impeccable',
      'version: 9.9.9-local',
      '---',
      '',
      `Local deterministic bundle for ${provider}.`,
    ].join('\n'));
    writeFileSync(join(skillDir, 'scripts', 'context.mjs'), 'console.log("local bundle context");\n');
  }
  return bundleRoot;
}

/**
 * Simulate an install from the era when the CLI offered a command prefix: the
 * skill lives at `<prefix>impeccable`. Optionally drop in a third-party skill
 * (one that even starts with the same prefix) that migration must NOT touch.
 */
function createPrefixedInstall(root, { prefix = 'i-', providers = ['.claude'], foreign = null } = {}) {
  for (const provider of providers) {
    writeSkill(root, provider, `${prefix}impeccable`);
    if (foreign) writeSkill(root, provider, foreign);
  }
}

// ─── Already-installed detection ─────────────────────────────────────────────

// Remote e2e blocks (real bundle downloads from impeccable.style) run only
// under `bun run test:cli-remote-e2e` (IMPECCABLE_CLI_REMOTE_E2E=1). The default
// suite skips them so it stays offline and stable; when opted in they still
// skip gracefully if the bundle endpoint is unreachable.
const WANT_CLI_REMOTE_E2E = process.env.IMPECCABLE_CLI_REMOTE_E2E === '1';
let bundleReachable = false;
if (WANT_CLI_REMOTE_E2E) {
  try {
    execSync('curl -sfIL --max-time 10 https://impeccable.style/api/download/bundle/universal -o /dev/null', { stdio: 'pipe' });
    bundleReachable = true;
  } catch {}
}
const describeRemote = (WANT_CLI_REMOTE_E2E && bundleReachable) ? describe : describe.skip;

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

// ─── Submodule/link installs ────────────────────────────────────────────────

describe('skills link: submodule installs', () => {
  test('creates relative skill symlinks from dist/universal', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp, ['.claude', '.cursor']);

    const output = run('skills link --source=.impeccable --providers=claude,cursor -y', { cwd: tmp });
    expect(output).toContain('Linked impeccable into: .claude, .cursor');

    for (const provider of ['.claude', '.cursor']) {
      const dest = join(tmp, provider, 'skills', 'impeccable');
      const src = join(tmp, '.impeccable', 'dist', 'universal', provider, 'skills', 'impeccable');
      expect(lstatSync(dest).isSymbolicLink()).toBe(true);
      expect(readlinkSync(dest).startsWith('/')).toBe(false);
      expect(realpathSync(dest)).toBe(realpathSync(src));
    }

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('is idempotent when links already point at the same source', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-again-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp);

    run('skills link --source=.impeccable --providers=claude -y', { cwd: tmp });
    const before = readlinkSync(join(tmp, '.claude', 'skills', 'impeccable'));
    const output = run('skills link --source=.impeccable --providers=claude -y', { cwd: tmp });

    expect(output).toContain('already linked');
    expect(readlinkSync(join(tmp, '.claude', 'skills', 'impeccable'))).toBe(before);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('does not overwrite an existing real skill unless forced', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-existing-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp);
    writeSkill(tmp, '.claude', 'impeccable');

    expect(() => run('skills link --source=.impeccable --providers=claude -y', { cwd: tmp })).toThrow();
    const dest = join(tmp, '.claude', 'skills', 'impeccable');
    expect(lstatSync(dest).isSymbolicLink()).toBe(false);

    const output = run('skills link --source=.impeccable --providers=claude -y --force', { cwd: tmp });
    expect(output).toContain('1 linked');
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('maps codex and rovo-dev provider aliases to their install folders', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-alias-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp, ['.agents', '.rovodev']);

    run('skills link --source=.impeccable --providers=codex,rovo-dev -y', { cwd: tmp });

    expect(lstatSync(join(tmp, '.agents', 'skills', 'impeccable')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(tmp, '.rovodev', 'skills', 'impeccable')).isSymbolicLink()).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills update leaves linked installs on the submodule path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-update-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp);
    run('skills link --source=.impeccable --providers=claude -y', { cwd: tmp });

    const dest = join(tmp, '.claude', 'skills', 'impeccable');
    const before = readlinkSync(dest);
    const output = run('skills update -y', { cwd: tmp });

    expect(output).toContain('Linked skills found in: .claude');
    expect(readlinkSync(dest)).toBe(before);
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('deduplicates providers that share one skills directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-shared-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp, ['.claude', '.agents']);
    mkdirSync(join(tmp, '.agents', 'skills'), { recursive: true });
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    symlinkSync('../.agents/skills', join(tmp, '.claude', 'skills'), 'dir');

    run('skills link --source=.impeccable --providers=claude,codex -y', { cwd: tmp });

    const dest = join(tmp, '.agents', 'skills', 'impeccable');
    const src = join(tmp, '.impeccable', 'dist', 'universal', '.claude', 'skills', 'impeccable');
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(realpathSync(dest)).toBe(realpathSync(src));

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);
});

// ─── Unprefix migration (real implementation, real filesystem) ───────────────
//
// The CLI no longer offers a command prefix (the `i-` rename only made sense
// when each command was its own skill). migrateUnprefixImpeccable retires any
// old `<prefix>impeccable` install back to the canonical `impeccable`, so an
// update lands fresh content there instead of orphaning the prefixed copy.
// These call the EXPORTED function -- not a reimplementation -- so a regression
// in the real code fails the suite.

describe('skills: unprefix migration', () => {
  test('renames i-impeccable back to impeccable across every provider', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-mig-'));
    createPrefixedInstall(tmp, { prefix: 'i-', providers: ['.claude', '.cursor'] });

    const migrated = migrateUnprefixImpeccable(tmp);
    expect(migrated).toBe(2); // one skill x two providers

    for (const provider of ['.claude', '.cursor']) {
      const skills = readdirSync(join(tmp, provider, 'skills'));
      expect(skills).toContain('impeccable');
      expect(skills).not.toContain('i-impeccable');
    }

    rmSync(tmp, { recursive: true, force: true });
  });

  test('migrates a custom prefix too (x-impeccable)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-mig-x-'));
    createPrefixedInstall(tmp, { prefix: 'x-' });

    expect(migrateUnprefixImpeccable(tmp)).toBe(1);
    expect(readdirSync(join(tmp, '.claude', 'skills'))).toContain('impeccable');

    rmSync(tmp, { recursive: true, force: true });
  });

  test('REGRESSION: never touches third-party skills, even ones starting with i-', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-mig-scope-'));
    // A foreign skill that shares the i- prefix but is NOT impeccable.
    createPrefixedInstall(tmp, { prefix: 'i-', foreign: 'i-cool-skill' });

    const migrated = migrateUnprefixImpeccable(tmp);
    expect(migrated).toBe(1); // only i-impeccable

    const skills = readdirSync(join(tmp, '.claude', 'skills'));
    expect(skills).toContain('impeccable');
    expect(skills).toContain('i-cool-skill'); // untouched, NOT renamed to cool-skill
    expect(skills).not.toContain('cool-skill');

    const foreign = readFileSync(join(tmp, '.claude', 'skills', 'i-cool-skill', 'SKILL.md'), 'utf8');
    expect(foreign).toContain('name: i-cool-skill');

    rmSync(tmp, { recursive: true, force: true });
  });

  test('leaves a clean impeccable install alone (no-op)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-mig-clean-'));
    createFakeSkills(tmp, ['impeccable'], ['.claude']);

    expect(migrateUnprefixImpeccable(tmp)).toBe(0);
    expect(readdirSync(join(tmp, '.claude', 'skills'))).toContain('impeccable');

    rmSync(tmp, { recursive: true, force: true });
  });

  test('leaves the legacy teach-impeccable name alone (cleanup owns that)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-mig-legacy-'));
    createFakeSkills(tmp, ['teach-impeccable'], ['.claude']);

    expect(migrateUnprefixImpeccable(tmp)).toBe(0);
    expect(readdirSync(join(tmp, '.claude', 'skills'))).toContain('teach-impeccable');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ─── Install/update from local universal bundle ──────────────────────────────

describe('skills install/update: local universal bundle e2e', () => {
  test('installs provider-specific skills into a fresh project', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-local-install-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp);

    const output = run('skills install -y --providers=claude,codex,cursor', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Done!');

    for (const provider of ['.claude', '.agents', '.cursor']) {
      const skillDir = join(tmp, provider, 'skills', 'impeccable');
      expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
      expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toContain(`Local deterministic bundle for ${provider}.`);
      expect(existsSync(join(skillDir, 'scripts', 'context.mjs'))).toBe(true);
    }

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('updates stale copied skills from the local bundle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-local-update-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    const skillDir = join(tmp, '.claude', 'skills', 'impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\nstale: true\n---\nOld content.\n');

    const output = run('skills update -y', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Updated');

    const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(content).not.toContain('stale: true');
    expect(content).toContain('version: 9.9.9-local');
    expect(existsSync(join(skillDir, 'scripts', 'context.mjs'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('--force reinstall over an old prefixed install lands on canonical impeccable', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-local-force-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    const prefixed = join(tmp, '.claude', 'skills', 'i-impeccable');
    mkdirSync(prefixed, { recursive: true });
    writeFileSync(join(prefixed, 'SKILL.md'), '---\nname: i-impeccable\n---\n');

    run('skills install -y --force --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    const skills = readdirSync(join(tmp, '.claude', 'skills'));
    expect(skills).toContain('impeccable');
    expect(skills).not.toContain('i-impeccable');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);
});

// ─── Update fallback (remote direct download smoke) ──────────────────────────

describeRemote('skills update: refreshes from the production universal bundle', () => {
  let tmp;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-'));
    execSync('git init', { cwd: tmp });

    // Stale impeccable skill that the update should overwrite with fresh,
    // compiled content. v3.0 ships a single `impeccable` skill (with
    // sub-commands), so it is the one the bundle refreshes.
    const skillDir = join(tmp, '.claude', 'skills', 'impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\nstale: true\n---\nOld content.\n');
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('downloads the bundle and refreshes the impeccable skill', () => {
    const output = run('skills update -y', { cwd: tmp });
    expect(output).toContain('Updated');

    // The skill now carries fresh, compiled content (no 'stale: true').
    const content = readFileSync(join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md'), 'utf8');
    expect(content).not.toContain('stale: true');
    expect(content).toContain('name:');
  }, 60000);

  test('refreshed skill ships its compiled scripts directory', () => {
    // The compiled variant bundles scripts/ (context loader, detector shim, ...).
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable', 'scripts'))).toBe(true);
  });
});

// ─── Full install remote smoke (downloads the production universal bundle) ───

describeRemote('skills install: production universal bundle download', () => {
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

  test('--force reinstall over an old prefixed install lands on canonical impeccable', () => {
    // Seed a stale prefixed install, then reinstall. The migration should
    // retire i-impeccable so we are left with the canonical name only.
    const prefixed = join(tmp, '.claude', 'skills', 'i-impeccable');
    mkdirSync(prefixed, { recursive: true });
    writeFileSync(join(prefixed, 'SKILL.md'), '---\nname: i-impeccable\n---\n');

    run('skills install -y --force', { cwd: tmp });

    const skills = readdirSync(join(tmp, '.claude', 'skills'));
    expect(skills).toContain('impeccable');
    expect(skills).not.toContain('i-impeccable');
  }, 90000);
});
