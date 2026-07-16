import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

import {
  VARIANT_SYSTEM_INSTRUCTIONS,
  parseVariantResponse,
  validateProgressiveVariantOutput,
  validateVariantCount,
  validateVariantMaterialChange,
  validateVariantVisibleCopy,
} from '../../tests/live-e2e/agents/llm-agent.mjs';

export const PROVIDER_PROFILES = Object.freeze({
  anthropic: {
    label: 'Anthropic',
    model: 'claude-sonnet-4-6',
    envKeys: ['ANTHROPIC_API_KEY'],
    pricePerMillion: { input: 3, cachedInput: 0.3, output: 15 },
    effort: 'low',
    priceSource: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-5.5',
    envKeys: ['OPENAI_API_KEY'],
    pricePerMillion: { input: 5, cachedInput: 0.5, output: 30 },
    effort: 'low',
    priceSource: 'https://developers.openai.com/api/docs/models/gpt-5.5',
  },
  google: {
    label: 'Google',
    model: 'gemini-3.1-flash-lite',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_CLOUD_API_KEY', 'GEMINI_API_KEY'],
    pricePerMillion: { input: 0.25, cachedInput: 0.025, output: 1.5 },
    effort: 'minimal (provider default)',
    priceSource: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
});

export const STRATEGIES = Object.freeze({
  'atomic-full': {
    delivery: 'atomic',
    promptMode: 'full-live-context',
    calls: 'one 3-variant call',
  },
  'progressive-full': {
    delivery: 'progressive',
    promptMode: 'full-live-context',
    calls: 'one first-variant call, then one remaining-directions call; deterministic assembly preserves variant 1',
  },
  'progressive-compact': {
    delivery: 'progressive',
    promptMode: 'compact-producer-contract',
    calls: 'one first-variant call, then one remaining-directions call; deterministic assembly preserves variant 1',
  },
  'parallel-compact': {
    delivery: 'parallel-progressive',
    promptMode: 'compact-producer-contract',
    calls: 'three concurrent one-variant calls; first valid result publishes immediately',
  },
});

export const BRAND_CONTRACT = Object.freeze({
  identity: 'Warm paper, dark ink, moss and brass accents; Georgia display with a restrained sans body; editorial, practical, and quiet.',
  requiredCopy: [
    'Quarterly print edition',
    'Field Notes',
    'Four routes, annotated maps, and practical details for unhurried weekends.',
    'Reserve issue eight',
  ],
  requiredClasses: [
    'offer-card',
    'offer-card__copy',
    'offer-card__eyebrow',
    'offer-card__title',
    'offer-card__body',
    'action-link',
  ],
  allowedTokens: [
    '--color-paper',
    '--color-paper-deep',
    '--color-ink',
    '--color-moss',
    '--color-brass',
    '--font-display',
    '--font-body',
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--radius-control',
  ],
  sourceExcerpt: [
    '<article className="offer-card" aria-labelledby="field-notes-title">',
    '  <div className="offer-card__copy">',
    '    <p className="offer-card__eyebrow">Quarterly print edition</p>',
    '    <h2 className="offer-card__title" id="field-notes-title">Field Notes</h2>',
    '    <p className="offer-card__body">Four routes, annotated maps, and practical details for unhurried weekends.</p>',
    '  </div>',
    '  <a className="action-link" href="#edition">Reserve issue eight</a>',
    '</article>',
  ].join('\n'),
});

const COMPACT_CONTRACT = [
  VARIANT_SYSTEM_INSTRUCTIONS,
  '',
  'QUALITY GATE FOR THIS PRODUCER:',
  '- Preserve all visible copy exactly and retain the article/component class contract.',
  '- Stay inside the supplied identity. Reuse the supplied CSS custom properties instead of inventing colors, typefaces, spacing, or radii.',
  '- Do not add gradients, blur, glow, glass, neon, decorative shadows, emoji, or unrelated content.',
  '- Make each variant materially different through hierarchy, layout, density, or color-role allocation.',
].join('\n');

export function loadBenchmarkEnv({ repoRoot, explicitPath } = {}) {
  const candidates = [
    explicitPath,
    repoRoot && path.join(repoRoot, '.env'),
    path.join(os.homedir(), 'code', 'impeccable-evals', '.env'),
  ].filter(Boolean);
  const loaded = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file, 'utf-8');
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[match[1]] && value) process.env[match[1]] = value;
    }
    loaded.push(file);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY;
  }
  return loaded;
}

