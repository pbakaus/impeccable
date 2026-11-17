/**
 * REN-1952 seed walk: a project seeded from a catalog world (DESIGN.md and its sidecar, as `impeccable world <id>`
 * writes them), then one unattended pricing-page build. Measures time, steps, tokens and finish-review rounds against
 * the bar: under 20 minutes, under $6, one correction round. Opt-in: needs SEED_WALK_SEED (a world seed JSON with
 * design_md and sidecar) and SEED_WALK_OUT (where the built page, the trace summary and the numbers are copied).
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { prepareWorkspace, cleanupWorkspace, runTurn, summarizeTrace, ENGINE_BIN } from '../skill-behavior/harness.mjs';
import { detectProvider, getModel, hasKey } from '../skill-behavior/providers.mjs';
import { prepareBrowser } from './browser.mjs';

const MODEL = process.env.SEED_WALK_MODEL || 'claude-sonnet-5';
const SEED = process.env.SEED_WALK_SEED;
const OUT = process.env.SEED_WALK_OUT;
const ready = SEED && OUT && ENGINE_BIN && hasKey(detectProvider(MODEL));

it('a seeded world becomes a working pricing page (seed walk)', { skip: !ready && 'set SEED_WALK_SEED and SEED_WALK_OUT, with an engine and a key' }, async () => {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const workspace = prepareWorkspace({ files: { 'DESIGN.md': seed.design_md, '.impeccable/design.json': `${JSON.stringify(seed.sidecar, null, 2)}\n` } });
  const browser = await prepareBrowser(workspace);
  const started = Date.now();
  // Called after every step: when each step ended and how many tool calls had run by then. Never stops the run.
  const stamps = [];
  // The run's own spend cap (captain, 17 Nov): stop once the estimate at list prices reaches SEED_WALK_BUDGET_USD.
  const BUDGET = Number(process.env.SEED_WALK_BUDGET_USD || 12);
  const PRICE = { input: 3 / 1e6, output: 15 / 1e6 }; // Sonnet list prices per token, no cache (the harness sends none)
  let spent = 0;
  const stamp = (trace, steps) => {
    // The harness asks once more without steps, to name the outcome: answer from the last estimate.
    if (!steps) return spent >= BUDGET;
    spent = steps.reduce((sum, st) => sum + (st.usage?.inputTokens ?? 0) * PRICE.input + (st.usage?.outputTokens ?? 0) * PRICE.output, 0);
    stamps.push({ s: Math.round((Date.now() - started) / 1000), calls: trace.toolCalls.length, usd: Number(spent.toFixed(2)) });
    return spent >= BUDGET;
  };
  try {
    const result = await runTurn({
      workspace,
      model: getModel(MODEL),
      maxSteps: 90,
      stopAfter: stamp,
      timeoutMs: 30 * 60 * 1000,
      environment: browser.environment,
      additionalTools: (trace) => browser.tools(trace),
      simulatedUser: { answer: () => 'Nobody can answer questions in this run. Proceed from the request and mark anything you assume.' },
      userPrompt: [
        '/impeccable craft a pricing page for Seedbed, a monthly seed subscription for balcony gardeners: city renters with a small balcony who have never grown anything from seed.',
        'Three plans, billed monthly: Sprout, $9 a month, 3 seed packets. Grower, $19 a month, 6 seed packets and a soil guide. Greenhouse, $39 a month, 12 seed packets, rare varieties and plant doctor chat.',
        'Static HTML and CSS, no framework, in index.html and styles.css. This project already has its design system (DESIGN.md, seeded from a world).',
        'The browser_snapshot and view_image tools are ready for visual review.',
      ].join(' '),
    });
    const minutes = (Date.now() - started) / 60000;
    const calls = result.trace.toolCalls;
    // Each pass of the finish review re-reads its reference; each correction round re-captures after it.
    const reviews = calls.filter((c) => c.name === 'read' && c.succeeded && /finish-reviewer\.md$/.test(c.input.path ?? '')).length;
    const captures = calls.filter((c) => c.name === 'bash' && /first-viewport\b.*--capture|impeccable\s+shot\b/.test(c.input.command ?? '')).length;
    // Per step: the step's start and its tool calls, so the slowest stretch can be named.
    const numbers = {
      model: MODEL, minutes: Number(minutes.toFixed(1)), estimatedUsd: Number(spent.toFixed(2)), budgetUsd: BUDGET, steps: result.steps, outcome: result.outcome, usage: result.usage,
      finishReviewReads: reviews, captureRuns: captures,
      calls: calls.map((c, i) => ({ name: c.name, what: (c.input?.command ?? c.input?.path ?? '').slice(0, 120), endS: stamps.find((t) => t.calls > i)?.s })),
      stamps,
    };
    fs.mkdirSync(OUT, { recursive: true });
    for (const f of fs.readdirSync(workspace)) {
      if (!f.startsWith('.')) fs.cpSync(path.join(workspace, f), path.join(OUT, 'page', f), { recursive: true });
    }
    if (fs.existsSync(path.join(workspace, '.impeccable'))) fs.cpSync(path.join(workspace, '.impeccable'), path.join(OUT, 'page', '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'numbers.json'), `${JSON.stringify(numbers, null, 2)}\n`);
    fs.writeFileSync(path.join(OUT, 'trace.json'), `${JSON.stringify(summarizeTrace(result.trace), null, 2)}\n`);
    assert.ok(fs.existsSync(path.join(workspace, 'index.html')), 'the build must produce index.html');
  } finally {
    await browser.close();
    cleanupWorkspace(workspace);
  }
});
