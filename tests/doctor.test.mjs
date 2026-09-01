/**
 * Tests for the deep staleness pass and the doctor CLI.
 * Run with: node --test tests/doctor.test.mjs
 *
 * The Tier 1 checks are covered in tests/staleness.test.mjs. This file covers
 * what only the deep pass does: git drift, ignore-list validation against the
 * rule registry, hook script resolution, the monorepo sweep, and the narrow set
 * of migrations `--fix` is allowed to perform.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { extractPlatform } from '../skill/scripts/context.mjs';
import { parseDesignMd } from '../skill/scripts/lib/design-parser.mjs';
import { checkNativePlatformEvidence } from '../skill/scripts/lib/staleness.mjs';
import {
  checkDesignCoverage,
  checkDesignDrift,
  checkDetectorIgnores,
  checkHookInstallation,
  checkLegacyLiveState,
  checkWorkspaces,
  loadKnownRuleIds,
} from '../skill/scripts/lib/staleness-deep.mjs';

const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'scripts');
const DOCTOR_PATH = path.join(SCRIPTS_DIR, 'doctor.mjs');

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-doctor-'));
});

afterEach(() => {
  // These tests run real git subprocesses in the scratch dir; on Node 22 a
  // recursive delete can race git's object writes and fail the whole test
  // with ENOTEMPTY (seen in CI). maxRetries/retryDelay make rmSync retry
  // exactly those transient errors.
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function write(rel, body) {
  const abs = path.join(scratch, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

function ids(findings) {
  return findings.map((entry) => entry.id);
}

function git(args, cwd = scratch) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function initRepo() {
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
}

function commit(message) {
  git(['add', '-A']);
  git(['commit', '-q', '--no-gpg-sign', '-m', message]);
}

const CURRENT_PRODUCT = [
  '# Product',
  '',
  '<!-- impeccable:product-schema 1 -->',
  '',
  '## Platform',
  '',
  'web',
  '',
  '## Positioning',
  'The only one that does the thing.',
  '',
].join('\n');

// ─── git drift ─────────────────────────────────────────────────────────────

describe('checkDesignDrift', () => {
  it('reports nothing outside a git repository', () => {
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    write('src/a.css', 'a{}');
    assert.deepEqual(checkDesignDrift({ designPath: design, projectRoot: scratch }), []);
  });

  it('reports nothing when UI commits stay under the threshold', () => {
    initRepo();
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    write('src/a.css', 'a{color:red}');
    commit('initial');
    for (let i = 0; i < 3; i++) {
      write(`src/f${i}.css`, `.f${i}{}`);
      commit(`ui ${i}`);
    }
    assert.deepEqual(checkDesignDrift({ designPath: design, projectRoot: scratch }), []);
  });

  it('reports the commit count once the threshold is crossed, framed as a proxy', () => {
    initRepo();
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    write('src/a.css', 'a{color:red}');
    commit('initial');
    for (let i = 0; i < 4; i++) {
      write(`src/f${i}.css`, `.f${i}{}`);
      commit(`ui ${i}`);
    }
    const findings = checkDesignDrift({ designPath: design, projectRoot: scratch, threshold: 3 });
    assert.deepEqual(ids(findings), ['design-md-drift']);
    assert.match(findings[0].summary, /4 commits have touched/);
    assert.match(findings[0].summary, /not that it is wrong/);
    assert.equal(findings[0].severity, 'route');
  });

  it('counts only commits after the last DESIGN.md edit', () => {
    initRepo();
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    write('src/a.css', 'a{}');
    commit('initial');
    for (let i = 0; i < 4; i++) {
      write(`src/old${i}.css`, `.o${i}{}`);
      commit(`old ui ${i}`);
    }
    fs.writeFileSync(design, '---\nname: X2\n---\n');
    commit('refresh design');
    assert.deepEqual(checkDesignDrift({ designPath: design, projectRoot: scratch, threshold: 3 }), []);
  });

  it('reports nothing for an untracked DESIGN.md', () => {
    initRepo();
    write('src/a.css', 'a{}');
    commit('initial');
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    assert.deepEqual(checkDesignDrift({ designPath: design, projectRoot: scratch, threshold: 1 }), []);
  });
});

// ─── DESIGN.md coverage ────────────────────────────────────────────────────

describe('checkDesignCoverage', () => {
  it('names the canonical sections that carry nothing', () => {
    const findings = checkDesignCoverage({
      design: '---\nname: X\n---\n\n# Design System: X\n\n## Overview\n\nSomething.\n',
      designPath: 'DESIGN.md',
      parseDesignMd,
    });
    assert.deepEqual(ids(findings), ['design-md-coverage']);
    assert.match(findings[0].summary, /colors, typography, components/);
    assert.equal(findings[0].severity, 'mention');
  });

  it('stays quiet when the sections are present', () => {
    const design = [
      '---', 'name: X', '---', '',
      '# Design System: X', '',
      '## Colors', '', '### Primary', '- **Ink** (#111): Text.', '',
      '## Typography', '', '**Body Font:** Inter', '',
      '### Hierarchy', '- **Body** (400, 16px, 1.5): Paragraphs.', '',
      '## Components', '', '### Button', '- Primary action.', '',
    ].join('\n');
    assert.deepEqual(checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd }), []);
  });

  it('allows Components to be absent from a marked seed document', () => {
    for (const command of ['/impeccable', '$impeccable']) {
      const design = [
        `<!-- SEED: established with the user before implementation; re-run ${command} document once there's code to capture the actual tokens and components. -->`,
        '',
        '# Design System: X',
        '',
        '## Colors', '', '### Primary', '- **Ink** (#111): Text.', '',
        '## Typography', '', '**Body Font:** Inter', '',
        '### Hierarchy', '- **Body** (400, 16px, 1.5): Paragraphs.', '',
      ].join('\n');
      assert.deepEqual(checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd }), []);
    }
  });

  it('still requires seed documents to cover Colors and Typography', () => {
    for (const command of ['/impeccable', '$impeccable']) {
      const design = [
        `<!-- SEED: established with the user before implementation; re-run ${command} document once there's code to capture the actual tokens and components. -->`,
        '',
        '# Design System: X',
        '',
        '## Typography', '', '**Body Font:** Inter', '',
        '### Hierarchy', '- **Body** (400, 16px, 1.5): Paragraphs.', '',
      ].join('\n');
      const findings = checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd });
      assert.deepEqual(ids(findings), ['design-md-coverage']);
      assert.match(findings[0].summary, /no colors section/);
      assert.doesNotMatch(findings[0].summary, /components/);
    }
  });

  it('counts machine-readable frontmatter as section coverage', () => {
    const design = [
      '---',
      'name: X',
      'colors:',
      '  ink: "#111111"',
      'typography:',
      '  body:',
      '    fontFamily: Inter',
      'components:',
      '  button:',
      '    backgroundColor: "{colors.ink}"',
      '---',
      '',
      '# Design System: X',
      '',
      'See the canonical source for prose guidance.',
      '',
    ].join('\n');
    assert.deepEqual(checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd }), []);
  });

  it('does not count empty frontmatter mappings as section coverage', () => {
    const design = [
      '---',
      'name: X',
      'colors:',
      'typography:',
      '  body:',
      '    fontFamily: Inter',
      'components:',
      '  button:',
      '    backgroundColor: "#111111"',
      '---',
      '',
      '# Design System: X',
      '',
    ].join('\n');
    const findings = checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd });
    assert.deepEqual(ids(findings), ['design-md-coverage']);
    assert.match(findings[0].summary, /no colors section/);
    assert.doesNotMatch(findings[0].summary, /typography|components/);
  });

  it('does not count boolean or numeric frontmatter scalars as section coverage', () => {
    for (const colors of ['false', '0']) {
      const design = [
        '---',
        'name: X',
        `colors: ${colors}`,
        'typography:',
        '  body:',
        '    fontFamily: Inter',
        'components:',
        '  button:',
        '    backgroundColor: "#111111"',
        '---',
        '',
        '# Design System: X',
        '',
      ].join('\n');
      const findings = checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd });
      assert.deepEqual(ids(findings), ['design-md-coverage']);
      assert.match(findings[0].summary, /no colors section/);
    }
  });

  it('does not count empty frontmatter collection literals as section coverage', () => {
    for (const colors of ['[]', '{}']) {
      const design = [
        '---',
        'name: X',
        `colors: ${colors}`,
        'typography:',
        '  body:',
        '    fontFamily: Inter',
        'components:',
        '  button:',
        '    backgroundColor: "#111111"',
        '---',
        '',
        '# Design System: X',
        '',
      ].join('\n');
      const findings = checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd });
      assert.deepEqual(ids(findings), ['design-md-coverage']);
      assert.match(findings[0].summary, /no colors section/);
    }
  });

  it('counts populated frontmatter array literals as section coverage', () => {
    const design = [
      '---',
      'name: X',
      'colors: ["#111111"]',
      'typography: [Inter]',
      'components: [button]',
      '---',
      '',
      '# Design System: X',
      '',
    ].join('\n');
    assert.deepEqual(checkDesignCoverage({ design, designPath: 'DESIGN.md', parseDesignMd }), []);
  });

  it('reports nothing without a DESIGN.md', () => {
    assert.deepEqual(checkDesignCoverage({ design: null, parseDesignMd }), []);
  });
});

// ─── detector ignore lists ─────────────────────────────────────────────────

describe('checkDetectorIgnores', () => {
  it('flags rule ids the engine does not have', () => {
    write('.impeccable/config.json', JSON.stringify({
      detector: { ignoreRules: ['side-tab', 'no-such-rule'] },
    }));
    const findings = checkDetectorIgnores({
      projectRoot: scratch,
      knownRuleIds: new Set(['side-tab']),
    });
    assert.deepEqual(ids(findings), ['detector-ignore-rules-unknown']);
    assert.match(findings[0].summary, /`no-such-rule`/);
    assert.doesNotMatch(findings[0].summary, /`side-tab`/);
  });

  it('skips validation entirely when the registry is unavailable', () => {
    write('.impeccable/config.json', JSON.stringify({ detector: { ignoreRules: ['whatever'] } }));
    assert.deepEqual(checkDetectorIgnores({ projectRoot: scratch, knownRuleIds: null }), []);
  });

  it('accepts the wildcard rule', () => {
    write('.impeccable/config.json', JSON.stringify({ detector: { ignoreRules: ['*'] } }));
    assert.deepEqual(
      checkDetectorIgnores({ projectRoot: scratch, knownRuleIds: new Set(['side-tab']) }),
      [],
    );
  });

  it('flags ignored files that no longer exist but leaves globs alone', () => {
    write('src/here.tsx', 'x');
    write('.impeccable/config.json', JSON.stringify({
      detector: { ignoreFiles: ['src/here.tsx', 'src/gone.tsx', 'src/**/*.stories.tsx'] },
    }));
    const findings = checkDetectorIgnores({ projectRoot: scratch });
    assert.deepEqual(ids(findings), ['detector-ignore-files-missing']);
    assert.match(findings[0].summary, /`src\/gone\.tsx`/);
    assert.doesNotMatch(findings[0].summary, /stories/);
  });

  it('resolves the real rule registry from the source checkout', async () => {
    const knownRuleIds = await loadKnownRuleIds(SCRIPTS_DIR);
    assert.ok(knownRuleIds instanceof Set, 'expected the bundled detector to resolve');
    assert.ok(knownRuleIds.size > 20, `expected many rule ids, got ${knownRuleIds.size}`);
    assert.ok(knownRuleIds.has('side-tab'));
  });
});

