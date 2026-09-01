#!/usr/bin/env node

/**
 * Generates cli/engine/vendor/static-html-parsers.mjs
 * by bundling htmlparser2, css-select, css-tree, and domutils for skill/plugin installs.
 *
 * Run: node scripts/build-static-html-parsers.js
 * Check: node scripts/build-static-html-parsers.js --check
 */

import { createHash } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENTRY = path.join(__dirname, 'lib/static-html-parsers.entry.mjs');
const OUT_DIR = path.join(ROOT, 'cli/engine/vendor');
const OUTPUT = path.join(OUT_DIR, 'static-html-parsers.mjs');
const PARSER_PACKAGES = ['htmlparser2', 'css-select', 'css-tree', 'domutils'];
const DIGEST_RE = /^\s*\* Source digest: ([0-9a-f]+)\s*$/m;

function sourceDigest() {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(ENTRY));
  hash.update('\n');
  for (const name of PARSER_PACKAGES) {
    const pkgPath = path.join(ROOT, 'node_modules', name, 'package.json');
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    hash.update(`${name}@${version}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

function header(digest) {
  return `/**
 * GENERATED -- do not edit. Source: scripts/lib/static-html-parsers.entry.mjs
 * Rebuild: node scripts/build-static-html-parsers.js
 * Source digest: ${digest}
 *
 * Bundles htmlparser2, css-select, css-tree, and domutils for skill/plugin installs.
 * Third-party licenses: see NOTICE.md.
 */
`;
}

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
  const output = header(sourceDigest()) + fs.readFileSync(outfile, 'utf8');
  fs.writeFileSync(outfile, output);
  return output;
}

if (process.argv.includes('--check')) {
  const committed = fs.readFileSync(OUTPUT, 'utf8');
  const found = committed.match(DIGEST_RE)?.[1];
  const expected = sourceDigest();
  if (found !== expected) {
    process.stderr.write(
      'cli/engine/vendor/static-html-parsers.mjs is stale. Run: node scripts/build-static-html-parsers.js\n',
    );
    process.exit(1);
  }
  process.exit(0);
}

generate(OUTPUT);
console.log(`Generated ${path.relative(ROOT, OUTPUT)} (${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB)`);
