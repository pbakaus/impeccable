import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  STRATEGIES,
  createProviderLiveAgent,
  assembleProgressiveOutput,
  applyRuntimeSourceScore,
  estimateCostUsd,
  scoreVariantOutput,
  summarizeProviderRuns,
  validateAcceptedCleanup,
} from '../scripts/lib/live-provider-benchmark.mjs';

const VARIANT = [
  '<article class="offer-card offer-card--measured" aria-labelledby="field-notes-title">',
  '<div class="offer-card__copy">',
  '<p class="offer-card__eyebrow">Quarterly print edition</p>',
  '<h2 class="offer-card__title" id="field-notes-title">Field Notes</h2>',
  '<p class="offer-card__body">Four routes, annotated maps, and practical details for unhurried weekends.</p>',
  '</div>',
  '<a class="action-link" href="#edition">Reserve issue eight</a>',
  '</article>',
].join('');

const GOOD_OUTPUT = {
  scopedCss: [
    '@scope ([data-impeccable-variant="1"]) {',
    '  :scope > .offer-card { background: var(--color-paper-deep); color: var(--color-ink); gap: var(--space-3); }',
    '  :scope .offer-card__eyebrow { color: var(--color-moss); }',
    '}',
  ].join('\n'),
  variants: [{ innerHtml: VARIANT, params: [] }],
};

describe('cross-provider Live benchmark', () => {
  it('defines the control, progressive, compact, and parallel candidates', () => {
    assert.deepEqual(Object.keys(STRATEGIES), [
      'atomic-full',
      'progressive-full',
      'progressive-compact',
      'parallel-compact',
    ]);
  });

  it('assembles progressive output without asking the tail call to reproduce variant 1', () => {
    const first = {
      scopedCss: '@scope ([data-impeccable-variant="1"]) { .first { color: var(--color-ink); } }',
      variants: [{ innerHtml: VARIANT, params: [] }],
    };
    const remaining = {
      scopedCss: [
        '@scope ([data-impeccable-variant="1"]) { .second { color: var(--color-moss); } }',
        '@scope ([data-impeccable-variant="2"]) { .third { color: var(--color-brass); } }',
      ].join('\n'),
      variants: [{ innerHtml: `${VARIANT} ` }, { innerHtml: `${VARIANT}  ` }],
    };
    const assembled = assembleProgressiveOutput(first, remaining);
    assert.equal(assembled.variants[0], first.variants[0]);
    assert.ok(assembled.scopedCss.startsWith(first.scopedCss));
    assert.match(assembled.scopedCss, /data-impeccable-variant="2"[^]*second/);
    assert.match(assembled.scopedCss, /data-impeccable-variant="3"[^]*third/);
  });

  it('passes on-brand, token-driven, copy-preserving component output', () => {
    const score = scoreVariantOutput(GOOD_OUTPUT);
    assert.equal(score.brandFidelity, 1);
    assert.equal(score.componentFidelity, 1);
    assert.equal(score.copyFidelity, 1);
    assert.equal(score.sourceValidity, 1);
    assert.ok(score.tokenFidelity >= 0.75);
    assert.equal(score.passed, true);
  });

  it('rejects off-brand raw colors, missing component parts, and changed copy', () => {
    const score = scoreVariantOutput({
      scopedCss: '.offer-card { color: #ff00ff; background: linear-gradient(red, blue); box-shadow: 0 0 20px cyan; }',
      variants: [{ innerHtml: '<article class="offer-card">Different sales copy</article>' }],
    });
    assert.ok(score.brandFidelity < 0.75);
    assert.ok(score.componentFidelity < 0.75);
    assert.equal(score.copyFidelity, 0);
    assert.equal(score.passed, false);
  });

  it('requires the accepted source to build and lose every Live marker', () => {
    const cleanSource = `export default function Card(){return (${VARIANT.replaceAll('class=', 'className=')});}`;
    const cleanup = validateAcceptedCleanup({ source: cleanSource, browserClean: true, buildPassed: true });
    assert.equal(cleanup.passed, true);

    const dirty = validateAcceptedCleanup({
      source: `${cleanSource}\n{/* impeccable-carbonize-start test */}`,
      browserClean: true,
      buildPassed: true,
    });
    assert.equal(dirty.markerFree, false);
    assert.equal(dirty.passed, false);
    assert.equal(applyRuntimeSourceScore(scoreVariantOutput(GOOD_OUTPUT), dirty).passed, false);
  });

  it('estimates cached token cost and summarizes latency, quality, and cleanup', () => {
    assert.equal(estimateCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000 },
      { input: 3, cachedInput: 0.3, output: 15 },
    ), 3.15);

    const summary = summarizeProviderRuns([
      { firstReviewableMs: 100, allReadyMs: 300, acceptCleanupMs: 20, estimatedCostUsd: 0.1, quality: { ...scoreVariantOutput(GOOD_OUTPUT), sourceValidity: 1 }, cleanup: { passed: true }, passed: true },
      { firstReviewableMs: 200, allReadyMs: 400, acceptCleanupMs: 30, estimatedCostUsd: 0.2, quality: { ...scoreVariantOutput(GOOD_OUTPUT), sourceValidity: 1 }, cleanup: { passed: true }, passed: true },
    ]);
    assert.equal(summary.metrics.firstReviewableMs.median, 150);
    assert.equal(summary.cleanupPassRate, 1);
    assert.equal(summary.gatePassRate, 1);
    assert.equal(summary.estimatedCostUsd, 0.3);
  });
});

