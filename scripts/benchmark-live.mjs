#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

import { createFakeAgent } from '../tests/live-e2e/agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from '../tests/live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR } from '../tests/live-e2e/session.mjs';
import {
  clickAccept,
  clickDiscard,
  clickGo,
  clickNext,
  clickPrev,
  drawAnnotationPinAndStroke,
  getVisibleVariant,
  pickElement,
  selectAction,
  waitForCycling,
  waitForHandshake,
} from '../tests/live-e2e/ui.mjs';
import {
  buildInteractionRun,
  assembleSplitProgressiveOutput,
  createBenchmarkReport,
  createTraceRecorder,
  deriveJournalGenerationMetrics,
  mergeBenchmarkReports,
  parseLiveBenchmarkArgs,
  resolveLiveBenchmarkPaths,
} from './lib/live-benchmark.mjs';
import { loadBenchmarkEnv } from './lib/live-provider-benchmark.mjs';
import {
  buildRenderedReviewContext,
  judgeRenderedVariants,
  summarizeRenderedJudgeRuns,
} from './lib/live-rendered-quality.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseLiveBenchmarkArgs(process.argv.slice(2));
const {
  fixtureName,
  fixtureDir,
  fixtureOrigin,
  evidenceRoot,
  artifactRoot,
  outputPath,
} = resolveLiveBenchmarkPaths(args, { root: ROOT, fixturesDir: FIXTURES_DIR });
const iterations = positiveInt(args.iterations, 5);
const agentMode = args.agent === 'codex' ? 'codex' : args.agent === 'llm' ? 'llm' : 'fake';
const scenario = args.scenario === 'annotated' ? 'annotated' : 'plain';
const delivery = args.delivery === 'atomic'
  ? 'atomic'
  : agentMode === 'codex' || args.delivery === 'progressive'
    ? 'progressive'
    : 'atomic';
const acceptVariant = positiveInt(args.acceptVariant, args.acceptFirst ? 1 : 0);
if (acceptVariant > 2) throw new Error('--accept-variant currently supports variant 1 or 2');
const interactionMode = acceptVariant
  ? `accept-variant-${acceptVariant}-then-next-go`
  : 'complete-then-discard';
const simulatedTailMs = positiveInt(args.simulatedTailMs, 0);
const judgeRendered = args.judgeRendered === true || args.judgeRendered === 'true';
const judgeModel = String(args.judgeModel || 'claude-sonnet-4-6');
const fixtureSource = await readFile(join(fixtureDir, 'fixture.json'), 'utf-8');
const fixture = JSON.parse(fixtureSource);
const captureConfig = fixture.evidenceCapture || fixture.renderedQuality || {};
if (!fixture.runtime) throw new Error(`fixture ${fixtureName} has no runtime configuration`);
if (fixture.runtime.mode === 'insert') throw new Error('live benchmark currently measures replace-mode fixtures only');
if (judgeRendered && !artifactRoot) throw new Error('--judge-rendered requires --artifacts=<directory>');
if (judgeRendered && evidenceRoot) {
  throw new Error('--evidence-bundle is rubric-free; run rendered quality evaluation in the external eval harness');
}
if (judgeRendered && acceptVariant) throw new Error('--judge-rendered requires complete variants; omit --accept-first/--accept-variant');
if (judgeRendered && fixture.renderedQuality?.remoteSafe !== true) {
  throw new Error(`fixture ${fixtureName} is not explicitly remote-safe for rendered judging`);
}

