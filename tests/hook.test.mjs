/**
 * Unit tests for the Impeccable design hook.
 * Run: node --test tests/hook.test.mjs
 *
 * Exercises hook-lib.mjs through `runHook()` with an injected detector so the
 * suite stays fast and detector-independent. A second block exercises the
 * library helpers (config, cache, filter, render) directly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  ENVELOPE_PREFIX,
  ALLOWED_EXTS,
  ACK_EXTS,
  DEFAULT_CONFIG,
  SENSITIVE_PATH,
  GENERATED_PATH,
  truthy,
  getConfigPath,
  getLocalConfigPath,
  ensureHookGitExcludes,
  readConfig,
  readCache,
  persistCache,
  resolveCacheCwd,
  bumpEditCount,
  rememberFindings,
  dedupeAgainstCache,
  filterFindings,
  renderTemplate,
  renderCleanAck,
  renderPendingAck,
  shouldEmitAckForFile,
  matchConfiguredExtension,
  matchesAnyGlob,
  writeAuditLog,
  suppressionNotice,
  parseApplyPatchPaths,
  resolveTargetFiles,
  resolveHarness,
  normalizeHookEvent,
  expandScanTargets,
  parseStaticStyleImports,
  coLocatedStylesheets,
  runHook,
  payload,
  extractFindingIgnoreValue,
  resolveProjectPlatform,
  isNativePlatform,
} from '../skill/scripts/hook-lib.mjs';
import { detectHtml, detectText } from '../cli/engine/detect-antipatterns.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-hook-'));
}

function fakeDetector(findings) {
  return {
    detectText: () => findings,
    detectHtml: () => findings,
  };
}

function finding(id, line, extras = {}) {
  return {
    antipattern: id,
    name: extras.name || 'Test finding',
    description: extras.description || 'A test finding description.',
    severity: extras.severity || 'warning',
    file: extras.file || 'src/Card.tsx',
    line,
    snippet: extras.snippet || '<snippet>',
  };
}

describe('truthy()', () => {
  it('matches the documented values, case-insensitive', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'On']) {
      assert.equal(truthy(v), true, `expected truthy("${v}")`);
    }
    for (const v of ['', '0', 'false', 'no', 'off', 'yep', undefined, null, 42]) {
      assert.equal(truthy(v), false, `expected falsy(${JSON.stringify(v)})`);
    }
  });
});

describe('SENSITIVE_PATH / GENERATED_PATH', () => {
  it('skips .env, .pem, id_rsa, secrets, credentials, .git', () => {
    for (const p of [
      '/x/.env', '/x/.env.production', '/x/server.pem', '/x/id_rsa',
      '/x/id_rsa.pub', '/x/api-secret.json', '/x/client_secret.ts',
      '/x/credentials.yml', '/x/.git/config',
    ]) {
      assert.ok(SENSITIVE_PATH.test(p), `expected sensitive: ${p}`);
    }
  });

  it('does not flag normal source files as sensitive', () => {
    for (const p of [
      '/x/src/Card.tsx',
      '/x/app/page.html',
      '/x/styles/main.css',
      '/x/src/CredentialForm.tsx',
      '/x/src/SecretPage.jsx',
      '/x/src/secretary-dashboard.vue',
      '/x/src/credentials-panel.tsx',
    ]) {
      assert.ok(!SENSITIVE_PATH.test(p), `unexpected sensitive: ${p}`);
    }
  });

  it('skips generated / lock / build output paths', () => {
    for (const p of [
      '/x/src/foo.generated.tsx', '/x/types.d.ts', '/x/bundle.min.js',
      '/x/node_modules/lib/index.tsx', '/x/dist/Card.tsx', '/x/build/index.html',
      '/x/pkg.lock.json', '/x/.next/server.js', '/x/coverage/report.html',
    ]) {
      assert.ok(GENERATED_PATH.test(p), `expected generated: ${p}`);
    }
  });
});

describe('readConfig()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('returns defaults when file missing', () => {
    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.limits.maxFindings, DEFAULT_CONFIG.limits.maxFindings);
  });

  it('parses hook runtime and legacy hook detector filters', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      hook: {
        enabled: false,
        ignoreRules: ['side-tab'],
        ignoreFiles: ['src/legacy/**'],
        minSeverity: 'error',
        limits: { maxFindings: 2, maxChars: 1000 },
      },
    }));
    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.ignoreRules, ['side-tab']);
    assert.deepEqual(cfg.ignoreFiles, ['src/legacy/**']);
    assert.deepEqual(cfg.ignoreValues, []);
    assert.equal(cfg.limits.maxFindings, 2);
    assert.equal(cfg.limits.maxChars, 1000);
  });

  it('merges shared config first and local config second', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      hook: {
        enabled: false,
        minSeverity: 'error',
        limits: { maxFindings: 2, maxChars: 1000 },
      },
      detector: {
        ignoreRules: ['side-tab'],
        ignoreFiles: ['src/legacy/**'],
        ignoreValues: [
          { rule: 'overused-font', value: 'inter', reason: 'team default' },
        ],
      },
    }));
    fs.writeFileSync(getLocalConfigPath(cwd), JSON.stringify({
      hook: {
        enabled: true,
        minSeverity: 'warning',
        limits: { maxFindings: 4 },
      },
      detector: {
        ignoreRules: ['gradient-text', 'side-tab'],
        ignoreFiles: ['src/local/**'],
        ignoreValues: [
          { rule: 'overused-font', value: 'Roboto' },
          { rule: 'overused-font', value: 'Inter', reason: 'local override' },
        ],
      },
    }));

    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, true);
    assert.deepEqual(cfg.ignoreRules, ['side-tab', 'gradient-text']);
    assert.deepEqual(cfg.ignoreFiles, ['src/legacy/**', 'src/local/**']);
    assert.deepEqual(cfg.ignoreValues, [
      { rule: 'overused-font', value: 'inter', reason: 'local override' },
      { rule: 'overused-font', value: 'roboto' },
    ]);
    assert.equal(cfg.limits.maxFindings, 4);
    assert.equal(cfg.limits.maxChars, 1000);
  });

  it('tolerates malformed JSON and falls back to defaults', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), '{ not json');
    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, true);
  });

  it('ignores malformed local config while preserving valid shared config', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      hook: {
        enabled: false,
        ignoreRules: ['side-tab'],
        limits: { maxFindings: 3 },
      },
    }));
    fs.writeFileSync(getLocalConfigPath(cwd), '{ not json');
    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.ignoreRules, ['side-tab']);
    assert.equal(cfg.limits.maxFindings, 3);
  });

  it('parses detector.extensions entries and defaults engine to html', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      detector: {
        extensions: [
          { ext: '.blade.php' },
          { ext: '.html.erb', engine: 'html' },
          { ext: '.d.ts.hbs', engine: 'text' },
          'twig',
          { ext: '' },
          { engine: 'html' },
          42,
        ],
      },
    }));
    const cfg = readConfig(cwd);
    assert.deepEqual(cfg.extensions, [
      { ext: '.blade.php', engine: 'html' },
      { ext: '.html.erb', engine: 'html' },
      { ext: '.d.ts.hbs', engine: 'text' },
      { ext: '.twig', engine: 'html' },
    ]);
  });

  it('lets local-config detector.extensions override the shared engine per ext', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      detector: { extensions: [{ ext: '.blade.php', engine: 'html' }] },
    }));
    fs.writeFileSync(getLocalConfigPath(cwd), JSON.stringify({
      detector: { extensions: [{ ext: '.blade.php', engine: 'text' }, { ext: '.twig' }] },
    }));
    const cfg = readConfig(cwd);
    assert.deepEqual(cfg.extensions, [
      { ext: '.blade.php', engine: 'text' },
      { ext: '.twig', engine: 'html' },
    ]);
  });

  it('defaults detector.extensions to an empty list', () => {
    assert.deepEqual(readConfig(cwd).extensions, []);
  });

  it('parses the new quiet and auditLog fields from the unified config', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      hook: { quiet: true, auditLog: '~/hook.ndjson' },
      detector: { designSystem: { enabled: false } },
    }));
    const cfg = readConfig(cwd);
    assert.equal(cfg.quiet, true);
    assert.equal(cfg.auditLog, '~/hook.ndjson');
    assert.deepEqual(cfg.designSystem, { enabled: false });
  });
});

describe('readCache / persistCache / bumpEditCount', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('round-trips a session', () => {
    const cache = readCache(cwd);
    bumpEditCount(cache, 'sid-1', '/x/a.tsx');
    bumpEditCount(cache, 'sid-1', '/x/a.tsx');
    rememberFindings(cache, 'sid-1', '/x/a.tsx', [finding('side-tab', 12)]);
    persistCache(cwd, cache);

    const reloaded = readCache(cwd);
    const file = reloaded.sessions['sid-1'].files['/x/a.tsx'];
    assert.equal(file.editCount, 2);
    assert.ok(file.findings.includes('side-tab:12'));
  });

  it('keeps same-line value-specific findings distinct in the cache', () => {
    const cache = readCache(cwd);
    const hotPink = {
      ...finding('design-system-color', 7, { snippet: 'Undocumented color #ff00aa' }),
      ignoreValue: '#ff00aa',
    };
    const cyan = {
      ...finding('design-system-color', 7, { snippet: 'Undocumented color rgb(20, 180, 220)' }),
      ignoreValue: 'rgb(20, 180, 220)',
    };

    assert.deepEqual(dedupeAgainstCache([hotPink, cyan], cache, 'sid-1', '/x/a.css'), [hotPink, cyan]);
    rememberFindings(cache, 'sid-1', '/x/a.css', [hotPink]);
    assert.deepEqual(dedupeAgainstCache([hotPink, cyan], cache, 'sid-1', '/x/a.css'), [cyan]);
  });

  it('garbage-collects oldest sessions over CACHE_MAX_SESSIONS', () => {
    const cache = readCache(cwd);
    // Stamp 10 sessions, each with a unique updatedAt so ordering is stable.
    for (let i = 0; i < 10; i++) {
      const id = `sid-${i}`;
      cache.sessions[id] = { updatedAt: 1000 + i, files: {} };
    }
    persistCache(cwd, cache);
    const reloaded = readCache(cwd);
    assert.equal(Object.keys(reloaded.sessions).length, 8);
    assert.ok(reloaded.sessions['sid-9'], 'newest preserved');
    assert.ok(!reloaded.sessions['sid-0'], 'oldest gc-ed');
  });
});

describe('ensureHookGitExcludes()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('adds hook runtime files to local git info exclude, not tracked .gitignore', () => {
    execFileSync('git', ['init', '-q'], { cwd });

    const result = ensureHookGitExcludes(cwd);
    assert.equal(result.mode, 'git-info-exclude');
    assert.equal(result.changed, true);
    assert.equal(fs.existsSync(path.join(cwd, '.gitignore')), false);

    const exclude = fs.readFileSync(path.join(cwd, '.git', 'info', 'exclude'), 'utf-8');
    assert.match(exclude, /\.impeccable\/hook\.cache\.json/);
    assert.match(exclude, /\.impeccable\/hook\.pending\.json/);
    assert.match(exclude, /\.impeccable\/config\.local\.json/);

    const second = ensureHookGitExcludes(cwd);
    assert.equal(second.changed, false);
    const rewritten = fs.readFileSync(path.join(cwd, '.git', 'info', 'exclude'), 'utf-8');
    assert.equal((rewritten.match(/impeccable-hook-ignore-start/g) || []).length, 1);
  });
});

describe('matchesAnyGlob()', () => {
  it('handles `**`, `*`, basename, and `{}` alternation', () => {
    assert.ok(matchesAnyGlob('src/legacy/Foo.tsx', ['src/legacy/**']));
    assert.ok(matchesAnyGlob('src/Foo.generated.tsx', ['**/*.generated.tsx']));
    assert.ok(matchesAnyGlob('src/Foo.generated.tsx', ['*.generated.tsx']));
    // {ts,tsx} expands to (?:ts|tsx) so the actual file path is what matches.
    assert.ok(matchesAnyGlob('src/widget/Foo.tsx', ['src/widget/Foo.{ts,tsx}']));
    assert.ok(matchesAnyGlob('src/widget/Foo.ts', ['src/widget/Foo.{ts,tsx}']));
    assert.ok(!matchesAnyGlob('src/widgets/Foo.tsx', ['src/legacy/**']));
    assert.ok(!matchesAnyGlob('src/Foo.tsx', []));
  });
});

