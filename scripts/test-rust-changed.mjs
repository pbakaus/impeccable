#!/usr/bin/env node
// Run the Rust tests for the crates a change touches and every workspace
// crate that depends on them, instead of the whole workspace.
//
//   node scripts/test-rust-changed.mjs [--base <ref>] [--print] [-- <cargo test args>]
//
// The change is the working tree (committed, staged, unstaged and untracked)
// against the merge base with `--base` (default origin/main). A file under
// crates/<dir>/ selects that crate. A file outside crates/ selects every crate
// whose sources name its path or one of its directories (include_str!, a
// fixture dir), so fixtures, browser-bundle/, ui/ and skill/scripts/ edits
// reach the crates that read them. Cargo.toml, Cargo.lock,
// rust-toolchain.toml and .cargo/ select the whole workspace. Then every
// workspace crate that depends on a selected one, dev-dependencies included,
// joins the run.
//
// The full cargo output goes to target/test-rust-changed.log; stdout gets the
// selection, then one summary line (and the failing test names). The exit
// code is cargo's. `--print` only prints the selection.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectCrates } from './lib/rust-test-selection.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const argv = process.argv.slice(2);
const dashDash = argv.indexOf('--');
const own = dashDash === -1 ? argv : argv.slice(0, dashDash);
const passthrough = dashDash === -1 ? [] : argv.slice(dashDash + 1);
if (own.includes('--help') || own.includes('-h')) {
  console.log('usage: node scripts/test-rust-changed.mjs [--base <ref>] [--print] [-- <cargo test args>]');
  process.exit(0);
}
const baseAt = own.indexOf('--base');
const base = baseAt === -1 ? 'origin/main' : own[baseAt + 1];
if (!base) fail('--base needs a ref');
const printOnly = own.includes('--print');

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
// NUL-separated output keeps paths verbatim: without -z git quotes and
// escapes a name such as `café.html`, which then matches no crate.
const paths = (text) => text.split('\0').filter(Boolean);

let mergeBase;
try {
  mergeBase = git(['merge-base', base, 'HEAD']).trim();
} catch {
  fail(`no merge base with ${base}; fetch it first or pass --base <ref>`);
}
const changed = [...new Set([
  // --no-renames lists both sides of a move, so a file moved out of a crate
  // still selects the crate it left.
  ...paths(git(['diff', '--name-only', '--no-renames', '-z', mergeBase])),
  ...paths(git(['ls-files', '--others', '--exclude-standard', '-z'])),
])];

const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
  cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
}));
const packages = metadata.packages.map((p) => ({
  name: p.name,
  dir: path.relative(ROOT, path.dirname(p.manifest_path)).split(path.sep).join('/'),
  deps: p.dependencies.filter((d) => d.path).map((d) => d.name),
}));

const searchCrates = (terms) => {
  try {
    return paths(git(['grep', '-l', '-z', '-F', ...terms.flatMap((t) => ['-e', t]), '--', 'crates']));
  } catch (error) {
    if (error.status === 1) return []; // git grep exits 1 when nothing matches
    throw error;
  }
};
const { whole, selected } = selectCrates({ changed, packages, searchCrates });

if (whole.length) {
  console.log(`Whole workspace: ${whole.join(', ')} changed against ${base}.`);
} else if (!selected.size) {
  console.log(`No Rust crate is affected by the ${changed.length} changed file(s) against ${base}.`);
  process.exit(0);
} else {
  console.log(`${selected.size} of ${packages.length} crates against ${base}:`);
  for (const name of [...selected.keys()].sort()) console.log(`  ${name}  (${selected.get(name)})`);
}

const cargoArgs = ['test', ...(whole.length ? ['--workspace'] : [...selected.keys()].sort().flatMap((n) => ['-p', n])), '--no-fail-fast', ...passthrough];
console.log(`cargo ${cargoArgs.join(' ')}`);
if (printOnly) process.exit(0);

const logPath = path.join(metadata.target_directory, 'test-rust-changed.log');
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const log = fs.createWriteStream(logPath);
console.log(`Log: ${logPath}`);
const started = Date.now();
const child = spawn('cargo', cargoArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    log.write(chunk);
    output += chunk;
  });
}
child.on('close', (code, signal) => {
  log.end();
  let passed = 0;
  let failed = 0;
  for (const m of output.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed/gm)) {
    passed += Number(m[1]);
    failed += Number(m[2]);
  }
  const failures = [...output.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((m) => m[1]);
  const secs = Math.round((Date.now() - started) / 1000);
  const status = code === 0 ? 'ok' : `FAILED (exit ${code ?? signal})`;
  console.log(`${status}: ${passed} passed, ${failed} failed in ${secs}s`);
  for (const name of failures) console.log(`  FAILED ${name}`);
  if (code !== 0 && !failures.length) console.log(`  see the log for the error: ${logPath}`);
  // exitCode rather than exit(): the log stream may still be flushing.
  process.exitCode = code ?? 1;
});

function fail(message) {
  console.error(`test-rust-changed: ${message}`);
  process.exit(2);
}
