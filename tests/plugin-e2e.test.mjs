/**
 * Plugin loader E2E: install the committed ./plugin subtree into a real
 * Claude Code and assert every shipped component actually loads. Part of the
 * default suite; the only external requirement is the claude CLI, and the
 * suite skips cleanly when it is not on PATH.
 *
 * The unit-level shape guard (tests/validate-plugin-manifest.test.js) pins the
 * loader contract we KNOW about. This suite is the only thing that catches the
 * contract being wrong: the `agents` manifest key shipped for months and loaded
 * zero of the four subagents (PR #494), `claude plugin validate` never flagged
 * it, and earlier releases had SKILL.md frontmatter that failed to parse. All
 * of those are invisible until the real loader reports its component
 * inventory, which is exactly what this suite asserts on.
 *
 * Isolation: every claude invocation runs with CLAUDE_CONFIG_DIR, HOME, and
 * USERPROFILE all pointed into a fresh temp dir, so the developer's real
 * config, marketplaces, and installed plugins are never touched even if the
 * CLI derives a path from the home directory rather than CLAUDE_CONFIG_DIR.
 * Requires the `claude` CLI on PATH; skips cleanly otherwise.
 *
 * The subtree under test is whatever git holds at ./plugin, which the sync
 * workflow regenerates on main (`bun run build:release`). Between the launcher
 * swap landing and that sync, ./plugin still ships the Node-era scripts; the
 * loader inventory asserted here is unaffected either way (the launcher layout
 * was verified against a local `bun run build:release` before the swap
 * merged), and tests/hook-build.test.mjs gates its launcher-path assertions on
 * the synced output.
 *
 * Run with: bun run test:plugin-e2e
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(REPO_ROOT, 'plugin');
const MARKETPLACE_NAME = 'impeccable-e2e';
const PLUGIN_REF = `impeccable@${MARKETPLACE_NAME}`;

// On Windows the claude CLI is a .cmd shim, which Node refuses to spawn
// without a shell, so commands there go through one with every argument
// double-quoted (paths under %TEMP% routinely contain spaces). Elsewhere
// execFileSync runs the binary directly with no quoting concerns.
const IS_WINDOWS = process.platform === 'win32';
const quoteForCmd = (arg) => `"${String(arg).replace(/"/g, '""')}"`;
const runClaude = (args, opts) =>
  IS_WINDOWS
    ? execSync(['claude', ...args.map(quoteForCmd)].join(' '), opts)
    : execFileSync('claude', args, opts);

const claudeAvailable = (() => {
  try {
    runClaude(['--version'], { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
})();

const skip = claudeAvailable ? false : 'claude CLI not on PATH; install Claude Code to run the plugin E2E suite';

describe('committed plugin subtree loads in a real Claude Code', { skip }, () => {
  let workDir;
  let configDir;
  let detailsOutput;

  const claude = (...args) =>
    runClaude(args, {
      encoding: 'utf-8',
      timeout: 120000,
      // Neutral cwd so the repo's own .claude/ project config cannot leak in.
      cwd: workDir,
      // Belt and suspenders: CLAUDE_CONFIG_DIR is the documented isolation
      // switch, but any path the CLI derives from the home directory instead
      // must also land in the sandbox, so HOME/USERPROFILE point there too.
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        HOME: workDir,
        USERPROFILE: workDir,
      },
    });

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-plugin-e2e-'));
    configDir = path.join(workDir, 'claude-config');
    fs.mkdirSync(configDir, { recursive: true });
    const marketplaceDir = path.join(workDir, 'marketplace');
    fs.mkdirSync(path.join(marketplaceDir, '.claude-plugin'), { recursive: true });
    fs.cpSync(PLUGIN_DIR, path.join(marketplaceDir, 'impeccable'), { recursive: true });
    fs.writeFileSync(
      path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: MARKETPLACE_NAME,
        owner: { name: 'impeccable plugin E2E' },
        plugins: [
          { name: 'impeccable', source: './impeccable', description: 'committed ./plugin subtree' },
        ],
      }, null, 2),
    );

    claude('plugin', 'marketplace', 'add', marketplaceDir);
    claude('plugin', 'install', PLUGIN_REF);
    detailsOutput = claude('plugin', 'details', PLUGIN_REF);
  });

  after(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  // `claude plugin details` prints "Skills (N)  name, name" lines; long name
  // lists wrap, so counts come from the header and names are matched anywhere.
  const componentCount = (component) => {
    const match = detailsOutput.match(new RegExp(`${component}\\s+\\((\\d+)\\)`));
    assert.ok(match, `component inventory has no "${component} (N)" line:\n${detailsOutput}`);
    return Number(match[1]);
  };

  it('reports the plugin as installed rather than silently absent', () => {
    // A manifest the loader rejects surfaces as "Plugin not found" here, with
    // no validation error anywhere else. Reaching this assertion at all means
    // the details call above did not throw.
    assert.match(detailsOutput, /Component inventory/);
  });

  it('parses and loads the impeccable skill', () => {
    assert.equal(componentCount('Skills'), 1);
    assert.match(detailsOutput, /Skills\s+\(1\)\s+impeccable/);
  });

  it('loads every shipped agent via auto-discovery (PR #494 regression)', () => {
    const shipped = fs.readdirSync(path.join(PLUGIN_DIR, 'agents'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/, ''));
    assert.ok(shipped.length > 0, 'plugin/agents/ ships no agent files');
    assert.equal(componentCount('Agents'), shipped.length);
    for (const name of shipped) {
      assert.ok(detailsOutput.includes(name), `agent "${name}" missing from inventory`);
    }
  });

  it('discovers the packaged hooks', () => {
    assert.equal(componentCount('Hooks'), 2);
    assert.match(detailsOutput, /PostToolUse/);
    assert.match(detailsOutput, /Stop/);
  });
});
