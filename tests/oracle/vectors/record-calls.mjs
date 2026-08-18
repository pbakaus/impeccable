#!/usr/bin/env node
/**
 * Record function-level vectors for the pure engine modules by running the
 * detect CLI (with the recorder hooks loaded) over the antipattern fixture
 * corpus and the oracle workspaces.
 *
 *   node tests/oracle/vectors/record-calls.mjs
 *
 * Output: tests/oracle/vectors/calls/<module>/<fn>.jsonl, one
 * {args, result} object per line, deduplicated by args. Plus _skipped.json,
 * which names the functions whose calls held non-plain data (DOM elements,
 * closures) and therefore need adapter-level coverage instead.
 *
 * Also runs the unit tests that exercise pure functions directly, so
 * hand-written edge cases in tests/*.test.mjs land in the vectors too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(HERE, 'calls');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const env = { ...process.env, IMPECCABLE_VECTORS_DIR: OUT, NO_COLOR: '1' };
const hook = path.join(HERE, 'hooks.mjs');
const cli = path.join(REPO, 'cli', 'bin', 'cli.js');

function run(args, cwd = REPO) {
  const r = spawnSync(process.execPath, ['--import', hook, ...args], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

const fixtures = path.join(REPO, 'tests', 'fixtures', 'antipatterns');
process.stdout.write('scanning fixture corpus (no config)...\n');
run([cli, 'detect', '--no-config', '--json', fixtures]);
process.stdout.write('scanning fixture corpus (with config, from oracle workspace)...\n');
const ws = path.join(REPO, 'tests', 'oracle', 'workspaces', 'detect-config');
run([cli, 'detect', '--json', 'src'], ws);
run([cli, 'detect', '--json', 'src/inline.html'], ws);
run([cli, 'detect', '--json', 'src/styles.css'], ws);

// Unit tests that call pure functions directly (node --test files only; the
// bun-run tests are not hookable this way).
const unitTests = fs.readdirSync(path.join(REPO, 'tests'))
  .filter(f => /^(detect-antipatterns-fixtures|inline-ignores|design-parser|design-system|detect-antipatterns-browser)\.test\.mjs$/.test(f))
  .map(f => path.join(REPO, 'tests', f));
for (const t of unitTests) {
  process.stdout.write(`running ${path.basename(t)} under recorder...\n`);
  run(['--test', t]);
}

let total = 0;
for (const mod of fs.readdirSync(OUT)) {
  const dir = path.join(OUT, mod);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    const n = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).length;
    total += n;
    process.stdout.write(`${mod}/${f}: ${n}\n`);
  }
}
process.stdout.write(`\n${total} vectors\n`);