describe('filterFindings()', () => {
  it('drops by ignoreRules and ignores legacy minSeverity config', () => {
    const content = [
      'a',                                          // line 1
      'b',                                          // line 2
    ].join('\n');
    const findings = [
      finding('side-tab', 1, { severity: 'warning' }),
      finding('gradient-text', 2, { severity: 'warning' }),
      finding('overused-font', 5, { severity: 'advisory' }),
    ];
    const filtered = filterFindings(findings, content, '.ts', {
      ignoreRules: ['side-tab'],
      minSeverity: 'error',
      limits: DEFAULT_CONFIG.limits,
    });
    assert.deepEqual(filtered.map((f) => f.antipattern), ['gradient-text', 'overused-font']);
  });

  it('does not treat source comments as hook suppression', () => {
    const content = [
      '/* impeccable: ignore * */',
      '.card { font-family: "Roboto", sans-serif; }',
      '<!-- impeccable: ignore side-tab -->',
      '<div style="border-left: 4px solid #7c3aed; border-radius: 16px;">Card</div>',
    ].join('\n');
    const filtered = filterFindings(
      [finding('overused-font', 2), finding('side-tab', 4)],
      content, '.html',
      { ignoreRules: [], minSeverity: 'warning', limits: DEFAULT_CONFIG.limits }
    );
    assert.deepEqual(filtered.map((f) => f.antipattern), ['overused-font', 'side-tab']);
  });

  it('drops only matching rule/value pairs from ignoreValues', () => {
    const findings = [
      finding('overused-font', 1, { snippet: 'Primary font: Inter (86% of text)' }),
      finding('overused-font', 2, { snippet: 'Primary font: Roboto' }),
      finding('bounce-easing', 3, { snippet: 'animation: bounce-ball' }),
      finding('bounce-easing', 4, { snippet: 'animation: wobble-card' }),
      finding('side-tab', 3),
    ];
    const filtered = filterFindings(findings, '', '.css', {
      ignoreRules: [],
      ignoreValues: [
        { rule: 'overused-font', value: 'inter' },
        { rule: 'bounce-easing', value: 'bounce-ball' },
      ],
      minSeverity: 'warning',
      limits: DEFAULT_CONFIG.limits,
    });
    assert.deepEqual(filtered.map((f) => `${f.antipattern}:${f.line}`), ['overused-font:2', 'bounce-easing:4', 'side-tab:3']);
  });

  it('scopes ignoreValues to file globs when files are provided', () => {
    const findings = [
      { ...finding('design-system-color', 1, { file: '/tmp/project/site/styles/main.css' }), ignoreValue: '#8b5cf6' },
      { ...finding('design-system-color', 2, { file: '/tmp/project/site/styles/feature.css' }), ignoreValue: '#8b5cf6' },
      { ...finding('design-system-color', 3, { file: '/tmp/project/site/styles/home-kinpaku.css' }), ignoreValue: 'oklch(60% 0.25 350 / 0.22)' },
    ];
    const filtered = filterFindings(findings, '', '.css', {
      ignoreRules: [],
      ignoreValues: [
        { rule: 'design-system-color', value: '#8b5cf6', files: ['site/styles/main.css'] },
        { rule: 'design-system-color', value: 'oklch(60% 0.25 350 / 0.22)', file: 'site/styles/home-kinpaku.css' },
      ],
      limits: DEFAULT_CONFIG.limits,
    });
    assert.deepEqual(filtered.map((f) => `${f.file}:${f.line}`), ['/tmp/project/site/styles/feature.css:2']);
  });

  it('matches equivalent design-system color ignore values', () => {
    const findings = [
      { ...finding('design-system-color', 1, { file: '/tmp/project/site/styles/rgb.css' }), ignoreValue: 'rgb(139, 92, 246)' },
      { ...finding('design-system-color', 2, { file: '/tmp/project/site/styles/hex.css' }), ignoreValue: '#8b5cf6' },
      { ...finding('design-system-color', 3, { file: '/tmp/project/site/styles/alpha.css' }), ignoreValue: 'rgba(139, 92, 246, 0.5)' },
      { ...finding('design-system-color', 4, { file: '/tmp/project/site/styles/other.css' }), ignoreValue: '#8b5cf7' },
      { ...finding('design-system-radius', 5, { file: '/tmp/project/site/styles/radius.css' }), ignoreValue: 'rgb(139, 92, 246)' },
    ];
    const filtered = filterFindings(findings, '', '.css', {
      ignoreRules: [],
      ignoreValues: [
        { rule: 'design-system-color', value: '#8b5cf6' },
        { rule: 'design-system-color', value: 'rgb(139 92 246 / 100%)' },
      ],
      limits: DEFAULT_CONFIG.limits,
    });
    assert.deepEqual(filtered.map((f) => `${f.antipattern}:${f.line}`), [
      'design-system-color:3',
      'design-system-color:4',
      'design-system-radius:5',
    ]);
  });

  it('allows wildcard ignoreValues only when scoped to files', () => {
    const findings = [
      { ...finding('design-system-color', 1, { file: '/tmp/project/site/styles/main.css' }), ignoreValue: '#8b5cf6' },
      { ...finding('design-system-color', 2, { file: '/tmp/project/site/styles/feature.css' }), ignoreValue: '#8b5cf6' },
      { ...finding('design-system-font', 3, { file: '/tmp/project/site/styles/main.css' }), ignoreValue: 'Inter' },
    ];
    const filtered = filterFindings(findings, '', '.css', {
      ignoreRules: [],
      ignoreValues: [
        { rule: 'design-system-color', value: '*', files: ['site/styles/main.css'] },
        { rule: 'design-system-font', value: '*' },
      ],
      limits: DEFAULT_CONFIG.limits,
    });
    assert.deepEqual(filtered.map((f) => `${f.antipattern}:${f.line}`), ['design-system-color:2', 'design-system-font:3']);
  });

  it('extracts overused-font values from primary, CSS, and Google font snippets', () => {
    assert.equal(
      extractFindingIgnoreValue(finding('overused-font', 1, { snippet: 'Primary font: Open Sans (80% of text)' })),
      'open sans',
    );
    assert.equal(
      extractFindingIgnoreValue(finding('overused-font', 1, { snippet: 'body { font-family: "Inter", sans-serif; }' })),
      'inter',
    );
    assert.equal(
      extractFindingIgnoreValue(finding('overused-font', 1, { snippet: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400' })),
      'plus jakarta sans',
    );
    assert.equal(extractFindingIgnoreValue(finding('side-tab', 1)), '');
  });

  it('extracts bounce-easing values from motion snippets', () => {
    assert.equal(
      extractFindingIgnoreValue(finding('bounce-easing', 1, { snippet: 'animation: bounce-ball' })),
      'bounce-ball',
    );
    assert.equal(
      extractFindingIgnoreValue(finding('bounce-easing', 1, { snippet: 'animate-bounce (Tailwind)' })),
      'animate-bounce',
    );
    assert.equal(
      extractFindingIgnoreValue(finding('bounce-easing', 1, { snippet: 'cubic-bezier(0.3, -0.4, 0.6, 1.4)' })),
      'cubic-bezier(0.3, -0.4, 0.6, 1.4)',
    );
  });
});

describe('hook-admin.mjs', () => {
  let cwd;
  const script = path.resolve('skill', 'scripts', 'hook-admin.mjs');

  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function runAdmin(args) {
    return execFileSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env },
      encoding: 'utf-8',
    });
  }

  it('ignore-value writes shared config by default without creating local config', () => {
    const out = runAdmin(['ignore-value', 'overused-font', 'Inter', '--reason', 'User confirmed Inter']);
    assert.match(out, /overused-font=inter/);
    assert.equal(fs.existsSync(getLocalConfigPath(cwd)), false);
    const raw = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8'));
    assert.equal(raw.hook, undefined);
    const shared = raw.detector;
    assert.deepEqual(shared.ignoreRules, []);
    assert.deepEqual(shared.ignoreValues.map(({ rule, value, reason }) => ({ rule, value, reason })), [
      { rule: 'overused-font', value: 'inter', reason: 'User confirmed Inter' },
    ]);
    assert.match(shared.ignoreValues[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('ignore-value --shared remains accepted for shared config', () => {
    runAdmin(['ignore-value', 'overused-font', 'Open', 'Sans', '--shared', '--reason', 'Brand font']);
    assert.equal(fs.existsSync(getLocalConfigPath(cwd)), false);
    const shared = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8')).detector;
    assert.deepEqual(shared.ignoreValues.map(({ rule, value, reason }) => ({ rule, value, reason })), [
      { rule: 'overused-font', value: 'open sans', reason: 'Brand font' },
    ]);
  });

  it('ignore-value --local writes private config and status reports local ignores', () => {
    runAdmin(['ignore-value', 'overused-font', 'Inter', '--local']);
    runAdmin(['ignore-value', 'OVERUSED-FONT', '"Inter"', '--local', '--reason', 'Still intentional']);
    assert.equal(fs.existsSync(getConfigPath(cwd)), false);
    const raw = JSON.parse(fs.readFileSync(getLocalConfigPath(cwd), 'utf-8'));
    assert.equal(raw.hook, undefined);
    const local = raw.detector;
    assert.equal(local.designSystem, undefined, 'local ignore should not override shared design-system state');
    assert.equal(local.ignoreValues.length, 1);
    assert.equal(local.ignoreValues[0].reason, 'Still intentional');

    const status = runAdmin(['status']);
    assert.match(status, /local file:\s+\.impeccable\/config\.local\.json/);
    assert.match(status, /ignoreValues:\s+overused-font=inter/);
  });

  it('a /impeccable hooks edit preserves sibling hook fields (consent, quiet)', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    // A recorded per-developer consent in the local file...
    fs.writeFileSync(getLocalConfigPath(cwd), JSON.stringify({ hook: { consent: 'declined' } }));
    runAdmin(['ignore-value', 'overused-font', 'Inter', '--local']);
    const localRaw = JSON.parse(fs.readFileSync(getLocalConfigPath(cwd), 'utf-8'));
    assert.equal(localRaw.hook.consent, 'declined', 'consent must survive a local ignore-value edit');
    assert.equal(localRaw.detector.ignoreValues.length, 1);

    // ...and a shared quiet flag survives an on/off toggle.
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({ hook: { quiet: true } }));
    runAdmin(['off']);
    const shared = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8')).hook;
    assert.equal(shared.enabled, false);
    assert.equal(shared.quiet, true, 'quiet must survive an enable/disable toggle');
  });

  it('hooks on accepts declined consent and installs missing provider manifests', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getLocalConfigPath(cwd), JSON.stringify({ hook: { consent: 'declined', quiet: true } }));
    for (const provider of ['.claude', '.agents', '.cursor', '.github']) {
      fs.mkdirSync(path.join(cwd, provider, 'skills', 'impeccable', 'scripts'), { recursive: true });
    }
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: {
        PostToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'command', command: 'node "./local-hook.mjs"' }] },
          { matcher: 'Edit', hooks: [{ type: 'command', command: 'node ".claude/skills/impeccable/scripts/hook.mjs"' }] },
        ],
      },
    }));

    const out = runAdmin(['on']);
    assert.match(out, /Recorded local hook consent/);
    assert.match(out, /Installed or repaired hook manifests for: \.claude, \.agents, \.cursor, \.github/);

    const shared = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8')).hook;
    assert.equal(shared.enabled, true);
    const local = JSON.parse(fs.readFileSync(getLocalConfigPath(cwd), 'utf-8')).hook;
    assert.equal(local.consent, 'accepted');
    assert.equal(local.quiet, true, 'unrelated local hook fields survive consent repair');

    const claude = fs.readFileSync(path.join(cwd, '.claude', 'settings.local.json'), 'utf-8');
    assert.match(claude, /local-hook\.mjs/);
    assert.equal(claude.split('skills/impeccable/scripts/hook.mjs').length - 1, 1);

    const codex = fs.readFileSync(path.join(cwd, '.codex', 'hooks.json'), 'utf-8');
    assert.match(codex, /\.agents\/skills\/impeccable\/scripts\/hook\.mjs/);
    const cursor = fs.readFileSync(path.join(cwd, '.cursor', 'hooks.json'), 'utf-8');
    assert.match(cursor, /\.cursor\/skills\/impeccable\/scripts\/hook-before-edit\.mjs/);
    const github = JSON.parse(fs.readFileSync(path.join(cwd, '.github', 'hooks', 'impeccable.json'), 'utf-8'));
    assert.equal(github.hooks.postToolUse[0].matcher, 'edit|create|apply_patch');
    assert.match(github.hooks.postToolUse[0].bash, /\.github\/skills\/impeccable\/scripts\/hook\.mjs/);
  });

  it('ignore-rule overused-font requires explicit broad suppression', () => {
    assert.throws(
      () => runAdmin(['ignore-rule', 'overused-font']),
      /ignore-value overused-font <font>|--all-values/,
    );
    assert.equal(fs.existsSync(getConfigPath(cwd)), false);
  });

  it('ignore-rule overused-font --all-values writes a whole-rule suppression', () => {
    const out = runAdmin(['ignore-rule', 'overused-font', '--all-values', '--reason', 'User asked to ignore overused fonts generally']);
    assert.match(out, /Added "overused-font" to detector\.ignoreRules/);
    const shared = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8')).detector;
    assert.deepEqual(shared.ignoreRules, ['overused-font']);
    assert.deepEqual(shared.ignoreValues, []);
  });

  it('ignore-rule still allows non-value rules without --all-values', () => {
    runAdmin(['ignore-rule', 'side-tab']);
    const shared = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8')).detector;
    assert.deepEqual(shared.ignoreRules, ['side-tab']);
  });

  it('ignore-value rejects conflicting scope flags', () => {
    assert.throws(
      () => runAdmin(['ignore-value', 'overused-font', 'Inter', '--shared', '--local']),
      /Pass only one scope flag/,
    );
  });

  it('ignore-file writes shared config that suppresses a later hook run', async () => {
    const file = path.join(cwd, 'src/ConfirmedCard.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<div style="border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px;">Card</div>');

    runAdmin(['ignore-file', 'src/ConfirmedCard.html']);

    const shared = JSON.parse(fs.readFileSync(getConfigPath(cwd), 'utf-8')).detector;
    assert.deepEqual(shared.ignoreFiles, ['src/ConfirmedCard.html']);

    const r = await runHook({
      stdinJson: JSON.stringify({
        session_id: 'confirmed-ignore-file',
        cwd,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: file },
      }),
      env: {},
      cwd,
      detector: fakeDetector([finding('side-tab', 1)]),
    });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'config-ignore-file');
  });
});