describe('parallel-compact lane orchestration', () => {
  const laneOutput = (lane) => ({
    scopedCss: `@scope ([data-impeccable-variant="1"]) { .${lane} { color: var(--color-ink); } }`,
    variants: [{ innerHtml: VARIANT, params: [] }],
  });

  // requestImpl stands in for the model call so lane timing/failure is exact.
  const agentWith = (behaviour) => createProviderLiveAgent({
    provider: 'anthropic',
    model: 'test-model',
    strategy: 'parallel-compact',
    liveSpec: '',
    requestImpl: ({ lane }) => behaviour(lane),
  });

  const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  const failAfter = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));

  it('returns a slower lane rather than rejecting on the lane that fails first', async () => {
    // Promise.race settles on the first *settlement*, so the fast failure below
    // used to reject the whole first-variant step while two lanes were still on
    // their way to succeeding.
    const agent = agentWith((lane) => (
      lane === 'hierarchy' ? failAfter(2, 'hierarchy lane failed') : after(30, laneOutput(lane))
    ));
    const first = await agent.generateFirstVariant({ id: 'par1', count: 3 });
    assert.ok(first.variants?.[0], 'a successful lane must still produce variant 1');
  });

  it('fails with every reason when all lanes fail', async () => {
    const agent = agentWith((lane) => failAfter(2, `${lane} lane failed`));
    await assert.rejects(
      () => agent.generateFirstVariant({ id: 'par2', count: 3 }),
      (err) => {
        assert.match(err.message, /every parallel lane failed for par2/);
        for (const lane of ['hierarchy', 'layout', 'density']) {
          assert.match(err.message, new RegExp(`${lane} lane failed`), `${lane} reason must be reported`);
        }
        return true;
      },
    );
  });

  it('reports a late lane failure as a lane failure, not a raw rejection', async () => {
    // The tail step used to Promise.all the same lane promises, so a lane that
    // rejected after another won the race surfaced its bare error from here.
    const agent = agentWith((lane) => (
      lane === 'density' ? failAfter(40, 'density lane failed') : after(2, laneOutput(lane))
    ));
    await agent.generateFirstVariant({ id: 'par3', count: 3 });
    await assert.rejects(
      () => agent.generateRemainingVariants({ id: 'par3', count: 3 }),
      /1 of 3 parallel lanes failed for par3.*density lane failed/s,
    );
  });

  it('assembles all three lanes when every lane succeeds', async () => {
    const agent = agentWith((lane) => after(lane === 'layout' ? 1 : 10, laneOutput(lane)));
    await agent.generateFirstVariant({ id: 'par4', count: 3 });
    const output = await agent.generateRemainingVariants({ id: 'par4', count: 3 });
    assert.equal(output.variants.length, 3);
  });
});
