import { performance } from 'node:perf_hooks';

const METRIC_KEYS = [
  'browserPreparationMs',
  'browserDispatchMs',
  'automationClickMs',
  'serverPickupMs',
  'goToAgentMs',
  'serverPreflightMs',
  'scaffoldMs',
  'generationToFirstMs',
  'generationMs',
  'firstVariantWriteMs',
  'writeMs',
  'writeToFirstVariantMs',
  'replyMs',
  'goToFirstVariantMs',
  'goToAllVariantsMs',
  'deliveryGapMs',
  'impeccableOverheadMs',
];

export function createTraceRecorder(now = () => performance.now()) {
  const events = [];
  return {
    events,
    trace(name, data = {}) {
      events.push({ name, at: now(), ...data });
    },
    mark(name, data = {}) {
      const event = { name, at: now(), ...data };
      events.push(event);
      return event;
    },
  };
}

export function durationBetween(events, startName, endName, predicate = () => true) {
  const start = events.find((event) => event.name === startName && predicate(event));
  const end = events.find((event) => event.name === endName && predicate(event) && (!start || event.at >= start.at));
  if (!start || !end) return null;
  return roundMs(Math.max(0, end.at - start.at));
}

/**
 * Assemble the two model calls used by the Live benchmark's progressive path.
 * The first checkpoint is already visible in the browser, so both its markup
 * and CSS are immutable. The tail call may supply deferred params for variant
 * 1, but its CSS must contain only independently-scoped rules for variants 2+.
 */
export function assembleSplitProgressiveOutput(first, remaining) {
  const firstVariant = first?.variants?.[0];
  if (!firstVariant) throw new Error('progressive assembly requires a first variant');
  if (!Array.isArray(remaining?.variants) || remaining.variants.length < 1) {
    throw new Error('progressive assembly requires a complete remaining variant set');
  }

  const firstCss = String(first.scopedCss || '');
  const laterCss = String(remaining.scopedCss || '');
  assertLaterVariantCss(laterCss);

  return {
    scopedCss: firstCss && laterCss ? `${firstCss}\n${laterCss}` : firstCss || laterCss,
    variants: [
      {
        ...firstVariant,
        params: Array.isArray(remaining.variants[0]?.params)
          ? remaining.variants[0].params
          : [],
      },
      ...remaining.variants.slice(1),
    ],
  };
}

export function buildInteractionRun(events, { iteration, scenario, goStartedAt, browserTiming = null }) {
  const received = events.find((event) =>
    event.name === 'agent.event.received'
    && event.type === 'generate'
    && event.at >= goStartedAt
  );
  if (!received?.id) throw new Error(`iteration ${iteration}: no generate event was traced`);

  const id = received.id;
  const forId = (event) => event.id === id;
  const eventPost = events.find((event) => event.name === 'browser.generate_post' && forId(event));
  const mark = (name) => events.find((event) => event.name === name && event.iteration === iteration);
  const first = mark('browser.first_variant');
  const all = mark('browser.all_variants');
  const writeEnd = events.find((event) => event.name === 'agent.write.end' && forId(event));
  const firstWriteEnd = events.find((event) => event.name === 'agent.first_variant.write.end' && forId(event));
  const reusedScaffold = events.find((event) => event.name === 'agent.scaffold.reused' && forId(event));
  const generationMs = durationBetween(events, 'agent.generate.start', 'agent.generate.end', forId);
  const generationToFirstMs = durationBetween(events, 'agent.generate.start', 'agent.generate.first_ready', forId);
  const browserPreparationMs = eventPost ? roundMs(eventPost.at - goStartedAt) : null;
  const browserDispatchMs = Number.isFinite(browserTiming?.goAt) && Number.isFinite(browserTiming?.generateAt)
    ? roundMs(Math.max(0, browserTiming.generateAt - browserTiming.goAt))
    : null;
  const interactionStartedAt = eventPost && browserDispatchMs != null
    ? eventPost.at - browserDispatchMs
    : goStartedAt;
  const measuredGoToFirstVariantMs = first ? roundMs(first.at - interactionStartedAt) : null;
  const measuredGoToAllVariantsMs = all ? roundMs(all.at - interactionStartedAt) : null;

  return {
    iteration,
    scenario,
    eventId: id,
    annotationEvidence: {
      screenshotPath: eventPost?.hasScreenshotPath === true,
      comments: Number(eventPost?.commentCount || 0),
      strokes: Number(eventPost?.strokeCount || 0),
    },
    browserPreparationMs,
    browserDispatchMs,
    automationClickMs: browserPreparationMs == null || browserDispatchMs == null
      ? null
      : roundMs(Math.max(0, browserPreparationMs - browserDispatchMs)),
    serverPickupMs: eventPost ? roundMs(Math.max(0, received.at - eventPost.at)) : null,
    goToAgentMs: roundMs(received.at - interactionStartedAt),
    serverPreflightMs: Number.isFinite(reusedScaffold?.durationMs) ? roundMs(reusedScaffold.durationMs) : null,
    scaffoldMs: durationBetween(events, 'agent.scaffold.start', 'agent.scaffold.end', forId),
    generationToFirstMs,
    generationMs,
    firstVariantWriteMs: durationBetween(events, 'agent.first_variant.write.start', 'agent.first_variant.write.end', forId),
    writeMs: durationBetween(events, 'agent.write.start', 'agent.write.end', forId),
    writeToFirstVariantMs: first && (firstWriteEnd || writeEnd)
      ? roundMs(Math.max(0, first.at - (firstWriteEnd || writeEnd).at))
      : null,
    replyMs: durationBetween(events, 'agent.reply.start', 'agent.reply.end', forId),
    goToFirstVariantMs: measuredGoToFirstVariantMs,
    goToAllVariantsMs: measuredGoToAllVariantsMs,
    deliveryGapMs: first && all ? roundMs(Math.max(0, all.at - first.at)) : null,
    impeccableOverheadMs: measuredGoToFirstVariantMs == null || generationToFirstMs == null
      ? null
      : roundMs(Math.max(0, measuredGoToFirstVariantMs - generationToFirstMs)),
  };
}

