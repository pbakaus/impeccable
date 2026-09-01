#!/usr/bin/env node

/**
 * Generates cli/engine/vendor/static-html-parsers.mjs
 * by bundling htmlparser2, css-select, css-tree, and domutils for skill/plugin installs.
 *
 * Run: node scripts/build-static-html-parsers.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENTRY = path.join(__dirname, 'lib/static-html-parsers.entry.mjs');
const OUT_DIR = path.join(ROOT, 'cli/engine/vendor');
const OUTPUT = path.join(OUT_DIR, 'static-html-parsers.mjs');

fs.mkdirSync(OUT_DIR, { recursive: true });

const result = spawnSync(
  'bun',
  ['build', ENTRY, '--outfile', OUTPUT, '--target', 'node', '--format', 'esm'],
  { cwd: ROOT, encoding: 'utf8' },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'bun build failed\n');
  process.exit(result.status ?? 1);
}

const bundled = fs.readFileSync(OUTPUT, 'utf8');
const output = `/**
 * GENERATED -- do not edit. Source: scripts/lib/static-html-parsers.entry.mjs
 * Rebuild: node scripts/build-static-html-parsers.js
 *
 * Bundles htmlparser2, css-select, css-tree, and domutils for skill/plugin installs.
 * Third-party licenses: see NOTICE.md.
 */
${bundled}`;

fs.writeFileSync(OUTPUT, output);
console.log(`Generated ${path.relative(ROOT, OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);
