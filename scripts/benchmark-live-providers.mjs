#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { bootFixtureSession, FIXTURES_DIR } from '../tests/live-e2e/session.mjs';
import { createFakeAgent } from '../tests/live-e2e/agent.mjs';
import {
  clickAccept,
  clickGo,
  pickElement,
  waitForCycling,
  waitForHandshake,
} from '../tests/live-e2e/ui.mjs';
import {
  BRAND_CONTRACT,
  PROVIDER_PROFILES,
  STRATEGIES,
  applyRuntimeSourceScore,
  createProviderLiveAgent,
  loadBenchmarkEnv,
  resolveProviderSelection,
  scoreVariantOutput,
  summarizeProviderRuns,
  validateAcceptedCleanup,
} from './lib/live-provider-benchmark.mjs';

const execFileP = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_NAME = 'vite8-react-brand-fidelity';
const SOURCE_FILE = 'src/App.jsx';
const args = parseArgs(process.argv.slice(2));
const iterations = positiveInt(args.iterations, 1);
const providers = csv(args.providers || 'anthropic,openai,google');
const strategies = csv(args.strategies || Object.keys(STRATEGIES).join(','));
const outputPath = args.output ? resolve(ROOT, String(args.output)) : null;
const loadedEnv = loadBenchmarkEnv({ repoRoot: ROOT, explicitPath: args.envFile ? resolve(String(args.envFile)) : null });
const modelOverrides = Object.fromEntries(providers.map((provider) => [provider, args[`${provider}Model`]]).filter(([, value]) => value));
const selection = resolveProviderSelection(providers, modelOverrides);
const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, FIXTURE_NAME, 'fixture.json'), 'utf-8'));
const liveSpec = await readFile(join(ROOT, 'skill', 'reference', 'live.md'), 'utf-8');

validateConfiguration({ fixture, strategies, selection, liveSpec });

if (args.dryRun) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    fixture: FIXTURE_NAME,
    iterations,
    envFilesLoaded: loadedEnv.length,
    providers: selection.map(publicProviderSelection),
    strategies: strategies.map((strategy) => ({ strategy, ...STRATEGIES[strategy] })),
    plannedApiCallsPerIteration: Object.fromEntries(strategies.map((strategy) => [strategy, callsPerStrategy(strategy)])),
    qualityGate: qualityGateDescription(),
  };
  if (outputPath) await persist(report, outputPath);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

const available = selection.filter((item) => item.keyPresent);
if (args.requireAll && available.length !== selection.length) {
  const missing = selection.filter((item) => !item.keyPresent).map((item) => item.provider);
  throw new Error(`missing API keys for: ${missing.join(', ')}`);
}
if (available.length === 0) throw new Error('no provider API keys found; use --dry-run to validate without network calls');

const needsBrowser = args.pipeline === 'e2e' || args.skipCleanupControl !== true;
const { chromium } = needsBrowser ? await import('playwright') : { chromium: null };
const browser = chromium ? await chromium.launch({ headless: args.headed !== true }) : null;
const results = [];
let cleanupControl = { passed: true, skipped: true };
try {
  if (args.skipCleanupControl !== true) {
    process.stderr.write('[live-provider-bench] running provider-independent Accept/cleanup control\n');
    cleanupControl = await runCleanupControl({ browser, fixture });
  }
  if (args.cleanupOnly) {
    const cleanupReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: 'cleanup-control',
      fixture: FIXTURE_NAME,
      cleanupControl,
    };
    if (outputPath) await persist(cleanupReport, outputPath);
    process.stdout.write(JSON.stringify(cleanupReport, null, 2) + '\n');
    process.exitCode = cleanupControl.passed ? 0 : 1;
  }
  if (args.cleanupOnly) {
    // Skip provider calls; the finally block still closes Chromium.
  } else {
  for (const providerConfig of available) {
    for (const strategy of strategies) {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        process.stderr.write(`[live-provider-bench] ${providerConfig.provider}/${providerConfig.model} ${strategy} run ${iteration}/${iterations}\n`);
        results.push(args.pipeline === 'e2e'
          ? await runOne({ browser, fixture, liveSpec, providerConfig, strategy, iteration })
          : await runGenerationOne({ liveSpec, providerConfig, strategy, iteration, cleanupControl }));
      }
    }
  }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}

