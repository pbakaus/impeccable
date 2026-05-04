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

import { isGeneratedFile } from '../skill/scripts/is-generated.mjs';
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
          }
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}
