#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

import { FIXTURES_DIR } from '../tests/live-e2e/session.mjs';
import { parseArgs } from './lib/cli-args.mjs';
import { loadBenchmarkEnv } from './lib/live-provider-benchmark.mjs';
import {
  buildRenderedReviewContext,
  judgeRenderedVariants,
  summarizeRenderedJudgeRuns,
} from './lib/live-rendered-quality.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const artifactRoot = resolve(ROOT, required(args, 'artifacts'));
const fixtureName = String(args.fixture || 'vite8-react-brand-fidelity');
const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, fixtureName, 'fixture.json'), 'utf-8'));
if (fixture.renderedQuality?.remoteSafe !== true) throw new Error(`fixture ${fixtureName} is not explicitly remote-safe`);

loadBenchmarkEnv({ repoRoot: ROOT, explicitPath: args.envFile ? resolve(String(args.envFile)) : null });
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');

const review = buildRenderedReviewContext({
  fixture: fixtureName,
  fixtureConfig: fixture,
  action: args.action,
  brief: args.brief,
});
const model = String(args.model || 'claude-sonnet-4-6');
const scenario = String(args.scenario || 'plain');
const scenarioRoot = join(artifactRoot, scenario);
const runNames = (await readdir(scenarioRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (runNames.length === 0) throw new Error(`no rendered runs found under ${scenarioRoot}`);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const runs = [];
for (const runName of runNames) {
  const runRoot = join(scenarioRoot, runName);
  const variants = [1, 2, 3].map((variantId) => ({
    variantId,
    path: join(runRoot, `variant-${variantId}.png`),
  }));
  process.stderr.write(`[live-rendered-judge] ${runName}\n`);
  runs.push({
    run: runName,
    renderedJudge: await judgeRenderedVariants({
      client,
      model,
      action: review.action,
      brief: review.brief,
      safeContext: review.safeContext,
      originalPath: join(runRoot, 'original.png'),
      variants,
    }),
  });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixture: fixtureName,
  scenario,
  model,
  artifacts: artifactRoot,
  review,
  summary: summarizeRenderedJudgeRuns(runs),
  runs,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) await writeFile(resolve(ROOT, String(args.output)), json, 'utf-8');
process.stdout.write(json);

function required(values, key) {
  const value = values[key];
  if (!value) throw new Error(`--${key}=<value> is required`);
  return String(value);
}