if (args.cleanupOnly) process.exit(process.exitCode || 0);

const groups = [];
for (const providerConfig of selection) {
  for (const strategy of strategies) {
    const runs = results.filter((run) => run.provider === providerConfig.provider && run.strategy === strategy);
    if (runs.length === 0) continue;
    groups.push({
      provider: providerConfig.provider,
      model: providerConfig.model,
      strategy,
      strategyConfig: STRATEGIES[strategy],
      summary: summarizeProviderRuns(runs),
      runs,
    });
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: 'live',
  fixture: FIXTURE_NAME,
  iterations,
  providers: selection.map(publicProviderSelection),
  qualityGate: qualityGateDescription(),
  cleanupControl,
  groups,
  evaluations: evaluateStrategies(groups),
  totals: {
    apiCalls: results.reduce((sum, run) => sum + run.providerCalls.filter((call) => call.phase !== 'parallel-assembled').length, 0),
    estimatedCostUsd: roundUsd(results.reduce((sum, run) => sum + run.estimatedCostUsd, 0)),
    passingRuns: results.filter((run) => run.passed).length,
    totalRuns: results.length,
  },
};

if (outputPath) await persist(report, outputPath);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');

async function runGenerationOne({ liveSpec: loadedLiveSpec, providerConfig, strategy, iteration, cleanupControl: cleanup }) {
  const records = [];
  const agent = createProviderLiveAgent({
    provider: providerConfig.provider,
    model: providerConfig.model,
    strategy,
    liveSpec: loadedLiveSpec,
    onRecord: (record) => {
      records.push(record);
      const result = record.error ? `error=${record.error.split('\n')[0]}` : `duration=${record.durationMs ?? 0}ms`;
      process.stderr.write(`[live-provider-bench:model] ${record.phase}${record.lane ? `/${record.lane}` : ''} attempt=${record.attempt} ${result}\n`);
    },
  });
  const event = syntheticEvent(`${providerConfig.provider}-${strategy}-${iteration}`);
  const startedAt = performance.now();
  try {
    let output;
    let firstOutput;
    let firstReviewableMs;
    if (typeof agent.generateFirstVariant === 'function') {
      firstOutput = await agent.generateFirstVariant(event, {});
      firstReviewableMs = roundMs(performance.now() - startedAt);
      output = await agent.generateRemainingVariants(event, { firstOutput });
    } else {
      output = await agent.generateVariants(event, {});
      firstReviewableMs = roundMs(performance.now() - startedAt);
    }
    const allReadyMs = roundMs(performance.now() - startedAt);
    const quality = scoreVariantOutput(output);
    const estimatedCostUsd = roundUsd(records.reduce((sum, record) => sum + Number(record.estimatedCostUsd || 0), 0));
    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      strategy,
      iteration,
      firstReviewableMs,
      allReadyMs,
      acceptCleanupMs: cleanup.acceptCleanupMs ?? null,
      quality,
      cleanup,
      firstOutputScore: firstOutput ? scoreVariantOutput(firstOutput) : quality,
      providerCalls: records.map(publicProviderRecord),
      estimatedCostUsd,
      passed: quality.passed && cleanup.passed,
    };
  } catch (error) {
    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      strategy,
      iteration,
      error: String(error?.stack || error),
      cleanup,
      providerCalls: records.map(publicProviderRecord),
      estimatedCostUsd: roundUsd(records.reduce((sum, record) => sum + Number(record.estimatedCostUsd || 0), 0)),
      passed: false,
    };
  }
}