if (judgeRendered) loadBenchmarkEnv({ repoRoot: ROOT, explicitPath: args.envFile && resolve(String(args.envFile)) });
if (judgeRendered && !process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required for --judge-rendered');
}
const renderedJudgeClient = judgeRendered ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

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
    fixtureRoot: fixtureDir,
    browser,
    agent: agentInfo.agent,
    startWorker: agentInfo.startWorker,
    wrapTarget: wrapTargetFromPickedElement,
    trace: recorder.trace,
    progressive: delivery === 'progressive',
    progressiveDelayMs: delivery === 'progressive' ? simulatedTailMs : 0,
    atomicDelayMs: delivery === 'atomic' ? simulatedTailMs : 0,
    keepTmp: args.keepTmp === true || args.keepTmp === 'true',
    log: args.quiet ? () => {} : (message) => process.stderr.write(`[live-bench] ${message}\n`),
  });

  if (captureConfig.viewport) {
    await session.page.setViewportSize(captureConfig.viewport);
  }

  recorder.mark('setup.handshake.start');
  session.page.on('request', (request) => {
    if (!request.url().endsWith('/events') || request.method() !== 'POST') return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    if (payload?.type === 'generate' && payload.id) {
      recorder.mark('browser.generate_post', {
        id: payload.id,
        selectedTagName: String(payload.element?.tagName || '').toLowerCase(),
        selectedClasses: Array.isArray(payload.element?.classes)
          ? payload.element.classes.map(String)
          : String(payload.element?.className || '').split(/\s+/).filter(Boolean),
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
  const renderedContext = artifactRoot || judgeRendered
    ? buildRenderedReviewContext({
        fixture: fixtureName,
        fixtureConfig: fixture,
        action: args.action,
        brief: args.brief,
      })
    : null;
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const runArtifactDir = artifactRoot
      ? join(artifactRoot, scenario, `run-${String(iteration).padStart(2, '0')}`)
      : null;
    if (runArtifactDir) await mkdir(runArtifactDir, { recursive: true });
    await pickElement(session.page, pickSelector, {
      position: fixture.runtime.pickPosition || null,
      resetPickMode: iteration > 1,
    });
    if (args.action) await selectAction(session.page, String(args.action));
    if (scenario === 'annotated') {
      await drawAnnotationPinAndStroke(session.page, { comment: 'Benchmark annotation' });
    }
    const renderedArtifacts = runArtifactDir ? {
      original: await captureRenderedElement(session.page, {
        filePath: join(runArtifactDir, 'original.png'),
        selector: renderedContext.captureSelector,
      }),
      variants: [],
    } : null;
    await resetBrowserTimingProbe(session.page, iteration);

    const goStarted = recorder.mark('ui.go.start', { iteration, scenario });
    const firstVariant = waitForFirstVariant(session.page).then(() => {
      recorder.mark('browser.first_variant', { iteration, scenario });
    });
    const secondVariant = acceptVariant === 1
      ? null
      : waitForVariantCount(session.page, 2).then(() => {
          recorder.mark('browser.second_variant', { iteration, scenario });
        });

    await clickGo(session.page);
    recorder.mark('ui.generating_visible', { iteration, scenario });
    await firstVariant;
    if (acceptVariant === 2) {
      await secondVariant;
      await ensureBenchmarkVariant(session.page, 2);
    }
    if (renderedArtifacts && acceptVariant) {
      renderedArtifacts.variants.push(await captureRenderedElement(session.page, {
        filePath: join(runArtifactDir, `variant-${acceptVariant}.png`),
        variantId: acceptVariant,
        selector: renderedContext.captureSelector,
      }));
    }
    const browserTiming = await readBrowserTimingProbe(session.page);
    if (!acceptVariant) {
      await waitForCycling(session.page, 3, { timeout: agentMode === 'fake' ? 30_000 : 240_000 });
      await secondVariant;
      recorder.mark('browser.all_variants', { iteration, scenario });
      if (renderedArtifacts) {
        for (const variantId of [1, 2, 3]) {
          await ensureBenchmarkVariant(session.page, variantId);
          renderedArtifacts.variants.push(await captureRenderedElement(session.page, {
            filePath: join(runArtifactDir, `variant-${variantId}.png`),
            variantId,
            selector: renderedContext.captureSelector,
          }));
        }
        await ensureBenchmarkVariant(session.page, 1);
      }
    }

    const run = buildInteractionRun(recorder.events, {
      iteration,
      scenario,
      goStartedAt: goStarted.at,
      browserTiming,
    });
    assertScenarioEvidence(run, scenario);
    assertSelectionEvidence(run, fixture.runtime.expectedPick);
    if (renderedArtifacts) run.renderedArtifacts = renderedArtifacts;
    if (judgeRendered) {
      run.renderedJudge = await judgeRenderedVariants({
        client: renderedJudgeClient,
        model: judgeModel,
        action: renderedContext.action,
        brief: renderedContext.brief,
        safeContext: renderedContext.safeContext,
        originalPath: renderedArtifacts.original.path,
        variants: renderedArtifacts.variants,
      });
    }
    if (renderedArtifacts) {
      run.renderedArtifacts = await serializeRenderedArtifacts(renderedArtifacts, {
        artifactRoot,
        runArtifactDir,
      });
    }
    if (acceptVariant) {
      const acceptStartedAt = performance.now();
      await clickAccept(session.page, { expectedVariant: acceptVariant });
      await waitForReset(session.page);
      run.acceptToResetMs = roundMs(performance.now() - acceptStartedAt);

      await pickElement(session.page, pickSelector, {
        position: fixture.runtime.pickPosition || null,
        resetPickMode: true,
      });
      if (args.action) await selectAction(session.page, String(args.action));
      await resetBrowserTimingProbe(session.page, `${iteration}-followup`);
      const nextFirstVariant = waitForFirstVariant(session.page);
      // Keep teardown from surfacing this background waiter as an unhandled
      // rejection if a preceding follow-up action is the real failure.
      void nextFirstVariant.catch(() => {});
      await clickGo(session.page);
      await waitForBrowserGeneratePost(session.page);
      run.acceptToNextGoDispatchMs = roundMs(performance.now() - acceptStartedAt);
      await nextFirstVariant;
      run.acceptToNextFirstVariantMs = roundMs(performance.now() - acceptStartedAt);
      try {
        await clickDiscard(session.page);
        await waitForReset(session.page);
        run.followupCleanup = { ok: true };
      } catch (error) {
        run.followupCleanup = { ok: false, error: error?.message || String(error) };
        process.exitCode = 1;
      }
    } else {
      await clickDiscard(session.page);
      await waitForReset(session.page);
    }
    const generationSnapshot = await readGenerationSnapshot(session.tmp, run.eventId);
    Object.assign(run, deriveJournalGenerationMetrics(generationSnapshot));
    if (generationSnapshot.variantPlan) run.variantPlan = generationSnapshot.variantPlan;
    if (acceptVariant) {
      const sourceCommitted = ['completed', 'carbonize_required', 'carbonize_cleanup_requested'].includes(
        generationSnapshot.phase,
      );
      run.acceptOutcome = { sourceCommitted, phase: generationSnapshot.phase || null };
      if (!sourceCommitted) process.exitCode = 1;
    }
    runs.push(run);

    if (!args.quiet) process.stderr.write(formatRun(runs.at(-1)) + '\n');
  }

  const report = createBenchmarkReport({
    fixture: fixtureName,
    agent: agentMode,
    provider: agentInfo.provider,
    model: session.worker?.state?.model || agentInfo.model,
    scenario,
    runs,
    events: recorder.events,
    harnessProbe: args.harnessProbe || null,
    delivery,
    promptMode: agentInfo.promptMode,
    simulation: simulatedTailMs > 0 ? { remainingGenerationMs: simulatedTailMs } : null,
  });
  report.benchmark.interactionMode = interactionMode;
  report.benchmark.fixtureOrigin = fixtureOrigin;
  report.benchmark.fixtureConfigSha256 = createHash('sha256').update(fixtureSource).digest('hex');
  report.benchmark.action = renderedContext?.action || (args.action ? String(args.action) : null);
  if (artifactRoot) report.artifacts = {
    kind: 'impeccable-live-evidence',
    schemaVersion: 1,
    root: evidenceRoot ? '.' : artifactRoot.startsWith(`${ROOT}${sep}`) ? relative(ROOT, artifactRoot) : null,
    externalRoot: evidenceRoot ? false : !artifactRoot.startsWith(`${ROOT}${sep}`),
    report: evidenceRoot ? 'report.json' : null,
    screenshotScope: renderedContext.captureSelector,
  };
  if (judgeRendered) {
    report.renderedQuality = {
      judge: { provider: 'anthropic', model: judgeModel },
      ...summarizeRenderedJudgeRuns(runs),
    };
    if (report.renderedQuality.passedRuns !== report.renderedQuality.runs) process.exitCode = 1;
  }

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

async function readGenerationSnapshot(tmp, eventId) {
  const file = join(tmp, '.impeccable', 'live', 'sessions', `${eventId}.snapshot.json`);
  try { return JSON.parse(await readFile(file, 'utf-8')); } catch { return {}; }
}

async function captureRenderedElement(page, { filePath, selector = null, variantId = null }) {
  const geometry = await page.evaluate(({ targetSelector, targetVariantId }) => {
    const wrapper = targetVariantId == null ? null : document.querySelector('[data-impeccable-variants]');
    const variant = targetVariantId == null
      ? null
      : wrapper?.querySelector(`[data-impeccable-variant="${targetVariantId}"]`);
    if (targetVariantId != null && (!variant || getComputedStyle(variant).display === 'none')) return null;
    const element = targetSelector
      ? document.querySelector(targetSelector)
      : variant?.firstElementChild;
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const core = window.__IMPECCABLE_LIVE_CHROME_CORE__;
    const chrome = (core?.componentIds || [])
      .map((id) => core?.getById?.(id) || document.getElementById(id))
      .filter(Boolean)
      .map((chromeElement) => ({ element: chromeElement, visibility: chromeElement.style.visibility }));
    window.__IMPECCABLE_LIVE_BENCH_CHROME__ = chrome;
    for (const hidden of chrome) hidden.element.style.visibility = 'hidden';
    const padding = 40;
    const pageWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const pageHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    const x = Math.max(0, rect.left + window.scrollX - padding);
    const y = Math.max(0, rect.top + window.scrollY - padding);
    const width = Math.max(1, Math.min(pageWidth - x, rect.width + padding * 2));
    const height = Math.max(1, Math.min(pageHeight - y, rect.height + padding * 2));
    return {
      x, y, width, height,
      elementWidth: rect.width,
      elementHeight: rect.height,
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
      pageHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontFamily: style.fontFamily,
    };
  }, { targetSelector: selector, targetVariantId: variantId });
  if (!geometry?.visible) throw new Error(`cannot capture visible ${variantId == null ? selector : `variant ${variantId}`}`);
  try {
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    });
    await page.screenshot({
      path: filePath,
      clip: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
      animations: 'disabled',
      caret: 'hide',
    });
  } finally {
    await page.evaluate(() => {
      const hidden = window.__IMPECCABLE_LIVE_BENCH_CHROME__ || [];
      for (const entry of hidden) entry.element.style.visibility = entry.visibility;
      delete window.__IMPECCABLE_LIVE_BENCH_CHROME__;
    }).catch(() => {});
  }
  return {
    path: filePath,
    variantId,
    width: roundMs(geometry.elementWidth),
    height: roundMs(geometry.elementHeight),
    text: geometry.text,
    visible: geometry.visible,
    horizontalOverflow: geometry.horizontalOverflow,
    pageHorizontalOverflow: geometry.pageHorizontalOverflow,
    computed: {
      backgroundColor: geometry.backgroundColor,
      color: geometry.color,
      fontFamily: geometry.fontFamily,
    },
  };
}

async function serializeRenderedArtifacts(renderedArtifacts, { artifactRoot: root, runArtifactDir }) {
  const serialize = async (artifact) => {
    const bytes = await readFile(artifact.path);
    return {
      ...artifact,
      path: relative(root, artifact.path),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    };
  };
  const manifest = {
    original: await serialize(renderedArtifacts.original),
    variants: await Promise.all(renderedArtifacts.variants.map(serialize)),
  };
  await writeFile(join(runArtifactDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function ensureBenchmarkVariant(page, expectedVariant) {
  const observed = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getVisibleVariant(page);
    observed.push(current);
    if (current === expectedVariant) return;
    await (current != null && current > expectedVariant ? clickPrev(page) : clickNext(page));
    await page.waitForTimeout(100);
  }
  const state = await page.evaluate(() => ({
    debug: window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.() || null,
    variants: [...document.querySelectorAll('[data-impeccable-variant]')].map((element) => ({
      id: element.getAttribute('data-impeccable-variant'),
      display: getComputedStyle(element).display,
    })),
  })).catch(() => null);
  throw new Error(`could not show rendered benchmark variant ${expectedVariant}; observed=${JSON.stringify(observed)} state=${JSON.stringify(state)}`);
}

async function resolveAgent(mode, options) {
  if (mode === 'fake') return { agent: createFakeAgent(), provider: 'deterministic', model: null, promptMode: null };
  if (mode === 'codex') {
    return {
      agent: null,
      provider: 'openai-codex-app-server',
      model: options.model || null,
      promptMode: 'production-live-contract',
      startWorker: (context) => startCodexProductionWorker(context, options),
    };
  }
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

async function startCodexProductionWorker({ tmp, scriptsDir, log, trace }, options) {
  const script = join(scriptsDir, 'live-codex-worker.mjs');
  const statePath = join(tmp, '.impeccable', 'live', 'codex-worker.json');
  const child = spawn(process.execPath, [script, '--foreground'], {
    cwd: tmp,
    env: {
      ...process.env,
      IMPECCABLE_LIVE_CODEX_WORKER: '1',
      IMPECCABLE_LIVE_CODEX_PROFILE: String(options.profile || 'quality'),
      IMPECCABLE_LIVE_CODEX_EFFORT: String(options.effort || 'medium'),
      IMPECCABLE_LIVE_CODEX_DELIVERY: options.delivery === 'atomic' ? 'atomic' : 'progressive',
      ...(options.model ? { IMPECCABLE_LIVE_CODEX_MODEL: String(options.model) } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  const capture = (chunk) => {
    const text = chunk.toString();
    output.push(text);
    if (output.length > 200) output.shift();
    log(`[codex-worker] ${text.trimEnd()}`);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const done = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const state = await waitForWorkerState(statePath, child, output, positiveInt(options.workerTimeoutMs, 20_000));
  const handle = {
    child,
    state,
    done,
    async stop() {
      clearInterval(handle.monitor);
      if (child.exitCode != null || child.signalCode != null) return;
      child.kill('SIGTERM');
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    },
  };
  const tracedEvents = new Set();
  let readingState = false;
  handle.monitor = setInterval(async () => {
    if (readingState) return;
    readingState = true;
    try {
      const next = JSON.parse(await readFile(statePath, 'utf-8'));
      handle.state = next;
      if (next.status === 'working' && next.eventId && !tracedEvents.has(next.eventId)) {
        tracedEvents.add(next.eventId);
        trace('agent.event.received', { id: next.eventId, type: 'generate', owner: next.owner });
      }
    } catch { /* state replacement is atomic but teardown may remove the fixture */ }
    finally { readingState = false; }
  }, 40);
  handle.monitor.unref();
  return handle;
}

async function waitForWorkerState(statePath, child, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`Codex production worker exited before ready.\n${output.join('')}`);
    }
    try {
      const state = JSON.parse(await readFile(statePath, 'utf-8'));
      if (state.status === 'error') throw new Error(`Codex production worker failed: ${state.error}\n${output.join('')}`);
      if (['ready', 'working'].includes(state.status)) return state;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Codex production worker was not ready after ${timeoutMs}ms.\n${output.join('')}`);
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
  await waitForVariantCount(page, 1);
}

async function waitForVariantCount(page, expectedCount) {
  const handle = await page.waitForFunction((count) => {
    const activeGeneration = document.querySelector('[data-impeccable-variants]');
    if (!activeGeneration) return false;
    const debugCount = Number(window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.()?.arrivedVariants || 0);
    const domCount = activeGeneration.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])').length;
    return Math.max(debugCount, domCount) >= count;
  }, expectedCount, { timeout: 240_000 });
  await handle.dispose();
}

async function waitForReset(page) {
  await page.waitForFunction(() => !document.querySelector('[data-impeccable-variants]'), undefined, { timeout: 30_000 });
  await page.waitForTimeout(100);
}

async function installBrowserTimingProbe(page) {
  await page.addInitScript(installBrowserTimingProbeInPage);
  await page.evaluate(installBrowserTimingProbeInPage);
}

function installBrowserTimingProbeInPage() {
  if (window.__IMPECCABLE_LIVE_BENCH_TIMING__?.installed === true) return;
  const state = { iteration: 0, goAt: null, generateAt: null, installed: true };
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
}

async function resetBrowserTimingProbe(page, iteration) {
  await page.evaluate(installBrowserTimingProbeInPage);
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

async function waitForBrowserGeneratePost(page) {
  await page.waitForFunction(() => Number.isFinite(window.__IMPECCABLE_LIVE_BENCH_TIMING__?.generateAt), undefined, {
    timeout: 10_000,
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

function assertSelectionEvidence(run, expected) {
  if (!expected) return;
  const actual = run.selectionEvidence || {};
  const expectedTag = String(expected.tagName || '').toLowerCase();
  const expectedClasses = Array.isArray(expected.classes) ? expected.classes.map(String) : [];
  if ((expectedTag && actual.tagName !== expectedTag)
      || expectedClasses.some((className) => !actual.classes?.includes(className))) {
    throw new Error(
      `iteration ${run.iteration}: picked ${actual.tagName || 'unknown'}.${(actual.classes || []).join('.')} instead of ${expectedTag || '*'}.${expectedClasses.join('.')}`,
    );
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

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatRun(run) {
  return `[live-bench] run ${run.iteration}: first=${run.goToFirstVariantMs}ms all=${run.goToAllVariantsMs}ms accept-reset=${run.acceptToResetMs ?? 'n/a'}ms next-first=${run.acceptToNextFirstVariantMs ?? 'n/a'}ms`;
}

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
