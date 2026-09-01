#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.join(__dirname, 'detector', 'detect-antipatterns.mjs'),
  path.join(__dirname, '..', '..', 'cli', 'engine', 'detect-antipatterns.mjs'),
];
const detectorPath = candidates.find(p => fs.existsSync(p));

if (!detectorPath) {
  process.stderr.write('Error: bundled detector not found.\n');
  process.exit(1);
}

const { detectCli } = await import(pathToFileURL(detectorPath));

// A comp-led build with its comp round or hero gate still open is not a page
// the detector can pass: say so after the scan (stderr, so --json stays
// parseable), on the same condition context.mjs reports at boot.
try {
  const { compRoundOpen } = await import(pathToFileURL(path.join(__dirname, 'build-phase.mjs')));
  const open = compRoundOpen(process.cwd());
  if (open) process.stderr.write(`COMP_ROUND_OPEN: ${open.reason}. A detector pass is not a finish: run node ${__dirname}/build-phase.mjs status and follow its NEXT line before treating this page as built.\n`);
} catch { /* build-phase absent */ }

await detectCli();
