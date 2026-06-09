#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { DEFAULT_SUITES, OPT_IN_SUITES, SUITES, expandSuites } from './test-suites.mjs';

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

for (const suiteName of suites) {
  const suite = SUITES[suiteName];
  console.log(`\n## test:${suiteName}`);
  console.log(suite.description);
  for (const command of suite.commands) {
    runCommand(command);
  }
}

function runCommand(command) {
  const env = { ...process.env, ...(command.env || {}) };
  if (command.runner === 'bun') {
    runProcess('bun', ['test', ...command.files], { env });
    return;
  }

  if (command.runner === 'node') {
    for (const file of command.files) {
      const args = ['--test'];
      if (command.timeoutMs) args.push(`--test-timeout=${command.timeoutMs}`);
      if (command.forceExit) args.push('--test-force-exit');
      args.push(file);
      runProcess(process.execPath, args, { env });
    }
    return;
  }

  throw new Error(`Unsupported test runner "${command.runner}"`);
}

function runProcess(cmd, args, { env }) {
  console.log(`$ ${formatCommand(cmd, args)}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
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
