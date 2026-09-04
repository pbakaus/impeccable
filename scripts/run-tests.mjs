#!/usr/bin/env node
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SUITES, OPT_IN_SUITES, SUITES, expandSuites } from './test-suites.mjs';
import { killGroupSync, stopGroup, trackChildExit } from './lib/process-group.mjs';
import {
  REPO_ENV,
  REPO_PATH_ENV,
  RUN_ID_ENV,
  alive,
  findLiveServers,
  killLiveServers,
  makeRunId,
  repoMarker,
} from './lib/live-server-processes.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--list')) {
  printSuites();
  process.exit(0);
}

if (args.includes('--cleanup')) {
  process.exit(cleanupRepoServers());
}

/**
 * Suite commands run in their own process group so a Ctrl-C, a timeout, or an
 * exiting runner can take the whole tree down at once. Nothing else in this
 * file may use spawnSync: a blocked event loop cannot run the signal handlers
 * that make that guarantee, and cannot reap the child it is waiting on either.
 */
let currentChild = null;
let shuttingDown = false;

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { void shutdown(sig); });
}
process.on('exit', () => {
  // Nothing can be awaited here, so this is the one path that does not wait.
  const running = currentChild;
  currentChild = null;
  killGroupSync(running);
});

async function shutdown(sig) {
  const running = currentChild;
  currentChild = null;
  if (shuttingDown) {
    // A second Ctrl-C means "stop waiting". Skip the grace period entirely.
    killGroupSync(running);
    process.exit(exitCodeForSignal(sig));
  }
  shuttingDown = true;
  await stopGroup(running);
  process.exit(exitCodeForSignal(sig));
}

/** The shell convention for "killed by signal N": 130 SIGINT, 143 SIGTERM, 129 SIGHUP. */
function exitCodeForSignal(sig) {
  return 128 + (os.constants.signals[sig] ?? 0);
}