export function summarizeRuns(runs) {
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const values = runs.map((run) => run[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) continue;
    metrics[key] = {
      median: roundMs(percentile(values, 0.5)),
      p95: roundMs(percentile(values, 0.95)),
      min: roundMs(values[0]),
      max: roundMs(values[values.length - 1]),
    };
  }
  return { count: runs.length, metrics };
}

export function summarizeSetup(events) {
  const stages = [
    ['dependencies', 'setup.install.start', 'setup.install.end'],
    ['liveServer', 'setup.live_server.start', 'setup.live_server.end'],
    ['injection', 'setup.inject.start', 'setup.inject.end'],
    ['devServer', 'setup.dev_server.start', 'setup.dev_server.end'],
    ['pageLoad', 'setup.page_load.start', 'setup.page_load.end'],
    ['handshake', 'setup.handshake.start', 'setup.handshake.end'],
  ];
  return Object.fromEntries(stages.map(([key, start, end]) => [key, durationBetween(events, start, end)]));
}

export function createBenchmarkReport({
  fixture,
  agent,
  provider,
  model,
  scenario,
  runs,
  events,
  harnessProbe = null,
  delivery = 'atomic',
  promptMode = null,
  simulation = null,
  generatedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: 1,
    generatedAt,
    benchmark: {
      fixture,
      agent,
      provider: provider || null,
      model: model || null,
      scenario,
      variants: 3,
      delivery,
      promptMode,
      simulation,
    },
    setup: summarizeSetup(events),
    summary: summarizeRuns(runs),
    runs,
    harnessProbe,
  };
}

export function mergeBenchmarkReports(reports, generatedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    generatedAt,
    reports,
  };
}

