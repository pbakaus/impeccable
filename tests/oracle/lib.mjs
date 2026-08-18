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
 *   - steps: multi-step cases share one staged workspace; a step may set
 *     `daemon: true` to spawn its verb detached (see runDaemonStep) so later
 *     steps run against a live process; the daemon is killed after the last
 *     step and its captured output lands in the golden as `daemon`.
 *
 * Normalization replaces the staged workspace path with <WS>, the repo root
 * with <REPO>, $HOME with <HOME>, and masks ISO timestamps, so goldens are
 * stable across machines and runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
  'generate-image', 'serve-question',
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
  // Self-referential command lines: the JS prints "node <scripts>/<verb>.mjs", the
  // binary prints "<bin> <verb>". Both collapse to "<IMPECCABLE> <verb>".
  out = out.replace(/node ['"]?<REPO>\/skill\/scripts\/([a-z-]+)\.mjs['"]?/g, (m, v) => `<IMPECCABLE> ${v === 'context-signals' ? 'signals' : v === 'hook-admin' ? 'hooks' : v}`);
  if (process.env.IMPECCABLE_BIN) {
    const bin = process.env.IMPECCABLE_BIN;
    for (const form of [`'${bin}'`, `"${bin}"`, bin]) out = out.split(form).join('<IMPECCABLE>');
  }
  // context.mjs probes `which cwebp/sips/magick/ffmpeg`; the set found is a
  // property of the recording machine, not of the implementation.
  out = out.replace(/IMAGE_TOOLS: available image converters on this machine: [^.]*\. Use the first suitable one; never probe again this session\./g, 'IMAGE_TOOLS: <IMAGE_TOOLS_PROBE>');
  out = out.replace(/IMAGE_TOOLS: no image converter found \(cwebp, sips, magick, ffmpeg\)\. Ship PNG output unconverted rather than probing per image\./g, 'IMAGE_TOOLS: <IMAGE_TOOLS_PROBE>');
  // context-signals probes localhost dev-server ports (4321, 3000, 5173, ...);
  // whatever is listening on the recording machine is not part of the contract.
  out = out.replace(/"devServer": \{\s*"running": (?:true|false),\s*"ports": \[[^\]]*\]\s*\}/g, '"devServer": <DEV_SERVER_PROBE>');
  // critique-storage stamps snapshots with the wall clock in dash form
  // (2026-05-12T18-30-00Z), both in the file name (<stamp>__<slug>.md) and in
  // the `timestamp:` frontmatter it writes.
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/g, '<STAMP>');
  // Hook audit entries carry wall-clock durations.
  out = out.replace(/"durationMs":\s*\d+/g, '"durationMs": <MS>');
  // ISO timestamps and epoch millis are run-dependent.
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');
  out = out.replace(/"(updatedAt|createdAt|checkedAt|lastCheck|lastChecked|timestamp|ts|mtimeMs|mtime|startedAt|endedAt)":\s*\d{10,}/g, '"$1": <EPOCH>');
  // The staleness notice cache (~/.impeccable/staleness-check.json) keys epoch
  // stamps by finding id: { projects: { "<root>": { "<finding-id>": ms } } }.
  out = out.replace(/"([a-z][a-z0-9-]*)":\s*1[6-9]\d{11}(?=[,}\s])/g, '"$1": <EPOCH>');
  // Live mode: server.json, the inject journal, and source locks record the
  // writing process's pid; the helper server mints a UUID token. Both vary
  // per run. Ports and lease stamps are per-case (see `normalize` on a case).
  out = out.replace(/"pid":(\s*)\d+/g, '"pid":$1<PID>');
  out = out.replace(/\(pid \d+\)/g, '(pid <PID>)');
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
  return out;
}

/**
 * Case-scoped replacements: `c.normalize` is a list of [regexSource, flags,
 * replacement] applied after the global pass to stdout, stderr, files, and
 * daemon output of that case only. Keeps run-dependent values that only one
 * flow produces (a dynamically chosen server port, lease deadlines) from
 * widening the global normalizer and masking real diffs elsewhere.
 */
