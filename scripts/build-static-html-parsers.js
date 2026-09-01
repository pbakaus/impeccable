#!/usr/bin/env node

/**
 * Generates cli/engine/vendor/static-html-parsers.mjs
 * by bundling htmlparser2, css-select, css-tree, and domutils for skill/plugin installs.
 *
 * Run: node scripts/build-static-html-parsers.js
 * Check: node scripts/build-static-html-parsers.js --check
 */

import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENTRY = path.join(__dirname, 'lib/static-html-parsers.entry.mjs');
const OUT_DIR = path.join(ROOT, 'cli/engine/vendor');
const OUTPUT = path.join(OUT_DIR, 'static-html-parsers.mjs');
const HEADER = `/**
 * GENERATED -- do not edit. Source: scripts/lib/static-html-parsers.entry.mjs
 * Rebuild: node scripts/build-static-html-parsers.js
 *
 * Bundles htmlparser2, css-select, css-tree, and domutils for skill/plugin installs.
 * Third-party licenses: see NOTICE.md.
 */
`;

function generate(outfile) {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const result = spawnSync(
    'bun',
    ['build', ENTRY, '--outfile', outfile, '--target', 'node', '--format', 'esm'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'bun build failed\n');
    process.exit(result.status ?? 1);
  }
  const output = HEADER + fs.readFileSync(outfile, 'utf8');
  fs.writeFileSync(outfile, output);
  return output;
}

if (process.argv.includes('--check')) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-static-html-parsers-'));
  const tmpFile = path.join(tmpDir, 'static-html-parsers.mjs');
  try {
    const fresh = generate(tmpFile);
    const committed = fs.readFileSync(OUTPUT, 'utf8');
    if (fresh !== committed) {
      process.stderr.write(
        'cli/engine/vendor/static-html-parsers.mjs is stale. Run: node scripts/build-static-html-parsers.js\n',
      );
      process.exit(1);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  process.exit(0);
}

generate(OUTPUT);
console.log(`Generated ${path.relative(ROOT, OUTPUT)} (${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB)`);
