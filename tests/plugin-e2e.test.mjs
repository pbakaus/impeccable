/**
 * Opt-in E2E: install the committed ./plugin subtree into a real Claude Code
 * and assert every shipped component actually loads.
 *
 * The unit-level shape guard (tests/validate-plugin-manifest.test.js) pins the
 * loader contract we KNOW about. This suite is the only thing that catches the
 * contract being wrong: the `agents` manifest key shipped for months and loaded
 * zero of the four subagents (PR #494), `claude plugin validate` never flagged
 * it, and earlier releases had SKILL.md frontmatter that failed to parse. All
 * of those are invisible until the real loader reports its component
 * inventory, which is exactly what this suite asserts on.
 *
 * Isolation: every claude invocation runs with CLAUDE_CONFIG_DIR pointed at a
 * fresh temp dir, so the developer's real config, marketplaces, and installed
 * plugins are never touched. Requires the `claude` CLI on PATH; skips cleanly
 * otherwise.
 *
 * Run with: bun run test:plugin-e2e
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(REPO_ROOT, 'plugin');
const MARKETPLACE_NAME = 'impeccable-e2e';
const PLUGIN_REF = `impeccable@${MARKETPLACE_NAME}`;

const claudeAvailable = (() => {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 30000 });
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
    execFileSync('claude', args, {
      encoding: 'utf-8',
      timeout: 120000,
      // Neutral cwd so the repo's own .claude/ project config cannot leak in.
      cwd: workDir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-plugin-e2e-'));
    configDir = path.join(workDir, 'claude-config');
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
