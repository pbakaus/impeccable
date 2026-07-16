#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { compareModelBackedReports } from './lib/live-benchmark.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.atomic || !args.progressive) {
  throw new Error('usage: node scripts/compare-live-benchmarks.mjs --atomic=<report.json> --progressive=<report.json>');
}

const [atomic, progressive] = await Promise.all([
  readReport(args.atomic, 'atomic'),
  readReport(args.progressive, 'progressive'),
]);
const comparison = compareModelBackedReports(atomic, progressive, {
  medianTarget: ratioArg(args.medianTarget, 0.35),
  p95Target: ratioArg(args.p95Target, 0.25),
});

process.stdout.write(JSON.stringify(comparison, null, 2) + '\n');
if (!comparison.passed) process.exitCode = 1;

async function readReport(file, delivery) {
  const value = JSON.parse(await readFile(resolve(String(file)), 'utf-8'));
  const reports = Array.isArray(value?.reports) ? value.reports : [value];
  const report = reports.find((item) => item?.benchmark?.delivery === delivery);
  if (!report) throw new Error(`${file} does not contain a ${delivery} benchmark report`);
  return report;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const index = arg.indexOf('=');
    if (index > 2) out[arg.slice(2, index)] = arg.slice(index + 1);
  }
  return out;
}

function ratioArg(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) throw new Error(`invalid threshold ratio: ${value}`);
  return parsed;
}
