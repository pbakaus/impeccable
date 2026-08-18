/**
 * Oracle harness: records the observable behavior of every impeccable verb
 * (stdout, stderr, exit code, files written) against a fixed corpus, and
 * replays the same corpus against an alternate implementation to diff.
 *
 * Two implementations are addressable:
 *   - js  (default): the Node scripts in skill/scripts and cli/bin
 *   - bin: an executable at $IMPECCABLE_BIN invoked as `<bin> <verb> ...args`
 *
 * A case is { id, verb, args, cwd?, stdin?, env?, files?, workspace? }:
 *   - workspace: name of a dir under tests/oracle/workspaces to copy into a
 *     temp dir and use as cwd (so writes never touch the repo)
 *   - cwd: subpath inside the staged workspace (default '.')
 *   - files: globs (relative to staged workspace) to snapshot after the run
 *   - args may contain <WS> and <REPO> placeholders
 *
 * Normalization replaces the staged workspace path with <WS>, the repo root
 * with <REPO>, $HOME with <HOME>, and masks ISO timestamps, so goldens are
 * stable across machines and runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ORACLE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(ORACLE_DIR, '..', '..');
export const GOLDEN_DIR = path.join(ORACLE_DIR, 'golden');
export const CASES_DIR = path.join(ORACLE_DIR, 'cases');
export const WORKSPACES_DIR = path.join(ORACLE_DIR, 'workspaces');

/** verb -> how the JS implementation is invoked */
export const JS_VERBS = {
  detect: ['node', path.join(REPO_ROOT, 'cli', 'bin', 'cli.js'), 'detect'],
  'cli-help': ['node', path.join(REPO_ROOT, 'cli', 'bin', 'cli.js'), '--help'],
  'cli-version': ['node', path.join(REPO_ROOT, 'cli', 'bin', 'cli.js'), '--version'],
  ignores: ['node', path.join(REPO_ROOT, 'cli', 'bin', 'cli.js'), 'ignores'],
};
for (const script of [
  'context', 'doctor', 'pin', 'surface-brief', 'critique-storage', 'palette',
  'embed-prompt', 'context-signals', 'detect-csp', 'concept-seed',
  'hook', 'hook-before-edit', 'hook-admin',
  'live', 'live-server', 'live-poll', 'live-status', 'live-resume', 'live-complete',
  'live-accept', 'live-wrap', 'live-insert', 'live-inject', 'live-target',
  'live-commit-manual-edits', 'live-discard-manual-edits', 'live-manual-edit-evidence',
]) {
  JS_VERBS[script] = ['node', path.join(REPO_ROOT, 'skill', 'scripts', `${script}.mjs`)];
}

/** verb -> argv for the binary implementation (verb name is the subcommand) */
export function binArgv(bin, verb) {
  if (verb === 'cli-help') return [bin, '--help'];
  if (verb === 'cli-version') return [bin, '--version'];
  return [bin, verb];
}

export async function allCases() {
  const out = [];
  for (const f of fs.readdirSync(CASES_DIR).sort()) {
    if (!f.endsWith('.mjs')) continue;
    const mod = await import(pathToFileURL(path.join(CASES_DIR, f)).href);
    const list = typeof mod.default === 'function' ? await mod.default() : mod.default;
    for (const item of Array.isArray(list) ? list : [list]) out.push({ ...item, sourceFile: f });
  }
  const seen = new Set();
  for (const c of out) {
    if (seen.has(c.id)) throw new Error(`duplicate oracle case id: ${c.id}`);
    seen.add(c.id);
  }
  return out;
}

export function stageWorkspace(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-oracle-'));
  if (name) {
    const src = path.join(WORKSPACES_DIR, name);
    if (!fs.existsSync(src)) throw new Error(`oracle workspace not found: ${name}`);
    fs.cpSync(src, tmp, { recursive: true });
  }
  return tmp;
}

export function normalize(text, { ws, home = os.homedir() }) {
  if (typeof text !== 'string') return text;
  let out = text;
  let wsReal = null;
  try { wsReal = ws ? fs.realpathSync(ws) : null; } catch { /* staged dir already gone */ }
  for (const [needle, tag] of [
    [wsReal, '<WS>'], [ws, '<WS>'], [REPO_ROOT, '<REPO>'], [home, '<HOME>'],
  ]) {
    if (needle) out = out.split(needle).join(tag);
  }
  // The hook footer embeds the admin command's own path; both runtimes name it differently.
  out = out.replace(/node '[^']*\/hook-admin\.mjs'/g, '<HOOK_ADMIN_CMD>');
  out = out.replace(/node "[^"]*\/hook-admin\.mjs"/g, '<HOOK_ADMIN_CMD>');
  out = out.replace(/'[^']*\/impeccable(?:\.exe)?' hooks/g, '<HOOK_ADMIN_CMD> hooks');
  // ISO timestamps and epoch millis are run-dependent.
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');
  out = out.replace(/"(updatedAt|createdAt|checkedAt|lastCheck|lastChecked|timestamp|ts|mtimeMs|mtime|startedAt|endedAt)":\s*\d{10,}/g, '"$1": <EPOCH>');
  return out;
}