async function runCleanupControl({ browser, fixture: loadedFixture }) {
  let session;
  try {
    session = await bootFixtureSession({
      name: FIXTURE_NAME,
      fixture: loadedFixture,
      browser,
      agent: createFakeAgent(),
      wrapTarget: { classes: 'offer-card', tag: 'article', text: 'Field Notes' },
      progressive: false,
      log: args.verbose ? (message) => process.stderr.write(`[live-provider-bench:cleanup] ${message}\n`) : () => {},
    });
    await waitForHandshake(session.page);
    await pickElement(session.page, loadedFixture.runtime.pickSelector);
    await clickGo(session.page);
    await waitForCycling(session.page, 3, { timeout: 45_000 });
    const acceptAt = performance.now();
    await clickAccept(session.page, { expectedVariant: 1 });
    const browserClean = await waitForAcceptCleanup(session.page, session.tmp);
    const acceptCleanupMs = roundMs(performance.now() - acceptAt);
    const source = await readFile(join(session.tmp, SOURCE_FILE), 'utf-8');
    const build = args.skipBuild ? { passed: true, skipped: true } : await verifyBuild(session.tmp);
    return {
      ...validateAcceptedCleanup({ source, browserClean, buildPassed: build.passed }),
      acceptCleanupMs,
      build,
      consoleErrorCount: session.consoleErrors.length,
    };
  } catch (error) {
    return { passed: false, error: String(error?.stack || error) };
  } finally {
    if (session) await session.teardown();
  }
}

async function runOne({ browser, fixture, liveSpec, providerConfig, strategy, iteration }) {
  const records = [];
  const agent = createProviderLiveAgent({
    provider: providerConfig.provider,
    model: providerConfig.model,
    strategy,
    liveSpec,
    onRecord: (record) => {
      records.push(record);
      const result = record.error ? `error=${record.error.split('\n')[0]}` : `duration=${record.durationMs ?? 0}ms`;
      process.stderr.write(`[live-provider-bench:model] ${record.phase}${record.lane ? `/${record.lane}` : ''} attempt=${record.attempt} ${result}\n`);
    },
  });
  let session;
  const startedAt = performance.now();
  try {
    session = await bootFixtureSession({
      name: FIXTURE_NAME,
      fixture,
      browser,
      agent,
      wrapTarget: (event) => ({
        classes: event.element?.classes?.join(',') || 'offer-card',
        tag: event.element?.tagName?.toLowerCase() || 'article',
        text: event.element?.textContent?.trim(),
      }),
      progressive: STRATEGIES[strategy].delivery !== 'atomic',
      log: args.verbose ? (message) => process.stderr.write(`[live-provider-bench:e2e] ${message}\n`) : () => {},
    });
    await waitForHandshake(session.page);
    await pickElement(session.page, fixture.runtime.pickSelector);

    const goAt = performance.now();
    const firstReady = waitForFirstReviewable(session.page);
    await clickGo(session.page);
    await firstReady;
    const firstReviewableMs = roundMs(performance.now() - goAt);
    await waitForCycling(session.page, 3, { timeout: 240_000 });
    const allReadyMs = roundMs(performance.now() - goAt);

    const finalRecord = [...records].reverse().find((record) => ['atomic', 'remaining', 'parallel-assembled'].includes(record.phase) && record.output);
    if (!finalRecord) throw new Error('provider benchmark produced no complete variant output');
    let quality = scoreVariantOutput(finalRecord.output);

    const acceptAt = performance.now();
    await clickAccept(session.page, { expectedVariant: 1 });
    const browserClean = await waitForAcceptCleanup(session.page, session.tmp);
    const acceptCleanupMs = roundMs(performance.now() - acceptAt);
    const source = await readFile(join(session.tmp, SOURCE_FILE), 'utf-8');
    const build = args.skipBuild ? { passed: true, skipped: true } : await verifyBuild(session.tmp);
    const cleanup = validateAcceptedCleanup({ source, browserClean, buildPassed: build.passed });
    quality = applyRuntimeSourceScore(quality, cleanup);

    const estimatedCostUsd = roundUsd(records.reduce((sum, record) => sum + Number(record.estimatedCostUsd || 0), 0));
    const passed = quality.passed && cleanup.passed;
    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      strategy,
      iteration,
      firstReviewableMs,
      allReadyMs,
      acceptCleanupMs,
      endToEndMs: roundMs(performance.now() - startedAt),
      quality,
      cleanup,
      build,
      consoleErrorCount: session.consoleErrors.length,
      providerCalls: records.map(publicProviderRecord),
      estimatedCostUsd,
      passed,
    };
  } catch (error) {
    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      strategy,
      iteration,
      error: String(error?.stack || error),
      providerCalls: records.map(publicProviderRecord),
      estimatedCostUsd: roundUsd(records.reduce((sum, record) => sum + Number(record.estimatedCostUsd || 0), 0)),
      passed: false,
    };
  } finally {
    if (session) await session.teardown();
  }
}

