#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, positiveIntFlag } from './lib/cli-args.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const iterations = positiveIntFlag(args.iterations, 5);
const fixture = args.fixture ? String(args.fixture) : 'vite8-react-plain';
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

  const rows = readMetrics(metricsFile);
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

/**
 * Read the metrics the e2e run appended. Fail loudly rather than reporting a
 * summary of nothing: an absent file means the run never produced a sample, and
 * an ENOENT stack or a `{"medianMs": null}` report both read as "measured" when
 * nothing was measured at all.
 */
function readMetrics(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`no metrics were recorded at ${file}. Did the e2e run emit IMPECCABLE_E2E_METRICS_FILE rows?`);
  }
  const rows = raw.trim().split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`metrics line ${index + 1} is not valid JSON: ${error.message}`);
    }
  });
  if (rows.length === 0) throw new Error(`metrics file ${file} is empty; nothing to summarize`);
  return rows;
}

function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  // Distinguish "every sample was missing this metric" from a real measurement.
  // percentile() on an empty array reads sorted[-1] and yields NaN, which
  // JSON.stringify turns into null and silently passes for a result.
  if (sorted.length === 0) return { samples: 0, medianMs: null, p95Ms: null, minMs: null, maxMs: null };
  return {
    samples: sorted.length,
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