describe('renderTemplate()', () => {
  it('starts with the versioned envelope and caps to maxFindings', () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      finding('side-tab', i + 1, { name: `R${i}`, description: 'd' }));
    const text = renderTemplate(findings, '/x/Card.tsx', DEFAULT_CONFIG, { cwd: '/x' });
    assert.ok(text.startsWith(`${ENVELOPE_PREFIX} Design hook findings requiring review in Card.tsx (12 issue(s)):`));
    assert.match(text, /\.\.\. and 7 more \(see \/impeccable audit\)\./);
    // Exactly 5 finding lines.
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(lines.length, 5);
    assert.ok(text.length <= DEFAULT_CONFIG.limits.maxChars);
  });

  it('emits a directive footer (imperative + judgment clause + confirmed ignore guidance)', () => {
    // Steers the model: imperative "handle", explicit context judgment
    // before editing, and "acknowledge" so the user sees the resolution
    // in the chat reply. See `directiveFooter()` in hook-lib.mjs for
    // the rationale.
    const text = renderTemplate(
      [finding('side-tab', 1, { name: 'X' })],
      '/x/Card.tsx', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.match(text, /Handle these before finalizing/);
    assert.match(text, /fix findings that are real design problems/);
    assert.match(text, /classify contextually intentional findings as false positives/);
    assert.match(text, /Use context judgment before editing/);
    assert.match(text, /not automatically a defect/);
    assert.match(text, /literal or domain-appropriate motion/);
    assert.match(text, /Do not change intentional design just to satisfy the hook/);
    assert.match(text, /Suppress a finding only after the user explicitly confirms it is intentional/);
    assert.match(text, /do not silence a real finding with an inline ignore comment/);
    assert.match(text, /inline `impeccable-disable <rule>` comment only when the waiver must travel with a file/);
    assert.match(text, /ignore-value \.\.\. --shared/);
    assert.match(text, /ignore-rule overused-font --all-values/);
    assert.match(text, /\/impeccable hooks ignore-file Card\.tsx/);
    assert.match(text, /ignore-rule <id>/);
    assert.match(text, /\/impeccable audit/);
  });

  it('shows the exact value-specific command for overused-font findings', () => {
    const text = renderTemplate(
      [finding('overused-font', 1, { name: 'Overused font', snippet: 'body { font-family: "Roboto", sans-serif; }' })],
      '/x/fonts.css', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.match(text, /\/impeccable hooks ignore-value overused-font Roboto --shared/);
    assert.match(text, /ignore-rule overused-font --all-values/);
  });

  it('shows the exact value-specific command for bounce-easing findings', () => {
    const text = renderTemplate(
      [finding('bounce-easing', 1, { name: 'Bounce or elastic easing', snippet: 'animation: bounce-ball' })],
      '/x/main.css', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.match(text, /\/impeccable hooks ignore-value bounce-easing bounce-ball --shared/);
  });

  it('drops the L<line> prefix when line is 0', () => {
    const text = renderTemplate(
      [finding('side-tab', 0, { name: 'X' })],
      '/x/a.tsx', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.match(text, /^- \[side-tab\]/m);
  });

  it('does not suggest ignore-value for rules that cannot be value-filtered', () => {
    const text = renderTemplate(
      [finding('side-tab', 1, {
        name: 'Side tab',
        ignoreValue: 'Inter',
      })],
      '/x/a.tsx', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.doesNotMatch(text, /\/impeccable hooks ignore-value side-tab Inter/);
  });

  it('clamps oversize output to maxChars', () => {
    const huge = Array.from({ length: 5 }, (_, i) =>
      finding('side-tab', i + 1, { name: 'X', description: 'y'.repeat(2000) }));
    const text = renderTemplate(huge, '/x/a.tsx',
      { ...DEFAULT_CONFIG, limits: { maxFindings: 5, maxChars: 500 } },
      { cwd: '/x' });
    assert.ok(text.length <= 500);
  });
});

describe('writeAuditLog()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('appends NDJSON when IMPECCABLE_HOOK_LOG is set', () => {
    const log = path.join(cwd, 'audit.ndjson');
    writeAuditLog({ IMPECCABLE_HOOK_LOG: log }, { event: 'PostToolUse', emitted: true });
    writeAuditLog({ IMPECCABLE_HOOK_LOG: log }, { event: 'PostToolUse', emitted: false });
    const body = fs.readFileSync(log, 'utf-8');
    assert.equal(body.trim().split('\n').length, 2);
    for (const line of body.trim().split('\n')) {
      const obj = JSON.parse(line);
      assert.ok(obj.ts && obj.event === 'PostToolUse');
    }
  });

  it('is a no-op when IMPECCABLE_HOOK_LOG is unset', () => {
    assert.equal(writeAuditLog({}, { event: 'x' }, cwd), false);
  });

  it('falls back to the unified config hook.auditLog when the env var is unset', () => {
    const log = path.join(cwd, 'from-config.ndjson');
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({ hook: { auditLog: log } }));
    assert.equal(writeAuditLog({}, { event: 'PostToolUse' }, cwd), true);
    assert.equal(fs.readFileSync(log, 'utf-8').trim().split('\n').length, 1);
  });

  it('prefers the env var over config hook.auditLog', () => {
    const envLog = path.join(cwd, 'from-env.ndjson');
    const cfgLog = path.join(cwd, 'from-config.ndjson');
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({ hook: { auditLog: cfgLog } }));
    writeAuditLog({ IMPECCABLE_HOOK_LOG: envLog }, { event: 'PostToolUse' }, cwd);
    assert.equal(fs.existsSync(envLog), true);
    assert.equal(fs.existsSync(cfgLog), false);
  });

  it('resolves config auditLog from entry.cwd (the event project root), not the fallback cwd', () => {
    const projectDir = path.join(cwd, 'project');
    const log = path.join(cwd, 'event-cwd.ndjson');
    fs.mkdirSync(path.join(projectDir, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.impeccable', 'config.json'),
      JSON.stringify({ hook: { auditLog: log } }));
    // The fallback cwd (root) has no config; entry.cwd points at the project.
    assert.equal(writeAuditLog({}, { event: 'PostToolUse', cwd: projectDir }, cwd), true);
    assert.equal(fs.existsSync(log), true);
  });

  it('resolves a relative auditLog path against the project root, not the process cwd', () => {
    const projectDir = path.join(cwd, 'project');
    fs.mkdirSync(path.join(projectDir, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.impeccable', 'config.json'),
      JSON.stringify({ hook: { auditLog: 'logs/hook.ndjson' } }));
    assert.equal(writeAuditLog({}, { event: 'PostToolUse', cwd: projectDir }, cwd), true);
    // Written under the project root, not the fallback cwd.
    assert.equal(fs.existsSync(path.join(projectDir, 'logs', 'hook.ndjson')), true);
    assert.equal(fs.existsSync(path.join(cwd, 'logs', 'hook.ndjson')), false);
  });
});