async function waitForFirstReviewable(page) {
  await page.waitForFunction(() => {
    const query = window.__impeccableLiveQuery || ((selector) => document.querySelector(selector));
    const wrapper = query('[data-impeccable-variants]');
    if (!wrapper) return false;
    const sourceVariants = wrapper.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])');
    const debug = window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.();
    const arrived = wrapper.dataset.impeccablePreview === 'svelte-component'
      ? Number(debug?.arrivedVariants || 0)
      : sourceVariants.length;
    return arrived >= 1;
  }, undefined, { timeout: 240_000 });
}

async function waitForAcceptCleanup(page, tmp) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const browserClean = await page.evaluate(() => {
      const query = window.__impeccableLiveQuery || ((selector) => document.querySelector(selector));
      const wrapperGone = !query('[data-impeccable-variants]');
      const state = document.documentElement.dataset.impeccableLiveState;
      return wrapperGone && (!state || state === 'PICKING');
    }).catch(() => false);
    const source = await readFile(join(tmp, SOURCE_FILE), 'utf-8').catch(() => '');
    const sourceClean = source && !/data-impeccable-|impeccable-(?:variants|carbonize|params|original)/i.test(source);
    if (browserClean && sourceClean) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  return false;
}

async function verifyBuild(tmp) {
  const startedAt = performance.now();
  try {
    await execFileP('npm', ['run', 'build'], { cwd: tmp, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return { passed: true, durationMs: roundMs(performance.now() - startedAt) };
  } catch (error) {
    return {
      passed: false,
      durationMs: roundMs(performance.now() - startedAt),
      error: String(error?.stderr || error?.message || error).slice(0, 2000),
    };
  }
}

function evaluateStrategies(groups) {
  const evaluations = [];
  for (const provider of new Set(groups.map((group) => group.provider))) {
    const providerGroups = groups.filter((group) => group.provider === provider);
    const baseline = providerGroups.find((group) => group.strategy === 'atomic-full');
    const baselineValid = baseline?.summary.gatePassRate === 1
      && Number.isFinite(baseline?.summary.metrics.firstReviewableMs?.median);
    for (const group of providerGroups) {
      const summary = group.summary;
      const qualityPass = summary.gatePassRate === 1 && summary.cleanupPassRate === 1;
      const first = summary.metrics.firstReviewableMs?.median;
      const baselineFirst = baseline?.summary.metrics.firstReviewableMs?.median;
      const firstImprovement = Number.isFinite(first) && Number.isFinite(baselineFirst) && baselineFirst > 0
        ? Number((1 - first / baselineFirst).toFixed(4))
        : null;
      const latencyPass = group.strategy === 'atomic-full'
        || (baselineValid ? firstImprovement != null && firstImprovement > 0.1 : Number.isFinite(first) && first < 15_000);
      evaluations.push({
        provider,
        model: group.model,
        strategy: group.strategy,
        decision: qualityPass && latencyPass ? 'accept' : 'reject',
        firstReviewableImprovementVsAtomic: firstImprovement,
        qualityPass,
        latencyPass,
        reason: !qualityPass
          ? 'Rejected: fidelity, source validity, or cleanup gate failed.'
          : !latencyPass
            ? 'Rejected: first-reviewable median did not improve by more than 10%.'
            : group.strategy === 'atomic-full'
              ? 'Control: retained as the one-call baseline.'
              : !baselineValid
                ? 'Accepted: quality passed and first review completed under 15 seconds; the atomic control was invalid for this provider.'
              : 'Accepted: materially faster first review with all quality and cleanup gates intact.',
      });
    }
  }
  return evaluations;
}

function publicProviderSelection(item) {
  return {
    provider: item.provider,
    label: item.label,
    model: item.model,
    keyPresent: item.keyPresent,
    pricePerMillion: item.pricePerMillion,
    effort: item.effort,
    priceSource: item.priceSource,
  };
}

function publicProviderRecord(record) {
  return {
    phase: record.phase,
    lane: record.lane,
    attempt: record.attempt,
    durationMs: record.durationMs,
    totalPhaseMs: record.totalPhaseMs,
    usage: record.usage,
    estimatedCostUsd: record.estimatedCostUsd,
    error: record.error,
    outputScore: record.output ? scoreVariantOutput(record.output) : undefined,
  };
}

function qualityGateDescription() {
  return {
    deterministic: true,
    pass: 'overall >= 0.90 and every dimension >= 0.75; accepted source must build and contain no Live markers',
    dimensions: ['brandFidelity', 'componentFidelity', 'tokenFidelity', 'copyFidelity', 'sourceValidity', 'acceptCleanup'],
    identityLock: BRAND_CONTRACT.identity,
  };
}

function syntheticEvent(id) {
  const outerHTML = BRAND_CONTRACT.sourceExcerpt
    .replaceAll('className=', 'class=')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id,
    action: 'impeccable',
    freeformPrompt: 'Make this offer easier to scan while staying unmistakably inside the existing brand and component system.',
    count: 3,
    mode: 'replace',
    element: {
      outerHTML,
      tagName: 'ARTICLE',
      className: 'offer-card',
      classes: ['offer-card'],
      textContent: BRAND_CONTRACT.requiredCopy.join(' '),
    },
  };
}

function callsPerStrategy(strategy) {
  if (strategy === 'atomic-full') return 1;
  if (strategy === 'parallel-compact') return 3;
  return 2;
}

function validateConfiguration({ fixture: loadedFixture, strategies: selectedStrategies, selection: selectedProviders, liveSpec: loadedLiveSpec }) {
  if (!loadedFixture.runtime?.pickSelector) throw new Error('benchmark fixture requires runtime.pickSelector');
  if (!loadedLiveSpec.includes('Phase A: Extract the identity')) throw new Error('live.md identity-lock guidance not found');
  for (const strategy of selectedStrategies) if (!STRATEGIES[strategy]) throw new Error(`unknown strategy ${strategy}`);
  if (selectedProviders.length === 0) throw new Error('at least one provider is required');
  for (const provider of selectedProviders) if (!PROVIDER_PROFILES[provider.provider]) throw new Error(`unknown provider ${provider.provider}`);
}

async function persist(report, file) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  process.stderr.write(`[live-provider-bench] wrote ${file}\n`);
}

function parseArgs(argv) {
  const out = {};
  for (let position = 0; position < argv.length; position += 1) {
    const arg = argv[position];
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const index = body.indexOf('=');
    if (index !== -1) {
      out[camel(body.slice(0, index))] = body.slice(index + 1);
      continue;
    }
    const next = argv[position + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[camel(body)] = next;
      position += 1;
    } else {
      out[camel(body)] = true;
    }
  }
  return out;
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function csv(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundMs(value) {
  return Number(Number(value).toFixed(2));
}

function roundUsd(value) {
  return Number(Number(value).toFixed(6));
}
