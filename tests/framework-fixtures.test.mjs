/**
 * Drives live-mode scripts against representative framework project shapes.
 *
 * Each fixture under tests/framework-fixtures/ is a small project tree with a
 * fixture.json that declares the inject config + expected is-generated and
 * wrap outcomes. The harness copies the fixture into a tmp git repo, applies
 * the fixture's gitignore, and runs the live scripts against it.
 *
 * Run with: node --test tests/framework-fixtures.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isGeneratedFile } from '../skill/scripts/lib/is-generated.mjs';
import { detectCsp } from '../skill/scripts/detect-csp.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', 'skill', 'scripts');
const FIXTURES_DIR = join(__dirname, 'framework-fixtures');

function listFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(FIXTURES_DIR, e.name, 'fixture.json')))
    .map((e) => e.name);
}

/**
 * Stage a fixture into a fresh tmp git repo. Returns the tmp path + loaded
 * fixture.json. Caller is responsible for cleanup.
 */
function stageFixture(name) {
  const fixtureRoot = join(FIXTURES_DIR, name);
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf-8'));
  const gitignore = readFileSync(join(fixtureRoot, 'gitignore.txt'), 'utf-8');

  const tmp = mkdtempSync(join(tmpdir(), 'impeccable-fixture-'));
  cpSync(join(fixtureRoot, 'files'), tmp, { recursive: true });
  writeFileSync(join(tmp, '.gitignore'), gitignore);
  mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
  writeFileSync(join(tmp, '.impeccable', 'live', 'config.json'), JSON.stringify(fixture.config));

  execFileSync('git', ['init', '-q'], { cwd: tmp });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: tmp });
  execFileSync('git', ['add', '-A'], { cwd: tmp });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: tmp });

  return { tmp, fixture };
}

