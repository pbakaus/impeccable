#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iterations = Math.max(1, Number(arg('--iterations') || 5));
const fixture = arg('--fixture') || 'vite8-react-plain';
const metricsFile = path.join(os.tmpdir(), 'impeccable-live-control-' + process.pid + '.jsonl');

try {
  for (let index = 0; index < iterations; index += 1) {
    execFileSync('bun', ['run', 'test:live-e2e'], {
      cwd: root,
      stdio: 'ignore',
      timeout: 120_000,
      env: {
        ...process.env,
        IMPECCABLE_E2E_ONLY: fixture,
        IMPECCABLE_E2E_SCENARIOS: 'progressive',
        IMPECCABLE_E2E_METRICS_FILE: metricsFile,
      },
    });
  }

  const rows = fs.readFileSync(metricsFile, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify({
    fixture,
    iterations: rows.length,
    measuredAt: new Date().toISOString(),
    acceptToPicking: summarize(rows.map((row) => row.acceptToPickingMs)),
    nextGoToPickup: summarize(rows.map((row) => row.nextGoToPickupMs)),
    samples: rows,
  }, null, 2));
} finally {
  try { fs.unlinkSync(metricsFile); } catch {}
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round((sorted[lower] * (1 - (index - lower)) + sorted[upper] * (index - lower)) * 100) / 100;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
