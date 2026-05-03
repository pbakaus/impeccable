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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgentLoop } from './agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'source', 'skills', 'impeccable', 'scripts');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'framework-fixtures');

export { SCRIPTS_DIR, FIXTURES_DIR, REPO_ROOT };

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export function stageFixture(name, fixture) {
  const fixtureRoot = join(FIXTURES_DIR, name);
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

export function runInstall(tmp, command) {
  const [cmd, ...args] = command;
  execFileSync(cmd, args, { cwd: tmp, stdio: 'inherit' });
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
    const timeout = setTimeout(() => {
      reject(new Error(
        `dev server ready timeout (${runtime.readyTimeoutMs}ms). Tail:\n${bufLog.join('')}`,
      ));
    }, runtime.readyTimeoutMs ?? 120_000);

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

export async function stopDevServer(child) {
  if (!child || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5_000));
  await Promise.race([exited, timeoutPromise]);
  if (!child.killed) child.kill('SIGKILL');
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
 * @param {import('playwright').Browser} opts.browser   shared browser instance
 * @param {object} opts.agent             VariantAgent (defaults to fake)
 * @param {(msg: string) => void} [opts.log]
 */
export async function bootFixtureSession({ name, fixture, browser, agent, log = () => {} }) {
  const runtime = fixture.runtime;
  if (!runtime) throw new Error(`fixture ${name} has no runtime block`);

  const tmp = stageFixture(name, fixture);
  let live;
  let dev;
  let agentAbort;
  let agentDone;
  let ctx;

  const teardown = async () => {
    try { if (ctx) await ctx.close(); } catch {}
    try { if (agentAbort) agentAbort.abort(); } catch {}
    try { if (agentDone) await agentDone.catch(() => {}); } catch {}
    try { if (dev?.child) await stopDevServer(dev.child); } catch {}
    try { if (live) stopLiveServer(tmp); } catch {}
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  };

  try {
    log(`installing deps`);
    runInstall(tmp, runtime.install);

    log(`starting live-server`);
    live = startLiveServer(tmp);

    log(`live-inject --port ${live.port}`);
    const injectResult = runInject(tmp, live.port);
    if (!injectResult.ok) throw new Error('live-inject failed: ' + JSON.stringify(injectResult));

    log(`spawning dev server: ${runtime.devCommand.join(' ')}`);
    dev = startDevServer(tmp, runtime);
    const { port: devPort } = await dev.ready;
    log(`dev server ready on ${devPort}`);

    // Agent loop runs concurrently — abort on teardown.
    agentAbort = new AbortController();
    agentDone = runAgentLoop({
      tmp,
      scriptsDir: SCRIPTS_DIR,
      port: live.port,
      token: live.token,
      agent,
      signal: agentAbort.signal,
      log: (m) => log('[agent] ' + m),
    });

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
    });

    await page.goto(`${scheme}://127.0.0.1:${devPort}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    return {
      tmp,
      page,
      ctx,
      dev,
      live,
      consoleErrors,
      teardown,
    };
  } catch (err) {
    if (dev?.log) err.message += `\n\n--- dev server tail ---\n${dev.log()}`;
    await teardown();
    throw err;
  }
}
