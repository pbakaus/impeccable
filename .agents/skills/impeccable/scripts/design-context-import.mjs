#!/usr/bin/env node
/** Rebuild a design context in this project from a bundle another one exported.
 *
 *   node <scripts_path>/design-context-import.mjs <bundle.json>
 *     [--design skip|write] [--force]
 *
 * Refuses a project that already has a design context unless --force, and
 * refuses either way while an edit session is running, because the session is
 * the only writer of the store while it lives.
 *
 * Prints IMPORTED <n> files and DESIGN_MD carried|absent for the agent to
 * branch on. Exit 1 on a bundle this release cannot read.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { migrate, paths, pidAlive, readAnswers, readJsonSoft } from './design-context/store.mjs';
import { importDesignContext, validateBundle } from './design-context/portability.mjs';

function printHelp() {
  console.log(`Usage: node design-context-import.mjs <bundle.json> [options]

Rebuild this project's design context from an exported bundle.

Options:
  --design skip|write  Write DESIGN.md when the bundle carries one and this
                       project has none (default: skip)
  --force              Replace an existing design context
  --help               Show this help

Output:
  IMPORTED N files
  DESIGN_MD carried|absent

See reference/design-context.md for the canonical agent flow.`);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(args.length ? 0 : 1);
}

const source = args.find((arg) => !arg.startsWith('--'));
if (!source) {
  console.error('Name the bundle to import.');
  process.exit(1);
}

const designAt = args.indexOf('--design');
const design = designAt !== -1 && args[designAt + 1] ? args[designAt + 1] : 'skip';
if (!['skip', 'write'].includes(design)) {
  console.error('--design must be skip or write');
  process.exit(1);
}

await migrate(process.cwd());
const target = paths(process.cwd());

/* A running session holds the store: importing under it would swap the run out
   from beneath the document someone is reading and the batch it may owe. */
const session = await readJsonSoft(target.sessionJson);
if (session && pidAlive(session.pid)) {
  console.error(`A design context document is open on http://127.0.0.1:${session.port}. Close it, then import.`);
  process.exit(1);
}

if (!args.includes('--force') && await readAnswers(process.cwd())) {
  console.error('This project already has a design context. Re-run with --force to replace it.');
  process.exit(1);
}

let bundle;
try {
  bundle = validateBundle(JSON.parse(await readFile(path.resolve(process.cwd(), source), 'utf8')));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const result = await importDesignContext(process.cwd(), bundle, { design });
console.log(`IMPORTED ${result.written} files`);
console.log(`DESIGN_MD ${result.designCarried ? 'carried' : 'absent'}${result.designWritten ? ' written' : ''}`);