// ─── hook installation ─────────────────────────────────────────────────────

describe('checkHookInstallation', () => {
  it('flags an installed hook whose script path does not resolve', () => {
    write('.claude/settings.json', JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: 'node .claude/skills/impeccable/scripts/hook.mjs' }] }] },
    }));
    const findings = checkHookInstallation({
      projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code',
    });
    assert.deepEqual(ids(findings), ['hook-script-missing']);
    assert.match(findings[0].summary, /no-op/);
  });

  it('stays quiet when the hook script is present', () => {
    write('.claude/skills/impeccable/scripts/hook.mjs', '// hook\n');
    write('.claude/settings.json', JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: 'node .claude/skills/impeccable/scripts/hook.mjs' }] }] },
    }));
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
      [],
    );
  });

  it('flags an installed manifest contradicted by hook.enabled false', () => {
    write('.claude/skills/impeccable/scripts/hook.mjs', '// hook\n');
    write('.claude/settings.json', JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: 'node .claude/skills/impeccable/scripts/hook.mjs' }] }] },
    }));
    write('.impeccable/config.json', JSON.stringify({ hook: { enabled: false } }));
    const findings = checkHookInstallation({
      projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code',
    });
    assert.deepEqual(ids(findings), ['hook-enabled-conflict']);
  });

  it('reports nothing when no manifest installs the hook', () => {
    write('.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node other.mjs' }] }] } }));
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
      [],
    );
  });

  it('reports nothing for a provider with no known manifest', () => {
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'source' }),
      [],
    );
  });

  // The manifest `impeccable hooks on` actually writes, verbatim: a
  // `${CLAUDE_PROJECT_DIR}`-relative command. Claude Code expands the variable
  // to the project dir at hook time; the doctor must expand it the same way
  // (issue #402) instead of existsSync-ing the literal `${CLAUDE_PROJECT_DIR}/...`.
  const claudeManifest = () => ({
    hooks: {
      PostToolUse: [{
        matcher: 'Edit|Write|MultiEdit',
        hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' }],
      }],
      Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' }] }],
    },
  });

  it('stays quiet for a ${CLAUDE_PROJECT_DIR} manifest when the script exists at root', () => {
    write('.claude/skills/impeccable/scripts/hook.mjs', '// hook\n');
    write('.claude/settings.json', JSON.stringify(claudeManifest()));
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
      [],
    );
  });

  it('still flags a genuinely missing script behind ${CLAUDE_PROJECT_DIR}', () => {
    // Placeholder expands to a real path that does not exist: the check must
    // stay real, not neutered into always-quiet.
    write('.claude/settings.json', JSON.stringify(claudeManifest()));
    const findings = checkHookInstallation({
      projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code',
    });
    assert.deepEqual(ids(findings), ['hook-script-missing']);
  });

  it('handles the #399 guarded project-relative form', () => {
    const p = '"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"';
    const guarded = `[ ! -f ${p} ] || node ${p}`;
    write('.claude/settings.json', JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: guarded }] }] },
    }));
    // missing → flagged
    assert.deepEqual(
      ids(checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' })),
      ['hook-script-missing'],
    );
    // present → quiet
    write('.claude/skills/impeccable/scripts/hook.mjs', '// hook\n');
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
      [],
    );
  });

  it('handles the #399 guarded absolute form (user-level installs)', () => {
    const abs = path.join(scratch, '.claude', 'skills', 'impeccable', 'scripts', 'hook.mjs');
    const p = JSON.stringify(abs);
    const guarded = `[ ! -f ${p} ] || node ${p}`;
    write('.claude/settings.json', JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: guarded }] }] },
    }));
    // absolute path missing → flagged
    assert.deepEqual(
      ids(checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' })),
      ['hook-script-missing'],
    );
    // present → quiet
    write('.claude/skills/impeccable/scripts/hook.mjs', '// hook\n');
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
      [],
    );
  });

  it('handles the #476 single-quoted absolute form (user-level installs)', () => {
    // The shell-injection fix single-quotes the absolute POSIX path instead of
    // JSON.stringify. The doctor's token parser must read the single-quoted
    // form too, or it silently stops verifying every user-level install.
    const abs = path.join(scratch, '.claude', 'skills', 'impeccable', 'scripts', 'hook.mjs');
    const p = `'${abs}'`;
    const guarded = `[ ! -f ${p} ] || node ${p}`;
    write('.claude/settings.json', JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: guarded }] }] },
    }));
    // absolute path missing → flagged
    assert.deepEqual(
      ids(checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' })),
      ['hook-script-missing'],
    );
    // present → quiet
    write('.claude/skills/impeccable/scripts/hook.mjs', '// hook\n');
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
      [],
    );
  });

  it('never reports missing for the GitHub $(git rev-parse) form', () => {
    // Command substitution is not statically resolvable; a doctor must not
    // assert a negative it cannot verify.
    write('.github/hooks/impeccable.json', JSON.stringify({
      hooks: { postToolUse: [{ bash: 'node "$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/hook.mjs"' }] },
    }));
    assert.deepEqual(
      checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'github' }),
      [],
    );
  });

  it('never reports missing for plugin-root placeholders the doctor cannot map', () => {
    for (const token of ['${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}', '${GROK_PLUGIN_ROOT}']) {
      fs.rmSync(path.join(scratch, '.claude'), { recursive: true, force: true });
      write('.claude/settings.json', JSON.stringify({
        hooks: { Stop: [{ hooks: [{ command: `node "${token}/skills/impeccable/scripts/hook.mjs"` }] }] },
      }));
      assert.deepEqual(
        checkHookInstallation({ projectRoot: scratch, repoRoot: scratch, providerId: 'claude-code' }),
        [],
        `expected no finding for ${token}`,
      );
    }
  });
});