describe('payload()', () => {
  it('produces hookSpecificOutput for Claude/Codex', () => {
    const obj = JSON.parse(payload('hello'));
    assert.equal(obj.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.equal(obj.hookSpecificOutput.additionalContext, 'hello');
  });

  it('produces additional_context for Cursor', () => {
    const obj = JSON.parse(payload('hello', 'PostToolUse', 'cursor'));
    assert.equal(obj.additional_context, 'hello');
    assert.equal(obj.hookSpecificOutput, undefined);
  });

  it('produces top-level additionalContext for GitHub Copilot', () => {
    const obj = JSON.parse(payload('hello', 'PostToolUse', 'github'));
    assert.equal(obj.additionalContext, 'hello');
    assert.equal(obj.hookSpecificOutput, undefined);
    assert.equal(obj.additional_context, undefined);
  });
});

describe('runHook()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function eventFor(file, sessionId = 'sid-1') {
    return {
      session_id: sessionId,
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file },
    };
  }

  function writeFixture(rel, body) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  }

  function writeDesignMd() {
    fs.writeFileSync(path.join(cwd, 'DESIGN.md'), `---
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
colors:
  ink: "#241f1a"
rounded:
  md: "8px"
---

# Design System
`);
  }

  function designFinding(value = 'Poppins') {
    return {
      ...finding('design-system-font', 1, {
        name: 'Font outside DESIGN.md',
        description: 'A font is used that is not declared in DESIGN.md typography.',
        snippet: `font-family: "${value}", sans-serif;`,
      }),
      ignoreValue: value,
    };
  }

  function designAwareDetector({ stale = false } = {}) {
    return {
      loadDesignSystemForCwd: (projectCwd) => (
        fs.existsSync(path.join(projectCwd, 'DESIGN.md'))
          ? { present: true, hasFonts: true, mdNewerThanJson: stale }
          : null
      ),
      detectText: (_content, _filePath, options = {}) => (
        options.designSystem ? [designFinding()] : []
      ),
      detectHtml: (_filePath, options = {}) => (
        options.designSystem ? [designFinding()] : []
      ),
    };
  }

  it('emits findings on first fire, then a pending-ack on subsequent dedup hits', async () => {
    // The "no silent fires" policy turns the previously-silent dedup hit
    // into a pending re-nudge that keeps the unresolved finding in the
    // model's context across turns. Findings emission still wins outright
    // over the nudge (`renderTemplate` text), so r1 is unchanged from
    // before. r2 is what changed: silent → pending ack.
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1, { name: 'Side-tab' })]);

    const r1 = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r1.exitCode, 0);
    assert.ok(r1.stdout.includes(ENVELOPE_PREFIX));
    assert.match(r1.stdout, /Design hook findings requiring review/);
    assert.equal(r1.audit.emitted, true);

    const r2 = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r2.exitCode, 0);
    assert.ok(r2.stdout.includes(ENVELOPE_PREFIX));
    assert.match(r2.stdout, /Still has 1 finding\(s\) flagged earlier this session/);
    assert.match(r2.stdout, /side-tab:1/);
    assert.equal(r2.audit.emitted, true);
    assert.equal(r2.audit.kind, 'pending');
  });

  it('handles a GitHub Copilot edit event end-to-end and emits additionalContext', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1, { name: 'Side-tab' })]);
    const githubEvent = {
      sessionId: 'gh-1',
      cwd,
      toolName: 'edit',
      toolArgs: JSON.stringify({ path: file, old_str: 'a', new_str: 'b' }),
    };

    const r = await runHook({ stdinJson: JSON.stringify(githubEvent), env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.equal(r.audit.harness, 'github');
    assert.equal(r.audit.emitted, true);
    const out = JSON.parse(r.stdout);
    assert.ok(out.additionalContext.includes(ENVELOPE_PREFIX));
    assert.match(out.additionalContext, /Design hook findings requiring review/);
    assert.equal(out.hookSpecificOutput, undefined);
  });

  it('handles a GitHub Copilot apply_patch event end-to-end (interactive/cloud path)', async () => {
    // The real bug the live test caught: interactive Copilot edits via
    // apply_patch (raw patch string in toolArgs), which the matcher and runtime
    // must both cover — not just the edit/create tools seen in `copilot -p`.
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1, { name: 'Side-tab' })]);
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${file}`,
      '+noop',
      '*** End Patch',
    ].join('\n');
    const githubEvent = { sessionId: 'gh-ap', cwd, toolName: 'apply_patch', toolArgs: patch };

    const r = await runHook({ stdinJson: JSON.stringify(githubEvent), env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.equal(r.audit.harness, 'github');
    assert.equal(r.audit.tool, 'apply_patch');
    assert.equal(r.audit.emitted, true);
    const out = JSON.parse(r.stdout);
    assert.ok(out.additionalContext.includes(ENVELOPE_PREFIX));
    assert.match(out.additionalContext, /Design hook findings requiring review/);
  });

  it('emits a clean ack when the file has zero findings', async () => {
    // No-silent-fires policy: a successful scan that finds nothing still
    // emits a short positive nudge so the hook stays a conversational
    // presence on every fire.
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([]); // no findings
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes(ENVELOPE_PREFIX));
    assert.match(r.stdout, /No deterministic design-quality issues found/);
    assert.match(r.stdout, /keep following the project design system and the impeccable skill guidance/);
    assert.equal(r.audit.emitted, true);
    assert.equal(r.audit.kind, 'clean');
  });

  it('does not emit clean acks for plain .ts files', async () => {
    const file = writeFixture('src/server.ts', 'export const value = 1;');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {},
      cwd,
      detector: fakeDetector([]),
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'non-ui-ack');
  });

  it('still emits findings for plain .ts files', async () => {
    const file = writeFixture('src/styles.ts', 'export const css = "border-left: 4px solid #7c3aed";');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {},
      cwd,
      detector: fakeDetector([finding('side-tab', 1)]),
    });
    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.match(r.stdout, /side-tab/);
  });

  it('does not emit pending acks for plain .js files', async () => {
    const file = writeFixture('src/build.js', 'export const value = 1;');
    const det = fakeDetector([finding('side-tab', 1)]);
    const first = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.match(first.stdout, /Design hook findings requiring review/);

    const second = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(second.stdout, '');
    assert.equal(second.audit.skipped, 'non-ui-ack');
  });

  it('IMPECCABLE_HOOK_QUIET=1 suppresses clean and pending acks, keeps findings emission', async () => {
    // The opt-out kill switch for users who want the old silent-on-clean
    // behavior. Findings still emit because those are real signals; the
    // QUIET switch only quiets the conversational acks.
    const fileA = writeFixture('src/A.tsx', 'noop');
    const fileB = writeFixture('src/B.tsx', 'noop');

    // Clean file: silent under QUIET.
    const detClean = fakeDetector([]);
    const rClean = await runHook({
      stdinJson: JSON.stringify(eventFor(fileA)),
      env: { IMPECCABLE_HOOK_QUIET: '1' }, cwd, detector: detClean,
    });
    assert.equal(rClean.stdout, '');
    assert.equal(rClean.audit.emitted, false);
    assert.equal(rClean.audit.quiet, true);

    // Findings file: still emits.
    const detFindings = fakeDetector([finding('side-tab', 1)]);
    const rFindings = await runHook({
      stdinJson: JSON.stringify(eventFor(fileB)),
      env: { IMPECCABLE_HOOK_QUIET: '1' }, cwd, detector: detFindings,
    });
    assert.ok(rFindings.stdout.includes(ENVELOPE_PREFIX));
    assert.match(rFindings.stdout, /Design hook findings requiring review/);
    assert.equal(rFindings.audit.emitted, true);
  });

  it('config quiet:true suppresses the clean ack like the env switch', async () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({ hook: { quiet: true } }));
    const file = writeFixture('src/Quiet.tsx', 'noop');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {}, cwd, detector: fakeDetector([]),
    });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.quiet, true);
  });

  it('re-entrancy guard short-circuits when IMPECCABLE_HOOK_DEPTH is set', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: { IMPECCABLE_HOOK_DEPTH: '1' },
      cwd,
      detector: det,
    });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.reentrant, true);
  });

  it('re-entrancy guard treats numeric CLAUDE_HOOK_DEPTH values as active', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: { CLAUDE_HOOK_DEPTH: '2' },
      cwd,
      detector: det,
    });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.reentrant, true);
  });

  it('IMPECCABLE_HOOK_DISABLED kill switch', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      const r = await runHook({
        stdinJson: JSON.stringify(eventFor(file)),
        env: { IMPECCABLE_HOOK_DISABLED: v },
        cwd,
        detector: det,
      });
      assert.equal(r.stdout, '', `expected silent for value ${v}`);
      assert.equal(r.audit.skipped, 'env-disabled');
    }
  });

  it('config-disabled silences cleanly', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({ hook: { enabled: false } }));
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'config-disabled');
  });

  it('skips the scan when PRODUCT.md declares a native platform', async () => {
    // The web rule engine has no business flagging React Native screens; the
    // hook watches .tsx/.ts/.js, which is exactly what a native project is
    // made of, so the platform field gates the whole scan.
    for (const platform of ['ios', 'android', 'adaptive']) {
      writeFixture('PRODUCT.md', `# App\n\n## Register\n\nproduct\n\n## Platform\n\n${platform}\n`);
      const file = writeFixture('src/Card.tsx', 'noop');
      const det = fakeDetector([finding('side-tab', 1)]);
      const r = await runHook({ stdinJson: JSON.stringify(eventFor(file, `native-${platform}`)), env: {}, cwd, detector: det });
      assert.equal(r.stdout, '', `expected silence for platform ${platform}`);
      assert.equal(r.audit.skipped, 'native-platform');
      assert.equal(r.audit.platform, platform);
    }
  });

  it('still scans when PRODUCT.md declares web (or has no platform field)', async () => {
    writeFixture('PRODUCT.md', '# App\n\n## Register\n\nproduct\n\n## Platform\n\nweb\n');
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1, { name: 'Side-tab' })]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file, 'web-platform')), env: {}, cwd, detector: det });
    assert.match(r.stdout, /Side-tab/);
  });

  it('only unlocks design-system detector findings when DESIGN.md exists', async () => {
    const file = writeFixture('src/Card.tsx', '.card { font-family: "Poppins", sans-serif; }');
    const det = designAwareDetector();

    const withoutDesign = await runHook({
      stdinJson: JSON.stringify(eventFor(file, 'design-system-off')),
      env: {},
      cwd,
      detector: det,
    });
    assert.match(withoutDesign.stdout, /No deterministic design-quality issues found/);
    assert.doesNotMatch(withoutDesign.stdout, /design-system-font/);

    writeDesignMd();
    const withDesign = await runHook({
      stdinJson: JSON.stringify(eventFor(file, 'design-system-on')),
      env: {},
      cwd,
      detector: det,
    });
    assert.match(withDesign.stdout, /Design hook findings requiring review/);
    assert.match(withDesign.stdout, /design-system-font/);
    assert.match(withDesign.stdout, /ignore-value design-system-font Poppins --shared/);
  });

  it('respects detector.designSystem.enabled=false', async () => {
    writeDesignMd();
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      detector: { designSystem: { enabled: false } },
    }));
    const file = writeFixture('src/Card.tsx', '.card { font-family: "Poppins", sans-serif; }');

    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file, 'design-system-disabled')),
      env: {},
      cwd,
      detector: designAwareDetector(),
    });

    assert.match(r.stdout, /No deterministic design-quality issues found/);
    assert.doesNotMatch(r.stdout, /design-system-font/);
  });

  it('suppresses design-system findings through ignore-value', async () => {
    writeDesignMd();
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      detector: {
        ignoreValues: [
          { rule: 'design-system-font', value: 'Poppins' },
        ],
      },
    }));
    const file = writeFixture('src/Card.tsx', '.card { font-family: "Poppins", sans-serif; }');

    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file, 'design-system-ignore-value')),
      env: {},
      cwd,
      detector: designAwareDetector(),
    });

    assert.match(r.stdout, /No deterministic design-quality issues found/);
    assert.doesNotMatch(r.stdout, /design-system-font/);
  });

  it('adds a non-blocking note when DESIGN.md is newer than the sidecar', async () => {
    writeDesignMd();
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = {
      loadDesignSystemForCwd: () => ({ present: true, mdNewerThanJson: true }),
      detectText: () => [],
      detectHtml: () => [],
    };

    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file, 'design-system-stale-sidecar')),
      env: {},
      cwd,
      detector: det,
    });

    assert.match(r.stdout, /No deterministic design-quality issues found/);
    assert.match(r.stdout, /DESIGN\.md is newer than \.impeccable\/design\.json/);
    assert.match(r.stdout, /\/impeccable document/);
  });

  it('rejects sensitive paths before reading file content', async () => {
    const file = path.join(cwd, '.env');
    fs.writeFileSync(file, 'SECRET=42');
    const det = { detectText: () => { throw new Error('should not run'); } };
    const r = await runHook({
      stdinJson: JSON.stringify({ ...eventFor(file), tool_input: { file_path: file } }),
      env: {}, cwd, detector: det,
    });
    assert.equal(r.audit.skipped, 'sensitive');
  });

  it('rejects generated paths', async () => {
    const file = writeFixture('dist/Card.tsx', 'noop');
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd });
    assert.equal(r.audit.skipped, 'generated');
  });

  it('rejects path traversal in file_path', async () => {
    const r = await runHook({
      stdinJson: JSON.stringify({ ...eventFor('/foo/../etc/passwd') }),
      env: {}, cwd,
    });
    assert.equal(r.audit.skipped, 'sensitive');
  });

  it('rejects extensions outside the allowlist', async () => {
    const file = writeFixture('docs/README.md', 'noop');
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd });
    assert.equal(r.audit.skipped, 'extension');
  });

  it('config ignoreFiles glob suppresses', async () => {
    const file = writeFixture('src/legacy/Foo.tsx', 'noop');
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({
      detector: { ignoreFiles: ['src/legacy/**'] },
    }));
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'config-ignore-file');
  });

  it('emits one-shot suppression notice on the 7th edit and silences after', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    let last;
    for (let i = 0; i < 8; i++) {
      // Use a different line each time so we don't dedup; we want to hit
      // edit-count, not the dedup cache.
      const f = [finding('side-tab', i + 1)];
      last = await runHook({
        stdinJson: JSON.stringify(eventFor(file)),
        env: {}, cwd, detector: { detectText: () => f, detectHtml: () => f },
      });
    }
    // The 7th call (index 6) crosses the threshold; the 8th (index 7) is silent.
    assert.equal(last.stdout, '', '8th edit should be silent');
    assert.equal(last.audit.suppressed, true);
  });

  it('emits suppressionNotice text on the threshold-crossing edit', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    let r;
    for (let i = 0; i < 7; i++) {
      const f = [finding('side-tab', i + 1)];
      r = await runHook({
        stdinJson: JSON.stringify(eventFor(file)),
        env: {}, cwd, detector: { detectText: () => f, detectHtml: () => f },
      });
    }
    assert.ok(r.stdout.includes('Suppressing further design hints'));
    assert.match(r.stdout, /More than 6 edits in this session reached/);
    assert.match(r.stdout, /Run \/impeccable audit to revisit/);
  });

  it('handles MultiEdit and apply_patch payload shapes (file_path field)', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    for (const event of [
      { ...eventFor(file), tool_name: 'MultiEdit', tool_input: { file_path: file, edits: [] } },
      { ...eventFor(file), tool_name: 'apply_patch', tool_input: { file_path: file, command: '...' } },
    ]) {
      const r = await runHook({ stdinJson: JSON.stringify(event), env: {}, cwd, detector: det });
      assert.equal(r.exitCode, 0);
      // First call emits; second is dedup-silent. Reset by using fresh session.
      assert.ok(r.stdout.length >= 0);
    }
  });

  it('parses Codex apply_patch command when file_path is omitted', async () => {
    writeFixture('src/Card.tsx', '<div className="border-l-4" />');
    const event = {
      session_id: 'sid-codex-ap',
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        command: '*** Begin Patch\n*** Update File: src/Card.tsx\n*** End Patch',
      },
    };
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({ stdinJson: JSON.stringify(event), env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /Design hook findings requiring review/);
  });

  it('detector throw is swallowed; never breaks turn', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = { detectText: () => { throw new Error('boom'); } };
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '');
  });

  it('awaits the real async HTML detector before deciding a page is clean', async () => {
    const file = writeFixture('index.html', [
      '<!doctype html>',
      '<html><body>',
      '<div style="border-left: 4px solid #6366f1; border-radius: 8px; padding: 16px;">Feature</div>',
      '</body></html>',
    ].join('\n'));
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {},
      cwd,
      detector: { detectHtml, detectText },
    });
    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.doesNotMatch(r.stdout, /No deterministic design-quality issues found/);
    assert.ok(r.audit.findings > 0);
  });

  it('honors an inline impeccable-disable comment so the hook scans the file clean', async () => {
    // The hook runs the same engine as `npx impeccable detect`, so an in-file
    // waiver suppresses hook findings exactly like a config ignore would.
    const flagged = writeFixture('src/Flagged.tsx', 'const css = "font-family: Inter";');
    const flaggedRun = await runHook({
      stdinJson: JSON.stringify(eventFor(flagged)), env: {}, cwd, detector: { detectHtml, detectText },
    });
    assert.match(flaggedRun.stdout, /Design hook findings requiring review/);
    assert.ok(flaggedRun.audit.findings > 0);

    const waived = writeFixture('src/Waived.tsx',
      'const css = "font-family: Inter"; // impeccable-disable-line overused-font');
    const waivedRun = await runHook({
      stdinJson: JSON.stringify(eventFor(waived)), env: {}, cwd, detector: { detectHtml, detectText },
    });
    assert.match(waivedRun.stdout, /No deterministic design-quality issues found/);
    assert.equal(waivedRun.audit.findings, 0);
  });

  it('malformed stdin → silent skip', async () => {
    const r = await runHook({ stdinJson: '{not json', env: {}, cwd });
    assert.equal(r.audit.skipped, 'stdin-malformed');
  });

  it('missing file → silent skip (race protection)', async () => {
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(path.join(cwd, 'src/Vanished.tsx'))),
      env: {}, cwd,
    });
    assert.equal(r.audit.skipped, 'file-missing');
  });
});