function runScript(script, args, opts = {}) {
  try {
    return execFileSync('node', [join(SCRIPTS_DIR, script), ...args], {
      encoding: 'utf-8',
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
    });
  } catch (err) {
    return { error: err.stdout?.toString() || '' , stderr: err.stderr?.toString() || '' };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const name of listFixtures()) {
  describe(`fixture · ${name}`, () => {
    it('loads fixture.json and has expected tree', () => {
      const { tmp, fixture } = stageFixture(name);
      try {
        assert.ok(fixture.name, 'fixture has a name');
        assert.ok(Array.isArray(fixture.config.files) && fixture.config.files.length > 0);
        rmSync(tmp, { recursive: true, force: true });
      } catch (err) {
        rmSync(tmp, { recursive: true, force: true });
        throw err;
      }
    });

    it('is-generated classifies files correctly', () => {
      const { tmp, fixture } = stageFixture(name);
      try {
        for (const rel of fixture.sourceFiles || []) {
          assert.equal(
            isGeneratedFile(rel, { cwd: tmp }),
            false,
            `${rel} should classify as source`
          );
        }
        for (const rel of fixture.generatedFiles || []) {
          assert.equal(
            isGeneratedFile(rel, { cwd: tmp }),
            true,
            `${rel} should classify as generated`
          );
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('live-inject --port adds the script tag to every config file', () => {
      const { tmp } = stageFixture(name);
      try {
        const out = runScript('live-inject.mjs', ['--port', '9999'], { cwd: tmp });
        const result = JSON.parse(typeof out === 'string' ? out : out.error);
        assert.equal(result.ok, true, 'inject succeeded');
        assert.equal(result.gitIgnore?.mode, 'git-info-exclude', 'live runtime ignores are installed locally');
        const ignored = execFileSync('git', [
          'check-ignore',
          '.impeccable/live/server.json',
          '.impeccable/live/sessions/example.jsonl',
          '.impeccable/live/previews/example/v1.html',
          '.impeccable/live/artifacts/example-r1.jsx',
          '.impeccable/live/accept-receipts/example.json',
          '.impeccable/live/locks/example.lock',
          '.impeccable/live/deferred-svelte-component-accepts.json',
          'src/lib/impeccable/ImpeccableLiveRoot.svelte',
          'src/lib/impeccable/__runtime.js',
          'src/lib/impeccable/a4ac4e74/v3.svelte',
        ], { cwd: tmp, encoding: 'utf-8' });
        assert.match(ignored, /\.impeccable\/live\/server\.json/);
        assert.match(ignored, /\.impeccable\/live\/sessions\/example\.jsonl/);
        assert.match(ignored, /\.impeccable\/live\/previews\/example\/v1\.html/);
        assert.match(ignored, /\.impeccable\/live\/artifacts\/example-r1\.jsx/);
        assert.match(ignored, /\.impeccable\/live\/accept-receipts\/example\.json/);
        assert.match(ignored, /\.impeccable\/live\/locks\/example\.lock/);
        assert.match(ignored, /\.impeccable\/live\/deferred-svelte-component-accepts\.json/);
        assert.match(ignored, /src\/lib\/impeccable\/ImpeccableLiveRoot\.svelte/);
        assert.match(ignored, /src\/lib\/impeccable\/__runtime\.js/);
        assert.match(ignored, /src\/lib\/impeccable\/a4ac4e74\/v3\.svelte/);
        if (result.adapter === 'sveltekit') {
          const layout = readFileSync(join(tmp, 'src/routes/+layout.svelte'), 'utf-8');
          const appHtml = readFileSync(join(tmp, 'src/app.html'), 'utf-8');
          const root = readFileSync(join(tmp, 'src/lib/impeccable/ImpeccableLiveRoot.svelte'), 'utf-8');
          assert.match(layout, /impeccable-live-svelte-start/, 'SvelteKit layout got the adapter marker');
          assert.match(layout, /ImpeccableLiveRoot/, 'SvelteKit layout renders the adapter host');
          assert.doesNotMatch(appHtml, /impeccable-live-start/, 'SvelteKit app.html must remain untouched');
          assert.doesNotMatch(appHtml, /localhost:9999\/live\.js/, 'SvelteKit app.html must not own live.js');
          assert.match(root, /localhost:9999\/live\.js/, 'SvelteKit root component loads live.js');
          return;
        }
        if (result.adapter === 'nuxt') {
          const plugin = result.results[0];
          const body = readFileSync(join(tmp, plugin.file), 'utf-8');
          assert.equal(plugin.inserted, true, 'Nuxt client plugin was created');
          assert.match(body, /impeccable-live-nuxt-plugin/);
          assert.match(body, /if \(!import\.meta\.dev/);
          assert.match(body, /localhost:9999\/live\.js/);
          return;
        }
        for (const r of result.results) {
          assert.ok(r.inserted, `${r.file} got the tag (result: ${JSON.stringify(r)})`);
          const body = readFileSync(join(tmp, r.file), 'utf-8');
          assert.match(body, /impeccable-live-start/);
          assert.match(body, /localhost:9999\/live\.js/);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('live-inject --remove strips the script tag cleanly', () => {
      const { tmp } = stageFixture(name);
      try {
        runScript('live-inject.mjs', ['--port', '9999'], { cwd: tmp });
        const out = runScript('live-inject.mjs', ['--remove'], { cwd: tmp });
        const result = JSON.parse(typeof out === 'string' ? out : out.error);
        assert.equal(result.ok, true, 'remove succeeded');
        if (result.adapter === 'sveltekit') {
          const layout = readFileSync(join(tmp, 'src/routes/+layout.svelte'), 'utf-8');
          const appHtml = readFileSync(join(tmp, 'src/app.html'), 'utf-8');
          assert.doesNotMatch(layout, /ImpeccableLiveRoot/);
          assert.doesNotMatch(layout, /impeccable-live-svelte-start/);
          assert.doesNotMatch(appHtml, /impeccable-live-start/);
          assert.equal(existsSync(join(tmp, 'src/lib/impeccable/ImpeccableLiveRoot.svelte')), false);
          return;
        }
        if (result.adapter === 'nuxt') {
          assert.equal(result.results[0].removed, true);
          assert.equal(existsSync(join(tmp, result.results[0].file)), false, 'Nuxt client plugin was removed');
          return;
        }
        for (const r of result.results) {
          const body = readFileSync(join(tmp, r.file), 'utf-8');
          assert.doesNotMatch(body, /impeccable-live-start/);
          assert.doesNotMatch(body, /live\.js/);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('detect-csp classifies CSP shape correctly', () => {
      const { tmp, fixture } = stageFixture(name);
      try {
        const expected = fixture.csp?.shape ?? null;
        const result = detectCsp(tmp);
        assert.equal(
          result.shape,
          expected,
          `expected CSP shape ${expected}, got ${result.shape}; signals: ${JSON.stringify(result.signals)}`
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('live-wrap routes to the expected source (or emits the expected fallback)', () => {
      const { tmp, fixture } = stageFixture(name);
      try {
        for (const [i, wc] of (fixture.wrapCases || []).entries()) {
          const flags = [];
          if (wc.args.elementId) flags.push('--element-id', wc.args.elementId);
          if (wc.args.classes) flags.push('--classes', wc.args.classes);
          if (wc.args.tag) flags.push('--tag', wc.args.tag);
          flags.push('--id', `wraptest${i}`, '--count', '3');

          const out = runScript('live-wrap.mjs', flags, { cwd: tmp });
          const payload = typeof out === 'string' ? out : (out.error || out.stderr);
          const parsed = JSON.parse(payload.trim().split('\n').pop());

          if (wc.expectsError) {
            assert.equal(parsed.error, wc.expectsError, `wrap case "${wc.name}": expected error ${wc.expectsError}, got ${JSON.stringify(parsed)}`);
          } else {
            assert.equal(parsed.file, wc.expectedFile, `wrap case "${wc.name}": landed in ${parsed.file}, expected ${wc.expectedFile}`);
            if (wc.expectedSourceFile) {
              assert.equal(parsed.sourceFile, wc.expectedSourceFile, `wrap case "${wc.name}": source file`);
            }
            if (wc.expectedPreviewMode) {
              assert.equal(parsed.previewMode, wc.expectedPreviewMode, `wrap case "${wc.name}": preview mode`);
            }
          }
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}