const requestedSuites = args.filter((arg) => !arg.startsWith('-'));
let suites;
try {
  suites = expandSuites(requestedSuites);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

for (const suiteName of suites) {
  const suite = SUITES[suiteName];
  console.log(`\n## test:${suiteName}`);
  console.log(suite.description);
  for (const command of suite.commands) {
    await runCommand(command, suiteName);
  }
}

async function runCommand(command, suiteName) {
  const runId = makeRunId(REPO_ROOT);
  const env = {
    ...process.env,
    [RUN_ID_ENV]: runId,
    // The hash is what matching uses; the path rides along for a human reading
    // `ps -E` output and is never matched on.
    [REPO_ENV]: repoMarker(REPO_ROOT),
    [REPO_PATH_ENV]: REPO_ROOT,
    ...(command.env || {}),
  };

  if (command.runner === 'bun') {
    await runProcess('bun', ['test', ...command.files], { env });
  } else if (command.runner === 'node') {
    // One invocation for the whole file list: node --test runs each file in
    // its own child process regardless, so isolation is unchanged, but the
    // runner-per-file spawn overhead is gone and files execute concurrently.
    // Measured on the live suite (38 files): 52s serial-per-file vs 18s
    // batched at concurrency 4. Suites can pin `concurrency: 1` if their
    // tests ever contend for a shared resource.
    const nodeArgs = ['--test', `--test-concurrency=${command.concurrency ?? 4}`];
    if (command.timeoutMs) nodeArgs.push(`--test-timeout=${command.timeoutMs}`);
    if (command.forceExit) nodeArgs.push('--test-force-exit');
    nodeArgs.push(...command.files);
    await runProcess(process.execPath, nodeArgs, { env });
  } else {
    throw new Error(`Unsupported test runner "${command.runner}"`);
  }

  await assertNoLeakedServers(runId, suiteName);
}

function runProcess(cmd, args, { env }) {
  console.log(`$ ${formatCommand(cmd, args)}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      // Own process group: killCurrentGroup() can then take down the runner,
      // every test file it forked, and anything those forked, in one signal.
      detached: true,
      // stdin is deliberately not inherited. A detached child is a background
      // process group on the terminal, and a background read of the tty stops
      // the process with SIGTTIN. No suite reads the runner's stdin.
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
    });
    // Registered before the handlers below, so `hasExited` is already set by
    // the time they run and a shutdown mid-exit does not signal a dead pid.
    currentChild = trackChildExit(child);

    child.on('error', (err) => {
      currentChild = null;
      console.error(err.message);
      process.exit(1);
    });
    child.on('exit', (code) => {
      currentChild = null;
      if (shuttingDown) return;
      if (code !== 0) {
        // Leaked servers are still worth reporting on a failing suite: a
        // failure before teardown is one of the ways they are left behind.
        assertNoLeakedServers(env[RUN_ID_ENV], null).finally(() => {
          process.exit(code ?? 1);
        });
        return;
      }
      resolve();
    });
  });
}

/**
 * Fail the run when a suite left live servers behind.
 *
 * The whole point of the guard is that a leak shows up in the run that caused
 * it rather than as a wedged port days later, so it is an error, not a warning.
 * The leaked servers are killed either way, so the next suite still gets its
 * ports.
 */
async function assertNoLeakedServers(runId, suiteName) {
  if (!runId || process.env.IMPECCABLE_SKIP_LEAK_CHECK === '1') return;
  // A server asked to stop needs a moment to actually go.
  let leaked = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    leaked = findLiveServers({ runId });
    if (!leaked.length) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  killLiveServers(leaked);
  const label = suiteName ? `test:${suiteName}` : 'the suite';
  console.error(`\nLeaked live servers: ${label} left ${leaked.length} live server process(es) running.`);
  for (const { pid, command } of leaked) console.error(`  pid ${pid}  ${command}`);
  console.error('They have been killed. A live server outliving its suite means a teardown path');
  console.error('was skipped; see tests/lib/live-servers.mjs for how servers are meant to be tracked.');
  console.error('Set IMPECCABLE_SKIP_LEAK_CHECK=1 to bypass this check.');
  process.exit(1);
}

/**
 * `bun run test:cleanup`: kill live servers this checkout's tests left behind.
 *
 * Scoped to servers carrying this checkout's `IMPECCABLE_TEST_REPO` marker, so
 * a live session the developer started themselves in this same repo is not a
 * candidate. A server from a run that predates the marker is not found here and
 * has to be killed by hand.
 */
function cleanupRepoServers() {
  const leaked = findLiveServers({ repo: REPO_ROOT });
  if (!leaked.length) {
    console.log('No leftover live servers from this repo\'s test runs.');
    return 0;
  }
  for (const { pid, command } of leaked) console.log(`killing pid ${pid}  ${command}`);
  killLiveServers(leaked);
  const survivors = leaked.filter(({ pid }) => alive(pid));
  if (survivors.length) {
    console.error(`Could not kill ${survivors.length} process(es): ${survivors.map((p) => p.pid).join(', ')}`);
    return 1;
  }
  console.log(`Killed ${leaked.length} leftover live server process(es).`);
  return 0;
}

function formatCommand(cmd, args) {
  const bin = cmd === process.execPath ? 'node' : cmd;
  return [bin, ...args].join(' ');
}

function printHelp() {
  console.log(`Usage: node scripts/run-tests.mjs [suite...]

Aliases:
  default     ${DEFAULT_SUITES.join(', ')}
  all-local   ${DEFAULT_SUITES.join(', ')}
  all         ${[...DEFAULT_SUITES, ...OPT_IN_SUITES].join(', ')}

Run with --list to see suite contents.
Run with --cleanup to kill live servers a previous run left behind.`);
}

function printSuites() {
  for (const [name, suite] of Object.entries(SUITES)) {
    const marker = suite.optIn ? ' (opt-in)' : '';
    console.log(`\n${name}${marker}`);
    console.log(`  ${suite.description}`);
    for (const command of suite.commands) {
      console.log(`  ${command.runner}:`);
      for (const file of command.files) console.log(`    ${file}`);
    }
  }
}
