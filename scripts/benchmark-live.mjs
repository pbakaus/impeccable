#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeAgent } from '../tests/live-e2e/agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from '../tests/live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR } from '../tests/live-e2e/session.mjs';
import {
  clickDiscard,
  clickGo,
  drawAnnotationPinAndStroke,
  pickElement,
  waitForCycling,
  waitForHandshake,
} from '../tests/live-e2e/ui.mjs';
import {
  buildInteractionRun,
  assembleSplitProgressiveOutput,
  createBenchmarkReport,
  createTraceRecorder,
  mergeBenchmarkReports,
} from './lib/live-benchmark.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const fixtureName = String(args.fixture || 'vite8-react-plain');
const iterations = positiveInt(args.iterations, 5);
const agentMode = args.agent === 'llm' ? 'llm' : 'fake';
const scenario = args.scenario === 'annotated' ? 'annotated' : 'plain';
const delivery = args.delivery === 'progressive' ? 'progressive' : 'atomic';
const simulatedTailMs = positiveInt(args.simulatedTailMs, 0);
const outputPath = args.output ? resolve(ROOT, String(args.output)) : null;
const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, fixtureName, 'fixture.json'), 'utf-8'));
if (!fixture.runtime) throw new Error(`fixture ${fixtureName} has no runtime configuration`);
if (fixture.runtime.mode === 'insert') throw new Error('live benchmark currently measures replace-mode fixtures only');

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: args.headed !== true });
const recorder = createTraceRecorder();
let session;

try {
  const agentInfo = await resolveAgent(agentMode, args);
  if (delivery === 'progressive' && agentMode === 'llm') {
    agentInfo.agent = createSplitProgressiveAgent(agentInfo.agent);
  }
  session = await bootFixtureSession({
    name: fixtureName,
    fixture,
    browser,
    agent: agentInfo.agent,
    wrapTarget: wrapTargetFromPickedElement,
    trace: recorder.trace,
    progressive: delivery === 'progressive',
    progressiveDelayMs: delivery === 'progressive' ? simulatedTailMs : 0,
    atomicDelayMs: delivery === 'atomic' ? simulatedTailMs : 0,
    log: args.quiet ? () => {} : (message) => process.stderr.write(`[live-bench] ${message}\n`),
  });

  recorder.mark('setup.handshake.start');
  session.page.on('request', (request) => {
    if (!request.url().endsWith('/events') || request.method() !== 'POST') return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    if (payload?.type === 'generate' && payload.id) {
      recorder.mark('browser.generate_post', {
        id: payload.id,
        hasScreenshotPath: typeof payload.screenshotPath === 'string' && payload.screenshotPath.length > 0,
        commentCount: Array.isArray(payload.comments) ? payload.comments.length : 0,
        strokeCount: Array.isArray(payload.strokes) ? payload.strokes.length : 0,
      });
    }
  });
  await waitForHandshake(session.page);
  recorder.mark('setup.handshake.end');
  await installBrowserTimingProbe(session.page);

  const runs = [];
  const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    await pickElement(session.page, pickSelector, { resetPickMode: iteration > 1 });
    if (scenario === 'annotated') {
      await drawAnnotationPinAndStroke(session.page, { comment: 'Benchmark annotation' });
    }
    await resetBrowserTimingProbe(session.page, iteration);

    const goStarted = recorder.mark('ui.go.start', { iteration, scenario });
    const firstVariant = waitForFirstVariant(session.page).then(() => {
      recorder.mark('browser.first_variant', { iteration, scenario });
    });

    await clickGo(session.page);
    recorder.mark('ui.generating_visible', { iteration, scenario });
    await firstVariant;
    await waitForCycling(session.page, 3, { timeout: agentMode === 'llm' ? 150_000 : 30_000 });
    recorder.mark('browser.all_variants', { iteration, scenario });
    const browserTiming = await readBrowserTimingProbe(session.page);

    const run = buildInteractionRun(recorder.events, {
      iteration,
      scenario,
      goStartedAt: goStarted.at,
      browserTiming,
    });
    assertScenarioEvidence(run, scenario);
    runs.push(run);

    if (!args.quiet) process.stderr.write(formatRun(runs.at(-1)) + '\n');
    await clickDiscard(session.page);
    await waitForReset(session.page);
  }

  const report = createBenchmarkReport({
    fixture: fixtureName,
    agent: agentMode,
    provider: agentInfo.provider,
    model: agentInfo.model,
    scenario,
    runs,
    events: recorder.events,
    harnessProbe: args.harnessProbe || null,
    delivery,
    promptMode: agentInfo.promptMode,
    simulation: simulatedTailMs > 0 ? { remainingGenerationMs: simulatedTailMs } : null,
  });

  let output = report;
  if (outputPath && args.append) {
    try {
      const existing = JSON.parse(await readFile(outputPath, 'utf-8'));
      const previousReports = Array.isArray(existing.reports) ? existing.reports : [existing];
      output = mergeBenchmarkReports([...previousReports, report]);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const json = JSON.stringify(output, null, 2) + '\n';
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, 'utf-8');
    process.stderr.write(`[live-bench] wrote ${outputPath}\n`);
  }
  process.stdout.write(json);
} finally {
  if (session) await session.teardown();
  await browser.close().catch(() => {});
}