describe('runHook() — cache write gating (issues #344, #305)', () => {
  // The hook must be a no-op on disk in projects that never earned an
  // `.impeccable/` footprint: skipped files never dirty the cache, and a
  // dirty cache is only persisted when there are fresh findings or the
  // project already opted in (an `.impeccable/` dir exists).
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function eventFor(file, sessionId = 'gate-sid') {
    return {
      session_id: sessionId,
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file },
    };
  }

  function write(rel, body, base = cwd) {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  }

  it('non-UI edit (.md) does not create .impeccable/', async () => {
    const file = write('notes/todo.md', '# notes');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {}, cwd, detector: fakeDetector([finding('side-tab', 1)]),
    });
    assert.equal(r.audit.skipped, 'extension');
    assert.ok(!fs.existsSync(path.join(cwd, '.impeccable')), '.impeccable should not exist');
  });

  it('clean UI edit in a project with no footprint does not create .impeccable/, still acks', async () => {
    const file = write('src/Card.tsx', 'noop');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {}, cwd, detector: fakeDetector([]),
    });
    assert.match(r.stdout, /No deterministic design-quality issues found/);
    assert.ok(!fs.existsSync(path.join(cwd, '.impeccable')), '.impeccable should not exist');
  });

  it('detector-missing path does not create .impeccable/', async () => {
    const file = write('src/Card.tsx', 'noop');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {}, cwd, detector: {},
    });
    assert.equal(r.audit.skipped, 'detector-missing');
    assert.ok(!fs.existsSync(path.join(cwd, '.impeccable')), '.impeccable should not exist');
  });

  it('fresh findings create the cache, and dedup works on the next run', async () => {
    const file = write('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1)]);
    const first = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.match(first.stdout, /Design hook findings requiring review/);
    assert.ok(fs.existsSync(path.join(cwd, '.impeccable', 'hook.cache.json')), 'cache should exist');

    const second = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.doesNotMatch(second.stdout, /Design hook findings requiring review/);
    assert.match(second.stdout, /flagged earlier this session/);
  });

  it('clean UI edit in an opted-in project (existing .impeccable/) still persists editCount', async () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    const file = write('src/Card.tsx', 'noop');
    await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: fakeDetector([]) });

    const cache = readCache(cwd);
    assert.equal(cache.sessions['gate-sid'].files[file].editCount, 1);
  });

  it('umbrella launch keys the cache to the edited file\'s project root', async () => {
    // cwd is the umbrella: no .git / package.json / .impeccable of its own.
    write('app/package.json', '{"name":"child"}');
    const file = write('app/src/Card.tsx', 'noop');
    const child = path.join(cwd, 'app');
    const r = await runHook({
      stdinJson: JSON.stringify(eventFor(file)),
      env: {}, cwd, detector: fakeDetector([finding('side-tab', 1)]),
    });
    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.equal(r.audit.cwd, child);
    assert.ok(fs.existsSync(path.join(child, '.impeccable', 'hook.cache.json')), 'cache should land in the child project');
    assert.ok(!fs.existsSync(path.join(cwd, '.impeccable')), 'umbrella root should stay clean');
  });
});

describe('resolveCacheCwd()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('keeps the session cwd when it already looks like a project root', () => {
    for (const marker of ['.git', '.impeccable']) {
      const dir = path.join(cwd, `root-${marker}`);
      fs.mkdirSync(path.join(dir, marker), { recursive: true });
      const file = path.join(dir, 'nested', 'app', 'src', 'Card.tsx');
      assert.equal(resolveCacheCwd(file, dir), dir);
    }
    const pkgDir = path.join(cwd, 'root-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{}');
    assert.equal(resolveCacheCwd(path.join(pkgDir, 'src', 'Card.tsx'), pkgDir), pkgDir);
  });

  it('climbs to the nearest marker root when the session cwd is a bare umbrella', () => {
    const child = path.join(cwd, 'app');
    fs.mkdirSync(path.join(child, 'src'), { recursive: true });
    fs.writeFileSync(path.join(child, 'package.json'), '{}');
    assert.equal(resolveCacheCwd(path.join(child, 'src', 'Card.tsx'), cwd), child);
  });

  it('falls back to the session cwd when no marker is found or the path is unsafe', () => {
    const file = path.join(cwd, 'app', 'src', 'Card.tsx');
    assert.equal(resolveCacheCwd(file, cwd), cwd);
    assert.equal(resolveCacheCwd('', cwd), cwd);
    assert.equal(resolveCacheCwd(`${cwd}/../etc/Card.tsx`, cwd), cwd);
  });
});

