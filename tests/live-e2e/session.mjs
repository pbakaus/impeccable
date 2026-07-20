/**
 * Per-fixture session lifecycle for live-mode E2E tests.
 *
 * Composes:
 *   - tmp staging (clones the fixture, git init, writes the inject config)
 *   - npm install (the fixture's runtime.install command)
 *   - live-server.mjs --background (returns {pid, port, token})
 *   - live-inject.mjs --port (patches the framework HTML entry)
 *   - the fixture's framework dev server (vite, vite dev, npx vite, ...)
 *   - Playwright Chromium page
 *   - the fake-agent poll loop (in this same node process)
 *
 * Returns handles + a single `teardown()` that cleans them all up in order.
 */

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgentLoop } from './agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'skill', 'scripts');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'framework-fixtures');

export { SCRIPTS_DIR, FIXTURES_DIR, REPO_ROOT };

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export function stageFixture(name, fixture, { fixtureRoot = join(FIXTURES_DIR, name) } = {}) {
  const gitignore = readFileSync(join(fixtureRoot, 'gitignore.txt'), 'utf-8');

  const tmp = mkdtempSync(join(tmpdir(), 'impeccable-e2e-'));
  cpSync(join(fixtureRoot, 'files'), tmp, { recursive: true });
  writeFileSync(join(tmp, '.gitignore'), gitignore);
  mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
  writeFileSync(join(tmp, '.impeccable', 'live', 'config.json'), JSON.stringify(fixture.config));

  execFileSync('git', ['init', '-q'], { cwd: tmp });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: tmp });
  execFileSync('git', ['add', '-A'], { cwd: tmp });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: tmp });

  return tmp;
}

export function runInstall(tmp, command, { timeoutMs = readTimeoutEnv('IMPECCABLE_E2E_INSTALL_TIMEOUT_MS', 180_000) } = {}) {
  const [cmd, ...args] = command;
  const installArgs = addNpmInstallDefaults(cmd, args);
  try {
    execFileSync(cmd, installArgs, { cwd: tmp, stdio: 'inherit', timeout: timeoutMs });
    repairMissingRollupOptionalBinary(tmp, { timeoutMs });
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.signal === 'SIGKILL' || err.killed) {
      err.message = `fixture dependency install timed out after ${timeoutMs}ms: ${cmd} ${installArgs.join(' ')}`;
    }
    throw err;
  }
}

function repairMissingRollupOptionalBinary(tmp, { timeoutMs }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
  const rollupPackage = join(tmp, 'node_modules', 'rollup', 'package.json');
  const nativePackage = join(tmp, 'node_modules', '@rollup', 'rollup-darwin-arm64', 'package.json');
  if (!existsSync(rollupPackage) || existsSync(nativePackage)) return;
  const version = JSON.parse(readFileSync(rollupPackage, 'utf-8')).version;
  execFileSync('npm', [
    'install', '--no-save', '--no-audit', '--no-fund', '--no-progress',
    `@rollup/rollup-darwin-arm64@${version}`,
  ], { cwd: tmp, stdio: 'inherit', timeout: timeoutMs });
}

function addNpmInstallDefaults(cmd, args) {
  if (cmd !== 'npm') return args;
  if (!['install', 'ci'].includes(args[0])) return args;
  const out = [...args];
  // npm can omit platform-specific Rollup binaries unless optional
  // dependencies are requested explicitly (npm/cli#4828). Astro/Vite then
  // fail before Live starts on fresh staged fixtures.
  for (const flag of ['--no-progress', '--include=optional']) {
    if (!out.some((arg) => arg === flag || arg.startsWith(flag + '='))) out.push(flag);
  }
  return out;
}

// ---------------------------------------------------------------------------
// live-server (background mode prints {pid, port, token})
// ---------------------------------------------------------------------------

export function startLiveServer(tmp) {
  const out = execFileSync(
    process.execPath,
    [join(SCRIPTS_DIR, 'live-server.mjs'), '--background'],
    { cwd: tmp, encoding: 'utf-8' },
  );
  const jsonLine = out.trim().split('\n').filter(Boolean).pop();
  const info = JSON.parse(jsonLine);
  if (!info.port || !info.pid) {
    throw new Error('live-server --background returned unexpected payload: ' + jsonLine);
  }
  return info;
}

