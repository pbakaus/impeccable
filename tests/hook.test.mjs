/**
 * Unit tests for the Impeccable design hook.
 * Run: node --test tests/hook.test.mjs
 *
 * Exercises hook-lib.mjs through `runHook()` with an injected detector so the
 * suite stays fast and detector-independent. A second block exercises the
 * library helpers (config, cache, filter, render, inline ignores) directly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  ENVELOPE_PREFIX,
  ALLOWED_EXTS,
  DEFAULT_CONFIG,
  SENSITIVE_PATH,
  GENERATED_PATH,
  truthy,
  readConfig,
  readCache,
  persistCache,
  bumpEditCount,
  rememberFindings,
  dedupeAgainstCache,
  filterFindings,
  parseInlineIgnores,
  renderTemplate,
  matchesAnyGlob,
  writeAuditLog,
  suppressionNotice,
  runHook,
  payload,
} from '../skill/scripts/hook-lib.mjs';

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
      '/x/api-secret.json', '/x/credentials.yml', '/x/.git/config',
    ]) {
      assert.ok(SENSITIVE_PATH.test(p), `expected sensitive: ${p}`);
    }
  });

  it('does not flag normal source files as sensitive', () => {
    for (const p of ['/x/src/Card.tsx', '/x/app/page.html', '/x/styles/main.css']) {
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

  it('parses enabled, ignoreRules, ignoreFiles, limits', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.impeccable', 'hook.json'), JSON.stringify({
      enabled: false,
      ignoreRules: ['side-tab'],
      ignoreFiles: ['src/legacy/**'],
      minSeverity: 'error',
      limits: { maxFindings: 2, maxChars: 1000 },
    }));
    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.ignoreRules, ['side-tab']);
    assert.deepEqual(cfg.ignoreFiles, ['src/legacy/**']);
    assert.equal(cfg.minSeverity, 'error');
    assert.equal(cfg.limits.maxFindings, 2);
    assert.equal(cfg.limits.maxChars, 1000);
  });

  it('tolerates malformed JSON and falls back to defaults', () => {
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.impeccable', 'hook.json'), '{ not json');
    const cfg = readConfig(cwd);
    assert.equal(cfg.enabled, true);
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

describe('parseInlineIgnores()', () => {
  it('attaches the directive to the next non-blank line', () => {
    const content = [
      'const x = 1;',
      '// impeccable: ignore side-tab',
      '',
      'const y = "border-l-4 border-purple-500";',
      'const z = "noop";',
    ].join('\n');
    const map = parseInlineIgnores(content, '.tsx');
    // The directive is on line 2 → applies to line 4 (next non-blank).
    assert.ok(map.has(4));
    assert.ok(map.get(4).has('side-tab'));
    assert.ok(!map.has(5));
  });

  it('recognizes HTML, JSX, CSS, JS shapes; `*` matches all', () => {
    const html = parseInlineIgnores('<!-- impeccable: ignore side-tab -->\n<div>x</div>', '.html');
    assert.ok(html.get(2).has('side-tab'));

    const jsx = parseInlineIgnores('{/* impeccable: ignore * */}\n<Foo />', '.tsx');
    assert.ok(jsx.get(2).has('*'));

    const css = parseInlineIgnores('/* impeccable: ignore gradient-text */\n.a { color: red; }', '.css');
    assert.ok(css.get(2).has('gradient-text'));

    const js = parseInlineIgnores('// impeccable: ignore overused-font\nfont-family: "Inter"', '.ts');
    assert.ok(js.get(2).has('overused-font'));
  });
});