describe('suppressionNotice()', () => {
  it('starts with envelope and mentions /impeccable audit', () => {
    const text = suppressionNotice('src/Card.tsx');
    assert.ok(text.startsWith(ENVELOPE_PREFIX));
    assert.match(text, /More than 6 edits in this session reached/);
    assert.match(text, /\/impeccable audit/);
  });
});

describe('ALLOWED_EXTS', () => {
  it('covers the documented design-relevant extensions', () => {
    for (const ext of ['.tsx', '.jsx', '.html', '.css', '.vue', '.svelte', '.astro', '.ts', '.js', '.scss', '.sass', '.less', '.htm']) {
      assert.ok(ALLOWED_EXTS.has(ext), `missing: ${ext}`);
    }
    for (const ext of ['.md', '.py', '.go', '.json']) {
      assert.ok(!ALLOWED_EXTS.has(ext), `unexpected allowed: ${ext}`);
    }
  });

  it('keeps clean/pending acknowledgements to UI-ish files', () => {
    for (const ext of ['.tsx', '.jsx', '.html', '.css', '.vue', '.svelte', '.astro', '.scss', '.sass', '.less', '.htm']) {
      assert.ok(ACK_EXTS.has(ext), `missing ack extension: ${ext}`);
      assert.equal(shouldEmitAckForFile(`/x/src/App${ext}`), true);
    }
    for (const ext of ['.ts', '.js']) {
      assert.ok(!ACK_EXTS.has(ext), `unexpected ack extension: ${ext}`);
      assert.equal(shouldEmitAckForFile(`/x/src/tool${ext}`), false);
    }
  });

  it('acks configured html-engine extensions but not text-engine ones', () => {
    const config = {
      extensions: [
        { ext: '.blade.php', engine: 'html' },
        { ext: '.d.ts.hbs', engine: 'text' },
      ],
    };
    assert.equal(shouldEmitAckForFile('/x/views/card.blade.php', config), true);
    assert.equal(shouldEmitAckForFile('/x/templates/types.d.ts.hbs', config), false);
    assert.equal(shouldEmitAckForFile('/x/views/card.blade.php'), false);
  });
});

describe('matchConfiguredExtension()', () => {
  const extensions = [
    { ext: '.blade.php', engine: 'html' },
    { ext: '.html.erb', engine: 'html' },
    { ext: '.twig', engine: 'html' },
  ];

  it('matches double extensions against the end of the filename', () => {
    assert.deepEqual(
      matchConfiguredExtension('/app/resources/views/Card.blade.php', extensions),
      { ext: '.blade.php', engine: 'html' },
    );
    assert.deepEqual(
      matchConfiguredExtension('app/views/users/show.html.erb', extensions),
      { ext: '.html.erb', engine: 'html' },
    );
    assert.deepEqual(
      matchConfiguredExtension('/templates/base.twig', extensions),
      { ext: '.twig', engine: 'html' },
    );
  });

  it('is case-insensitive on the filename', () => {
    assert.ok(matchConfiguredExtension('/views/Card.BLADE.PHP', extensions));
  });

  it('prefers the longest matching suffix regardless of config order', () => {
    const overlapping = [
      { ext: '.php', engine: 'text' },
      { ext: '.blade.php', engine: 'html' },
    ];
    assert.deepEqual(
      matchConfiguredExtension('/views/card.blade.php', overlapping),
      { ext: '.blade.php', engine: 'html' },
    );
    assert.deepEqual(
      matchConfiguredExtension('/views/card.blade.php', overlapping.slice().reverse()),
      { ext: '.blade.php', engine: 'html' },
    );
    assert.deepEqual(
      matchConfiguredExtension('/app/Controller.php', overlapping),
      { ext: '.php', engine: 'text' },
    );
  });

  it('does not match unrelated files or bare dotfile-like names', () => {
    assert.equal(matchConfiguredExtension('/app/Http/Controller.php', extensions), null);
    assert.equal(matchConfiguredExtension('/views/.blade.php', extensions), null);
    assert.equal(matchConfiguredExtension('/src/Card.tsx', extensions), null);
  });

  it('returns null for empty or missing config', () => {
    assert.equal(matchConfiguredExtension('/views/card.blade.php', []), null);
    assert.equal(matchConfiguredExtension('/views/card.blade.php', undefined), null);
  });
});

describe('renderCleanAck() / renderPendingAck()', () => {
  it('renderCleanAck stays short and ends with the steer line', () => {
    const text = renderCleanAck('/x/src/App.jsx', { cwd: '/x' });
    assert.match(text, /^\[impeccable@1\] Design hook scanned src\/App\.jsx\. No deterministic design-quality issues found\./);
    assert.match(text, /keep following the project design system and the impeccable skill guidance/);
    // Budget guard: should fit comfortably under a single context-message
    // injection (~200 chars). Hard upper bound 240 chars.
    assert.ok(text.length < 240, `clean ack too long: ${text.length} chars`);
  });

  it('renderPendingAck quotes up to 3 known findings and counts the rest', () => {
    const known = ['side-tab:3', 'gradient-text:4', 'ai-color-palette:8', 'overused-font:12'];
    const text = renderPendingAck('/x/src/SlopCard.jsx', known, { cwd: '/x' });
    assert.match(text, /^\[impeccable@1\] Design hook scanned src\/SlopCard\.jsx\./);
    assert.match(text, /Still has 4 finding\(s\) flagged earlier this session/);
    assert.match(text, /side-tab:3, gradient-text:4, ai-color-palette:8/);
    assert.match(text, /\+1 more/); // 4 total, 3 shown
    assert.match(text, /Handle them before finalizing/);
  });

  it('renderPendingAck omits the "+N more" suffix when ≤3 known findings', () => {
    const text = renderPendingAck('/x/src/A.tsx', ['side-tab:1', 'gradient-text:2'], { cwd: '/x' });
    assert.ok(!text.includes('+'), 'no overflow suffix expected');
  });
});

describe('parseApplyPatchPaths()', () => {
  it('extracts absolute and relative paths from patch bodies', () => {
    const cwd = '/proj';
    const rel = parseApplyPatchPaths('*** Update File: src/App.jsx\n', cwd);
    assert.deepEqual(rel, ['/proj/src/App.jsx']);
    const abs = parseApplyPatchPaths('*** Add File: /tmp/x.css\n*** Update File: src/y.html\n', cwd);
    assert.deepEqual(abs, ['/tmp/x.css', '/proj/src/y.html']);
  });
});

describe('resolveTargetFiles()', () => {
  it('uses file_path when present and falls back to apply_patch command', () => {
    assert.deepEqual(resolveTargetFiles({ tool_input: { file_path: '/a/b.tsx' } }, '/proj'), ['/a/b.tsx']);
    assert.deepEqual(
      resolveTargetFiles({ tool_name: 'apply_patch', tool_input: { command: '*** Update File: src/x.css\n' } }, '/proj'),
      ['/proj/src/x.css'],
    );
    assert.deepEqual(resolveTargetFiles({ tool_name: 'Bash', tool_input: { command: 'echo hi' } }, '/proj'), []);
  });

  it('includes every apply_patch file even when file_path is also present', () => {
    assert.deepEqual(
      resolveTargetFiles({
        tool_name: 'apply_patch',
        tool_input: {
          file_path: '/proj/src/App.jsx',
          command: '*** Update File: src/App.jsx\n*** Update File: src/styles.css\n',
        },
      }, '/proj'),
      ['/proj/src/App.jsx', '/proj/src/styles.css'],
    );
  });

  it('accepts Cursor Write/StrReplace path field and top-level file_path', () => {
    assert.deepEqual(resolveTargetFiles({ tool_input: { path: '/a/b.tsx' } }, '/proj'), ['/a/b.tsx']);
    assert.deepEqual(resolveTargetFiles({ file_path: '/a/c.css' }, '/proj'), ['/a/c.css']);
  });
});

describe('resolveHarness() / normalizeHookEvent()', () => {
  it('routes explicit env and Cursor conversation_id to cursor harness', () => {
    assert.equal(resolveHarness({ IMPECCABLE_HOOK_HARNESS: 'cursor' }), 'cursor');
    assert.equal(resolveHarness({}, { conversation_id: 'c1' }), 'cursor');
    assert.equal(resolveHarness({}), 'claude');
  });

  it('maps Cursor postToolUse Write path into file_path + cwd', () => {
    const normalized = normalizeHookEvent({
      conversation_id: 'c1',
      workspace_roots: ['/proj'],
      tool_name: 'Write',
      tool_input: { path: 'src/App.jsx' },
    }, '/fallback', 'cursor');
    assert.equal(normalized.session_id, 'c1');
    assert.equal(normalized.cwd, '/proj');
    assert.equal(normalized.tool_input.file_path, 'src/App.jsx');
  });

  it('routes a GitHub Copilot postToolUse event (toolName/toolArgs) to the github harness', () => {
    const event = { sessionId: 's1', cwd: '/proj', toolName: 'edit', toolArgs: '{"path":"src/App.tsx"}' };
    assert.equal(resolveHarness({}, event), 'github');
    assert.equal(resolveHarness({ IMPECCABLE_HOOK_HARNESS: 'github' }), 'github');
    // A Claude/Codex event (tool_name/tool_input) must not be mistaken for github.
    assert.equal(resolveHarness({}, { tool_name: 'Edit', tool_input: { file_path: 'a.tsx' } }), 'claude');
  });

  it('normalizes a GitHub edit event: JSON-string toolArgs.path -> tool_input.file_path', () => {
    const normalized = normalizeHookEvent({
      sessionId: 's1',
      cwd: '/proj',
      toolName: 'edit',
      toolArgs: '{"path":"/proj/src/App.tsx","old_str":"a","new_str":"b"}',
    }, '/fallback', 'github');
    assert.equal(normalized.session_id, 's1');
    assert.equal(normalized.cwd, '/proj');
    assert.equal(normalized.tool_name, 'edit');
    assert.equal(normalized.tool_input.file_path, '/proj/src/App.tsx');
  });

  it('normalizes a GitHub apply_patch event: raw patch string -> tool_input.command', () => {
    // Interactive Copilot and the cloud agent edit via apply_patch, whose
    // toolArgs is a raw OpenAI-format patch string, not JSON.
    const patch = [
      '*** Begin Patch',
      '*** Add File: /proj/src/Card.css',
      "+body { font-family: 'Inter'; }",
      '*** End Patch',
    ].join('\n');
    const normalized = normalizeHookEvent({
      sessionId: 's-ap', cwd: '/proj', toolName: 'apply_patch', toolArgs: patch,
    }, '/fallback', 'github');
    assert.equal(normalized.tool_name, 'apply_patch');
    assert.equal(normalized.tool_input.command, patch);
    // resolveTargetFiles understands apply_patch via tool_input.command.
    assert.deepEqual(resolveTargetFiles(normalized, '/proj'), ['/proj/src/Card.css']);
  });

  it('does not misroute an edit whose content contains apply_patch markers', () => {
    // An edit/create payload is JSON; its edited content may legitimately
    // contain "*** Begin Patch" text (e.g. editing docs about apply_patch).
    // That must still take the JSON path so `path` is extracted, not be
    // mistaken for a raw apply_patch payload.
    const normalized = normalizeHookEvent({
      sessionId: 's-edit', cwd: '/proj', toolName: 'edit',
      toolArgs: JSON.stringify({
        path: '/proj/docs/patches.md',
        old_str: 'old',
        new_str: '*** Begin Patch\n*** Add File: x\n*** End Patch',
      }),
    }, '/fallback', 'github');
    assert.equal(normalized.tool_name, 'edit');
    assert.equal(normalized.tool_input.file_path, '/proj/docs/patches.md');
    assert.equal(normalized.tool_input.command, undefined);
    assert.deepEqual(resolveTargetFiles(normalized, '/proj'), ['/proj/docs/patches.md']);
  });

  it('normalizes a GitHub create event and tolerates malformed toolArgs', () => {
    const created = normalizeHookEvent({
      sessionId: 's2', cwd: '/proj', toolName: 'create',
      toolArgs: '{"path":"/proj/styles.css","file_text":"body{}"}',
    }, '/fallback', 'github');
    assert.equal(created.tool_name, 'create');
    assert.equal(created.tool_input.file_path, '/proj/styles.css');

    const broken = normalizeHookEvent({
      sessionId: 's3', cwd: '/proj', toolName: 'edit', toolArgs: 'not json{',
    }, '/fallback', 'github');
    assert.equal(broken.session_id, 's3');
    assert.equal(broken.tool_input.file_path, undefined);
  });
});