export function stopLiveServer(tmp) {
  try {
    execFileSync(
      process.execPath,
      [join(SCRIPTS_DIR, 'live-server.mjs'), 'stop', '--keep-inject'],
      { cwd: tmp, stdio: 'ignore' },
    );
  } catch { /* already gone */ }
}

export function runInject(tmp, port) {
  const out = execFileSync(
    process.execPath,
    [join(SCRIPTS_DIR, 'live-inject.mjs'), '--port', String(port)],
    {
      cwd: tmp,
      encoding: 'utf-8',
      env: { ...process.env },
    },
  );
  const last = out.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(last);
}

// ---------------------------------------------------------------------------
// Framework dev server
// ---------------------------------------------------------------------------

export function startDevServer(tmp, runtime) {
  const [cmd, ...args] = runtime.devCommand;
  const child = spawn(cmd, args, {
    cwd: tmp,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const readyRe = new RegExp(runtime.readyPattern);
  const bufLog = [];
  const capture = (chunk) => {
    const s = chunk.toString();
    bufLog.push(s);
    if (bufLog.length > 200) bufLog.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const ready = new Promise((resolve, reject) => {
    const readyTimeoutMs = readTimeoutEnv(
      'IMPECCABLE_E2E_DEV_READY_TIMEOUT_MS',
      runtime.readyTimeoutMs ?? 120_000,
    );
    const timeout = setTimeout(() => {
      reject(new Error(
        `dev server ready timeout (${readyTimeoutMs}ms). Tail:\n${bufLog.join('')}`,
      ));
    }, readyTimeoutMs);

    const checkMatch = (buf) => {
      const m = buf.toString().match(readyRe);
      if (m && m[1]) {
        clearTimeout(timeout);
        resolve({ port: Number(m[1]) });
      }
    };
    child.stdout.on('data', checkMatch);
    child.stderr.on('data', checkMatch);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`dev server exited before ready (code=${code}). Tail:\n${bufLog.join('')}`));
    });
  });

  return { child, ready, log: () => bufLog.join('') };
}

function readTimeoutEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function stopDevServer(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  let didExit = false;
  const exited = new Promise((resolve) => child.once('exit', () => {
    didExit = true;
    resolve();
  }));
  child.kill('SIGTERM');
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5_000));
  await Promise.race([exited, timeoutPromise]);
  if (!didExit && child.exitCode == null && child.signalCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
}

// ---------------------------------------------------------------------------
// Composite: full stage → ready
// ---------------------------------------------------------------------------

/**
 * Boots everything and returns the connected page + handles + teardown.
 *
 * @param {object} opts
 * @param {string} opts.name              fixture name
 * @param {object} opts.fixture           fixture.json contents
 * @param {string=} opts.fixtureRoot      fixture directory; defaults to the public framework fixture tree
 * @param {import('playwright').Browser} opts.browser   shared browser instance
 * @param {object} opts.agent             VariantAgent (defaults to fake)
 * @param {object|function=} opts.wrapTarget live-wrap target or event mapper
 * @param {(context: object) => Promise<object|void>} [opts.startWorker]
 *        Optional production worker factory. Return {stop, done}; when used,
 *        omit `agent` so the deterministic in-process loop is not started.
 * @param {(context: object) => Promise<void>|void} [opts.prepareTmp]
 * @param {(msg: string) => void} [opts.log]
 */