export function resolveProviderSelection(providerNames, modelOverrides = {}) {
  return providerNames.map((provider) => {
    const profile = PROVIDER_PROFILES[provider];
    if (!profile) throw new Error(`unknown provider ${JSON.stringify(provider)}`);
    const keyPresent = profile.envKeys.some((key) => Boolean(process.env[key]));
    return {
      provider,
      label: profile.label,
      model: modelOverrides[provider] || profile.model,
      keyPresent,
      pricePerMillion: profile.pricePerMillion,
      effort: profile.effort,
      priceSource: profile.priceSource,
    };
  });
}

export function createProviderLiveAgent({ provider, model, strategy, liveSpec, onRecord = () => {} }) {
  const strategyConfig = STRATEGIES[strategy];
  if (!strategyConfig) throw new Error(`unknown strategy ${JSON.stringify(strategy)}`);
  const languageModel = providerModel(provider, model);
  const system = strategyConfig.promptMode === 'full-live-context'
    ? `${COMPACT_CONTRACT}\n\nFULL LIVE CONTEXT:\n${liveSpec}`
    : COMPACT_CONTRACT;
  const pendingParallel = new Map();
  const pendingFirst = new Map();

  const request = async ({ event, phase, lane = null, firstVariant = null }) => {
    const startedAt = performance.now();
    const expectedCount = Number(event.count);
    const payload = benchmarkPayload(event, { phase, lane, firstVariant });
    const basePrompt = [
      'Produce Impeccable Live variant output for this request. Return only the JSON object.',
      phaseInstructions(phase, expectedCount, lane),
      '',
      '<benchmark_context>',
      JSON.stringify(payload, null, 2),
      '</benchmark_context>',
    ].join('\n');
    let prompt = basePrompt;
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptStartedAt = performance.now();
      let usage = null;
      try {
        const response = await generateText({
          model: languageModel,
          system,
          prompt,
          maxOutputTokens: 12_000,
          ...providerLatencyOptions(provider),
        });
        usage = normalizeUsage(response.usage);
        const parsed = parseVariantResponse(response.text);
        const validationError = validateVariantOutput(parsed, event, { phase, firstVariant });
        if (validationError) throw new Error(validationError);
        const record = {
          provider,
          model,
          strategy,
          phase,
          lane,
          attempt,
          durationMs: roundMs(performance.now() - attemptStartedAt),
          totalPhaseMs: roundMs(performance.now() - startedAt),
          usage,
          estimatedCostUsd: estimateCostUsd(usage, PROVIDER_PROFILES[provider].pricePerMillion),
          output: parsed,
        };
        onRecord(record);
        return parsed;
      } catch (error) {
        lastError = error;
        onRecord({
          provider,
          model,
          strategy,
          phase,
          lane,
          attempt,
          durationMs: roundMs(performance.now() - attemptStartedAt),
          usage,
          estimatedCostUsd: usage ? estimateCostUsd(usage, PROVIDER_PROFILES[provider].pricePerMillion) : 0,
          error: String(error?.message || error),
        });
        prompt = `${basePrompt}\n\nVALIDATION ERROR:\n${String(error?.message || error)}\nReturn corrected JSON only.`;
      }
    }
    throw lastError;
  };

  if (strategy === 'atomic-full') {
    return {
      async generateVariants(event) {
        return request({ event, phase: 'atomic' });
      },
    };
  }

  if (strategy === 'parallel-compact') {
    return {
      async generateFirstVariant(event) {
        const lanes = ['hierarchy', 'layout', 'density'];
        const calls = lanes.map((lane) => {
          const laneEvent = { ...event, count: 1 };
          return request({ event: laneEvent, phase: 'parallel-lane', lane }).then((output) => ({ lane, output }));
        });
        const first = await Promise.race(calls);
        pendingParallel.set(event.id, { calls, first });
        return first.output;
      },
      async generateRemainingVariants(event) {
        const pending = pendingParallel.get(event.id);
        if (!pending) throw new Error(`parallel generation state missing for ${event.id}`);
        const settled = await Promise.all(pending.calls);
        pendingParallel.delete(event.id);
        const ordered = [pending.first, ...settled.filter((item) => item !== pending.first)];
        const variants = ordered.map((item) => item.output.variants[0]);
        const scopedCss = ordered.map((item, index) => remapSingleVariantCss(item.output.scopedCss, index + 1)).join('\n');
        const output = { scopedCss, variants };
        onRecord({ provider, model, strategy, phase: 'parallel-assembled', lane: null, attempt: 1, usage: normalizeUsage(), estimatedCostUsd: 0, output });
        return output;
      },
    };
  }

  return {
    async generateFirstVariant(event) {
      const first = await request({ event: { ...event, count: 1 }, phase: 'first' });
      pendingFirst.set(event.id, first);
      return first;
    },
    async generateRemainingVariants(event, context) {
      const first = pendingFirst.get(event.id) || context.firstOutput;
      if (!first?.variants?.[0]) throw new Error(`first variant state missing for ${event.id}`);
      const remaining = await request({
        event: { ...event, count: Math.max(1, event.count - 1) },
        phase: 'remaining-directions',
        firstVariant: first.variants[0],
      });
      pendingFirst.delete(event.id);
      return assembleProgressiveOutput(first, remaining);
    },
  };
}