// ─── retired live-mode state ───────────────────────────────────────────────

describe('checkLegacyLiveState', () => {
  it('flags retired locations as automatic', () => {
    write('.impeccable-live.json', '{}');
    const findings = checkLegacyLiveState({ projectRoot: scratch });
    assert.deepEqual(ids(findings), ['legacy-live-state']);
    assert.equal(findings[0].severity, 'auto');
  });

  it('reports nothing on a current project', () => {
    assert.deepEqual(checkLegacyLiveState({ projectRoot: scratch }), []);
  });
});

// ─── monorepo sweep ────────────────────────────────────────────────────────

describe('checkWorkspaces', () => {
  function sweep(candidates) {
    return checkWorkspaces({
      repoRoot: scratch,
      candidates,
      checkNativePlatformEvidence,
      extractPlatform,
      readFile: (filePath) => {
        try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
      },
    });
  }

  it('flags a native workspace inheriting a web product record', () => {
    write('PRODUCT.md', CURRENT_PRODUCT);
    write('apps/mobile/ios/Podfile', '');
    const { findings } = sweep([
      { name: 'mobile', path: 'apps/mobile', productStatus: 'inherited', productPath: 'PRODUCT.md', designStatus: 'missing' },
    ]);
    assert.ok(ids(findings).includes('workspace-platform-native-evidence'));
    const entry = findings.find((f) => f.id === 'workspace-platform-native-evidence');
    assert.match(entry.summary, /inherits the repo-root PRODUCT\.md/);
    assert.match(entry.fix, /its own PRODUCT\.md/);
  });

  it('does not flag a workspace whose own record declares the native platform', () => {
    write('apps/mobile/PRODUCT.md', CURRENT_PRODUCT.replace('web', 'ios'));
    write('apps/mobile/ios/Podfile', '');
    const { findings } = sweep([
      { name: 'mobile', path: 'apps/mobile', productStatus: 'child', productPath: 'apps/mobile/PRODUCT.md', designStatus: 'missing' },
    ]);
    assert.deepEqual(ids(findings), []);
  });

  it('reports inheritance as information, not as a defect to fix', () => {
    write('PRODUCT.md', CURRENT_PRODUCT);
    const { findings, workspaces } = sweep([
      { name: 'web', path: 'apps/web', productStatus: 'inherited', productPath: 'PRODUCT.md', designStatus: 'missing' },
    ]);
    assert.deepEqual(ids(findings), ['workspace-context-inherited']);
    assert.match(findings[0].summary, /is not something this check can tell/);
    assert.equal(workspaces[0].platform, 'web');
  });

  it('returns an empty sweep with no candidates', () => {
    assert.deepEqual(checkWorkspaces({ repoRoot: scratch, candidates: [] }), { findings: [], workspaces: [] });
  });
});