export async function bootFixtureSession({
  name,
  fixture,
  fixtureRoot,
  browser,
  agent,
  wrapTarget,
  startWorker,
  prepareTmp,
  log = () => {},
  trace = () => {},
  atomicDelayMs = 0,
  keepTmp = false,
}) {
  const runtime = fixture.runtime;
  if (!runtime) throw new Error(`fixture ${name} has no runtime block`);

  const tmp = stageFixture(name, fixture, { fixtureRoot });
  let live;
  let dev;
  let agentAbort;
  let agentDone;
  let externalWorker;
  let ctx;

  const teardown = async () => {
    try { if (ctx) await ctx.close(); } catch {}
    try { if (agentAbort) agentAbort.abort(); } catch {}
    try { if (agentDone) await agentDone.catch(() => {}); } catch {}
    try { if (externalWorker?.stop) await externalWorker.stop(); } catch {}
    try { if (externalWorker?.done) await externalWorker.done.catch(() => {}); } catch {}
    try { if (dev?.child) await stopDevServer(dev.child); } catch {}
    try { if (live) stopLiveServer(tmp); } catch {}
    if (!keepTmp) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    } else {
      log(`kept staged fixture at ${tmp}`);
    }
  };

  const stopLiveForDeferredWork = () => {
    if (!live) return;
    stopLiveServer(tmp);
    live = null;
  };

  try {
    const startedAt = Date.now();
    if (prepareTmp) await prepareTmp({ tmp, fixture, scriptsDir: SCRIPTS_DIR, trace, log });
    trace('setup.install.start', { fixture: name });
    log(`installing deps`);
    runInstall(tmp, runtime.install);
    trace('setup.install.end', { fixture: name });
    log(`deps installed in ${formatDuration(Date.now() - startedAt)}`);

    const liveStartedAt = Date.now();
    trace('setup.live_server.start', { fixture: name });
    log(`starting live-server`);
    live = startLiveServer(tmp);
    trace('setup.live_server.end', { fixture: name, port: live.port });
    log(`live-server ready in ${formatDuration(Date.now() - liveStartedAt)}`);

    if (startWorker) {
      trace('setup.worker.start', { fixture: name });
      externalWorker = await startWorker({ tmp, fixture, scriptsDir: SCRIPTS_DIR, live, trace, log });
      trace('setup.worker.end', { fixture: name });
    }

    const injectStartedAt = Date.now();
    trace('setup.inject.start', { fixture: name });
    log(`live-inject --port ${live.port}`);
    const injectResult = runInject(tmp, live.port);
    if (!injectResult.ok) throw new Error('live-inject failed: ' + JSON.stringify(injectResult));
    trace('setup.inject.end', { fixture: name, files: injectResult.files || injectResult.pageFiles || [] });
    log(`live-inject complete in ${formatDuration(Date.now() - injectStartedAt)}`);

    const devStartedAt = Date.now();
    trace('setup.dev_server.start', { fixture: name });
    log(`spawning dev server: ${runtime.devCommand.join(' ')}`);
    dev = startDevServer(tmp, runtime);
    const { port: devPort } = await dev.ready;
    trace('setup.dev_server.end', { fixture: name, port: devPort });
    log(`dev server ready on ${devPort} in ${formatDuration(Date.now() - devStartedAt)}`);

    // Agent loop runs concurrently — abort on teardown.
    if (agent) {
      agentAbort = new AbortController();
      const loopOptions = {
        tmp,
        scriptsDir: SCRIPTS_DIR,
        port: live.port,
        token: live.token,
        agent,
        wrapTarget,
        signal: agentAbort.signal,
        trace,
        atomicDelayMs,
        steerSourceFile: runtime.steer?.sourceFile,
        steerTarget: runtime.steer?.target,
      };
      agentDone = Promise.all([runAgentLoop({ ...loopOptions, log: (m) => log('[worker] ' + m) })]);
    }

    const scheme = runtime.scheme || 'http';
    ctx = await browser.newContext({
      ignoreHTTPSErrors: runtime.ignoreHTTPSErrors === true,
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}\n${err.stack || ''}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
      else if (process.env.IMPECCABLE_E2E_CONSOLE && /\[impeccable\]|\[vite\]/.test(msg.text())) {
        log(`[console.${msg.type()}] ${msg.text()}`);
      }
    });
    if (process.env.IMPECCABLE_E2E_CONSOLE) {
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) log(`[nav] main frame → ${frame.url()}`);
      });
    }

    const pageStartedAt = Date.now();
    trace('setup.page_load.start', { fixture: name });
    await page.goto(`${scheme}://127.0.0.1:${devPort}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    trace('setup.page_load.end', { fixture: name });
    log(`page loaded in ${formatDuration(Date.now() - pageStartedAt)}`);

    return {
      tmp,
      page,
      ctx,
      dev,
      live,
      worker: externalWorker,
      consoleErrors,
      stopLiveServer: stopLiveForDeferredWork,
      teardown,
    };
  } catch (err) {
    if (dev?.log) err.message += `\n\n--- dev server tail ---\n${dev.log()}`;
    await teardown();
    throw err;
  }
}

function formatDuration(ms) {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