function applyCaseNormalizers(text, rules) {
  if (typeof text !== 'string' || !rules?.length) return text;
  let out = text;
  for (const [src, flags, repl] of rules) out = out.replace(new RegExp(src, flags), repl);
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
        if (ent.name === '.git') continue;
        if (ent.name === 'node_modules') {
          // Only the live-mode preview tree is ours; never walk installed or
          // symlinked packages.
          const preview = path.join(full, '.impeccable-live');
          if (fs.existsSync(preview)) walk(preview);
          continue;
        }
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
    const daemons = [];
    try {
      for (const step of steps) {
        const merged = { ...c, ...step, verb: step.verb || c.verb };
        if (step.daemon) {
          daemons.push(runDaemonStep(merged, { impl, bin, ws, isolatedHome }));
          results.push({ stdout: '', stderr: '', status: null, signal: null, daemon: true });
          continue;
        }
        results.push(runStep(merged, { impl, bin, ws, isolatedHome }));
      }
    } finally {
      for (const d of daemons) stopDaemon(d);
    }
    const files = snapshotFiles(ws, c.files);
    const ctx = { ws };
    const N = (text) => applyCaseNormalizers(normalize(text, ctx), c.normalize);
    const norm = (r) => ({
      stdout: N(r.stdout ?? ''),
      stderr: N(r.stderr ?? ''),
      exit: r.status,
      signal: r.signal || null,
      ...(r.daemon ? { daemon: true } : {}),
    });
    const filesNorm = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, N(v)]));
    const daemonOut = daemons.length
      ? { daemon: daemons.map((d) => ({ stdout: N(d.stdout()), stderr: N(d.stderr()) })) }
      : {};
    if (c.steps) return { steps: results.map(norm), files: filesNorm, ...daemonOut };
    return { ...norm(results[0]), files: filesNorm, ...daemonOut };
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

function buildInvocation(c, { impl, bin, ws, isolatedHome }) {
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
  return { argv, cwd, env, stdin };
}

/**
 * Spawn a step's verb detached and wait until `readyFile` (relative to the
 * staged workspace) exists. stdout/stderr go to files under
 * <ws>/.oracle-daemon/ and are read back at teardown so the golden records
 * what the daemon printed over its whole life.
 */
function runDaemonStep(c, opts) {
  const { argv, cwd, env } = buildInvocation(c, opts);
  const outDir = path.join(opts.ws, '.oracle-daemon');
  fs.mkdirSync(outDir, { recursive: true });
  const n = fs.readdirSync(outDir).length;
  const outPath = path.join(outDir, `${n}.stdout`);
  const errPath = path.join(outDir, `${n}.stderr`);
  const outFd = fs.openSync(outPath, 'w');
  const errFd = fs.openSync(errPath, 'w');
  const child = spawn(argv[0], argv.slice(1), {
    cwd, env, stdio: ['ignore', outFd, errFd], detached: true, windowsHide: true,
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  const readyFile = path.join(opts.ws, c.readyFile);
  const deadline = Date.now() + (c.readyTimeoutMs || 10_000);
  while (!fs.existsSync(readyFile)) {
    if (child.exitCode !== null || Date.now() > deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  if (!fs.existsSync(readyFile)) {
    throw new Error(`daemon ${c.verb} for case ${c.id} did not create ${c.readyFile}\n${safeRead(errPath)}`);
  }
  return {
    child,
    stdout: () => safeRead(outPath),
    stderr: () => safeRead(errPath),
  };
}

function stopDaemon(d) {
  const { child } = d;
  if (child.exitCode !== null || child.signalCode) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  const deadline = Date.now() + 3000;
  while (child.exitCode === null && !child.signalCode && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    // A detached child never reports exit to a synchronous loop; probe the pid.
    try { process.kill(child.pid, 0); } catch { break; }
  }
  try { process.kill(child.pid, 0); child.kill('SIGKILL'); } catch { /* exited */ }
  // Give the OS a beat to release the port and flush the output files.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function runStep(c, opts) {
  const { argv, cwd, env, stdin } = buildInvocation(c, opts);
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
    const gd = golden.daemon || [], ad = actual.daemon || [];
    if (gd.length !== ad.length) diffs.push(`daemons: expected ${gd.length}, got ${ad.length}`);
    for (let i = 0; i < Math.min(gd.length, ad.length); i++) {
      for (const k of ['stdout', 'stderr']) {
        if (gd[i][k] !== ad[i][k]) diffs.push(`daemon ${i + 1} ${k} differs:\n${firstDiff(gd[i][k], ad[i][k])}`);
      }
    }
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