export function scoreVariantOutput(output, { validationError = null } = {}) {
  const variants = Array.isArray(output?.variants) ? output.variants : [];
  const css = String(output?.scopedCss || '');
  const perVariant = variants.map((variant) => String(variant.innerHtml || ''));
  const copyChecks = perVariant.flatMap((html) => BRAND_CONTRACT.requiredCopy.map((copy) => html.includes(copy)));
  const componentChecks = perVariant.flatMap((html) => [
    /^\s*<article\b/i.test(html),
    /\bclass=["'][^"']*\boffer-card\b/.test(html),
    ...BRAND_CONTRACT.requiredClasses.slice(1).map((className) => new RegExp(`\\b${escapeRegExp(className)}\\b`).test(html)),
    /href=["']#edition["']/.test(html),
    /aria-labelledby=["']field-notes-title["']/.test(html),
  ]);
  const usedTokens = BRAND_CONTRACT.allowedTokens.filter((token) => css.includes(`var(${token}`));
  const rawColors = css.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|lab)\s*\(/gi) || [];
  const foreignFonts = css.match(/font-family\s*:\s*([^;}]+)/gi) || [];
  const tokenChecks = [
    usedTokens.length >= 3,
    rawColors.length === 0,
    foreignFonts.every((declaration) => /var\(--font-(?:display|body)\)|inherit|serif|sans-serif/.test(declaration)),
    !/\b(?:margin|padding|gap|border-radius)\s*:\s*(?!var\(|0(?:\D|$))[^;}]+/i.test(css),
  ];
  const brandChecks = [
    /var\(--color-(?:paper|paper-deep|ink|moss|brass)\)/.test(css),
    !/(?:linear|radial|conic)-gradient|backdrop-filter|filter\s*:\s*blur|text-shadow|box-shadow/i.test(css),
    !/\b(?:neon|glass|glow|purple|magenta|cyan)\b/i.test(`${css}\n${perVariant.join('\n')}`),
    !/border-radius\s*:\s*(?:999|[5-9]\d)px/i.test(css),
  ];
  const sourceChecks = [
    !validationError,
    variants.length > 0,
    perVariant.every((html) => !/data-impeccable-|<script|<style/i.test(html)),
    perVariant.every((html) => /^\s*<article\b[\s\S]*<\/article>\s*$/i.test(html)),
  ];
  const dimensions = {
    brandFidelity: dimension(brandChecks),
    componentFidelity: dimension(componentChecks),
    tokenFidelity: dimension(tokenChecks),
    copyFidelity: dimension(copyChecks),
    sourceValidity: dimension(sourceChecks),
  };
  const overall = roundScore(Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length);
  return {
    ...dimensions,
    overall,
    passed: overall >= 0.9 && Object.values(dimensions).every((value) => value >= 0.75),
    diagnostics: {
      usedTokens,
      rawColorCount: rawColors.length,
      validationError,
    },
  };
}

export function validateAcceptedCleanup({ source, browserClean, buildPassed, expectedCopy = BRAND_CONTRACT.requiredCopy }) {
  const markerFree = !/data-impeccable-|impeccable-(?:variants|carbonize|params|original)/i.test(source);
  const copyPreserved = expectedCopy.every((copy) => source.includes(copy));
  const sourceShape = /<article\b[^>]*\boffer-card\b[\s\S]*<\/article>/.test(source);
  const checks = { markerFree, copyPreserved, sourceShape, browserClean: Boolean(browserClean), buildPassed: Boolean(buildPassed) };
  return { ...checks, passed: Object.values(checks).every(Boolean) };
}

export function applyRuntimeSourceScore(quality, cleanup) {
  const sourceChecks = [cleanup.markerFree, cleanup.copyPreserved, cleanup.sourceShape, cleanup.browserClean, cleanup.buildPassed];
  const sourceValidity = dimension(sourceChecks);
  const dimensions = {
    brandFidelity: quality.brandFidelity,
    componentFidelity: quality.componentFidelity,
    tokenFidelity: quality.tokenFidelity,
    copyFidelity: quality.copyFidelity,
    sourceValidity,
  };
  const overall = roundScore(Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length);
  return {
    ...quality,
    ...dimensions,
    overall,
    passed: cleanup.passed === true && overall >= 0.9 && Object.values(dimensions).every((value) => value >= 0.75),
  };
}

export function assembleProgressiveOutput(first, remaining) {
  if (!first?.variants?.[0]) throw new Error('progressive assembly requires a first variant');
  if (!Array.isArray(remaining?.variants) || remaining.variants.length === 0) {
    throw new Error('progressive assembly requires remaining variants');
  }
  return {
    scopedCss: [first.scopedCss, shiftVariantCss(remaining.scopedCss, 1)].filter(Boolean).join('\n'),
    variants: [first.variants[0], ...remaining.variants],
  };
}

export function summarizeProviderRuns(runs) {
  const latencyKeys = ['firstReviewableMs', 'allReadyMs', 'acceptCleanupMs'];
  const metrics = {};
  for (const key of latencyKeys) {
    const values = runs.map((run) => run[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length) metrics[key] = summarizeNumbers(values);
  }
  const qualityKeys = ['brandFidelity', 'componentFidelity', 'tokenFidelity', 'copyFidelity', 'sourceValidity', 'overall'];
  const quality = {};
  for (const key of qualityKeys) {
    const values = runs.map((run) => run.quality?.[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length) quality[key] = summarizeNumbers(values);
  }
  return {
    count: runs.length,
    metrics,
    quality,
    cleanupPassRate: runs.length ? roundScore(runs.filter((run) => run.cleanup?.passed).length / runs.length) : 0,
    gatePassRate: runs.length ? roundScore(runs.filter((run) => run.passed).length / runs.length) : 0,
    estimatedCostUsd: roundUsd(runs.reduce((sum, run) => sum + Number(run.estimatedCostUsd || 0), 0)),
  };
}

function providerModel(provider, model) {
  if (provider === 'anthropic') return anthropic(model);
  if (provider === 'openai') return openai(model);
  if (provider === 'google') return google(model);
  throw new Error(`unsupported provider ${provider}`);
}

function providerLatencyOptions(provider) {
  if (provider === 'anthropic') return { providerOptions: { anthropic: { effort: 'low' } } };
  if (provider === 'openai') return { providerOptions: { openai: { reasoningEffort: 'low' } } };
  // Gemini 3.1 Flash-Lite defaults to minimal thinking; leaving the provider
  // option unset preserves that latency-oriented default across SDK versions.
  return {};
}

function benchmarkPayload(event, { phase, lane, firstVariant }) {
  return {
    request: {
      id: event.id,
      action: event.action,
      freeformPrompt: event.freeformPrompt,
      count: event.count,
      phase,
      lane,
      firstVariant,
    },
    pickedElement: event.element,
    identityLock: BRAND_CONTRACT.identity,
    sourceExcerpt: BRAND_CONTRACT.sourceExcerpt,
    availableTokens: BRAND_CONTRACT.allowedTokens,
    componentContract: {
      rootTag: 'article',
      requiredClasses: BRAND_CONTRACT.requiredClasses,
      requiredHref: '#edition',
      requiredAriaLabelledby: 'field-notes-title',
      exactVisibleCopy: BRAND_CONTRACT.requiredCopy,
    },
  };
}

function phaseInstructions(phase, count, lane) {
  if (phase === 'first') {
    return 'Return exactly one variant. Use params: [] so tunables stay off the first-reviewable path.';
  }
  if (phase === 'remaining-directions') {
    return `Return exactly ${count} new variants for different axes. Do not reproduce request.firstVariant; assembly preserves that first output byte-for-byte.`;
  }
  if (phase === 'parallel-lane') {
    return `Return exactly one complete variant whose primary difference axis is ${lane}. It must stand alone and may include 0-3 useful params.`;
  }
  return `Return exactly ${count} complete variants in one response.`;
}

function validateVariantOutput(parsed, event, { phase, firstVariant }) {
  const phaseEvent = phase === 'first'
    ? { ...event, progressive: { phase: 'first', totalCount: 3 } }
    : event;
  return validateVariantCount(parsed, phaseEvent)
    || validateProgressiveVariantOutput(parsed, phaseEvent)
    || validateVariantVisibleCopy(parsed, event.element)
    || validateVariantMaterialChange(parsed, event.element);
}

function remapSingleVariantCss(css, variantNumber) {
  return String(css)
    .replaceAll('[data-impeccable-variant="1"]', `[data-impeccable-variant="${variantNumber}"]`)
    .replaceAll("[data-impeccable-variant='1']", `[data-impeccable-variant='${variantNumber}']`);
}

function shiftVariantCss(css, amount) {
  return String(css).replace(/(data-impeccable-variant=["'])(\d+)(["'])/g, (_, before, number, after) => {
    return `${before}${Number(number) + amount}${after}`;
  });
}

function normalizeUsage(usage = {}) {
  const input = numberFrom(usage.inputTokens, usage.promptTokens, usage.inputTokenDetails?.noCacheTokens);
  const cached = numberFrom(usage.cachedInputTokens, usage.inputTokenDetails?.cacheReadTokens, usage.inputTokenDetails?.cachedTokens);
  const output = numberFrom(usage.outputTokens, usage.completionTokens);
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    totalTokens: numberFrom(usage.totalTokens, input + output),
  };
}

export function estimateCostUsd(usage, pricing) {
  const cached = Math.min(usage.cachedInputTokens || 0, usage.inputTokens || 0);
  const uncached = Math.max(0, (usage.inputTokens || 0) - cached);
  return roundUsd((
    uncached * pricing.input
    + cached * pricing.cachedInput
    + (usage.outputTokens || 0) * pricing.output
  ) / 1_000_000);
}

function numberFrom(...values) {
  for (const value of values) if (Number.isFinite(value)) return Number(value);
  return 0;
}

function dimension(checks) {
  return checks.length ? roundScore(checks.filter(Boolean).length / checks.length) : 0;
}

function summarizeNumbers(values) {
  return {
    median: roundMs(percentile(values, 0.5)),
    p95: roundMs(percentile(values, 0.95)),
    min: roundMs(values[0]),
    max: roundMs(values.at(-1)),
  };
}

function percentile(values, ratio) {
  if (values.length === 1) return values[0];
  const index = (values.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roundMs(value) {
  return Number(Number(value).toFixed(2));
}

function roundScore(value) {
  return Number(Number(value).toFixed(4));
}

function roundUsd(value) {
  return Number(Number(value).toFixed(6));
}
