import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assembleSplitProgressiveOutput,
  buildInteractionRun,
  compareModelBackedReports,
  createTraceRecorder,
  durationBetween,
  summarizeRuns,
} from '../scripts/lib/live-benchmark.mjs';

describe('live benchmark metrics', () => {
  it('keeps published progressive CSS byte-stable and carries deferred params', () => {
    const firstCss = '@scope ([data-impeccable-variant="1"]) { .offer { color: red; } }';
    const laterCss = [
      '@scope ([data-impeccable-variant="2"]) { .offer { color: green; } }',
      '@scope ([data-impeccable-variant="3"]) { .offer { color: blue; } }',
    ].join('\n');
    const firstVariant = { innerHtml: '<article class="offer">One</article>', params: [] };
    const deferredParams = [{ name: 'density', type: 'range', min: 0, max: 1, default: 0.5 }];
    const assembled = assembleSplitProgressiveOutput(
      { scopedCss: firstCss, variants: [firstVariant] },
      {
        scopedCss: laterCss,
        variants: [
          { innerHtml: firstVariant.innerHtml, params: deferredParams },
          { innerHtml: '<article class="offer">Two</article>', params: [] },
          { innerHtml: '<article class="offer">Three</article>', params: [] },
        ],
      },
    );

    assert.equal(assembled.scopedCss, `${firstCss}\n${laterCss}`);
    assert.equal(assembled.scopedCss.slice(0, firstCss.length), firstCss);
    assert.equal(assembled.variants[0].innerHtml, firstVariant.innerHtml);
    assert.equal(assembled.variants[0].params, deferredParams);
  });

  it('rejects tail CSS that would reproduce published_variant_css_changed', () => {
    const first = {
      scopedCss: '@scope ([data-impeccable-variant="1"]) { .offer { color: red; } }',
      variants: [{ innerHtml: '<article class="offer">One</article>', params: [] }],
    };
    const conflictingTail = {
      scopedCss: [
        '@scope ([data-impeccable-variant="1"]) { .offer { color: purple; } }',
        '@scope ([data-impeccable-variant="2"]) { .offer { color: green; } }',
      ].join('\n'),
      variants: [
        { innerHtml: first.variants[0].innerHtml, params: [] },
        { innerHtml: '<article class="offer">Two</article>', params: [] },
      ],
    };

    assert.throws(
      () => assembleSplitProgressiveOutput(first, conflictingTail),
      /must not repeat or conflict with published variant 1 CSS/,
    );
  });

  it('separates model generation from Impeccable overhead', () => {
    const events = [
      { name: 'ui.go.start', at: 100, iteration: 1 },
      { name: 'browser.generate_post', at: 108, id: 'abc', hasScreenshotPath: false, commentCount: 0, strokeCount: 0 },
      { name: 'agent.event.received', at: 110, id: 'abc', type: 'generate' },
      { name: 'agent.scaffold.start', at: 112, id: 'abc' },
      { name: 'agent.scaffold.end', at: 132, id: 'abc' },
      { name: 'agent.generate.start', at: 132, id: 'abc' },
      { name: 'agent.generate.first_ready', at: 1132, id: 'abc' },
      { name: 'agent.generate.end', at: 1132, id: 'abc' },
      { name: 'agent.write.start', at: 1132, id: 'abc' },
      { name: 'agent.write.end', at: 1142, id: 'abc' },
      { name: 'agent.reply.start', at: 1142, id: 'abc' },
      { name: 'agent.reply.end', at: 1147, id: 'abc' },
      { name: 'browser.first_variant', at: 1200, iteration: 1 },
      { name: 'browser.all_variants', at: 1200, iteration: 1 },
    ];

    const run = buildInteractionRun(events, {
      iteration: 1,
      scenario: 'plain',
      goStartedAt: 100,
      browserTiming: { goAt: 50, generateAt: 52.5 },
    });
    assert.equal(run.goToFirstVariantMs, 1094.5);
    assert.equal(run.browserPreparationMs, 8);
    assert.equal(run.browserDispatchMs, 2.5);
    assert.equal(run.automationClickMs, 5.5);
    assert.deepEqual(run.annotationEvidence, { screenshotPath: false, comments: 0, strokes: 0 });
    assert.equal(run.serverPickupMs, 2);
    assert.equal(run.generationMs, 1000);
    assert.equal(run.impeccableOverheadMs, 94.5);
    assert.equal(run.deliveryGapMs, 0);
    assert.equal(run.scaffoldMs, 20);
  });

  it('reports interpolated medians and p95 values', () => {
    const summary = summarizeRuns([
      { goToFirstVariantMs: 100, generationMs: 70 },
      { goToFirstVariantMs: 200, generationMs: 140 },
      { goToFirstVariantMs: 300, generationMs: 210 },
    ]);
    assert.equal(summary.metrics.goToFirstVariantMs.median, 200);
    assert.equal(summary.metrics.goToFirstVariantMs.p95, 290);
  });

  it('records monotonic trace events and returns null for missing boundaries', () => {
    let now = 0;
    const recorder = createTraceRecorder(() => ++now);
    recorder.trace('start');
    recorder.trace('end');
    assert.equal(durationBetween(recorder.events, 'start', 'end'), 1);
    assert.equal(durationBetween(recorder.events, 'missing', 'end'), null);
  });

  it('proves model-backed first-reviewable thresholds with comparable reports', () => {
    const atomic = modelReport('atomic', 1000, 1200, 1400, 1500);
    const progressive = modelReport('progressive', 500, 700, 1450, 1550);
    const comparison = compareModelBackedReports(atomic, progressive);
    assert.equal(comparison.passed, true);
    assert.equal(comparison.target.medianImprovement, 0.5);
    assert.equal(comparison.target.p95Improvement, 0.4167);
  });

  it('rejects fake, simulated, and mismatched model reports', () => {
    const atomic = modelReport('atomic', 1000, 1200, 1400, 1500);
    const progressive = modelReport('progressive', 500, 700, 1450, 1550);
    assert.throws(
      () => compareModelBackedReports({ ...atomic, benchmark: { ...atomic.benchmark, agent: 'fake' } }, progressive),
      /model-backed/,
    );
    assert.throws(
      () => compareModelBackedReports(atomic, { ...progressive, benchmark: { ...progressive.benchmark, simulation: { remainingGenerationMs: 1 } } }),
      /simulated latency/,
    );
    assert.throws(
      () => compareModelBackedReports(atomic, { ...progressive, benchmark: { ...progressive.benchmark, model: 'other-model' } }),
      /benchmark mismatch for model/,
    );
  });
});

function modelReport(delivery, firstMedian, firstP95, allMedian, allP95) {
  return {
    benchmark: {
      fixture: 'vite8-react-plain',
      agent: 'llm',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      scenario: 'plain',
      variants: 3,
      delivery,
      promptMode: 'synthetic-element-contract',
      simulation: null,
    },
    summary: {
      count: 5,
      metrics: {
        goToFirstVariantMs: { median: firstMedian, p95: firstP95 },
        goToAllVariantsMs: { median: allMedian, p95: allP95 },
      },
    },
  };
}