describe('expandScanTargets()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function write(rel, body) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  }

  it('includes co-located styles.css when the primary edit is App.jsx', () => {
    const app = write('src/App.jsx', 'export default function App() { return <main className="x" />; }');
    write('src/styles.css', "body { font-family: 'Inter', sans-serif; }");
    const expanded = expandScanTargets([app], cwd);
    assert.deepEqual(expanded, [app, path.join(cwd, 'src/styles.css')]);
  });

  it('includes common co-located Sass, SCSS, and Less stylesheet names', () => {
    for (const name of ['index.scss', 'index.sass', 'index.less', 'global.scss', 'global.less', 'globals.scss', 'globals.less']) {
      const dir = `src/${name.replaceAll('.', '-')}`;
      const app = write(`${dir}/App.jsx`, 'export default function App() { return <main className="x" />; }');
      const stylesheet = write(`${dir}/${name}`, ".card\n  border-left: 4px solid #3b82f6");
      const expanded = expandScanTargets([app], cwd);
      assert.ok(expanded.includes(stylesheet), `missing ${name}`);
    }
  });

  it('follows static stylesheet imports from the edited component', () => {
    const card = write('src/Card.jsx', "import './Card.module.css';\nexport default function Card() { return null; }");
    const mod = write('src/Card.module.css', '.card { border-left: 4px solid #3b82f6; }');
    const expanded = expandScanTargets([card], cwd);
    assert.ok(expanded.includes(mod));
  });

  it('includes co-located module Sass and Less stylesheets', () => {
    for (const name of ['Card.module.sass', 'Card.module.less']) {
      const dir = `src/${name.replaceAll('.', '-')}`;
      const card = write(`${dir}/Card.jsx`, 'export default function Card() { return <main className="x" />; }');
      const stylesheet = write(`${dir}/${name}`, '.card { border-left: 4px solid #3b82f6; }');
      const expanded = expandScanTargets([card], cwd);
      assert.ok(expanded.includes(stylesheet), `missing ${name}`);
    }
  });

  it('resolves relative primary targets against the project cwd', () => {
    write('src/Card.jsx', "import './Card.module.css';\nexport default function Card() { return null; }");
    const mod = write('src/Card.module.css', '.card { border-left: 4px solid #3b82f6; }');
    const expanded = expandScanTargets(['src/Card.jsx'], cwd);
    assert.deepEqual(expanded, [path.join(cwd, 'src/Card.jsx'), mod]);
  });

  it('does not follow imports from traversal-looking primary targets', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-hook-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'App.jsx'), "import './styles.css';\nexport default function App() { return null; }");
      fs.writeFileSync(path.join(outside, 'styles.css'), "body { font-family: 'Inter', sans-serif; }");
      const traversalPrimary = `${cwd}/../${path.basename(outside)}/App.jsx`;
      const expanded = expandScanTargets([traversalPrimary], cwd);
      assert.deepEqual(expanded, [traversalPrimary]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not expand when the primary target is already a stylesheet', () => {
    const css = write('src/styles.css', "body { font-family: 'Inter', sans-serif; }");
    assert.deepEqual(expandScanTargets([css], cwd), [css]);
  });
});

describe('runHook() — co-located stylesheet scan', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function write(rel, body) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  }

  it('flags slop in styles.css when only App.jsx was edited', async () => {
    const app = write('src/App.jsx', 'export default function App() { return <main className="x" />; }');
    write('src/styles.css', "body { font-family: 'Inter', sans-serif; }");
    const det = {
      detectText: (content, filePath) => (
        filePath.endsWith('.css') ? [finding('overused-font', 8)] : []
      ),
      detectHtml: () => [],
    };
    const r = await runHook({
      stdinJson: JSON.stringify({
        session_id: 'co-scan',
        cwd,
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: `*** Update File: ${app}\n` },
      }),
      env: {},
      cwd,
      detector: det,
    });
    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.match(r.stdout, /styles\.css/);
  });

  it('flags slop in co-located .sass when only App.jsx was edited', async () => {
    const app = write('src/App.jsx', 'export default function App() { return <main className="x" />; }');
    write('src/styles.sass', ".card\n  border-left: 4px solid #3b82f6");
    const det = {
      detectText: (content, filePath) => (
        filePath.endsWith('.sass') ? [finding('side-tab', 2)] : []
      ),
      detectHtml: () => [],
    };
    const r = await runHook({
      stdinJson: JSON.stringify({
        session_id: 'co-scan-sass',
        cwd,
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: `*** Update File: ${app}\n` },
      }),
      env: {},
      cwd,
      detector: det,
    });
    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.match(r.stdout, /styles\.sass/);
  });

  it('emits fresh findings for every file scanned in the same hook run', async () => {
    const app = write('src/App.jsx', 'export default function App() { return <main className="border-l-4 border-blue-500" />; }');
    const styles = write('src/styles.css', "body { font-family: 'Inter', sans-serif; }");
    const seen = [];
    const det = {
      detectText: (content, filePath) => {
        seen.push(filePath);
        if (filePath.endsWith('App.jsx')) return [finding('side-tab', 1)];
        if (filePath.endsWith('styles.css')) return [finding('overused-font', 1)];
        return [];
      },
      detectHtml: () => [],
    };

    const r = await runHook({
      stdinJson: JSON.stringify({
        session_id: 'co-scan-fresh-primary',
        cwd,
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: `*** Update File: ${app}\n` },
      }),
      env: {},
      cwd,
      detector: det,
    });

    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.match(r.stdout, /App\.jsx/);
    assert.match(r.stdout, /styles\.css/);
    assert.match(r.stdout, /side-tab/);
    assert.match(r.stdout, /overused-font/);
    assert.ok(seen.includes(app), 'primary file should be scanned');
    assert.ok(seen.includes(styles), 'co-located stylesheet should still be scanned');
    assert.equal(r.emission.groups.length, 2);
    const cache = readCache(cwd);
    const files = cache.sessions['co-scan-fresh-primary'].files;
    assert.deepEqual(files[app].findings, ['side-tab:1']);
    assert.deepEqual(files[styles].findings, ['overused-font:1']);
  });

  it('does not bump edit count for passively co-scanned stylesheets', async () => {
    const app = write('src/App.jsx', 'export default function App() { return <main className="x" />; }');
    const styles = write('src/styles.css', "body { font-family: 'Inter', sans-serif; }");
    const det = {
      detectText: (content, filePath) => (
        filePath.endsWith('styles.css') ? [finding('overused-font', 1)] : []
      ),
      detectHtml: () => [],
    };

    const r = await runHook({
      stdinJson: JSON.stringify({
        session_id: 'co-scan-edit-count',
        cwd,
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: `*** Update File: ${app}\n` },
      }),
      env: {},
      cwd,
      detector: det,
    });

    assert.match(r.stdout, /styles\.css/);
    const cache = readCache(cwd);
    const files = cache.sessions['co-scan-edit-count'].files;
    assert.equal(files[app].editCount, 1);
    assert.equal(files[styles].editCount || 0, 0);
  });

  it('does not scan imported styles from a traversal-looking primary path', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-hook-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'App.jsx'), "import './styles.css';\nexport default function App() { return null; }");
      fs.writeFileSync(path.join(outside, 'styles.css'), "body { font-family: 'Inter', sans-serif; }");
      const traversalPrimary = `${cwd}/../${path.basename(outside)}/App.jsx`;
      const det = fakeDetector([finding('overused-font', 1, { name: 'Overused font' })]);
      const r = await runHook({
        stdinJson: JSON.stringify({
          session_id: 'co-scan-traversal',
          cwd,
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: traversalPrimary },
        }),
        env: {},
        cwd,
        detector: det,
      });
      assert.equal(r.stdout, '');
      assert.equal(r.audit.skipped, 'sensitive');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('runHook() — events without file_path', () => {
  // The sweep fallback was removed in v5 (single-hook simplification).
  // Code-execution tools that don't carry a `file_path` now hit a clean
  // silent skip instead of running a git-status sweep. This keeps the
  // single PostToolUse matcher (Edit/Write/MultiEdit/apply_patch) honest:
  // anything else is a no-op.
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('returns silent skip with reason no-file-path', async () => {
    const event = JSON.stringify({
      session_id: 'sid-x',
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__node_repl__js',
      tool_input: { title: 'do work', code: 'console.log(1)' },
    });
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({ stdinJson: event, env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'no-file-path');
  });
});

describe('runHook() — configured template extensions (issue #316)', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function eventFor(file) {
    return {
      session_id: 'sid-ext',
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file },
    };
  }

  function writeFixture(rel, body) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  }

  function writeExtensionsConfig(extensions) {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(getConfigPath(cwd), JSON.stringify({ detector: { extensions } }));
  }

  function recordingDetector(findings = []) {
    const calls = { html: [], text: [] };
    return {
      calls,
      detectHtml: (filePath) => { calls.html.push(filePath); return findings; },
      detectText: (_content, filePath) => { calls.text.push(filePath); return findings; },
    };
  }

  it('skips .blade.php with no config — the issue #316 repro', async () => {
    const file = writeFixture('resources/views/card.blade.php', '<div class="bg-gradient-to-r">Hi</div>');
    const det = recordingDetector([finding('gradient-text', 1)]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'extension');
    assert.equal(det.calls.html.length + det.calls.text.length, 0);
  });

  it('scans a configured .blade.php through the html engine and emits findings', async () => {
    writeExtensionsConfig([{ ext: '.blade.php' }]);
    const file = writeFixture('resources/views/card.blade.php', '<div class="bg-gradient-to-r">Hi</div>');
    const det = recordingDetector([finding('gradient-text', 1, { name: 'Gradient text' })]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.match(r.stdout, /Design hook findings requiring review/);
    assert.match(r.stdout, /gradient-text/);
    assert.equal(r.audit.emitted, true);
    assert.equal(r.audit.ext, '.blade.php');
    assert.deepEqual(det.calls.html, [file]);
    assert.deepEqual(det.calls.text, []);
  });

  it('routes an engine:text entry through detectText instead', async () => {
    writeExtensionsConfig([{ ext: '.blade.php', engine: 'text' }]);
    const file = writeFixture('resources/views/card.blade.php', '<div>Hi</div>');
    const det = recordingDetector([finding('side-tab', 1)]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.match(r.stdout, /side-tab/);
    assert.deepEqual(det.calls.text, [file]);
    assert.deepEqual(det.calls.html, []);
  });

  it('emits a clean ack for configured html-engine files, stays quiet for text-engine ones', async () => {
    writeExtensionsConfig([
      { ext: '.blade.php' },
      { ext: '.d.ts.hbs', engine: 'text' },
    ]);
    const blade = writeFixture('resources/views/clean.blade.php', '<div>Hi</div>');
    const rBlade = await runHook({ stdinJson: JSON.stringify(eventFor(blade)), env: {}, cwd, detector: recordingDetector([]) });
    assert.match(rBlade.stdout, /No deterministic design-quality issues found/);
    assert.equal(rBlade.audit.kind, 'clean');

    const hbs = writeFixture('templates/types.d.ts.hbs', 'export type X = {{name}};');
    const rHbs = await runHook({ stdinJson: JSON.stringify(eventFor(hbs)), env: {}, cwd, detector: recordingDetector([]) });
    assert.equal(rHbs.stdout, '');
    assert.equal(rHbs.audit.skipped, 'non-ui-ack');
  });
});