// ─── the CLI ───────────────────────────────────────────────────────────────

describe('doctor CLI', () => {
  function run(args = [], cwd = scratch) {
    return spawnSync(process.execPath, [DOCTOR_PATH, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
  }

  it('reports a clean project and exits zero', () => {
    write('PRODUCT.md', CURRENT_PRODUCT);
    const res = run();
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /No drift found/);
  });

  it('groups findings by severity in JSON mode', () => {
    write('PRODUCT.md', '# Product\n\n## Register\n\nbrand\n\n## Users\nDesigners.\n');
    const res = run(['--json']);
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.ok(report.findings.some((entry) => entry.id === 'product-deprecated-register'));
    assert.ok(report.findings.some((entry) => entry.id === 'product-schema-legacy'));
    for (const entry of report.findings) {
      assert.ok(['auto', 'mention', 'route'].includes(entry.severity), entry.severity);
      assert.ok(entry.summary && entry.fix, entry.id);
    }
    assert.equal(report.ruleRegistryAvailable, true);
  });

  it('keeps boot and deep findings in their established artifact order', () => {
    write('PRODUCT.md', '# Product\n\n## Register\n\nbrand\n\n## Users\nDesigners.\n');
    write('DESIGN.md', '---\nname: Example\n---\n\n# Design System: Example\n');
    write('.impeccable/design.json', JSON.stringify({ schemaVersion: 1 }));
    write('.impeccable/config.json', JSON.stringify({ unknownSetting: true }));

    const res = run(['--json']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(
      JSON.parse(res.stdout).findings.map((entry) => entry.id),
      [
        'product-deprecated-register',
        'product-schema-legacy',
        'design-sidecar-schema-outdated',
        'design-md-coverage',
        'config-unknown-keys',
      ],
    );
  });

  it('applies only the automatic migrations under --fix', () => {
    write('PRODUCT.md', CURRENT_PRODUCT.replace('<!-- impeccable:product-schema 1 -->\n\n', ''));
    write('DESIGN.json', JSON.stringify({ schemaVersion: 2 }));
    const res = run(['--fix']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Moved DESIGN\.json to \.impeccable\/design\.json/);
    assert.match(res.stdout, /Stamped PRODUCT\.md/);
    assert.ok(fs.existsSync(path.join(scratch, '.impeccable', 'design.json')));
    assert.ok(!fs.existsSync(path.join(scratch, 'DESIGN.json')));
    assert.match(fs.readFileSync(path.join(scratch, 'PRODUCT.md'), 'utf8'), /impeccable:product-schema 1/);
  });

  it('leaves a legacy sidecar alone when the canonical one already exists', () => {
    write('PRODUCT.md', CURRENT_PRODUCT);
    write('DESIGN.json', JSON.stringify({ schemaVersion: 2, title: 'legacy' }));
    write('.impeccable/design.json', JSON.stringify({ schemaVersion: 2, title: 'current' }));
    const res = run(['--fix', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.equal(report.fixes.applied.length, 0);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(scratch, '.impeccable', 'design.json'), 'utf8')).title,
      'current',
    );
    assert.ok(fs.existsSync(path.join(scratch, 'DESIGN.json')));
  });

  it('does not stamp a PRODUCT.md that init should rewrite instead', () => {
    write('PRODUCT.md', '# Product\n\n## Users\nDesigners.\n');
    const res = run(['--fix']);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(fs.readFileSync(path.join(scratch, 'PRODUCT.md'), 'utf8'), /product-schema/);
    assert.match(res.stdout, /product-schema-legacy/);
  });

  it('lists workspaces and their context resolution in a monorepo', () => {
    write('package.json', JSON.stringify({ name: 'root', workspaces: ['apps/*'] }));
    write('PRODUCT.md', CURRENT_PRODUCT);
    write('apps/web/package.json', JSON.stringify({ name: 'web' }));
    write('apps/mobile/package.json', JSON.stringify({ name: 'mobile', dependencies: { 'react-native': '0.74' } }));
    write('apps/mobile/ios/Podfile', '');
    const res = run(['--json']);
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.equal(report.isMonorepo, true);
    assert.deepEqual(report.workspaces.map((entry) => entry.path).sort(), ['apps/mobile', 'apps/web']);
    assert.ok(report.findings.some((entry) => entry.id === 'workspace-platform-native-evidence'));
  });

  it('prints usage for --help without running any check', () => {
    const res = run(['--help']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Usage: node doctor\.mjs/);
    assert.doesNotMatch(res.stdout, /No drift found/);
  });

  it('rejects a malformed target argument', () => {
    const res = run(['--target']);
    assert.notEqual(res.status, 0);
  });
});