async function resolveAgent(mode, options) {
  if (mode === 'fake') return { agent: createFakeAgent(), provider: 'deterministic', model: null, promptMode: null };
  const config = resolveLlmAgentConfig({
    provider: options.provider,
    model: options.model,
  });
  const agent = await createLlmAgent({
    config,
    includeLiveSpec: false,
    log: (message) => process.stderr.write(`[live-bench:llm] ${message}\n`),
  });
  if (!agent) {
    throw new Error(`LLM benchmark provider=${config.provider} requires ${config.requiredEnv}. Pass it in the environment; .env files are not read implicitly.`);
  }
  return { agent, provider: config.provider, model: config.model, promptMode: 'synthetic-element-contract' };
}

function createSplitProgressiveAgent(agent) {
  const firstBySession = new Map();
  return {
    ...agent,
    async generateFirstVariant(event, context) {
      const first = await agent.generateVariants({
        ...event,
        count: 1,
        progressive: { phase: 'first', totalCount: event.count },
      }, context);
      firstBySession.set(event.id, first);
      return first;
    },
    async generateRemainingVariants(event, context) {
      const first = firstBySession.get(event.id) || context.firstOutput;
      const remaining = await agent.generateVariants({
        ...event,
        count: event.count,
        progressive: {
          phase: 'remaining',
          totalCount: event.count,
          firstVariant: first?.variants?.[0] || null,
          omitFirstVariantCss: true,
        },
      }, context);
      firstBySession.delete(event.id);
      return assembleSplitProgressiveOutput(first, remaining);
    },
  };
}

async function waitForFirstVariant(page) {
  const handle = await page.waitForFunction(() => {
    const wrappers = [...document.querySelectorAll('[data-impeccable-variant]')];
    return wrappers.some((element) => element.getAttribute('data-impeccable-variant') !== 'original');
  }, undefined, { timeout: 150_000 });
  await handle.dispose();
}

async function waitForReset(page) {
  await page.waitForFunction(() => !document.querySelector('[data-impeccable-variants]'), undefined, { timeout: 30_000 });
  await page.waitForTimeout(100);
}

async function installBrowserTimingProbe(page) {
  await page.evaluate(() => {
    const state = { iteration: 0, goAt: null, generateAt: null };
    window.__IMPECCABLE_LIVE_BENCH_TIMING__ = state;
    const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.()
      || window.__IMPECCABLE_LIVE_UI_ROOT__
      || document;
    root.addEventListener('click', (event) => {
      const button = event.composedPath().find((node) =>
        node?.getAttribute?.('aria-label') === 'Generate variants'
      );
      if (button) state.goAt = performance.now();
    }, true);

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      try {
        const url = typeof input === 'string' ? input : input?.url;
        if (String(url || '').endsWith('/events') && init?.method === 'POST') {
          const payload = typeof init.body === 'string' ? JSON.parse(init.body) : null;
          if (payload?.type === 'generate') state.generateAt = performance.now();
        }
      } catch { /* measurement must never affect Live */ }
      return originalFetch(input, init);
    };
  });
}

async function resetBrowserTimingProbe(page, iteration) {
  await page.evaluate((nextIteration) => {
    const state = window.__IMPECCABLE_LIVE_BENCH_TIMING__;
    if (!state) return;
    state.iteration = nextIteration;
    state.goAt = null;
    state.generateAt = null;
  }, iteration);
}

async function readBrowserTimingProbe(page) {
  return page.evaluate(() => {
    const state = window.__IMPECCABLE_LIVE_BENCH_TIMING__;
    return state ? { ...state } : null;
  });
}

function assertScenarioEvidence(run, currentScenario) {
  const evidence = run.annotationEvidence;
  if (currentScenario === 'annotated') {
    if (!evidence?.screenshotPath || evidence.comments < 1 || evidence.strokes < 1) {
      throw new Error(`iteration ${run.iteration}: annotated generate payload lost screenshot/comments/strokes`);
    }
    return;
  }
  if (evidence?.screenshotPath) {
    throw new Error(`iteration ${run.iteration}: plain generate payload unexpectedly included screenshotPath`);
  }
}

function wrapTargetFromPickedElement(event) {
  const element = event.element || {};
  return {
    elementId: element.id || undefined,
    classes: Array.isArray(element.classes) ? element.classes.join(',') : undefined,
    tag: element.tagName ? String(element.tagName).toLowerCase() : undefined,
    text: element.textContent ? String(element.textContent).trim() : undefined,
  };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const index = body.indexOf('=');
    if (index === -1) out[body] = true;
    else out[body.slice(0, index)] = body.slice(index + 1);
  }
  return out;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatRun(run) {
  return `[live-bench] run ${run.iteration}: first=${run.goToFirstVariantMs}ms all=${run.goToAllVariantsMs}ms generation=${run.generationMs}ms overhead=${run.impeccableOverheadMs}ms`;
}
