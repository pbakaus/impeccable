#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCodexAppServerClient } from './live/codex-app-server-client.mjs';
import {
  codexWorkerStateIsOwned,
  resolveCodexWorkerConfig,
} from './live/codex-worker.mjs';
import { CodexLiveWorkerSupervisor } from './live/codex-worker-supervisor.mjs';
import {
  getLiveCodexWorkerStatePath,
  readLiveServerInfo,
  resolveLiveConfigPath,
} from './lib/impeccable-paths.mjs';

const args = process.argv.slice(2);
const cwd = process.cwd();
const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const statePath = getLiveCodexWorkerStatePath(cwd);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node live-codex-worker.mjs [--background | --status | --stop]

Experimental, Codex-only Live generation supervisor. It owns a separate
app-server process and dedicated worker thread; it never attaches to the
foreground desktop task.

Opt in explicitly for this Codex process with IMPECCABLE_LIVE_CODEX_WORKER=1.
Project config may tune the worker but cannot activate it across harnesses.

Optional environment:
  IMPECCABLE_LIVE_CODEX_MODEL    Model override; otherwise Spark/mini/default is selected dynamically
  IMPECCABLE_LIVE_CODEX_EFFORT   Reasoning effort override (default: low)
  IMPECCABLE_CODEX_PATH          Codex binary path (default: codex)

Without the opt-in this command exits without polling, leaving the portable
foreground Live path unchanged.`);
  process.exit(0);
}

if (args.includes('--status')) {
  const state = readJson(statePath);
  console.log(JSON.stringify(state
    ? { ...state, reachable: pidReachable(state.pid) }
    : { ok: false, status: 'not_started' }));
  process.exit(0);
}

if (args.includes('--stop')) {
  const state = readJson(statePath);
  if (state?.pid && !codexWorkerStateIsOwned(state, cwd)) {
    console.log(JSON.stringify({
      ok: false,
      status: 'not_stopped',
      error: 'codex_worker_state_unowned',
    }));
    process.exitCode = 2;
    process.exit();
  }
  if (!state?.pid || !pidReachable(state.pid)) {
    console.log(JSON.stringify({ ok: true, status: 'not_running' }));
    process.exit(0);
  }
  process.kill(state.pid, 'SIGTERM');
  const stopped = await waitFor(
    () => !pidReachable(state.pid),
    positiveInteger(process.env.IMPECCABLE_LIVE_CODEX_STOP_TIMEOUT_MS, 5_000),
  );
  if (!stopped) {
    console.log(JSON.stringify({ ok: false, status: 'stop_timeout', pid: state.pid }));
    process.exitCode = 2;
    process.exit();
  }
  console.log(JSON.stringify({ ok: true, status: 'stopped', pid: state.pid }));
  process.exit(0);
}

const liveConfig = readLiveConfig(cwd);
const config = resolveCodexWorkerConfig({ env: process.env, liveConfig });
if (!config.enabled) {
  console.log(JSON.stringify({
    ok: false,
    error: 'codex_worker_disabled',
    fallback: 'foreground',
  }));
  process.exit(0);
}

if (args.includes('--background')) {
  const existing = readJson(statePath);
  if (codexWorkerStateIsOwned(existing, cwd)
    && existing?.pid
    && pidReachable(existing.pid)
    && ['ready', 'working'].includes(existing.status)) {
    console.log(JSON.stringify({ ...existing, ok: true, reused: true }));
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const logPath = path.join(path.dirname(statePath), 'codex-worker.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [scriptPath, '--foreground'], {
    cwd,
    env: process.env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  const ready = await waitFor(() => {
    const state = readJson(statePath);
    if (state?.pid !== child.pid) return null;
    if (state.status === 'error') return state;
    return ['ready', 'working'].includes(state.status) ? state : null;
  }, positiveInteger(process.env.IMPECCABLE_LIVE_CODEX_START_TIMEOUT_MS, 12_000));
  if (!ready || ready.status === 'error') {
    let terminated = true;
    if (pidReachable(child.pid)) {
      process.kill(child.pid, 'SIGTERM');
      terminated = Boolean(await waitFor(
        () => !pidReachable(child.pid),
        positiveInteger(process.env.IMPECCABLE_LIVE_CODEX_STOP_TIMEOUT_MS, 2_000),
      ));
    }
    console.log(JSON.stringify({
      ok: false,
      error: ready?.error || 'codex_worker_start_timeout',
      fallback: terminated ? 'foreground' : null,
      terminated,
      childPid: child.pid,
      logPath,
    }));
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify({ ...ready, ok: true, logPath }));
  }
  process.exit();
}

await runForeground();

async function runForeground() {
  const server = readLiveServerInfo(cwd)?.info;
  if (!server?.port || !server?.token) {
    writeState({ ok: false, status: 'error', error: 'live_server_not_running' });
    process.exitCode = 1;
    return;
  }
  const client = createCodexAppServerClient({
    command: config.codexPath,
    cwd,
    requestTimeoutMs: 30_000,
    turnTimeoutMs: 240_000,
    clientInfo: {
      name: 'impeccable_live',
      title: 'Impeccable Live dedicated worker',
      version: '0.1.0',
    },
  });
  const supervisor = new CodexLiveWorkerSupervisor({
    cwd,
    base: `http://localhost:${server.port}`,
    token: server.token,
    client,
    config,
    statePath,
    scriptsDir,
    log: (message) => process.stderr.write(`[impeccable-codex-worker] ${message}\n`),
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await supervisor.shutdown({ archive: true }).catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await supervisor.initialize();
    await supervisor.run();
  } catch (error) {
    writeState({
      ok: false,
      status: 'error',
      error: error.message,
      stack: error.stack,
    });
    await supervisor.shutdown().catch(() => {});
    process.exitCode = 1;
  }
}

function readLiveConfig(projectCwd) {
  const configPath = resolveLiveConfigPath({ cwd: projectCwd, scriptsDir });
  return readJson(configPath) || {};
}

function writeState(value) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const state = {
    cwd: path.resolve(cwd),
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...value,
  };
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  fs.renameSync(temporary, statePath);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function pidReachable(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
