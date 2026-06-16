#!/usr/bin/env node

/**
 * Impeccable CLI
 *
 * Usage:
 *   npx impeccable detect [file-or-dir-or-url...]
 *   npx impeccable ignores <list|add-file|add-value|remove-...>
 *   npx impeccable help|install|update
 *   npx impeccable --help
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_COMMANDS = new Set(['help', 'install', 'link', 'update', 'check']);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`Usage: impeccable <command> [options]

Commands:
  detect [file-or-dir-or-url...]   Scan for UI anti-patterns and design quality issues
  ignores                          Manage detector ignore rules, files, and values
  help                             List all available skills and commands
  install                          Install impeccable skills into your project or global harness
  link                             Symlink skills from a local checkout or submodule
  update                           Update skills to the latest version
  check                            Check if skill updates are available

Options:
  --help       Show this help message
  --version    Show version number

Compatibility:
  impeccable skills <command>       Legacy namespace; still supported.`);
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
  } else if (command === 'ignores' || command === 'ignore') {
    const { run } = await import('./commands/ignores.mjs');
    await run(args.slice(1));
  } else if (command === 'skills') {
    const { run } = await import('./commands/skills.mjs');
    await run(args.slice(1));
  } else if (SKILL_COMMANDS.has(command)) {
    const { run } = await import('./commands/skills.mjs');
    await run(args);
  } else {
    // Default: treat as detect arguments (allow `npx impeccable src/` shorthand)
    process.argv = [process.argv[0], process.argv[1], ...args];
    const { detectCli } = await import('../engine/detect-antipatterns.mjs');
    await detectCli();
  }
}

main().catch(error => {
  if (error?.code === 'IMPECCABLE_PROMPT_ABORT') {
    console.log('\nAborted.');
    process.exit(130);
  }

  console.error(error?.message || error);
  process.exit(1);
});