function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export function snapshotFiles(ws, globs) {
  const out = {};
  if (!globs || !globs.length) return out;
  const regs = globs.map(globToRegex);
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(ws, full).split(path.sep).join('/');
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        walk(full);
      } else if (regs.some(r => r.test(rel))) {
        const buf = fs.readFileSync(full);
        out[rel] = isProbablyText(buf) ? buf.toString('utf8') : `<binary ${buf.length} bytes>`;
      }
    }
  };
  walk(ws);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function isProbablyText(buf) {
  const n = Math.min(buf.length, 512);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

/**
 * Run one case with the given implementation ('js' | 'bin').
 * Returns { stdout, stderr, exit, signal, files } normalized.
 */
export function runCase(c, { impl = 'js', bin = process.env.IMPECCABLE_BIN } = {}) {
  const ws = stageWorkspace(c.workspace);
  try {
    const isolatedHome = path.join(ws, '.oracle-home');
    if (c.isolateHome !== false) fs.mkdirSync(isolatedHome, { recursive: true });
    if (typeof c.setup === 'function') c.setup(ws);
    const steps = c.steps || [c];
    const results = [];
    for (const step of steps) {
      results.push(runStep({ ...c, ...step, verb: step.verb || c.verb }, { impl, bin, ws, isolatedHome }));
    }
    const files = snapshotFiles(ws, c.files);
    const ctx = { ws };
    const norm = (r) => ({
      stdout: normalize(r.stdout ?? '', ctx),
      stderr: normalize(r.stderr ?? '', ctx),
      exit: r.status,
      signal: r.signal || null,
    });
    const filesNorm = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, normalize(v, ctx)]));
    if (c.steps) return { steps: results.map(norm), files: filesNorm };
    return { ...norm(results[0]), files: filesNorm };
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

function runStep(c, { impl, bin, ws, isolatedHome }) {
  const cwd = path.join(ws, c.cwd || '.');
  let argv;
  if (impl === 'js') {
    const base = JS_VERBS[c.verb];
    if (!base) throw new Error(`no JS invocation for verb ${c.verb}`);
    argv = [...base];
  } else {
    if (!bin) throw new Error('IMPECCABLE_BIN not set');
    argv = binArgv(bin, c.verb);
  }
  const sub = (v) => String(v).replaceAll('<WS>', ws).replaceAll('<REPO>', REPO_ROOT);
  argv.push(...(c.args || []).map(sub));
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    IMPECCABLE_NO_UPDATE_CHECK: '1',
    IMPECCABLE_NO_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    ...(c.isolateHome === false ? {} : { HOME: isolatedHome, USERPROFILE: isolatedHome }),
    ...Object.fromEntries(Object.entries(c.env || {}).map(([k, v]) => [k, v == null ? v : sub(v)])),
  };
  for (const [k, v] of Object.entries(env)) if (v == null) delete env[k];
  const stdin = typeof c.stdin === 'string' ? sub(c.stdin) : c.stdin != null ? sub(JSON.stringify(c.stdin)) : '';
  return spawnSync(argv[0], argv.slice(1), {
    cwd, env, input: stdin, encoding: 'utf8', timeout: c.timeoutMs || 60_000,
    windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}

export function goldenPath(id) {
  return path.join(GOLDEN_DIR, `${id}.json`);
}

export function writeGolden(id, result) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  fs.writeFileSync(goldenPath(id), JSON.stringify(result, null, 2) + '\n');
}

export function readGolden(id) {
  const p = goldenPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Return a list of human-readable differences, empty if equal. */
export function diffResults(golden, actual) {
  const diffs = [];
  if (golden.steps || actual.steps) {
    const g = golden.steps || [], a = actual.steps || [];
    if (g.length !== a.length) diffs.push(`steps: expected ${g.length}, got ${a.length}`);
    for (let i = 0; i < Math.min(g.length, a.length); i++) {
      for (const d of diffResults({ ...g[i], files: {} }, { ...a[i], files: {} })) diffs.push(`step ${i + 1} ${d}`);
    }
    for (const d of diffResults({ files: golden.files, exit: 0, signal: null, stdout: '', stderr: '' }, { files: actual.files, exit: 0, signal: null, stdout: '', stderr: '' })) diffs.push(d);
    return diffs;
  }
  for (const k of ['exit', 'signal']) {
    if (golden[k] !== actual[k]) diffs.push(`${k}: expected ${golden[k]}, got ${actual[k]}`);
  }
  for (const k of ['stdout', 'stderr']) {
    if (golden[k] !== actual[k]) diffs.push(`${k} differs:\n${firstDiff(golden[k], actual[k])}`);
  }
  const keys = new Set([...Object.keys(golden.files || {}), ...Object.keys(actual.files || {})]);
  for (const k of [...keys].sort()) {
    const g = golden.files?.[k], a = actual.files?.[k];
    if (g === undefined) diffs.push(`file ${k}: unexpected (written by actual only)`);
    else if (a === undefined) diffs.push(`file ${k}: missing (golden has it)`);
    else if (g !== a) diffs.push(`file ${k} differs:\n${firstDiff(g, a)}`);
  }
  return diffs;
}

function firstDiff(a, b) {
  const al = String(a).split('\n'), bl = String(b).split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return `  line ${i + 1}\n  - ${JSON.stringify(al[i] ?? '<EOF>')}\n  + ${JSON.stringify(bl[i] ?? '<EOF>')}`;
    }
  }
  return '  (lengths differ)';
}
