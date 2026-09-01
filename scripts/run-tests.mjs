#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { DEFAULT_SUITES, OPT_IN_SUITES, SUITES, expandSuites } from './test-suites.mjs';

// Global wall-clock backstop for any one command. Even with per-test timeouts
// and client-side network deadlines in place, a wedged tool or an orphaned
// grandchild can keep a runner alive forever; this cap guarantees the sweep
// terminates. Per-suite `wallClockMs` overrides it; the env var overrides both.
const DEFAULT_WALL_CLOCK_MS = Number(process.env.IMPECCABLE_TEST_WALL_CLOCK_MS) || 1_200_000;

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--list')) {
  printSuites();
  process.exit(0);
}

const requestedSuites = args.filter((arg) => !arg.startsWith('-'));
let suites;
try {
  suites = expandSuites(requestedSuites);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

await main();

async function main() {
  for (const suiteName of suites) {
    const suite = SUITES[suiteName];
    console.log(`\n## test:${suiteName}`);
    console.log(suite.description);
    for (const command of suite.commands) {
      await runCommand(command);
    }
  }
}

async function runCommand(command) {
  const env = { ...process.env, ...(command.env || {}) };
  const wallClockMs = command.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  if (command.runner === 'bun') {
    await runProcess('bun', ['test', ...command.files], { env, wallClockMs });
    return;
  }

  if (command.runner === 'node') {
    // One invocation for the whole file list: node --test runs each file in
    // its own child process regardless, so isolation is unchanged, but the
    // runner-per-file spawn overhead is gone and files execute concurrently.
    // Measured on the live suite (38 files): 52s serial-per-file vs 18s
    // batched at concurrency 4. Suites can pin `concurrency: 1` if their
    // tests ever contend for a shared resource.
    const args = ['--test', `--test-concurrency=${command.concurrency ?? 4}`];
    if (command.timeoutMs) args.push(`--test-timeout=${command.timeoutMs}`);
    if (command.forceExit) args.push('--test-force-exit');
    args.push(...command.files);
    await runProcess(process.execPath, args, { env, wallClockMs });
    return;
  }

  throw new Error(`Unsupported test runner "${command.runner}"`);
}

// Spawn as a detached process-group leader so the wall-clock cap can SIGKILL
// the entire tree — the runner, its per-file `node --test` workers, and any
// grandchildren or browsers they left open — not just the top process. A
// blocked spawnSync inside a test can't be reached by node's `--test-timeout`;
// this group kill is the guaranteed cleanup that lets the sweep always end.
function runProcess(cmd, args, { env, wallClockMs }) {
  return new Promise((resolve) => {
    console.log(`$ ${formatCommand(cmd, args)}`);
    const child = spawn(cmd, args, { stdio: 'inherit', env, detached: true });
    let timedOut = false;
    // A detached child is its own group leader, so an interactive Ctrl-C on
    // the runner no longer reaches it. Forward the interrupt to the group so
    // the whole tree is torn down instead of orphaned.
    const forward = (signal) => () => {
      try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } }
    };
    const onInt = forward('SIGINT');
    const onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    const timer = wallClockMs
      ? setTimeout(() => {
          timedOut = true;
          console.error(
            `\n[run-tests] wall-clock cap of ${wallClockMs}ms exceeded for "${formatCommand(cmd, args)}"; ` +
            'killing the process group (SIGKILL).',
          );
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
        }, wallClockMs)
      : null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    };
    child.on('error', (err) => {
      cleanup();
      console.error(err.message);
      process.exit(1);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      if (timedOut) process.exit(1);
      if (signal) { console.error(`[run-tests] "${formatCommand(cmd, args)}" killed by signal ${signal}`); process.exit(1); }
      if (code !== 0) process.exit(code || 1);
      resolve();
    });
  });
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

Run with --list to see suite contents.`);
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