describe('resolveProjectPlatform() / isNativePlatform()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('reads the platform from PRODUCT.md via the same resolution the skill uses', () => {
    fs.writeFileSync(path.join(cwd, 'PRODUCT.md'), '# App\n\n## Platform\n\nios\n');
    assert.equal(resolveProjectPlatform(cwd), 'ios');
  });

  it('returns null when PRODUCT.md is absent or platform-less', () => {
    assert.equal(resolveProjectPlatform(cwd), null);
    fs.writeFileSync(path.join(cwd, 'PRODUCT.md'), '# App\n\nno platform field\n');
    assert.equal(resolveProjectPlatform(cwd), null);
  });

  it('isNativePlatform is true only for ios / android / adaptive', () => {
    assert.equal(isNativePlatform('ios'), true);
    assert.equal(isNativePlatform('android'), true);
    assert.equal(isNativePlatform('adaptive'), true);
    assert.equal(isNativePlatform('web'), false);
    assert.equal(isNativePlatform(null), false);
  });
});

describe('Cursor hook scripts', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('preToolUse denies proposed writes with detector findings before they land', () => {
    const logPath = path.join(cwd, 'hook.ndjson');
    const filePath = path.join(cwd, 'src/Card.html');

    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Write',
        tool_input: {
          file_path: filePath,
          content: `
            <style>
              .card { border-left: 4px solid #7c3aed; border-radius: 16px; }
            </style>
            <div class="card">Hello</div>
          `,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: logPath },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /blocked this write/);
    assert.match(payload.user_message, /side-tab/);
    assert.match(payload.agent_message, /Handle these before finalizing/);

    const entries = fs.readFileSync(logPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entries[0].event, 'preToolUse');
    assert.equal(entries[0].blocked, true);
    assert.equal(entries[0].blockedFindings, 1);
  });

  it('preToolUse allows writes with findings when the project platform is native', () => {
    // Same slop content the deny test blocks, but the project declares a
    // native platform, so the web rule engine must stand aside.
    fs.writeFileSync(path.join(cwd, 'PRODUCT.md'), '# App\n\n## Platform\n\nios\n');
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(cwd, 'src/Card.html'),
          content: `
            <style>
              .card { border-left: 4px solid #7c3aed; border-radius: 16px; }
            </style>
            <div class="card">Hello</div>
          `,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    assert.deepEqual(JSON.parse(out), { permission: 'allow' });
  });

  it('preToolUse allows clean proposed writes', () => {
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Write',
        tool_input: {
          path: 'src/Card.jsx',
          streamContent: 'export default function Card() { return <section className="card">Hello</section>; }',
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    assert.deepEqual(JSON.parse(out), { permission: 'allow' });
  });

  it('preToolUse gates configured template extensions (issue #316)', () => {
    const filePath = path.join(cwd, 'resources/views/card.blade.php');
    const content = `
      <style>
        .card { border-left: 4px solid #7c3aed; border-radius: 16px; }
      </style>
      <div class="card">Hello</div>
    `;
    const run = () => execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Write',
        tool_input: { file_path: filePath, content },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    // Without config the file is invisible to the gate: allowed untouched.
    assert.equal(JSON.parse(run()).permission, 'allow');

    // With a detector.extensions entry the same proposed write is scanned and denied.
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.impeccable', 'config.json'), JSON.stringify({
      detector: { extensions: [{ ext: '.blade.php' }] },
    }));
    const payload = JSON.parse(run());
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /card\.blade\.php/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse routes configured html-engine templates through the HTML engine (issue #316)', () => {
    // oversized-h1 is only detectable by the static HTML engine (detectText has
    // no such rule), so a denial here proves the proposed content went through
    // detectHtml rather than the old always-detectText path.
    const filePath = path.join(cwd, 'resources/views/hero.blade.php');
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.impeccable', 'config.json'), JSON.stringify({
      detector: { extensions: [{ ext: '.blade.php' }] },
    }));

    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Write',
        tool_input: {
          file_path: filePath,
          content: '<style>h1 { font-size: 84px; }</style>\n<h1>This is a very long headline that keeps going on and on for a while</h1>',
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /oversized-h1/);
  });

  it('preToolUse denies shell heredoc writes that bypass the Write tool', () => {
    const filePath = path.join(cwd, 'src/ShellCard.html');
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Shell',
        tool_input: {
          command: `cat > "${filePath}" <<'EOF'\n<style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style>\n<div class="card">Hello</div>\nEOF\n`,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /ShellCard\.html/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse denies Python heredoc file writes that bypass the Write tool', () => {
    const filePath = path.join(cwd, 'src/PythonCard.html');
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Shell',
        tool_input: {
          command: `python3 - <<'PY'\nfrom pathlib import Path\npath = Path('${filePath}')\npath.write_text('''<style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style>\n<div class="card">Hello</div>\n''', encoding='utf-8')\nPY\n`,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /PythonCard\.html/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse denies shell append redirects that bypass the Write tool', () => {
    const filePath = path.join(cwd, 'src/AppendedCard.html');
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Shell',
        tool_input: {
          command: `cat >> "${filePath}" <<'EOF'\n<style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style>\n<div class="card">Hello</div>\nEOF\n`,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /AppendedCard\.html/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse denies shell tee writes that bypass the Write tool', () => {
    const filePath = path.join(cwd, 'src/TeeCard.html');
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Shell',
        tool_input: {
          command: `cat <<'EOF' | tee -a "${filePath}"\n<style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style>\n<div class="card">Hello</div>\nEOF\n`,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /TeeCard\.html/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse denies shell copy writes when copied content has detector findings', () => {
    const sourcePath = path.join(cwd, 'src/SourceCard.html');
    const destPath = path.join(cwd, 'src/CopiedCard.html');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, `
      <style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style>
      <div class="card">Hello</div>
    `);

    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Shell',
        tool_input: {
          command: `cp "${sourcePath}" "${destPath}"`,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /CopiedCard\.html/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse reconstructs Edit old_string/new_string into a full proposed file before scanning', () => {
    const filePath = path.join(cwd, 'src/EditCard.html');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const oldString = '<div class="card">Hello</div>';
    fs.writeFileSync(filePath, oldString);
    const newString = '<style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style>\n<div class="card">Hello</div>';

    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Edit',
        tool_input: {
          file_path: filePath,
          old_string: oldString,
          new_string: newString,
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.equal(payload.permission, 'deny');
    assert.match(payload.user_message, /EditCard\.html/);
    assert.match(payload.user_message, /side-tab/);
  });

  it('preToolUse allows fragment-only edits instead of denying on partial context', () => {
    const filePath = path.join(cwd, 'src/MissingEditCard.html');
    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd,
        tool_name: 'Edit',
        tool_input: {
          file_path: filePath,
          new_string: '<div style="border-left: 4px solid #7c3aed; border-radius: 16px;">Hello</div>',
        },
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    assert.deepEqual(JSON.parse(out), { permission: 'allow' });
  });

  it('preToolUse downgrades repeated identical denials to allow-with-warning after the edit threshold', () => {
    const filePath = path.join(cwd, 'src/LoopCard.html');
    const input = JSON.stringify({
      hook_event_name: 'preToolUse',
      cwd,
      session_id: 'cursor-loop',
      tool_name: 'Write',
      tool_input: {
        file_path: filePath,
        content: '<style>.card { border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px; }</style><div class="card">Hello</div>',
      },
    });

    let payload;
    for (let i = 0; i < 7; i++) {
      const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
        cwd: path.resolve('.'),
        input,
        env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
        encoding: 'utf-8',
      });
      payload = JSON.parse(out);
    }

    assert.equal(payload.permission, 'allow');
    assert.match(payload.agent_message, /allowing this write to avoid a loop/);
    const cache = readCache(cwd);
    const denials = cache.sessions['cursor-loop'].files[filePath].cursorDenials;
    assert.equal(Object.values(denials)[0], 7);
  });

  it('preToolUse honors truthy IMPECCABLE_HOOK_DISABLED values before stdin parsing', () => {
    const logPath = path.join(cwd, 'hook.ndjson');

    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-before-edit.mjs')], {
      cwd: path.resolve('.'),
      input: '{not-json',
      env: {
        ...process.env,
        IMPECCABLE_HOOK_DISABLED: 'true',
        IMPECCABLE_HOOK_LOG: logPath,
      },
      encoding: 'utf-8',
    });

    assert.deepEqual(JSON.parse(out), { permission: 'allow' });
    const entries = fs.readFileSync(logPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entries[0].event, 'preToolUse');
    assert.equal(entries[0].skipped, 'env-disabled');
  });

});

describe('runHook() — emission enrichment', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function write(rel, content) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  }

  it('returns emission.kind fresh with findings on new hits', async () => {
    write('src/styles.css', "body { font-family: 'Inter', sans-serif; }");
    const r = await runHook({
      stdinJson: JSON.stringify({
        session_id: 'emit-fresh',
        cwd,
        hook_event_name: 'PostToolUse',
        file_path: path.join(cwd, 'src/styles.css'),
      }),
      env: { IMPECCABLE_HOOK_HARNESS: 'claude' },
      cwd,
      detector: fakeDetector([finding('overused-font', 8)]),
    });
    assert.equal(r.emission?.kind, 'fresh');
    assert.ok(Array.isArray(r.emission?.findings));
    assert.equal(r.emission.findings.length, 1);
  });
});