export function compareModelBackedReports(atomic, progressive, {
  medianTarget = 0.35,
  p95Target = 0.25,
  minimumRuns = 3,
} = {}) {
  assertComparableModelReport(atomic, 'atomic', minimumRuns);
  assertComparableModelReport(progressive, 'progressive', minimumRuns);

  for (const key of ['fixture', 'provider', 'model', 'scenario', 'variants', 'promptMode']) {
    if (atomic.benchmark[key] !== progressive.benchmark[key]) {
      throw new Error(`benchmark mismatch for ${key}: atomic=${atomic.benchmark[key]} progressive=${progressive.benchmark[key]}`);
    }
  }

  const atomicFirst = requiredMetric(atomic, 'goToFirstVariantMs');
  const progressiveFirst = requiredMetric(progressive, 'goToFirstVariantMs');
  const medianImprovement = improvement(atomicFirst.median, progressiveFirst.median);
  const p95Improvement = improvement(atomicFirst.p95, progressiveFirst.p95);
  const allReady = {
    atomic: requiredMetric(atomic, 'goToAllVariantsMs'),
    progressive: requiredMetric(progressive, 'goToAllVariantsMs'),
  };
  const passed = medianImprovement >= medianTarget && p95Improvement >= p95Target;

  return {
    passed,
    target: { medianImprovement, p95Improvement, medianTarget, p95Target },
    firstReviewable: { atomic: atomicFirst, progressive: progressiveFirst },
    allVariantsReady: allReady,
    benchmark: {
      fixture: atomic.benchmark.fixture,
      provider: atomic.benchmark.provider,
      model: atomic.benchmark.model,
      scenario: atomic.benchmark.scenario,
      runs: { atomic: atomic.summary.count, progressive: progressive.summary.count },
    },
  };
}

function assertComparableModelReport(report, delivery, minimumRuns) {
  if (!report?.benchmark || !report?.summary) throw new Error(`${delivery} benchmark report is missing metadata or summary`);
  if (report.benchmark.agent !== 'llm') throw new Error(`${delivery} benchmark must be model-backed (agent=llm)`);
  if (report.benchmark.delivery !== delivery) {
    throw new Error(`expected ${delivery} delivery report, got ${report.benchmark.delivery || 'unknown'}`);
  }
  if (report.benchmark.simulation) throw new Error(`${delivery} model benchmark must not contain simulated latency`);
  if (!report.benchmark.provider || !report.benchmark.model) throw new Error(`${delivery} benchmark is missing provider/model identity`);
  if (!Number.isInteger(report.summary.count) || report.summary.count < minimumRuns) {
    throw new Error(`${delivery} benchmark requires at least ${minimumRuns} runs`);
  }
}

function requiredMetric(report, key) {
  const metric = report.summary.metrics?.[key];
  if (!Number.isFinite(metric?.median) || !Number.isFinite(metric?.p95)) {
    throw new Error(`${report.benchmark.delivery} benchmark is missing ${key} median/p95`);
  }
  return { median: metric.median, p95: metric.p95 };
}

function improvement(baseline, candidate) {
  if (!(baseline > 0) || !Number.isFinite(candidate)) throw new Error('benchmark latency must be finite and baseline must be positive');
  return Number((1 - (candidate / baseline)).toFixed(4));
}

function assertLaterVariantCss(css) {
  if (!css.trim()) return;
  for (const prelude of topLevelCssPreludes(css)) {
    const variants = [...prelude.matchAll(/\[data-impeccable-variant\s*=\s*(["'])(\d+)\1[^\]]*\]/g)]
      .map((match) => Number(match[2]));
    if (variants.includes(1)) {
      throw new Error('progressive tail CSS must not repeat or conflict with published variant 1 CSS');
    }
    if (variants.length === 0 || variants.some((variant) => variant < 2)) {
      throw new Error('progressive tail CSS must be attributable only to variants 2+');
    }
    if (new Set(variants).size !== 1) {
      throw new Error('each progressive tail CSS block must target exactly one later variant');
    }
  }
}

function topLevelCssPreludes(css) {
  const preludes = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
    if (cursor >= css.length) break;
    const start = cursor;
    const open = findCssToken(css, cursor, '{');
    if (open === -1) throw new Error('progressive tail CSS contains a rule without a block');
    const prelude = css.slice(start, open).trim();
    if (!prelude || prelude.includes(';')) {
      throw new Error('progressive tail CSS must contain scoped rule blocks only');
    }
    preludes.push(prelude);
    const close = findMatchingCssBrace(css, open);
    if (close === -1) throw new Error('progressive tail CSS has unbalanced braces');
    cursor = close + 1;
  }
  return preludes;
}

function findCssToken(css, start, token) {
  let quote = null;
  let comment = false;
  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === token) return index;
  }
  return -1;
}

function findMatchingCssBrace(css, open) {
  let depth = 0;
  let quote = null;
  let comment = false;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function roundMs(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}
