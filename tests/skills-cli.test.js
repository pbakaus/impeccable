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
import { execSync, execFileSync } from 'child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, chmodSync, rmSync, lstatSync, realpathSync, readlinkSync, symlinkSync, statSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  collectInstallDetections,
  copyProviderAgents,
  copyProviderHooks,
  copyProviderSkills,
  decideHookInstall,
  downloadAndExtractBundle,
  downloadFile,
  expectedHookDests,
  formatInstallDetectionLines,
  getSkillsVersion,
  mergeHookManifests,
  migrateUnprefixImpeccable,
  resolveInstallTargets,
} from '../cli/bin/commands/skills.mjs';

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
  if (providers.includes('.opencode')) {
    const commandsDir = join(root, '.impeccable', 'dist', 'universal', '.opencode', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, 'impeccable.md'), [
      'description: Impeccable impeccable bridge',
      'agent: build',
      'subtask: true',
      '',
      'body impeccable',
      '',
    ].join('\n'));
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
  if (providers.includes('.claude')) {
    mkdirSync(join(bundleRoot, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(bundleRoot, '.claude', 'settings.json'), JSON.stringify({
      description: 'fresh claude hook',
      hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' }] }] },
    }, null, 2));
    writeFileSync(join(bundleRoot, '.claude', 'agents', 'impeccable-finish-reviewer.md'),
      '---\nname: impeccable-finish-reviewer\ndescription: Reviews a finished build.\n---\nClaude reviewer body.\n');
  }
  if (providers.includes('.cursor')) {
    mkdirSync(join(bundleRoot, '.cursor'), { recursive: true });
    writeFileSync(join(bundleRoot, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: { preToolUse: [{ command: 'node ".cursor/skills/impeccable/scripts/hook-before-edit.mjs"' }] },
    }, null, 2));
  }
  if (providers.includes('.agents')) {
    mkdirSync(join(bundleRoot, '.codex'), { recursive: true });
    // Mirror production: the Codex bundle's `.codex/hooks.json` targets its own
    // `.codex/skills` payload. The CLI installs the skill at `.agents/skills`, so
    // the installer must rewrite this command to `.agents/skills` (see below).
    writeFileSync(join(bundleRoot, '.codex', 'hooks.json'), JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'apply_patch', hooks: [{ type: 'command', command: 'node ".codex/skills/impeccable/scripts/hook.mjs"' }] }] },
    }, null, 2));
  }
  if (providers.includes('.opencode')) {
    const commandsDir = join(bundleRoot, '.opencode', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, 'impeccable.md'), [
      'description: Impeccable impeccable bridge',
      'agent: build',
      'subtask: true',
      '',
      'body impeccable',
      '',
    ].join('\n'));
  }
  if (providers.includes('.grok')) {
    mkdirSync(join(bundleRoot, '.grok', 'hooks'), { recursive: true });
    writeFileSync(join(bundleRoot, '.grok', 'hooks', 'impeccable.json'), JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node ".grok/skills/impeccable/scripts/hook.mjs"' }] }] },
    }, null, 2));
  }
  // Native subagent definitions, mirroring the build's provider agents output.
  if (providers.includes('.github')) {
    mkdirSync(join(bundleRoot, '.github', 'agents'), { recursive: true });
    writeFileSync(join(bundleRoot, '.github', 'agents', 'impeccable-finish-reviewer.agent.md'),
      '---\nname: impeccable-finish-reviewer\ndescription: Reviews a finished build.\n---\nCopilot reviewer body.\n');
    writeFileSync(join(bundleRoot, '.github', 'agents', 'impeccable-asset-producer.agent.md'),
      '---\nname: impeccable-asset-producer\ndescription: Produces assets.\n---\nCopilot producer body.\n');
  }
  if (providers.includes('.cursor')) {
    mkdirSync(join(bundleRoot, '.cursor', 'agents'), { recursive: true });
    writeFileSync(join(bundleRoot, '.cursor', 'agents', 'impeccable-finish-reviewer.md'),
      '---\nname: impeccable-finish-reviewer\ndescription: Reviews a finished build.\nmodel: inherit\nreadonly: true\nis_background: false\n---\nCursor reviewer body.\n');
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

describe('skills version discovery', () => {
  test('prefers metadata.version while accepting legacy top-level version', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-skill-version-'));
    const skillDir = join(tmp, '.agents', 'skills', 'impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: impeccable',
      'version: 0.9.0',
      'metadata:',
      '  version: 1.2.3',
      '---',
      '',
      'Body.',
    ].join('\n'));

    try {
      expect(getSkillsVersion(tmp, 'project')).toBe('1.2.3');
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\nversion: 0.9.0\n---\nBody.\n');
      expect(getSkillsVersion(tmp, 'project')).toBe('0.9.0');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

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

describe('copyProviderSkills: symlink handling', () => {
  test('preserves an external shared-skills symlink and writes through it (#295)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-295-ext-'));
    const root = join(tmp, 'home');
    const shared = join(tmp, 'shared');
    mkdirSync(root, { recursive: true });
    mkdirSync(join(shared, 'other-skill'), { recursive: true });
    writeFileSync(join(shared, 'other-skill', 'SKILL.md'), '---\nname: other-skill\n---\n');
    mkdirSync(join(root, '.claude'), { recursive: true });
    symlinkSync(shared, join(root, '.claude', 'skills'), 'dir');

    const bundle = createFakeUniversalBundle(tmp, ['.claude']);
    copyProviderSkills(bundle, root, ['.claude']);

    const skillsPath = join(root, '.claude', 'skills');
    expect(lstatSync(skillsPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(skillsPath)).toBe(realpathSync(shared));
    expect(existsSync(join(skillsPath, 'other-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(shared, 'impeccable', 'SKILL.md'))).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  test('still converts an in-project cross-provider link to a real dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-295-inproj-'));
    mkdirSync(join(tmp, '.agents', 'skills'), { recursive: true });
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    symlinkSync('../.agents/skills', join(tmp, '.claude', 'skills'), 'dir');

    const bundle = createFakeUniversalBundle(tmp, ['.claude']);
    copyProviderSkills(bundle, tmp, ['.claude']);

    const skillsPath = join(tmp, '.claude', 'skills');
    expect(lstatSync(skillsPath).isSymbolicLink()).toBe(false);
    expect(existsSync(join(skillsPath, 'impeccable', 'SKILL.md'))).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  test('preserves external symlinks when two providers share one external dir (#295, multi-tool)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-295-multi-'));
    const root = join(tmp, 'home');
    const shared = join(tmp, 'shared');
    mkdirSync(root, { recursive: true });
    mkdirSync(join(shared, 'other-skill'), { recursive: true });
    writeFileSync(join(shared, 'other-skill', 'SKILL.md'), '---\nname: other-skill\n---\n');
    for (const provider of ['.claude', '.agents']) {
      mkdirSync(join(root, provider), { recursive: true });
      symlinkSync(shared, join(root, provider, 'skills'), 'dir');
    }

    const bundle = createFakeUniversalBundle(tmp, ['.claude', '.agents']);
    copyProviderSkills(bundle, root, ['.claude', '.agents']);

    for (const provider of ['.claude', '.agents']) {
      const skillsPath = join(root, provider, 'skills');
      expect(lstatSync(skillsPath).isSymbolicLink()).toBe(true);
      expect(realpathSync(skillsPath)).toBe(realpathSync(shared));
    }
    expect(existsSync(join(shared, 'other-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(shared, 'impeccable', 'SKILL.md'))).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  test('replaces a dangling in-project cross-provider link with a real dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-295-dangling-'));
    // Link to another provider's in-project skills dir that does NOT exist yet.
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    symlinkSync('../.agents/skills', join(tmp, '.claude', 'skills'), 'dir');

    const bundle = createFakeUniversalBundle(tmp, ['.claude']);
    copyProviderSkills(bundle, tmp, ['.claude']);

    const skillsPath = join(tmp, '.claude', 'skills');
    expect(lstatSync(skillsPath).isSymbolicLink()).toBe(false);
    expect(existsSync(join(skillsPath, 'impeccable', 'SKILL.md'))).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('copyProviderAgents: Claude, Copilot, and Cursor subagents', () => {
  test('Claude project and user scopes use .claude/agents, with project copies taking precedence', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-agents-claude-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-claude-home-'));
    const bundle = createFakeUniversalBundle(tmp, ['.claude']);
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(home, '.claude', 'agents', 'impeccable-finish-reviewer.md'), 'stale copy\n');

    const projectResults = copyProviderAgents(bundle, tmp, ['.claude'], { scope: 'project', home });
    const userResults = copyProviderAgents(bundle, home, ['.claude'], { scope: 'user' });

    expect(projectResults).toHaveLength(1);
    expect(projectResults[0].shadowed).toEqual([]);
    expect(userResults).toHaveLength(1);
    expect(readFileSync(join(tmp, '.claude', 'agents', 'impeccable-finish-reviewer.md'), 'utf8'))
      .toContain('Claude reviewer body.');
    expect(readFileSync(join(home, '.claude', 'agents', 'impeccable-finish-reviewer.md'), 'utf8'))
      .toContain('Claude reviewer body.');

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('Claude install and update backfill bundled agents beside an unchanged skill', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-agents-claude-install-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-claude-install-home-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    const agentPath = join(tmp, '.claude', 'agents', 'impeccable-finish-reviewer.md');

    const installOutput = run('skills install -y --no-hooks --providers=claude', { cwd: tmp, env });
    expect(installOutput).toContain('Installed Claude Code agents into:');
    expect(existsSync(agentPath)).toBe(true);

    rmSync(agentPath);
    const updateOutput = run('skills update -y --no-hooks', { cwd: tmp, env });
    expect(updateOutput).toContain('Updated');
    expect(updateOutput).toContain('Installed Claude Code agents into:');
    expect(existsSync(agentPath)).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('project scope places agents at .github/agents/ and .cursor/agents/', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-agents-project-'));
    const bundle = createFakeUniversalBundle(tmp, ['.github', '.cursor']);

    const results = copyProviderAgents(bundle, tmp, ['.github', '.cursor'], { scope: 'project' });

    expect(existsSync(join(tmp, '.github', 'agents', 'impeccable-finish-reviewer.agent.md'))).toBe(true);
    expect(existsSync(join(tmp, '.github', 'agents', 'impeccable-asset-producer.agent.md'))).toBe(true);
    expect(existsSync(join(tmp, '.cursor', 'agents', 'impeccable-finish-reviewer.md'))).toBe(true);
    expect(results.map(r => r.provider).sort()).toEqual(['.cursor', '.github']);

    rmSync(tmp, { recursive: true, force: true });
  });

  test('user scope places Copilot agents at ~/.copilot/agents (not ~/.github) and Cursor agents at ~/.cursor/agents, overwriting stale copies', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-agents-user-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-user-home-'));
    const bundle = createFakeUniversalBundle(tmp, ['.github', '.cursor']);
    // A stale user-level copy from an older release must be overwritten.
    mkdirSync(join(home, '.copilot', 'agents'), { recursive: true });
    writeFileSync(join(home, '.copilot', 'agents', 'impeccable-finish-reviewer.agent.md'), 'stale copy\n');

    copyProviderAgents(bundle, home, ['.github', '.cursor'], { scope: 'user' });

    const copilotAgent = readFileSync(join(home, '.copilot', 'agents', 'impeccable-finish-reviewer.agent.md'), 'utf8');
    expect(copilotAgent).toContain('Copilot reviewer body.');
    expect(existsSync(join(home, '.cursor', 'agents', 'impeccable-finish-reviewer.md'))).toBe(true);
    expect(existsSync(join(home, '.github', 'agents'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('skills check accepts current Copilot user agents in a home-rooted checkout', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-check-home-'));
    execSync('git init', { cwd: home });
    const bundleRoot = createFakeUniversalBundle(home, ['.github']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    run('skills install -y --scope=global --no-hooks --providers=github', { cwd: home, env });
    expect(existsSync(join(home, '.copilot', 'agents', 'impeccable-finish-reviewer.agent.md'))).toBe(true);
    expect(existsSync(join(home, '.github', 'agents'))).toBe(false);

    const output = run('skills check', { cwd: home, env });
    expect(output).toContain('Skills are up to date');
    expect(output).not.toContain('Updates available');

    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('inferred home-rooted updates refresh stale or missing Copilot user agents', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-update-home-'));
    execSync('git init', { cwd: home });
    const bundleRoot = createFakeUniversalBundle(home, ['.github']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    const userAgent = join(home, '.copilot', 'agents', 'impeccable-finish-reviewer.agent.md');
    const projectAgent = join(home, '.github', 'agents', 'impeccable-finish-reviewer.agent.md');

    run('skills install -y --scope=global --no-hooks --providers=github', { cwd: home, env });
    writeFileSync(userAgent, 'stale copy\n');

    run('skills update -y --no-hooks', { cwd: home, env });
    expect(readFileSync(userAgent, 'utf8')).toContain('Copilot reviewer body.');
    expect(existsSync(projectAgent)).toBe(false);

    rmSync(userAgent);
    run('skills update -y --no-hooks', { cwd: home, env });
    expect(readFileSync(userAgent, 'utf8')).toContain('Copilot reviewer body.');
    expect(existsSync(projectAgent)).toBe(false);

    rmSync(home, { recursive: true, force: true });
  }, 20000);

  test('project scope reports user-level Copilot agents that shadow the installed ones; Cursor never does (project wins there)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-agents-shadow-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-shadow-home-'));
    const bundle = createFakeUniversalBundle(tmp, ['.github', '.cursor']);
    mkdirSync(join(home, '.copilot', 'agents'), { recursive: true });
    writeFileSync(join(home, '.copilot', 'agents', 'impeccable-finish-reviewer.agent.md'), 'user-level copy\n');
    mkdirSync(join(home, '.cursor', 'agents'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'agents', 'impeccable-finish-reviewer.md'), 'user-level copy\n');

    const results = copyProviderAgents(bundle, tmp, ['.github', '.cursor'], { scope: 'project', home });

    const github = results.find(r => r.provider === '.github');
    const cursor = results.find(r => r.provider === '.cursor');
    expect(github.shadowed).toEqual(['impeccable-finish-reviewer.agent.md']);
    expect(cursor.shadowed).toEqual([]);
    // The project copies still land; the shadow report is a warning, not a block.
    expect(existsSync(join(tmp, '.github', 'agents', 'impeccable-finish-reviewer.agent.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('fresh install lays agents down alongside skills and reports them', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-agents-install-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-agents-install-home-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.github', '.cursor']);

    const output = run('skills install -y --no-hooks --providers=github,cursor', {
      cwd: tmp,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .github, .cursor (project)');
    expect(output).toContain('Installed GitHub Copilot agents into:');
    expect(output).toContain('Installed Cursor agents into:');
    expect(existsSync(join(tmp, '.github', 'agents', 'impeccable-finish-reviewer.agent.md'))).toBe(true);
    expect(existsSync(join(tmp, '.cursor', 'agents', 'impeccable-finish-reviewer.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);
});

describe('skills install: already-installed detection', () => {
  test('detects impeccable sentinel and bails', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp);
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    // Seed the canonical hook target so the already-installed path sees the hook
    // wired up and doesn't try to repair it (which would need the bundle).
    writeFileSync(join(tmp, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
        { type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' },
      ] }] },
    }));

    const output = run('skills install -y', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('already installed');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('already-installed projects keep working when the update check is offline', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-offline-installed-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp, ['impeccable'], ['.claude']);
    writeFileSync(join(tmp, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
        { type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' },
      ] }] },
    }));

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: join(tmp, 'missing-bundle') },
    });

    expect(output).toContain('already installed');
    expect(output).toContain('Could not check for skill updates');
    expect(output).toContain('Existing skills were left unchanged.');
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('detects prefixed i-impeccable', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'));
    execSync('git init', { cwd: tmp });

    const skillDir = join(tmp, '.cursor', 'skills', 'i-impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: i-impeccable\n---\n');
    const bundleRoot = createFakeUniversalBundle(tmp, ['.cursor']);
    // Seed the hook so the already-installed path sees it wired up and doesn't
    // try to repair it (which would need the bundle).
    writeFileSync(join(tmp, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: { preToolUse: [{ command: 'node ".cursor/skills/impeccable/scripts/hook-before-edit.mjs"' }] },
    }));

    const output = run('skills install -y', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('already installed');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('repairs missing hook manifests on already-installed projects', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-repair-hooks-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp, ['impeccable'], ['.claude']);
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('already installed');
    expect(output).toContain('Installed hooks into: .claude');
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('--no-hooks does not repair missing hook manifests on already-installed projects', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-no-hooks-repair-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp, ['impeccable'], ['.claude']);
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    const output = run('skills install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('already installed');
    expect(output).not.toContain('Installed hooks into');
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('repairs the hook when settings.local.json exists without the Impeccable marker', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-repair-unrelated-local-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp, ['impeccable'], ['.claude']);
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    // A local settings file that exists for unrelated reasons (e.g. permissions)
    // must not be mistaken for an installed hook.
    writeFileSync(join(tmp, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }, null, 2));

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('already installed');
    expect(output).toContain('Installed hooks into: .claude');
    // The hook is merged in, and the unrelated local settings are preserved.
    const merged = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.local.json'), 'utf8'));
    expect(JSON.stringify(merged)).toContain('skills/impeccable/scripts/hook.mjs');
    expect(merged.permissions.allow).toContain('Bash(ls:*)');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('a permissions entry mentioning the hook path is not mistaken for an installed hook', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-marker-falsepos-'));
    execSync('git init', { cwd: tmp });
    createFakeSkills(tmp, ['impeccable'], ['.claude']);
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    // The hook path appears only inside a permissions string, not a hooks entry.
    writeFileSync(join(tmp, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(node .claude/skills/impeccable/scripts/hook.mjs:*)'] },
    }, null, 2));

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    // Detected as missing -> repaired, with the real hook added under hooks.
    expect(output).toContain('Installed hooks into: .claude');
    const merged = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.local.json'), 'utf8'));
    expect(merged.hooks.PostToolUse).toBeDefined();
    expect(merged.permissions.allow[0]).toContain('skills/impeccable/scripts/hook.mjs');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);
});

// ─── Submodule/link installs ────────────────────────────────────────────────

describe('skills link: submodule installs', () => {
  test('writes the OpenCode command bridge alongside linked skills', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-bridge-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp, ['.opencode']);

    const output = run('skills link --source=.impeccable --providers=opencode -y', { cwd: tmp });
    expect(output).toContain('Linked impeccable into: .opencode');

    const dest = join(tmp, '.opencode', 'skills', 'impeccable');
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    const bridge = join(tmp, '.opencode', 'commands', 'impeccable.md');
    expect(existsSync(bridge)).toBe(true);
    expect(readFileSync(bridge, 'utf8')).toContain('impeccable bridge');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

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

  test('maps grok and grok-build provider aliases to .grok', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-grok-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp, ['.grok']);

    run('skills link --source=.impeccable --providers=grok -y', { cwd: tmp });
    expect(lstatSync(join(tmp, '.grok', 'skills', 'impeccable')).isSymbolicLink()).toBe(true);
    rmSync(tmp, { recursive: true, force: true });

    const tmp2 = mkdtempSync(join(tmpdir(), 'imp-test-link-grok-build-'));
    execSync('git init', { cwd: tmp2 });
    createFakeLinkSource(tmp2, ['.grok']);

    run('skills link --source=.impeccable --providers=grok-build -y', { cwd: tmp2 });
    expect(lstatSync(join(tmp2, '.grok', 'skills', 'impeccable')).isSymbolicLink()).toBe(true);
    rmSync(tmp2, { recursive: true, force: true });
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

  test('plain install leaves linked installs on the submodule path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-link-install-'));
    execSync('git init', { cwd: tmp });
    createFakeLinkSource(tmp);
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.cursor']);
    run('skills link --source=.impeccable --providers=claude -y', { cwd: tmp });

    const linkedDest = join(tmp, '.claude', 'skills', 'impeccable');
    const before = readlinkSync(linkedDest);
    const copiedDest = join(tmp, '.cursor', 'skills', 'impeccable');
    mkdirSync(join(copiedDest, 'scripts'), { recursive: true });
    writeFileSync(join(copiedDest, 'SKILL.md'), '---\nname: impeccable\nstale: true\n---\nOld content.\n');
    writeFileSync(join(copiedDest, 'scripts', 'context.mjs'), 'console.log("old broken script");\n');

    const output = run('skills install -y --providers=claude,cursor --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Linked skills found in: .claude');
    expect(output).toContain('Continuing with copied installs in: .cursor');
    expect(output).toContain('Updated');
    expect(readlinkSync(linkedDest)).toBe(before);
    expect(lstatSync(linkedDest).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(copiedDest, 'SKILL.md'), 'utf8')).toContain('version: 9.9.9-local');
    expect(readFileSync(join(copiedDest, 'scripts', 'context.mjs'), 'utf8')).toBe('console.log("local bundle context");\n');

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

  test('leaves unrelated legacy skill names alone', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-mig-legacy-'));
    createFakeSkills(tmp, ['teach-impeccable'], ['.claude']);

    expect(migrateUnprefixImpeccable(tmp)).toBe(0);
    expect(readdirSync(join(tmp, '.claude', 'skills'))).toContain('teach-impeccable');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ─── Install/update from local universal bundle ──────────────────────────────

describe('skills install/update: local universal bundle e2e', () => {
  test('root help advertises top-level skills commands', () => {
    const output = run('--help');

    expect(output).toContain('install                          Install impeccable skills');
    expect(output).toContain('update                           Update skills to the latest version');
    expect(output).toContain('impeccable skills <command>       Legacy namespace; still supported.');
    expect(output).not.toContain('skills install                   Install impeccable skills');
  });

  test('update --help is read-only and never downloads (#699)', () => {
    const missingBundle = join(tmpdir(), 'imp-missing-bundle-699-does-not-exist');
    const envBase = { ...process.env, IMPECCABLE_BUNDLE_PATH: missingBundle };

    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-help-699-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-update-help-699-'));
    createFakeSkills(tmp, ['impeccable'], ['.claude']);
    const skillPath = join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md');
    const beforeContent = readFileSync(skillPath, 'utf8');

    for (const args of ['update --help', 'update -h', 'skills update --help']) {
      const output = run(args, { cwd: tmp, env: { ...envBase, HOME: home } });
      expect(output).toContain('Usage: impeccable update');
      expect(output).not.toContain('Checking for updates');
      expect(output).not.toContain('Updating the');
    }
    expect(readFileSync(skillPath, 'utf8')).toBe(beforeContent);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });

    const emptyTmp = mkdtempSync(join(tmpdir(), 'imp-test-update-help-empty-699-'));
    const emptyHome = mkdtempSync(join(tmpdir(), 'imp-home-update-help-empty-699-'));
    const output = run('update --help', { cwd: emptyTmp, env: { ...envBase, HOME: emptyHome } });
    expect(output).toContain('Usage: impeccable update');
    expect(output).not.toContain('Run `npx impeccable install` to install first.');
    expect(output).not.toContain('Checking for updates');

    rmSync(emptyTmp, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  });

  test('top-level install aliases the legacy skills install command', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-top-level-install-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-top-level-install-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    const output = run('install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .claude (project)');
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('install completion says /impeccable init runs in the agent chat, not the terminal (#472)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-install-472-msg-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-install-472-msg-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    const output = run('install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain("type /impeccable init in your AI coding agent's chat (not in this terminal)");

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('`impeccable init` in the shell points at the agent chat instead of "Unknown command" (#472)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-init-472-'));

    let error;
    try {
      run('init', { cwd: tmp, stdio: 'pipe' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    const stderr = String(error.stderr);
    expect(stderr).toContain("Type /impeccable init in your AI coding agent's chat");
    expect(stderr).not.toContain('Unknown command');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('a real path named init still routes to detect, not the #472 guidance', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-init-path-472-'));
    mkdirSync(join(tmp, 'init'), { recursive: true });
    writeFileSync(join(tmp, 'init', 'page.html'), '<!doctype html><html><head><title>t</title></head><body><p>hello</p></body></html>\n');

    // Detect exits 0 on a clean scan and 2 when findings surface; either way it
    // must be the detector answering, not the init redirect. --json makes that
    // positive: the detector always prints a JSON findings array.
    let output = '';
    try {
      output = run('init --json', { cwd: tmp, stdio: 'pipe' });
    } catch (e) {
      output = `${e.stdout || ''}${e.stderr || ''}`;
    }

    expect(output.trim().startsWith('[')).toBe(true);
    expect(output).not.toContain('is not a CLI command');
    expect(output).not.toContain('Unknown command');

    rmSync(tmp, { recursive: true, force: true });
  }, 60000);

  test('formats detected harnesses as concise source-to-target rows', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-detect-lines-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-detect-lines-'));
    const detections = [
      {
        provider: '.claude',
        scope: 'user',
        foundPath: join(home, '.claude'),
        installRoot: home,
        installPath: join(home, '.claude', 'skills'),
      },
      {
        provider: '.agents',
        scope: 'user',
        foundPath: join(home, '.codex'),
        installRoot: home,
        installPath: join(home, '.agents', 'skills'),
      },
      {
        provider: '.pi',
        scope: 'user',
        foundPath: join(home, '.pi'),
        installRoot: home,
        installPath: join(home, '.pi', 'agent', 'skills'),
      },
    ];

    const lines = formatInstallDetectionLines(tmp, detections, home);
    expect(lines).toEqual([
      'Detected harnesses:',
      '  Claude Code      ~/.claude',
      '  Codex CLI        ~/.codex',
      '  Pi Coding Agent  ~/.pi',
    ]);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('detects an installed Veto CLI and targets its managed skill directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-veto-detect-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-veto-detect-'));
    const bin = join(tmp, 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(home, '.veto'), { recursive: true });
    writeFileSync(join(bin, 'veto'), '#!/bin/sh\n');

    const previousPath = process.env.PATH;
    process.env.PATH = bin;
    try {
      expect(collectInstallDetections(tmp, home).some((detection) => detection.provider === '.veto')).toBe(false);

      chmodSync(join(bin, 'veto'), 0o755);
      const detections = collectInstallDetections(tmp, home);
      const veto = detections.find((detection) => detection.provider === '.veto');
      expect(veto).toEqual(expect.objectContaining({
        provider: '.veto',
        scope: 'user',
        foundPath: join(bin, 'veto'),
        installPath: join(home, '.veto', 'skills'),
        reason: 'CLI on PATH',
      }));
    } finally {
      process.env.PATH = previousPath;
      rmSync(tmp, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('does not detect an extensionless Veto file on Windows', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-veto-win-detect-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-veto-win-detect-'));
    const bin = join(tmp, 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(home, '.veto'), { recursive: true });
    writeFileSync(join(bin, 'veto'), '#!/bin/sh\n');

    const previousPath = process.env.PATH;
    const originalPlatform = process.platform;
    process.env.PATH = bin;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(collectInstallDetections(tmp, home).some((detection) => detection.provider === '.veto')).toBe(false);

      const windowsCommand = join(bin, 'veto.cmd');
      writeFileSync(windowsCommand, '@echo off\r\n');
      chmodSync(windowsCommand, 0o755);
      const detections = collectInstallDetections(tmp, home);
      expect(detections.find((detection) => detection.provider === '.veto')).toEqual(expect.objectContaining({
        foundPath: windowsCommand,
        reason: 'CLI on PATH',
      }));
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      process.env.PATH = previousPath;
      rmSync(tmp, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('installs Veto skills into its global managed directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-veto-install-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-veto-install-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.veto']);

    const output = run('install -y --providers=veto --scope=global --no-hooks', {
      cwd: tmp,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .veto (global)');
    expect(existsSync(join(home, '.veto', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

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
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(true);
    expect(existsSync(join(tmp, '.cursor', 'hooks.json'))).toBe(true);
    expect(existsSync(join(tmp, '.codex', 'hooks.json'))).toBe(true);
    // The CLI puts Codex's skill at `.agents/skills`, so the project-scope hook
    // command must point there — not at the bundle's own `.codex/skills` path,
    // which would resolve to a nonexistent file and silently no-op the hook.
    const codexHooks = readFileSync(join(tmp, '.codex', 'hooks.json'), 'utf8');
    expect(codexHooks).toContain('.agents/skills/impeccable/scripts/hook.mjs');
    expect(codexHooks).not.toContain('.codex/skills/impeccable/scripts/hook.mjs');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('installs Antigravity skills into .agent/ with --providers=antigravity', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-antigravity-install-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.agent']);

    const output = run('skills install -y --providers=antigravity --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Done!');

    const skillDir = join(tmp, '.agent', 'skills', 'impeccable');
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toContain('Local deterministic bundle for .agent.');
    expect(existsSync(join(skillDir, 'scripts', 'context.mjs'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('updates stale Antigravity skills at .agent/ from the local bundle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-antigravity-update-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.agent']);

    const skillDir = join(tmp, '.agent', 'skills', 'impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\nstale: true\n---\nOld content.\n');

    const output = run('skills update -y --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Updated');

    const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(content).not.toContain('stale: true');
    expect(content).toContain('version: 9.9.9-local');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('interactive install explains home detections and can target the project root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-interactive-project-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-interactive-project-'));
    execSync('git init', { cwd: tmp });
    for (const dir of ['.claude', '.codex', '.cursor', '.gemini']) {
      mkdirSync(join(home, dir), { recursive: true });
    }
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.agents', '.cursor', '.gemini']);

    const output = run('skills install --no-hooks', {
      cwd: tmp,
      input: '\nproject\n\n',
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Detected harnesses:');
    expect(output).toContain('Claude Code  ~/.claude');
    expect(output).toContain('~/.codex');
    expect(output).toContain('Install target: [1] Detected only (claude, codex, cursor, gemini)  [2] Customize [1]:');
    for (const provider of ['.claude', '.agents', '.cursor', '.gemini']) {
      expect(existsSync(join(tmp, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(false);
    }

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('interactive install can add providers beyond detected harnesses', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-interactive-add-more-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-interactive-add-more-'));
    execSync('git init', { cwd: tmp });
    mkdirSync(join(home, '.claude'), { recursive: true });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.agents']);

    const output = run('skills install --no-hooks', {
      cwd: tmp,
      input: '2\nclaude,codex\nproject\n\n',
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Install target: [1] Detected only (claude)  [2] Customize [1]:');
    expect(output).toContain('Select harnesses (comma-separated:');
    expect(output).toContain('Installed impeccable into: .claude, .agents (project)');
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmp, '.agents', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('interactive install defaults config-only home detections to project scope', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-interactive-config-only-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-interactive-config-only-'));
    execSync('git init', { cwd: tmp });
    for (const dir of ['.claude', '.codex', '.cursor', '.gemini']) {
      mkdirSync(join(home, dir), { recursive: true });
    }
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.agents', '.cursor', '.gemini']);

    const output = run('skills install --no-hooks', {
      cwd: tmp,
      input: '\n\n\n',
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .claude, .agents, .cursor, .gemini (project)');
    for (const provider of ['.claude', '.agents', '.cursor', '.gemini']) {
      expect(existsSync(join(tmp, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(false);
    }

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('interactive install defaults home detections with real skills to user scope', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-interactive-user-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-interactive-user-'));
    execSync('git init', { cwd: tmp });
    for (const dir of ['.claude', '.codex', '.cursor', '.gemini']) {
      mkdirSync(join(home, dir), { recursive: true });
    }
    writeSkill(home, '.claude', 'existing-user-skill');
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.agents', '.cursor', '.gemini']);

    const output = run('skills install --no-hooks', {
      cwd: tmp,
      input: '\n\n\n',
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .claude, .agents, .cursor, .gemini (global)');
    for (const provider of ['.claude', '.agents', '.cursor', '.gemini']) {
      expect(existsSync(join(home, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(tmp, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(false);
    }

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('Codex system/runtime-only skills do not count as real user skills', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-codex-system-skills-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-codex-system-skills-'));
    execSync('git init', { cwd: tmp });
    mkdirSync(join(home, '.codex', 'skills', 'codex-primary-runtime'), { recursive: true });
    mkdirSync(join(home, '.codex', 'skills', '.system', 'skill-creator'), { recursive: true });
    writeFileSync(join(home, '.codex', 'skills', '.system', 'skill-creator', 'SKILL.md'), '---\nname: skill-creator\n---\n');
    const bundleRoot = createFakeUniversalBundle(tmp, ['.agents']);

    const output = run('skills install --no-hooks', {
      cwd: tmp,
      input: '\n\n\n',
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Codex CLI');
    expect(output).toContain('Installed impeccable into: .agents (project)');
    expect(existsSync(join(tmp, '.agents', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.agents', 'skills', 'impeccable', 'SKILL.md'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('interactive install with no detections asks for providers directly', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-interactive-none-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-interactive-none-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.agents']);

    const output = run('skills install --no-hooks', {
      cwd: tmp,
      input: 'claude,codex\nproject\n\n',
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('No harnesses detected');
    expect(output).toContain('Select harnesses (comma-separated:');
    expect(output).toContain('Installed impeccable into: .claude, .agents (project)');
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmp, '.agents', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('--scope=global installs skills globally and project hooks point there', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-scope-user-hooks-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-scope-user-hooks-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.agents', '.cursor', '.grok']);

    const output = run('skills install -y --providers=claude,codex,cursor,grok --scope=global', {
      cwd: tmp,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .claude, .agents, .cursor, .grok (global)');
    for (const provider of ['.claude', '.agents', '.cursor', '.grok']) {
      expect(existsSync(join(home, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(tmp, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(false);
    }
    expect(readFileSync(join(tmp, '.claude', 'settings.local.json'), 'utf8')).toContain(join(home, '.claude', 'skills', 'impeccable', 'scripts', 'hook.mjs'));
    expect(readFileSync(join(tmp, '.codex', 'hooks.json'), 'utf8')).toContain(join(home, '.agents', 'skills', 'impeccable', 'scripts', 'hook.mjs'));
    expect(readFileSync(join(tmp, '.cursor', 'hooks.json'), 'utf8')).toContain(join(home, '.cursor', 'skills', 'impeccable', 'scripts', 'hook-before-edit.mjs'));
    const grokHooks = readFileSync(join(tmp, '.grok', 'hooks', 'impeccable.json'), 'utf8');
    expect(grokHooks).toContain(join(home, '.grok', 'skills', 'impeccable', 'scripts', 'hook.mjs'));
    expect(grokHooks).not.toContain('".grok/skills/impeccable/scripts/hook.mjs"');

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  // Pi discovers global skills from ~/.pi/agent/skills/, not ~/.pi/skills/ (#327).
  // Also covers the GLOBAL_HARNESS_HINTS detection: no --providers is passed, so
  // the ~/.pi dir alone must route the install to Pi's agent skills path.
  test('global install detects ~/.pi and writes Pi skills to ~/.pi/agent/skills', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-scope-user-pi-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-scope-user-pi-'));
    execSync('git init', { cwd: tmp });
    mkdirSync(join(home, '.pi'), { recursive: true });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.pi']);

    const output = run('skills install -y --scope=global --no-hooks', {
      cwd: tmp,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .pi (global)');
    expect(existsSync(join(home, '.pi', 'agent', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.pi', 'skills', 'impeccable'))).toBe(false);
    expect(existsSync(join(tmp, '.pi', 'skills', 'impeccable', 'SKILL.md'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  // OpenCode reads global skills from its config directory, not ~/.opencode:
  // $OPENCODE_CONFIG_DIR/skills, else $XDG_CONFIG_HOME/opencode/skills, else
  // ~/.config/opencode/skills. Writing to ~/.opencode/skills produced an
  // install `opencode debug skill` never saw (#406).
  test('global install writes OpenCode skills to ~/.config/opencode/skills (#406)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-scope-user-oc-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-scope-user-oc-'));
    execSync('git init', { cwd: tmp });
    mkdirSync(join(home, '.opencode'), { recursive: true });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete env.OPENCODE_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;

    const output = run('skills install -y --scope=global --no-hooks', { cwd: tmp, env });

    expect(output).toContain('Installed impeccable into: .opencode (global)');
    expect(existsSync(join(home, '.config', 'opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.opencode', 'skills', 'impeccable'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('OpenCode global dir honors OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME (#406)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-oc-env-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-oc-env-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const baseEnv = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete baseEnv.OPENCODE_CONFIG_DIR;
    delete baseEnv.XDG_CONFIG_HOME;

    run('skills install -y --providers=opencode --scope=global --no-hooks', {
      cwd: tmp,
      env: { ...baseEnv, OPENCODE_CONFIG_DIR: join(home, 'occfg') },
    });
    expect(existsSync(join(home, 'occfg', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    run('skills install -y --providers=opencode --scope=global --no-hooks', {
      cwd: tmp,
      env: { ...baseEnv, XDG_CONFIG_HOME: join(home, 'xdg') },
    });
    expect(existsSync(join(home, 'xdg', 'opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.opencode', 'skills', 'impeccable'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 20000);

  test('global OpenCode install migrates a legacy ~/.opencode/skills copy, sparing siblings (#406)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-oc-migrate-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-oc-migrate-'));
    execSync('git init', { cwd: tmp });
    writeSkill(home, '.opencode', 'impeccable');
    writeSkill(home, '.opencode', 'unrelated-skill');
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete env.OPENCODE_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;

    run('skills install -y --providers=opencode --scope=global --no-hooks', { cwd: tmp, env });

    expect(existsSync(join(home, '.config', 'opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    // The stranded legacy copy is gone; the sibling skill is untouched.
    expect(existsSync(join(home, '.opencode', 'skills', 'impeccable'))).toBe(false);
    expect(existsSync(join(home, '.opencode', 'skills', 'unrelated-skill', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('OpenCode migration never follows a symlinked legacy skills dir (#406)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-oc-symlink-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-oc-symlink-'));
    execSync('git init', { cwd: tmp });
    // Shared skill storage with ~/.opencode/skills symlinked at it. Deleting
    // "the legacy copy" through the link would destroy the shared original.
    writeSkill(join(home, '.config'), 'agents', 'impeccable');
    mkdirSync(join(home, '.opencode'), { recursive: true });
    symlinkSync(join(home, '.config', 'agents', 'skills'), join(home, '.opencode', 'skills'), 'dir');
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete env.OPENCODE_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;

    run('skills install -y --providers=opencode --scope=global --no-hooks', { cwd: tmp, env });

    expect(existsSync(join(home, '.config', 'opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    // The shared store behind the symlink is intact, link included.
    expect(existsSync(join(home, '.config', 'agents', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(lstatSync(join(home, '.opencode', 'skills')).isSymbolicLink()).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('OpenCode migration leaves a home-rooted repo project install alone (#406)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-oc-homerepo-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-oc-homerepo-'));
    execSync('git init', { cwd: tmp });
    // The home dir IS a repo (dotfiles setup): .opencode/skills there is a
    // live project-scope install, not a stranded pre-#406 global one.
    execSync('git init', { cwd: home });
    writeSkill(home, '.opencode', 'impeccable');
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete env.OPENCODE_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;

    run('skills install -y --providers=opencode --scope=global --no-hooks', { cwd: tmp, env });

    expect(existsSync(join(home, '.config', 'opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('global install detects OpenCode from ~/.config/opencode alone (#406)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-oc-detect-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-oc-detect-'));
    execSync('git init', { cwd: tmp });
    // No ~/.opencode at all; only the config dir marks OpenCode as present.
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete env.OPENCODE_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;

    const output = run('skills install -y --scope=global --no-hooks', { cwd: tmp, env });

    expect(output).toContain('Installed impeccable into: .opencode (global)');
    expect(existsSync(join(home, '.config', 'opencode', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 15000);

  // Project scope must stay at .pi/skills/ even when the git root IS the home
  // dir (dotfiles repos), where scope can't be inferred from the path alone.
  // An existing global install at ~/.pi/agent/skills must not swallow the
  // project-scope request into its already-installed refresh path.
  test('project-scope install keeps Pi skills in .pi/skills even for a home-rooted repo', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-home-rooted-project-pi-'));
    execSync('git init', { cwd: home });
    writeSkill(join(home, '.pi'), 'agent', 'impeccable');
    const bundleRoot = createFakeUniversalBundle(home, ['.pi']);

    const output = run('skills install -y --providers=pi --no-hooks', {
      cwd: home,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .pi (project)');
    expect(existsSync(join(home, '.pi', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    // The pre-existing global copy is untouched, not refreshed in place.
    expect(readFileSync(join(home, '.pi', 'agent', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('name: impeccable');
    expect(readFileSync(join(home, '.pi', 'agent', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).not.toContain('Local deterministic bundle');

    // An unscoped update from the same root must refresh BOTH Pi trees, not
    // just the first layout it finds.
    run('skills update -y --no-hooks', {
      cwd: home,
      env: { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(readFileSync(join(home, '.pi', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('Local deterministic bundle');
    expect(readFileSync(join(home, '.pi', 'agent', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('Local deterministic bundle');

    rmSync(home, { recursive: true, force: true });
  }, 15000);

  test('honors an existing hook in shared settings.json and never duplicates into settings.local.json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-local-shared-hook-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    // Simulate a user who moved (or whose legacy install left) the hook in the
    // team-shared settings.json.
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    writeFileSync(join(tmp, '.claude', 'settings.json'), JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
        { type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' },
      ] }] },
    }, null, 2));

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Done!');
    // The hook is honored in place: no local override is written, and the
    // shared file is left exactly as the user had it (one hook, no dupes).
    expect(output).not.toContain('Installed hooks into');
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(false);
    const shared = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'));
    expect(shared.hooks.PostToolUse).toHaveLength(1);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('prunes a stale local hook when the shared settings.json owns the hook', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-local-dedupe-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    mkdirSync(join(tmp, '.claude'), { recursive: true });

    // The team added the hook to shared settings.json...
    writeFileSync(join(tmp, '.claude', 'settings.json'), JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
        { type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' },
      ] }] },
    }, null, 2));
    // ...while a machine-local install already wrote the hook here, alongside
    // unrelated local settings that must survive.
    writeFileSync(join(tmp, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
        { type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' },
      ] }] },
    }, null, 2));

    run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    // Local duplicate is pruned (no hook left), unrelated settings preserved;
    // the shared file still owns the single hook.
    const local = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.local.json'), 'utf8'));
    expect(local.hooks).toBeUndefined();
    expect(local.permissions.allow).toContain('Bash(ls:*)');
    const shared = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'));
    expect(shared.hooks.PostToolUse).toHaveLength(1);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('recorded consent "declined" skips the hook (no prompt, no --no-hooks needed)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-consent-declined-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'config.local.json'),
      JSON.stringify({ hook: { consent: 'declined' } }));

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Installed impeccable into: .claude');
    expect(output).not.toContain('Installed hooks into');
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('recorded consent "accepted" installs the hook even non-interactively', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-consent-accepted-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'config.local.json'),
      JSON.stringify({ hook: { consent: 'accepted' } }));

    const output = run('skills install -y --providers=claude', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Installed hooks into: .claude');
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('--no-hooks records no consent decision (one-off skip)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-consent-nohooks-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    run('skills install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(existsSync(join(tmp, '.impeccable', 'config.local.json'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('does not opt into hooks when no provider targets are installed', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-consent-no-targets-'));
    execSync('git init', { cwd: tmp });

    const wantHooks = await decideHookInstall(tmp, [], { yes: true });

    expect(wantHooks).toBe(false);
    expect(existsSync(join(tmp, '.impeccable', 'config.local.json'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('--no-hooks installs skills without hook manifests', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-local-no-hooks-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp);

    const output = run('skills install -y --providers=claude,codex,cursor --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Done!');
    expect(output).not.toContain('Installed hooks into');
    for (const provider of ['.claude', '.agents', '.cursor']) {
      expect(existsSync(join(tmp, provider, 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(false);
    expect(existsSync(join(tmp, '.cursor', 'hooks.json'))).toBe(false);
    expect(existsSync(join(tmp, '.codex', 'hooks.json'))).toBe(false);

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
    expect(existsSync(join(tmp, '.claude', 'settings.local.json'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills update refreshes script-only bundle changes when SKILL.md is unchanged', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-script-only-update-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    run('skills install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    const scriptPath = join(tmp, '.claude', 'skills', 'impeccable', 'scripts', 'context.mjs');
    writeFileSync(scriptPath, 'console.log("old broken script");\n');

    const output = run('skills update -y --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Updated');
    expect(readFileSync(scriptPath, 'utf8')).toBe('console.log("local bundle context");\n');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('plain install refreshes an already-installed stale skill', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-existing-install-refresh-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);

    const skillDir = join(tmp, '.claude', 'skills', 'impeccable');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      readFileSync(join(bundleRoot, '.claude', 'skills', 'impeccable', 'SKILL.md'), 'utf8')
    );
    writeFileSync(join(skillDir, 'scripts', 'context.mjs'), 'console.log("old broken script");\n');

    const output = run('skills install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('already installed');
    expect(output).toContain('Updated');
    expect(readFileSync(join(skillDir, 'scripts', 'context.mjs'), 'utf8')).toBe('console.log("local bundle context");\n');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('plain install only refreshes selected copied providers', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-existing-install-scope-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.cursor']);

    for (const provider of ['.claude', '.cursor']) {
      const skillDir = join(tmp, provider, 'skills', 'impeccable');
      mkdirSync(join(skillDir, 'scripts'), { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: impeccable\nstale: ${provider}\n---\nOld content.\n`);
      writeFileSync(join(skillDir, 'scripts', 'context.mjs'), `console.log("old ${provider} script");\n`);
    }

    const output = run('skills install -y --providers=claude --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('already installed');
    expect(output).toContain('Updated');
    expect(readFileSync(join(tmp, '.claude', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('version: 9.9.9-local');
    expect(readFileSync(join(tmp, '.cursor', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('stale: .cursor');
    expect(readFileSync(join(tmp, '.cursor', 'skills', 'impeccable', 'scripts', 'context.mjs'), 'utf8')).toBe('console.log("old .cursor script");\n');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('explicit --providers installs a missing provider without --force (#500)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-explicit-missing-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.cursor']);

    // Seed an existing .claude install; .cursor has nothing yet.
    const skillDir = join(tmp, '.claude', 'skills', 'impeccable');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\nversion: 9.9.9-local\n---\nSeeded install.\n');

    const output = run('skills install -y --providers=cursor --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('Installed impeccable into: .cursor');
    expect(readFileSync(join(tmp, '.cursor', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('version: 9.9.9-local');
    // The unselected .claude install is left alone.
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toContain('Seeded install.');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('explicit --providers mixes per-target updates and fresh installs (#500)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-explicit-mixed-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude', '.cursor']);

    // Stale .claude install; .cursor has nothing yet.
    const skillDir = join(tmp, '.claude', 'skills', 'impeccable');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\nstale: .claude\n---\nOld content.\n');
    writeFileSync(join(skillDir, 'scripts', 'context.mjs'), 'console.log("old script");\n');

    const output = run('skills install -y --providers=claude,cursor', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });

    expect(output).toContain('already installed');
    expect(output).toContain('Updated');
    expect(output).toContain('Installed impeccable into: .cursor');
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toContain('version: 9.9.9-local');
    expect(readFileSync(join(tmp, '.cursor', 'skills', 'impeccable', 'SKILL.md'), 'utf8')).toContain('version: 9.9.9-local');
    // The freshly installed provider gets its hooks and agents too.
    expect(existsSync(join(tmp, '.cursor', 'hooks.json'))).toBe(true);
    expect(existsSync(join(tmp, '.cursor', 'agents', 'impeccable-finish-reviewer.md'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills update --no-hooks refreshes skills without touching malformed hook manifests', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-no-hooks-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.cursor']);

    run('skills install -y --providers=cursor --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    mkdirSync(join(tmp, '.cursor'), { recursive: true });
    writeFileSync(join(tmp, '.cursor', 'hooks.json'), '{ malformed');

    const output = run('skills update -y --no-hooks', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Skills are up to date');
    expect(readFileSync(join(tmp, '.cursor', 'hooks.json'), 'utf8')).toBe('{ malformed');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('reinstall backfills a missing OpenCode command bridge when skills are current', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-reinstall-backfill-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    run('skills install -y --providers=opencode --no-hooks', { cwd: tmp, env });
    const bridge = join(tmp, '.opencode', 'commands', 'impeccable.md');
    expect(existsSync(bridge)).toBe(true);
    rmSync(bridge);

    const output = run('skills install -y --providers=opencode --no-hooks', { cwd: tmp, env });
    expect(output).toContain('already installed');
    expect(existsSync(bridge)).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills update backfills a missing OpenCode command bridge when skills are current', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-backfill-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    run('skills install -y --providers=opencode --no-hooks', { cwd: tmp, env });
    const bridge = join(tmp, '.opencode', 'commands', 'impeccable.md');
    expect(existsSync(bridge)).toBe(true);
    rmSync(bridge);

    run('skills update -y --no-hooks', { cwd: tmp, env });
    expect(existsSync(bridge)).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills update restores a command bridge whose content drifted', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-drifted-bridge-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    run('skills install -y --providers=opencode --no-hooks', { cwd: tmp, env });
    const bridge = join(tmp, '.opencode', 'commands', 'impeccable.md');
    writeFileSync(bridge, 'user edit drift\n');

    run('skills update -y --no-hooks', { cwd: tmp, env });
    expect(readFileSync(bridge, 'utf8')).toContain('impeccable bridge');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills check from the home dir recognises a global OpenCode install as current', () => {
    // Bugbot scenario: `skills check` runs scope-less, so a home-rooted run
    // matches the GLOBAL skills dir via HOME_SKILLS_DIR_OVERRIDES. The command
    // bridge must be resolved next to that matched skills dir, not at
    // <home>/.opencode/commands. os.homedir() only honours HOME at process
    // start, so this must run through the CLI subprocess, not in-process.
    const home = mkdtempSync(join(tmpdir(), 'imp-test-check-home-'));
    execSync('git init', { cwd: home });
    const bundleRoot = createFakeUniversalBundle(home, ['.opencode']);
    const configHome = mkdtempSync(join(tmpdir(), 'imp-test-check-config-'));
    cpSync(join(bundleRoot, '.opencode', 'skills'), join(configHome, 'skills'), { recursive: true });
    cpSync(join(bundleRoot, '.opencode', 'commands'), join(configHome, 'commands'), { recursive: true });

    const output = run('skills check', {
      cwd: home,
      env: { ...process.env, HOME: home, OPENCODE_CONFIG_DIR: configHome, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    expect(output).toContain('Skills are up to date');

    rmSync(home, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }, 15000);

  test('skills update leaves an intact command bridge and pinned siblings alone', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-bridge-intact-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.opencode']);
    const env = { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    run('skills install -y --providers=opencode --no-hooks', { cwd: tmp, env });
    const bridge = join(tmp, '.opencode', 'commands', 'impeccable.md');
    const pinned = join(tmp, '.opencode', 'commands', 'impeccable-audit.md');
    writeFileSync(pinned, 'pinned by user\n');

    const output = run('skills update -y --no-hooks', { cwd: tmp, env });
    expect(output).toContain('Skills are up to date');
    expect(readFileSync(bridge, 'utf8')).toContain('impeccable bridge');
    expect(readFileSync(pinned, 'utf8')).toBe('pinned by user\n');

    rmSync(tmp, { recursive: true, force: true });
  }, 15000);

  test('skills update reports malformed hook manifests cleanly on the up-to-date path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-update-bad-hooks-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.cursor']);

    run('skills install -y --providers=cursor', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
    });
    writeFileSync(join(tmp, '.cursor', 'hooks.json'), '{ malformed');

    expect(() => run('skills update -y', {
      cwd: tmp,
      env: { ...process.env, IMPECCABLE_BUNDLE_PATH: bundleRoot },
      stdio: 'pipe',
    })).toThrow();

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

describe('hook manifest merge helpers', () => {
  test('mergeHookManifests refreshes fresh description and version while preserving third-party hooks', () => {
    const merged = mergeHookManifests(
      {
        version: 0,
        description: 'old description',
        hooks: {
          preToolUse: [
            { command: 'node third-party.mjs' },
            { command: 'node .cursor/skills/impeccable/scripts/hook-before-edit.mjs' },
          ],
        },
      },
      {
        version: 1,
        description: 'fresh description',
        hooks: {
          preToolUse: [
            { command: 'node .cursor/skills/impeccable/scripts/hook-before-edit.mjs' },
          ],
        },
      },
    );

    expect(merged.version).toBe(1);
    expect(merged.description).toBe('fresh description');
    expect(merged.hooks.preToolUse.map((entry) => entry.command)).toEqual([
      'node third-party.mjs',
      'node .cursor/skills/impeccable/scripts/hook-before-edit.mjs',
    ]);
  });

  test('mergeHookManifests replaces legacy Windows-path Claude hooks (#604)', () => {
    const legacyPath = 'C:\\Users\\alice\\.claude\\skills\\impeccable\\scripts\\hook.mjs';
    const legacyCommand = `[ ! -f "${legacyPath}" ] || node "${legacyPath}"`;
    const freshCommand = `node -e "guard" "${legacyPath}"`;
    const merged = mergeHookManifests(
      {
        hooks: {
          PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
            { type: 'command', command: legacyCommand },
          ] }],
          Stop: [{ hooks: [{ type: 'command', command: legacyCommand }] }],
        },
      },
      {
        hooks: {
          PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
            { type: 'command', command: freshCommand },
          ] }],
          Stop: [{ hooks: [{ type: 'command', command: freshCommand }] }],
        },
      },
    );

    expect(merged.hooks.PostToolUse).toHaveLength(1);
    expect(merged.hooks.Stop).toHaveLength(1);
    expect(merged.hooks.PostToolUse[0].hooks[0].command).toBe(freshCommand);
    expect(merged.hooks.Stop[0].hooks[0].command).toBe(freshCommand);
  });
});

// ─── Hook command path resolution (issue #399, part 1) ───────────────────────
// The bundled Claude manifest ships a ${CLAUDE_PROJECT_DIR}-relative command.
// That resolves per-project, so a user-level (~/.claude/settings.local.json)
// hook — which fires in EVERY project — must be rewritten to the resolved
// absolute skill path, or Node crashes on every PostToolUse/Stop in projects
// without a local skill copy. Project-level hooks keep ${CLAUDE_PROJECT_DIR}.
// Both are wrapped with a missing-file guard so a missing script exits 0.

// A bundle whose Claude manifest mirrors production: ${CLAUDE_PROJECT_DIR}-relative.
function createProjectDirBundle(root) {
  const bundleRoot = join(root, 'projdir-bundle');
  const skillDir = join(bundleRoot, '.claude', 'skills', 'impeccable', 'scripts');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(bundleRoot, '.claude', 'skills', 'impeccable', 'SKILL.md'),
    '---\nname: impeccable\nversion: 9.9.9-local\n---\nbundle\n');
  mkdirSync(join(bundleRoot, '.claude'), { recursive: true });
  writeFileSync(join(bundleRoot, '.claude', 'settings.json'), JSON.stringify({
    hooks: {
      PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [
        { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' },
      ] }],
      Stop: [{ hooks: [
        { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' },
      ] }],
    },
  }, null, 2));
  return bundleRoot;
}

function claudeHookCommands(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return Object.values(parsed.hooks).flatMap(entries =>
    entries.flatMap(entry => (entry.hooks || []).map(h => h.command)));
}

describe('copyProviderHooks: hook command path resolution (#399)', () => {
  test('project-scope hook keeps ${CLAUDE_PROJECT_DIR} and adds a missing-file guard', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-hook-project-'));
    const bundleDir = createProjectDirBundle(tmp);

    // skillRoot === root === a non-home project dir: keep the portable token.
    copyProviderHooks(bundleDir, tmp, ['.claude'], { skillRoot: tmp });

    const commands = claudeHookCommands(join(tmp, '.claude', 'settings.local.json'));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toContain('${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs');
      expect(command).not.toContain(tmp); // no absolute rewrite for project scope
      expect(command).toContain('[ ! -f '); // guarded so a missing file exits 0
      expect(command).not.toContain('|| true'); // must preserve node's exit code
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  // The user/global case (isHomeDir(root) true) is driven end-to-end through a
  // child process below ('user-level update writes an absolute, guarded hook'),
  // where HOME is set in the child's env so os.homedir() reflects it. It cannot
  // be faked reliably in-process, so it is not unit-tested here.

  test('project hook pointing at a global skill uses the absolute skill path', () => {
    // --scope=global shape: manifest root is the project, skill lives in home.
    const tmp = mkdtempSync(join(tmpdir(), 'imp-hook-split-'));
    const skillHome = mkdtempSync(join(tmpdir(), 'imp-hook-skillroot-'));
    const bundleDir = createProjectDirBundle(tmp);

    copyProviderHooks(bundleDir, tmp, ['.claude'], { skillRoot: skillHome });

    const commands = claudeHookCommands(join(tmp, '.claude', 'settings.local.json'));
    const absolute = join(skillHome, '.claude', 'skills', 'impeccable', 'scripts', 'hook.mjs');
    for (const command of commands) {
      expect(command).toContain(absolute);
      expect(command).not.toContain('${CLAUDE_PROJECT_DIR}');
      expect(command).toContain('[ ! -f ');
    }
    rmSync(tmp, { recursive: true, force: true });
    rmSync(skillHome, { recursive: true, force: true });
  });

  test('single-quotes an absolute install path that embeds $(...), and the guard is inert under /bin/sh (#476)', () => {
    // A hook command is re-executed by the harness on every edit. JSON.stringify
    // is not shell quoting: an install path containing $(...) inside double
    // quotes would run on each fire. The absolute POSIX form must be
    // single-quoted so the substitution stays inert.
    const tmp = mkdtempSync(join(tmpdir(), 'imp-hook-split-'));
    const skillHome = mkdtempSync(join(tmpdir(), 'imp-hook-$(touch pwned)-'));
    const bundleDir = createProjectDirBundle(tmp);

    copyProviderHooks(bundleDir, tmp, ['.claude'], { skillRoot: skillHome });

    const raw = readFileSync(join(tmp, '.claude', 'settings.local.json'), 'utf8');
    // The path appears single-quoted, never double-quoted (which would leave
    // the substitution live for /bin/sh).
    expect(raw).toContain(`'${skillHome}`);
    expect(raw).not.toContain(`"${skillHome}`);

    const commands = claudeHookCommands(join(tmp, '.claude', 'settings.local.json'));
    expect(commands.length).toBeGreaterThan(0);
    // End-to-end: actually run each generated guard under /bin/sh from a clean
    // cwd. The hook script does not exist (skillHome is empty), so `[ ! -f ... ]`
    // short-circuits and node never runs — and crucially the single-quoted
    // $(touch pwned) must not execute. Prove it: no `pwned` file appears and the
    // guard exits 0.
    if (process.platform !== 'win32') {
      const runCwd = mkdtempSync(join(tmpdir(), 'imp-hook-run-'));
      for (const command of commands) {
        expect(command).toContain('[ ! -f ');
        expect(command).not.toMatch(/"[^"]*\$\(touch pwned\)/);
        execFileSync('/bin/sh', ['-c', command], { cwd: runCwd, stdio: 'ignore' });
      }
      expect(existsSync(join(runCwd, 'pwned'))).toBe(false);
      rmSync(runCwd, { recursive: true, force: true });
    }
    rmSync(tmp, { recursive: true, force: true });
    rmSync(skillHome, { recursive: true, force: true });
  });

  test('the Windows hook form keeps a usable double-quoted absolute path (#533)', () => {
    // cmd.exe does no $(...) substitution but treats single quotes as literal,
    // so the Windows command form must keep the absolute path double-quoted or
    // a space in the install path would split the argument. copyProviderHooks
    // branches on process.platform, so drive it as win32 in-process.
    const original = process.platform;
    const tmp = mkdtempSync(join(tmpdir(), 'imp-hook-win-'));
    const skillHome = mkdtempSync(join(tmpdir(), 'imp-hook-win-home-'));
    const bundleDir = createProjectDirBundle(tmp);
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      copyProviderHooks(bundleDir, tmp, ['.claude'], { skillRoot: skillHome });
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }

    const absolute = join(skillHome, '.claude', 'skills', 'impeccable', 'scripts', 'hook.mjs');
    for (const command of claudeHookCommands(join(tmp, '.claude', 'settings.local.json'))) {
      // Windows guard shape (node -e wrapper) with the absolute path double-quoted.
      expect(command).toContain(`"${absolute}"`);
      expect(command).not.toContain(`'${absolute}`);
      expect(command).toContain('node -e');
    }
    rmSync(tmp, { recursive: true, force: true });
    rmSync(skillHome, { recursive: true, force: true });
  });
});

// ─── Update scope resolution (issue #399, part 2) ────────────────────────────

describe('skills update: names the resolved target and honors scope (#399)', () => {
  test('user-level update writes an absolute, guarded hook to ~/.claude', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-update-user-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-update-user-home-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    // Seed a user-level install (skills only), then update it with hooks.
    run('skills install -y --providers=claude --scope=global --no-hooks', { cwd: tmp, env });
    expect(existsSync(join(home, '.claude', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);

    const output = run('skills update -y --user', { cwd: tmp, env });
    expect(output).toContain('user level'); // scope named explicitly
    expect(output).toContain('~'); // resolved home path named, not a bare ".claude"

    const settingsPath = join(home, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);
    const raw = readFileSync(settingsPath, 'utf8');
    expect(raw).toContain(join(home, '.claude', 'skills', 'impeccable', 'scripts', 'hook.mjs'));
    expect(raw).not.toContain('${CLAUDE_PROJECT_DIR}');
    expect(raw).toContain('[ ! -f ');
    // The project dir was never touched.
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 20000);

  test('does not vendor impeccable into a repo that only tracks OTHER skills', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-update-vendor-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-update-vendor-home-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };

    // The repo tracks a first-party, NON-impeccable skill under .claude/skills.
    writeSkill(tmp, '.claude', 'house-brand');
    // A real user-level impeccable install exists.
    run('skills install -y --providers=claude --scope=global --no-hooks', { cwd: tmp, env });

    const output = run('skills update -y', { cwd: tmp, env });
    // Targets the user level, not the project's unrelated .claude/skills.
    expect(output).toContain('user level');
    expect(existsSync(join(tmp, '.claude', 'skills', 'impeccable'))).toBe(false);
    expect(existsSync(join(tmp, '.claude', 'skills', 'house-brand'))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 20000);

  test('--user with no user-level install reports the resolved user path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-update-nouser-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-update-nouser-home-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    const env = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    // Only a project install exists; --user must not fall through to it.
    run('skills install -y --providers=claude --no-hooks', { cwd: tmp, env });

    expect(() => run('skills update -y --user', { cwd: tmp, env, stdio: 'pipe' })).toThrow();

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 20000);
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

describe('hermesGlobalHome resolver (PR #521)', () => {
  // hermesGlobalHome was added in PR #521 to honor $HERMES_HOME for
  // profile-scoped installs. The original PR had a P1 bug at lines
  // 105-111 of cli/bin/commands/skills.mjs: it called `path.resolve` and
  // `path.sep` but the file only named-imports `resolve` and `sep` from
  // `node:path`. The ReferenceError was swallowed by the catch block, so
  // $HERMES_HOME was silently ignored and installs always landed in
  // ~/.hermes regardless of the active profile.
  //
  // These tests exercise the real implementation (via the export
  // added to the skills.mjs test surface), not a reimplementation.

  // The resolver is internal to skills.mjs. It reads $HERMES_HOME and
  // returns the home dir it should use for ~/.hermes/skills. We import
  // it via the public test surface — see the export block at the bottom
  // of skills.mjs.
  let hermesGlobalHome;

  beforeAll(async () => {
    // Dynamic import so the test can use the same surface as the
    // production code without forcing a re-export gymnastics on the
    // rest of the test file.
    const mod = await import('../cli/bin/commands/skills.mjs');
    hermesGlobalHome = mod.hermesGlobalHome;
  });

  test('default (no HERMES_HOME) returns <home>/.hermes', () => {
    // Use a fresh tmp HOME so the test never depends on the dev's real
    // ~/.hermes leaking through. The `delete env.HERMES_HOME` happens
    // in the caller; here we just verify the function honors an
    // explicitly-unset env (process.env is set per test below).
    const home = mkdtempSync(join(tmpdir(), 'imp-home-hermes-default-'));
    try {
      expect(hermesGlobalHome(home)).toBe(join(home, '.hermes'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('HERMES_HOME=<home>/.hermes is honored (default profile)', () => {
    const home = mkdtempSync(join(tmpdir(), 'imp-home-hermes-real-'));
    const prev = process.env.HERMES_HOME;
    process.env.HERMES_HOME = join(home, '.hermes');
    try {
      // The resolver returns $HERMES_HOME (resolved) when it lives
      // under the active home. Callers append 'skills'.
      expect(hermesGlobalHome(home)).toBe(join(home, '.hermes'));
    } finally {
      if (prev === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('HERMES_HOME=<home>/.hermes/profiles/forge is honored (active profile)', () => {
    // The whole point of the resolver: a Hermes invocation with
    // HERMES_HOME pointing at an active profile should install into
    // that profile's skills dir, not the default ~/.hermes. The
    // original bug had install/update/check landing in ~/.hermes for
    // every profile, which is the cross-profile data-corruption class
    // that hermes_constants.py's active_profile fallback warning is
    // designed to detect.
    const home = mkdtempSync(join(tmpdir(), 'imp-home-hermes-profile-'));
    const prev = process.env.HERMES_HOME;
    process.env.HERMES_HOME = join(home, '.hermes', 'profiles', 'forge');
    try {
      const resolved = hermesGlobalHome(home);
      expect(resolved).toBe(join(home, '.hermes', 'profiles', 'forge'));
      // And critically: it must NOT fall back to the default profile
      // when an active profile is selected.
      expect(resolved).not.toBe(join(home, '.hermes'));
    } finally {
      if (prev === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('HERMES_HOME outside the active home is ignored (cross-home leakage guard)', () => {
    // If the developer's shell has HERMES_HOME=/home/dev/.hermes and a
    // test runs under HOME=/tmp/imp-home-xxx, the resolver must NOT
    // pick up the dev's real ~/.hermes. Otherwise test output (and
    // potentially writes) leak into the developer's working state.
    // The cross-home guard turns the inherited HERMES_HOME into a
    // not-set, so the resolver falls back to <home>/.hermes.
    const home = mkdtempSync(join(tmpdir(), 'imp-home-hermes-xhome-'));
    const otherHome = mkdtempSync(join(tmpdir(), 'imp-home-hermes-xhome-other-'));
    const prev = process.env.HERMES_HOME;
    process.env.HERMES_HOME = join(otherHome, '.hermes', 'profiles', 'main');
    try {
      // HERMES_HOME is set but it doesn't sit under `home`, so the
      // resolver should treat it as not-set and return <home>/.hermes.
      expect(hermesGlobalHome(home)).toBe(join(home, '.hermes'));
    } finally {
      if (prev === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prev;
      rmSync(home, { recursive: true, force: true });
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  test('HOME_SKILLS_DIR_OVERRIDES[".hermes"] returns <HERMES_HOME>/skills under an active profile', async () => {
    // Integration check: the resolver is wired through the override
    // map, so this is what the install path actually consumes. The
    // import is cached across the suite (ESM module singleton), so
    // the same `hermesGlobalHome` from the unit tests above applies
    // here. We assert inside the async block so process.env is still
    // set when the override function reads it (the unit-test version
    // returns synchronously, but this one uses async import to share
    // the module reference).
    const home = mkdtempSync(join(tmpdir(), 'imp-home-hermes-override-'));
    const prev = process.env.HERMES_HOME;
    process.env.HERMES_HOME = join(home, '.hermes', 'profiles', 'savant');
    try {
      const mod = await import('../cli/bin/commands/skills.mjs');
      const override = mod.HOME_SKILLS_DIR_OVERRIDES['.hermes'];
      expect(override(home)).toBe(join(home, '.hermes', 'profiles', 'savant', 'skills'));
    } finally {
      if (prev === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('end-to-end: --scope=user --providers=hermes with HERMES_HOME=profile lands in the active profile', () => {
    // The full pipeline: drive the real CLI under a controlled HOME and
    // HERMES_HOME. This catches any regression that breaks the wiring
    // between hermesGlobalHome and the install path (e.g. if a future
    // refactor moves the override out of HOME_SKILLS_DIR_OVERRIDES, or
    // if copyProviderSkills stops reading from it).
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-hermes-e2e-'));
    const home = mkdtempSync(join(tmpdir(), 'imp-home-hermes-e2e-'));
    execSync('git init', { cwd: tmp });
    const bundleRoot = createFakeUniversalBundle(tmp, ['.hermes']);
    const baseEnv = { ...process.env, HOME: home, IMPECCABLE_BUNDLE_PATH: bundleRoot };
    delete baseEnv.HERMES_HOME;
    const profileDir = join(home, '.hermes', 'profiles', 'forge');
    const env = { ...baseEnv, HERMES_HOME: profileDir };

    run('skills install -y --providers=hermes --scope=user --no-hooks', { cwd: tmp, env });

    // Landed in the active profile, not the default ~/.hermes.
    expect(existsSync(join(profileDir, 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.hermes', 'skills', 'impeccable', 'SKILL.md'))).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }, 20000);
});

describe('downloadAndExtractBundle: safe staging dir (#479)', () => {
  test('local bundle uses mkdtemp under tmpdir with 0700 perms', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'imp-test-staging-'));
    const bundleRoot = createFakeUniversalBundle(tmp, ['.claude']);
    const prev = process.env.IMPECCABLE_BUNDLE_PATH;
    let stagingDir;
    try {
      process.env.IMPECCABLE_BUNDLE_PATH = bundleRoot;
      stagingDir = await downloadAndExtractBundle();

      expect(stagingDir.startsWith(tmpdir())).toBe(true);
      const basename = stagingDir.split(/[/\\]/).pop();
      expect(basename.startsWith('impeccable-local-bundle-')).toBe(true);
      expect(basename).not.toMatch(/^impeccable-local-bundle-\d+-\d+$/);

      if (process.platform !== 'win32') {
        expect(statSync(stagingDir).mode & 0o777).toBe(0o700);
      }

      expect(existsSync(join(stagingDir, '.claude', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.IMPECCABLE_BUNDLE_PATH;
      else process.env.IMPECCABLE_BUNDLE_PATH = prev;
      if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('downloadFile (#479)', () => {
  test('200 writes body to dest with wx flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async () => new Response('hello', { status: 200 });
      await downloadFile('https://example.com/file', dest, { fetchImpl });
      expect(readFileSync(dest, 'utf8')).toBe('hello');

      await expect(downloadFile('https://example.com/file', dest, { fetchImpl }))
        .rejects.toThrow();
      expect(readFileSync(dest, 'utf8')).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('404 throws and dest does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async () => new Response('not found', { status: 404 });
      await expect(downloadFile('https://example.com/missing', dest, { fetchImpl }))
        .rejects.toThrow(/HTTP 404/);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('redirect 302 to 200 follows location and writes second body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      let callCount = 0;
      const fetchImpl = async (url) => {
        callCount++;
        if (url === 'https://example.com/start') {
          return new Response('', { status: 302, headers: { location: 'https://example.com/final' } });
        }
        return new Response('final body', { status: 200 });
      };
      await downloadFile('https://example.com/start', dest, { fetchImpl });
      expect(callCount).toBe(2);
      expect(readFileSync(dest, 'utf8')).toBe('final body');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('redirect 302 to 404 throws and dest does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async (url) => {
        if (url.includes('/start')) {
          return new Response('', { status: 302, headers: { location: 'https://example.com/bad' } });
        }
        return new Response('error', { status: 404 });
      };
      await expect(downloadFile('https://example.com/start', dest, { fetchImpl }))
        .rejects.toThrow(/HTTP 404/);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('redirect to http throws non-HTTPS and dest does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async () => new Response('', { status: 302, headers: { location: 'http://example.com/insecure' } });
      await expect(downloadFile('https://example.com/start', dest, { fetchImpl }))
        .rejects.toThrow(/non-HTTPS/i);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('relative redirect location resolved against current URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async (url) => {
        if (url === 'https://example.com/api/start') {
          return new Response('', { status: 302, headers: { location: '/final' } });
        }
        expect(url).toBe('https://example.com/final');
        return new Response('ok', { status: 200 });
      };
      await downloadFile('https://example.com/api/start', dest, { fetchImpl });
      expect(readFileSync(dest, 'utf8')).toBe('ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('more than maxRedirects hops throws and dest does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async () => new Response('', { status: 302, headers: { location: 'https://example.com/loop' } });
      await expect(downloadFile('https://example.com/loop', dest, { fetchImpl }))
        .rejects.toThrow(/Too many redirects/);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fetchImpl rejection leaves dest absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      const fetchImpl = async () => { throw new Error('network down'); };
      await expect(downloadFile('https://example.com/file', dest, { fetchImpl }))
        .rejects.toThrow(/network down/);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('http initial URL throws without calling fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imp-dl-'));
    const dest = join(dir, 'out.bin');
    try {
      let called = false;
      const fetchImpl = async () => { called = true; return new Response('x', { status: 200 }); };
      await expect(downloadFile('http://example.com/file', dest, { fetchImpl }))
        .rejects.toThrow(/non-HTTPS/i);
      expect(called).toBe(false);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
