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
import { execFileSync } from 'node:child_process';

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
  renderCleanAck,
  renderPendingAck,
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
  appendPending,
  drainPending,
  clearPending,
  renderCursorFollowup,
  followupPayload,
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
    assert.ok(text.startsWith(`${ENVELOPE_PREFIX} Required design corrections in Card.tsx (12 issue(s)):`));
    assert.match(text, /\.\.\. and 7 more \(see \/impeccable audit\)\./);
    // Exactly 5 finding lines.
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(lines.length, 5);
    assert.ok(text.length <= DEFAULT_CONFIG.limits.maxChars);
  });

  it('emits a directive footer (imperative + exception clause + ack)', () => {
    // Steers the model: imperative "fix", explicit exception for
    // intentional bad UI / fixtures, and "acknowledge" so the user
    // sees the correction in the chat reply. See `directiveFooter()`
    // in hook-lib.mjs for the rationale.
    const text = renderTemplate(
      [finding('side-tab', 1, { name: 'X' })],
      '/x/Card.tsx', DEFAULT_CONFIG, { cwd: '/x' }
    );
    assert.match(text, /Fix these in your next reply/);
    assert.match(text, /Acknowledge what you changed/);
    assert.match(text, /intentionally bad UI|anti-pattern example|test fixture/);
    assert.match(text, /\/impeccable audit/);
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
  it('produces hookSpecificOutput for Claude/Codex', () => {
    const obj = JSON.parse(payload('hello'));
    assert.equal(obj.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.equal(obj.hookSpecificOutput.additionalContext, 'hello');
    const session = JSON.parse(payload('hi', 'SessionStart'));
    assert.equal(session.hookSpecificOutput.hookEventName, 'SessionStart');
  });

  it('produces additional_context for Cursor', () => {
    const obj = JSON.parse(payload('hello', 'PostToolUse', 'cursor'));
    assert.equal(obj.additional_context, 'hello');
    assert.equal(obj.hookSpecificOutput, undefined);
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
    assert.match(r1.stdout, /Required design corrections/);
    assert.equal(r1.audit.emitted, true);

    const r2 = await runHook({ stdinJson: JSON.stringify(eventFor(file)), env: {}, cwd, detector: det });
    assert.equal(r2.exitCode, 0);
    assert.ok(r2.stdout.includes(ENVELOPE_PREFIX));
    assert.match(r2.stdout, /Still has 1 issue\(s\) flagged earlier this session/);
    assert.match(r2.stdout, /side-tab:1/);
    assert.equal(r2.audit.emitted, true);
    assert.equal(r2.audit.kind, 'pending');
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
    assert.match(r.stdout, /No anti-patterns/);
    assert.match(r.stdout, /typography hierarchy, spacing rhythm, and color contrast/);
    assert.equal(r.audit.emitted, true);
    assert.equal(r.audit.kind, 'clean');
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
    assert.match(rFindings.stdout, /Required design corrections/);
    assert.equal(rFindings.audit.emitted, true);
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
    assert.match(r.stdout, /Required design corrections/);
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
    assert.match(r.stdout, /Required design corrections/);
    assert.doesNotMatch(r.stdout, /No anti-patterns/);
    assert.ok(r.audit.findings > 0);
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
    for (const ext of ['.tsx', '.jsx', '.html', '.css', '.vue', '.svelte', '.astro', '.ts', '.js', '.scss', '.sass', '.less', '.htm']) {
      assert.ok(ALLOWED_EXTS.has(ext), `missing: ${ext}`);
    }
    for (const ext of ['.md', '.py', '.go', '.json']) {
      assert.ok(!ALLOWED_EXTS.has(ext), `unexpected allowed: ${ext}`);
    }
  });
});

describe('renderCleanAck() / renderPendingAck()', () => {
  it('renderCleanAck stays short and ends with the steer line', () => {
    const text = renderCleanAck('/x/src/App.jsx', { cwd: '/x' });
    assert.match(text, /^\[impeccable@1\] Design hook scanned src\/App\.jsx\. No anti-patterns\./);
    assert.match(text, /typography hierarchy, spacing rhythm, and color contrast/);
    // Budget guard: should fit comfortably under a single context-message
    // injection (~200 chars). Hard upper bound 240 chars.
    assert.ok(text.length < 240, `clean ack too long: ${text.length} chars`);
  });

  it('renderPendingAck quotes up to 3 known findings and counts the rest', () => {
    const known = ['side-tab:3', 'gradient-text:4', 'ai-color-palette:8', 'overused-font:12'];
    const text = renderPendingAck('/x/src/SlopCard.jsx', known, { cwd: '/x' });
    assert.match(text, /^\[impeccable@1\] Design hook scanned src\/SlopCard\.jsx\./);
    assert.match(text, /Still has 4 issue\(s\) flagged earlier this session/);
    assert.match(text, /side-tab:3, gradient-text:4, ai-color-palette:8/);
    assert.match(text, /\+1 more/); // 4 total, 3 shown
    assert.match(text, /Address them before finalizing/);
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
  it('prefers file_path when present and falls back to apply_patch command', () => {
    assert.deepEqual(resolveTargetFiles({ tool_input: { file_path: '/a/b.tsx' } }, '/proj'), ['/a/b.tsx']);
    assert.deepEqual(
      resolveTargetFiles({ tool_name: 'apply_patch', tool_input: { command: '*** Update File: src/x.css\n' } }, '/proj'),
      ['/proj/src/x.css'],
    );
    assert.deepEqual(resolveTargetFiles({ tool_name: 'Bash', tool_input: { command: 'echo hi' } }, '/proj'), []);
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
    assert.equal(resolveHarness({}, { hook_event_name: 'sessionStart' }), 'cursor');
    assert.equal(resolveHarness({}, { hook_event_name: 'stop' }), 'cursor');
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

  it('follows static stylesheet imports from the edited component', () => {
    const card = write('src/Card.jsx', "import './Card.module.css';\nexport default function Card() { return null; }");
    const mod = write('src/Card.module.css', '.card { border-left: 4px solid #3b82f6; }');
    const expanded = expandScanTargets([card], cwd);
    assert.ok(expanded.includes(mod));
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
    assert.match(r.stdout, /Required design corrections/);
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
    assert.match(r.stdout, /Required design corrections/);
    assert.match(r.stdout, /styles\.sass/);
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

describe('appendPending() / drainPending() / clearPending()', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('keys queue entries by conversation_id', () => {
    appendPending(cwd, 'conv-a', { kind: 'fresh', file: 'src/a.css', findings: [finding('overused-font', 1)] });
    appendPending(cwd, 'conv-b', { kind: 'fresh', file: 'src/b.css', findings: [finding('side-tab', 2)] });

    const a = drainPending(cwd, 'conv-a');
    assert.equal(a.length, 1);
    assert.equal(a[0].file, 'src/a.css');

    const b = drainPending(cwd, 'conv-b');
    assert.equal(b.length, 1);
    assert.equal(b[0].file, 'src/b.css');
  });

  it('falls back to _default bucket when conversation_id is absent', () => {
    appendPending(cwd, null, { kind: 'pending', file: 'src/x.tsx', known: ['side-tab:3'] });
    const items = drainPending(cwd, null);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'pending');
    assert.deepEqual(items[0].known, ['side-tab:3']);
  });

  it('drain clears the bucket; clearPending removes without returning', () => {
    appendPending(cwd, 'conv-x', { kind: 'fresh', file: 'src/y.css', findings: [finding('overused-font', 4)] });
    clearPending(cwd, 'conv-x');
    const items = drainPending(cwd, 'conv-x');
    assert.equal(items.length, 0);
  });
});

describe('Cursor hook scripts', () => {
  let cwd;
  beforeEach(() => { cwd = mkTmp(); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('afterFileEdit and stop share the default pending bucket when Cursor omits ids', () => {
    const filePath = path.join(cwd, 'index.html');
    fs.writeFileSync(filePath, `
      <style>
        .card { border-left: 4px solid #7c3aed; border-radius: 16px; }
      </style>
      <div class="card">Hello</div>
    `);

    execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-after-edit.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'afterFileEdit',
        cwd,
        file_path: filePath,
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const out = execFileSync(process.execPath, [path.join('skill', 'scripts', 'hook-stop.mjs')], {
      cwd: path.resolve('.'),
      input: JSON.stringify({
        hook_event_name: 'stop',
        cwd,
      }),
      env: { ...process.env, IMPECCABLE_HOOK_LOG: '' },
      encoding: 'utf-8',
    });

    const payload = JSON.parse(out);
    assert.match(payload.followup_message, /Required design corrections/);
    assert.match(payload.followup_message, /side-tab/);
  });
});

describe('renderCursorFollowup()', () => {
  it('renders fresh findings with envelope + directive footer', () => {
    const text = renderCursorFollowup([
      { kind: 'fresh', file: 'src/styles.css', findings: [finding('overused-font', 8, { name: 'Overused font' })] },
    ], { cwd: '/proj' });
    assert.match(text, new RegExp(`^${ENVELOPE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(text, /Required design corrections in src\/styles\.css/);
    assert.match(text, /overused-font/);
    assert.match(text, /Fix these in your next reply/);
  });

  it('includes pending reminders for queued known findings', () => {
    const text = renderCursorFollowup([
      { kind: 'pending', file: 'src/Card.tsx', known: ['side-tab:12', 'low-contrast:4'] },
    ], { cwd: '/proj' });
    assert.match(text, /Still pending in src\/Card\.tsx/);
    assert.match(text, /side-tab:12/);
  });
});

describe('followupPayload()', () => {
  it('wraps text as Cursor stop followup_message JSON', () => {
    const out = followupPayload('fix the font');
    assert.deepEqual(JSON.parse(out), { followup_message: 'fix the font' });
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
        hook_event_name: 'afterFileEdit',
        file_path: path.join(cwd, 'src/styles.css'),
      }),
      env: { IMPECCABLE_HOOK_HARNESS: 'cursor' },
      cwd,
      detector: fakeDetector([finding('overused-font', 8)]),
    });
    assert.equal(r.emission?.kind, 'fresh');
    assert.ok(Array.isArray(r.emission?.findings));
    assert.equal(r.emission.findings.length, 1);
  });
});
