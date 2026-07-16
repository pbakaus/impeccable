#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveScript = path.join(root, 'skill/scripts/live.mjs');
const serverScript = path.join(root, 'skill/scripts/live-server.mjs');
const iterations = Math.max(1, Number(arg('--iterations') || 10));
const fixture = arg('--fixture') || 'vite8-react-plain';
const fixtureDir = path.join(root, 'tests/framework-fixtures', fixture, 'files');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-live-init-'));

try {
  fs.cpSync(fixtureDir, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'PRODUCT.md'), '# Product\n\nA realistic Live initialization benchmark fixture.\n');
  fs.writeFileSync(path.join(tmp, 'DESIGN.md'), '# Design\n\nUse the fixture\'s existing type, color, and component system.\n');
  fs.mkdirSync(path.join(tmp, '.impeccable/live'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.impeccable/live/config.json'), JSON.stringify({
    files: ['index.html'],
    insertBefore: '</body>',
    commentSyntax: 'html',
    cspChecked: true,
  }, null, 2) + '\n');

  const cold = [];
  for (let i = 0; i < iterations; i += 1) {
    stop();
    cold.push(runLive());
  }

  stop();
  runLive();
  const warm = [];
  for (let i = 0; i < iterations; i += 1) warm.push(runLive());

  console.log(JSON.stringify({
    fixture,
    iterations,
    measuredAt: new Date().toISOString(),
    cold: summarize(cold),
    warm: summarize(warm),
    samples: { cold, warm },
  }, null, 2));
} finally {
  stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}

function runLive() {
  const start = performance.now();
  const stdout = execFileSync(process.execPath, [liveScript], {
    cwd: tmp,
    encoding: 'utf-8',
    timeout: 15_000,
  });
  const elapsed = performance.now() - start;
  const result = JSON.parse(stdout);
  if (!result.ok) throw new Error('live init failed: ' + stdout);
  return round(elapsed);
}

function stop() {
  try {
    execFileSync(process.execPath, [serverScript, 'stop'], {
      cwd: tmp,
      stdio: 'ignore',
      timeout: 5_000,
    });
  } catch {}
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
}

function percentile(sorted, value) {
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * value;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
