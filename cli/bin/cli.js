#!/usr/bin/env node

/**
 * Impeccable CLI
 *
 * Usage:
 *   npx impeccable detect [file-or-dir-or-url...]
 *   npx impeccable skills help|install|update
 *   npx impeccable --help
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`Usage: impeccable <command> [options]

Commands:
  detect [file-or-dir-or-url...]   Scan for UI anti-patterns and design quality issues
  skills help                      List all available skills and commands
  skills install                   Install impeccable skills into your project
  skills update                    Update skills to the latest version
  skills check                     Check if skill updates are available

Options:
  --help       Show this help message
  --version    Show version number

Run 'impeccable <command> --help' for command-specific options.`);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (command === 'detect') {
  process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];
  const { detectCli } = await import('../engine/detect-antipatterns.mjs');
  await detectCli();
} else if (command === 'skills') {
  const { run } = await import('./commands/skills.mjs');
  await run(args.slice(1));
} else {
  // Default: treat as detect arguments (allow `npx impeccable src/` shorthand)
  process.argv = [process.argv[0], process.argv[1], ...args];
  const { detectCli } = await import('../engine/detect-antipatterns.mjs');
  await detectCli();
}