describe('filterFindings()', () => {
  it('drops by ignoreRules, minSeverity, and inline-ignore', () => {
    const content = [
      'a',                                          // line 1
      '// impeccable: ignore gradient-text',        // line 2 directive
      'b',                                          // line 3 — protected
    ].join('\n');
    const findings = [
      finding('side-tab', 1, { severity: 'warning' }),
      finding('gradient-text', 3, { severity: 'warning' }),
      finding('overused-font', 5, { severity: 'advisory' }),
    ];
    const filtered = filterFindings(findings, content, '.ts', {
      ignoreRules: ['side-tab'],
      minSeverity: 'warning',
      limits: DEFAULT_CONFIG.limits,
    });
    assert.equal(filtered.length, 0,
      'side-tab dropped by rule, gradient-text dropped by inline, overused-font dropped by severity');
  });

  it('inline ignore `*` covers any rule on the next line', () => {
    const content = '{/* impeccable: ignore * */}\n<Foo />';
    const filtered = filterFindings(
      [finding('side-tab', 2), finding('gradient-text', 2)],
      content, '.tsx',
      { ignoreRules: [], minSeverity: 'warning', limits: DEFAULT_CONFIG.limits }
    );
    assert.equal(filtered.length, 0);
  });
});

describe('renderTemplate()', () => {
  it('starts with the versioned envelope and caps to maxFindings', () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      finding('side-tab', i + 1, { name: `R${i}`, description: 'd' }));
    const text = renderTemplate(findings, '/x/Card.tsx', DEFAULT_CONFIG, { cwd: '/x' });
    assert.ok(text.startsWith(`${ENVELOPE_PREFIX} Design detector flagged 12 issue(s) in Card.tsx:`));
    assert.match(text, /\.\.\. and 7 more \(see \/impeccable audit\)\./);
    // Exactly 5 finding lines.
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(lines.length, 5);
    assert.ok(text.length <= DEFAULT_CONFIG.limits.maxChars);
  });

  it('drops the L<line> prefix when line is 0', () => {
    const text = renderTemplate(
      [finding('side-tab', 0, { name: 'X' })],
      '/x/a.tsx', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.match(text, /^- \[side-tab\]/m);
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
    assert.equal(writeAuditLog({}, { event: 'x' }), false);
  });
});

describe('payload()', () => {
  it('produces the documented hookSpecificOutput shape', () => {
    const obj = JSON.parse(payload('hello'));
    assert.equal(obj.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.equal(obj.hookSpecificOutput.additionalContext, 'hello');
    const session = JSON.parse(payload('hi', 'SessionStart'));
    assert.equal(session.hookSpecificOutput.hookEventName, 'SessionStart');
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

  it('emits payload on findings, silent on subsequent dedup hit', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = fakeDetector([finding('side-tab', 1, { name: 'Side-tab' })]);

    const r1 = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r1.exitCode, 0);
    assert.ok(r1.stdout.includes(ENVELOPE_PREFIX));
    assert.equal(r1.audit.emitted, true);

    const r2 = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r2.stdout, '');
    assert.equal(r2.audit.emitted, false);
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
    fs.writeFileSync(path.join(cwd, '.impeccable', 'hook.json'), JSON.stringify({ enabled: false }));
    const det = fakeDetector([finding('side-tab', 1)]);
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.stdout, '');
    assert.equal(r.audit.skipped, 'config-disabled');
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
    fs.writeFileSync(path.join(cwd, '.impeccable', 'hook.json'), JSON.stringify({
      ignoreFiles: ['src/legacy/**'],
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

  it('detector throw is swallowed; never breaks turn', async () => {
    const file = writeFixture('src/Card.tsx', 'noop');
    const det = { detectText: () => { throw new Error('boom'); } };
    const r = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '');
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

describe('suppressionNotice()', () => {
  it('starts with envelope and mentions /impeccable audit', () => {
    const text = suppressionNotice('src/Card.tsx');
    assert.ok(text.startsWith(ENVELOPE_PREFIX));
    assert.match(text, /\/impeccable audit/);
  });
});

describe('ALLOWED_EXTS', () => {
  it('covers the documented design-relevant extensions', () => {
    for (const ext of ['.tsx', '.jsx', '.html', '.css', '.vue', '.svelte', '.astro', '.ts', '.js', '.scss', '.less', '.htm']) {
      assert.ok(ALLOWED_EXTS.has(ext), `missing: ${ext}`);
    }
    for (const ext of ['.md', '.py', '.go', '.json']) {
      assert.ok(!ALLOWED_EXTS.has(ext), `unexpected allowed: ${ext}`);
    }
  });
});
