/**
 * End-to-end live-mode tests — full click-to-accept cycle.
 *
 * For every framework fixture with a `runtime` block in fixture.json, this
 * runner exercises the entire user-visible chain:
 *
 *   1. Stage → install → start live-server + dev server → inject script tag
 *   2. Open Playwright Chromium, assert the live handshake fires
 *   3. Spawn an agent polling loop in this same process
 *   4. Drive the bar UI: pick element → Go → wait CYCLING → cycle → Accept
 *   5. Assert source rewrite (variants block, then accepted-only after accept)
 *   6. Assert DOM reflects the accepted variant via getComputedStyle
 *   7. Tear down (browser, dev server, agent loop, live-server, tmp)
 *
 * The fake and LLM agents share one interface — see tests/live-e2e/agent.mjs
 * and tests/live-e2e/agents/llm-agent.mjs.
 *
 * Run with:  bun run test:live-e2e
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeAgent } from './live-e2e/agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import { readCliOption } from './live-e2e/cli-options.mjs';
import { bootFixtureSession, FIXTURES_DIR } from './live-e2e/session.mjs';
import {
  assertApplyDockVisible,
  assertSourceApplied,
  clickAccept,
  clickApplyEdits,
  clickEditCopy,
  clickSaveEdit,
  clickGo,
  clickNext,
  editTextLeaf,
  getVisibleVariant,
  pickElement,
  waitForApplyDockHidden,
  waitForBarHidden,
  waitForCycling,
  waitForHandshake,
} from './live-e2e/ui.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Discover fixtures that opt into the runtime E2E pass.
function listRuntimeFixtures() {
  const names = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const out = [];
  for (const name of names) {
    const fixturePath = join(FIXTURES_DIR, name, 'fixture.json');
    if (!existsSync(fixturePath)) continue;
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    if (fixture.runtime) out.push({ name, fixture });
  }
  return out;
}

const allFixtures = listRuntimeFixtures();

// During development of the full-cycle test, a single fixture is much faster
// to iterate on. Set IMPECCABLE_E2E_ONLY=<name> to scope the run.
const onlyName = process.env.IMPECCABLE_E2E_ONLY;
const fixtures = onlyName
  ? allFixtures.filter((f) => f.name === onlyName)
  : allFixtures;

const cliLlmProvider = readCliOption(process.argv, 'llm-provider');
const cliLlmModel = readCliOption(process.argv, 'llm-model');
const manualOnly = process.env.IMPECCABLE_E2E_MANUAL_ONLY === '1'
  || process.env.IMPECCABLE_E2E_MANUAL_ONLY === 'true';

if (fixtures.length === 0) {
  describe('live-e2e (no runtime fixtures registered)', () => {
    it('is a no-op', () => assert.ok(true));
  });
}

let playwright;
let browser;

before(async () => {
  if (fixtures.length === 0) return;
  try {
    playwright = await import('playwright');
  } catch (err) {
    throw new Error(
      `Playwright is required for live-e2e tests (${err.message}). Run: npx playwright install chromium`,
    );
  }
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(`Failed to launch Chromium (${err.message}). Run: npx playwright install chromium`);
  }
});

after(async () => {
  if (browser) await browser.close();
});

for (const { name, fixture } of fixtures) {
  describe(`live-e2e · ${name} (${fixture.runtime.styling || 'unknown-styling'})`, () => {
    it('drives the full click → Go → cycle → accept cycle', async (t) => {
      if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
        t.skip('manual scenario filter is active');
        return;
      }
      // Fixtures may declare `runtime.knownLimitation` to flag a scenario
      // that exposes a genuine live-mode gap rather than a test bug. The
      // test still attempts the full chain but does not fail the suite when
      // the documented failure mode appears — it surfaces the diagnostic so
      // the limitation is visible in the run output.
      const knownLimitation = fixture.runtime.knownLimitation;

      // Pick the agent. `IMPECCABLE_E2E_AGENT=llm` opts into Claude first,
      // with DeepSeek as the secondary fallback/override; everything else
      // uses the deterministic fake. Skip rather than fail when LLM is
      // requested but the selected provider key is missing so default suite
      // runs in unauthenticated environments still pass.
      const agentMode = process.env.IMPECCABLE_E2E_AGENT || 'fake';
      let agent;
      if (agentMode === 'llm') {
        const llmConfig = resolveLlmAgentConfig({
          provider: cliLlmProvider,
          model: cliLlmModel || process.env.IMPECCABLE_E2E_LLM_MODEL,
        });
        agent = await createLlmAgent({
          config: llmConfig,
          log: (m) => t.diagnostic('[llm] ' + m),
        });
        if (!agent) {
          t.skip(`IMPECCABLE_E2E_AGENT=llm with provider=${llmConfig.provider} requires ${llmConfig.requiredEnv}`);
          return;
        }
        t.diagnostic(`Using LLM agent (provider=${llmConfig.provider} model=${llmConfig.model})`);
      } else {
        agent = createFakeAgent();
      }

      t.diagnostic(`Booting fixture ${name}`);
      const session = await bootFixtureSession({
        name,
        fixture,
        browser,
        agent,
        wrapTarget: agentMode === 'llm' ? wrapTargetFromPickedElement : undefined,
        log: (m) => t.diagnostic(m),
      });

      const { page, tmp, consoleErrors, teardown } = session;
      const expectedCount = 3;
      const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';

      try {
        // 1. Handshake
        t.diagnostic('Waiting for live handshake');
        await waitForHandshake(page);

        // 2. preActions — fixtures with hidden/conditional content (modals,
        //    tabs, routes) drive the page into the right state before pick.
        if (fixture.runtime.preActions) {
          t.diagnostic(`Running ${fixture.runtime.preActions.length} preAction(s)`);
          await runPreActions(page, fixture.runtime.preActions);
        }

        // 3. Pick the target element
        t.diagnostic(`Picking ${pickSelector}`);
        await pickElement(page, pickSelector);

        if (process.env.IMPECCABLE_E2E_DEBUG) {
          const barText = await page.evaluate(() => {
            const bar = document.querySelector('#impeccable-live-bar');
            return bar ? { display: bar.style.display, text: bar.textContent || '', html: bar.innerHTML.slice(0, 500) } : null;
          });
          t.diagnostic(`Bar after pick: ${JSON.stringify(barText)}`);
        }

        // 3. Click Go (default action 'impeccable', default count 3 — fixture-stable)
        t.diagnostic('Clicking Go');
        await clickGo(page);

        // 4. Wait for the agent's variants to land (HMR + MutationObserver).
        //    For fixtures whose picked element lives inside a conditional
        //    render (modal, tab, route), HMR can remount the parent and lose
        //    the open/active state — the wrapper exists in source but isn't
        //    in the DOM, so MutationObserver never sees it. Live mode now
        //    surfaces a toast asking the user to retrace the path; we mirror
        //    that here by re-running preActions on the first short timeout.
        //
        //    The first-pass timeout has to be long enough to cover the agent's
        //    generate latency before declaring "state was lost, retrace." A
        //    fake agent finishes in <100ms. The real LLM path usually lands
        //    quickly too, but full-matrix runs can see minute-scale API or
        //    install pressure, so keep this gate patient enough that we do
        //    not retrace while the agent is still writing the variants.
        t.diagnostic(`Waiting for CYCLING state with ${expectedCount} variants`);
        const firstPassTimeoutMs = agentMode === 'llm' ? 240_000 : 5_000;
        let cyclingReached = false;
        if (fixture.runtime.preActions) {
          try {
            await waitForCycling(page, expectedCount, { timeout: firstPassTimeoutMs });
            cyclingReached = true;
          } catch {
            t.diagnostic(`Cycling not reached in ${firstPassTimeoutMs}ms — retracing preActions`);
            await runPreActions(page, fixture.runtime.preActions);
          }
        }
        try {
          if (!cyclingReached) {
            // Default 30s; LLM mode bumps higher to absorb API latency on
            // top of HMR settle time.
            const finalTimeoutMs = agentMode === 'llm' ? 240_000 : 30_000;
            await waitForCycling(page, expectedCount, { timeout: finalTimeoutMs });
          }
        } catch (err) {
          if (process.env.IMPECCABLE_E2E_DEBUG) {
            const variantCount = await page.evaluate(() =>
              document.querySelectorAll('[data-impeccable-variant]').length,
            );
            const barInfo = await page.evaluate(() => {
              const bars = document.querySelectorAll('#impeccable-live-bar');
              return {
                count: bars.length,
                bars: [...bars].map((bar) => ({
                  display: bar.style.display,
                  opacity: bar.style.opacity,
                  text: bar.textContent || '',
                  innerHtml: bar.innerHTML.slice(0, 600),
                })),
                __init: window.__IMPECCABLE_LIVE_INIT__,
              };
            });
            t.diagnostic(`waitForCycling failed; variants in DOM: ${variantCount}`);
            t.diagnostic(`Bar state: ${JSON.stringify(barInfo)}`);
            t.diagnostic(`--- dev server tail ---\n${session.dev.log()}`);
          }
          throw err;
        }

        // 5. Source-side check: wrapper + style + variants are present
        const sourceFile = await locateSessionFile(tmp);
        const after = readFileSync(sourceFile, 'utf-8');
        assert.match(after, /data-impeccable-variants="/, 'wrapper inserted');
        if (sourceFile.endsWith('.astro')) {
          assert.match(after, /<style is:inline data-impeccable-css="/, 'Astro live CSS uses an inline compiler-bypassing style block');
          assert.match(
            after,
            /\[data-impeccable-variant="1"\]\s*>\s*(?:h1|\.[\w-]+)/,
            'event=live_e2e.astro_css_prefix actor=agent operation=write_variants risk=astro_scopes_preview_css_away expected=variant-prefixed global selector actual=missing suggestion=inspect fake agent styleMode handling',
          );
          assert.doesNotMatch(after, /@scope \(\[data-impeccable-variant="1"\]\)/, 'Astro live CSS does not use raw @scope');
        } else {
          assert.match(after, /<style data-impeccable-css="/, 'colocated <style> block present');
          assert.match(after, /@scope \(\[data-impeccable-variant="1"\]\)/, 'scoped CSS for variant 1');
          assert.match(after, /@scope \(\[data-impeccable-variant="2"\]\)/, 'scoped CSS for variant 2');
          assert.match(after, /@scope \(\[data-impeccable-variant="3"\]\)/, 'scoped CSS for variant 3');
        }
        // Param manifest assertions are scoped to fake-agent mode. The fake
        // agent deterministically emits one param per variant covering all
        // three kinds; the LLM agent is non-deterministic and may legitimately
        // emit no params per the live.md spec ("variants are fixed points").
        if (agentMode === 'fake') {
          assert.match(after, /data-impeccable-params=/, 'data-impeccable-params manifest emitted');
          for (const kind of ['range', 'steps', 'toggle']) {
            assert.match(after, new RegExp(`"kind"\\s*:\\s*"${kind}"`), `param kind ${kind} present`);
          }
        }

        // 6. Cycle to variant 2 (the bold one in the fake agent)
        t.diagnostic('Cycling to variant 2');
        await clickNext(page);
        const visible = await getVisibleVariant(page);
        assert.equal(visible, 2, 'variant 2 visible after one Next');
        if (agentMode === 'fake') {
          await page.waitForFunction(() => {
            const h1 = document.querySelector('[data-impeccable-variant="2"] > h1');
            return h1 && getComputedStyle(h1).fontWeight === '900';
          }, null, { timeout: 5_000 }).catch(() => {});
          const variantWeight = await page.evaluate(() => {
            const h1 = document.querySelector('[data-impeccable-variant="2"] > h1');
            return h1 ? getComputedStyle(h1).fontWeight : null;
          });
          assert.equal(
            variantWeight,
            '900',
            'event=live_e2e.variant_css_applied actor=browser operation=render_visible_variant risk=unstyled_live_preview expected=font-weight 900 actual=' + variantWeight + ' suggestion=inspect live CSS style mode and selector shape',
          );
        }

        // 7. Accept variant 2
        t.diagnostic('Accepting variant 2');
        await clickAccept(page, { expectedVariant: 2 });

        // 8. Wait for live-accept + the agent's carbonize cleanup to land.
        //    File-side: wrapper, all variants, and carbonize markers gone;
        //    only the accepted inner element survives.
        t.diagnostic('Waiting for accept + carbonize cleanup to land');
        const final = await waitForSourceClean(sourceFile, 20_000);
        assert.doesNotMatch(final, /data-impeccable-variants="/,    'variants wrapper removed');
        assert.doesNotMatch(final, /impeccable-variants-start/,      'variants-start marker removed');
        assert.doesNotMatch(final, /impeccable-carbonize-start/,     'carbonize-start marker removed');
        assert.doesNotMatch(final, /impeccable-carbonize-end/,       'carbonize-end marker removed');
        assert.doesNotMatch(final, /data-impeccable-variant="/,      'no leftover variant scaffolding');
        // Accept the original class as a substring of the className value so
        // an LLM agent that adds classes around the original (e.g.
        // class="hero-title bold red") still passes — only the literal
        // class="hero-title" form would otherwise match.
        assert.match(
          final,
          /<h1[^>]*(class|className)="[^"]*\bhero-title\b[^"]*"/,
          'accepted h1 survives with hero-title class',
        );

        // Optional fixture hook: assert that arbitrary strings survive the
        // wrap → accept → carbonize cycle. Used by repeated-branch fixtures
        // to prove wrap disambiguated correctly — sibling branches the test
        // didn't pick should be untouched.
        if (Array.isArray(fixture.runtime.assertSourceContains)) {
          for (const needle of fixture.runtime.assertSourceContains) {
            assert.ok(
              final.includes(needle),
              `source still contains ${JSON.stringify(needle)} after accept (sibling branch must not be rewritten)`,
            );
          }
        }

        // 9. DOM-side: at least one matching element, none inside any wrapper.
        await page.waitForFunction(
          (sel) => {
            const all = document.querySelectorAll(sel);
            if (all.length < 1) return false;
            for (const el of all) {
              if (el.closest('[data-impeccable-variants],[data-impeccable-variant]')) return false;
            }
            return true;
          },
          pickSelector,
          { timeout: 20_000 },
        );

        // 9b. reloadProbe — fixtures with conditional render assert that the
        //     accepted variant survives a full page reload. The picked element
        //     may be hidden by default (closed modal, non-default tab); the
        //     probe re-runs preActions to bring it back into the DOM.
        if (fixture.runtime.reloadProbe) {
          t.diagnostic('Running reloadProbe (reload + reach + assert)');
          await page.reload({ waitUntil: 'domcontentloaded' });
          if (fixture.runtime.reloadProbe.preActions) {
            await runPreActions(page, fixture.runtime.reloadProbe.preActions);
          }
          const expectSelector = fixture.runtime.reloadProbe.expectSelector || pickSelector;
          await page.waitForSelector(expectSelector, { timeout: 10_000 });
        }

        // 10. Console hygiene — no errors during the whole flow.
        if (fixture.runtime.probe?.expectConsoleClean) {
          const realErrors = consoleErrors.filter((e) =>
            !/(Download the React DevTools|StrictMode|Failed to load resource: the server responded with a status of 404)/i.test(e),
          );
          if (realErrors.length > 0) {
            t.diagnostic('--- console errors ---');
            for (const e of realErrors) t.diagnostic(e);
            t.diagnostic('--- final source ---');
            t.diagnostic(readFileSync(sourceFile, 'utf-8'));
          }
          assert.equal(
            realErrors.length,
            0,
            `expected clean console, got:\n${realErrors.join('\n')}`,
          );
        }
      } catch (err) {
        if (knownLimitation) {
          t.diagnostic(`KNOWN LIMITATION: ${knownLimitation}`);
          t.diagnostic(`Failure: ${err.message?.split('\n')[0] || err}`);
          t.skip(`known limitation: ${knownLimitation}`);
          return;
        }
        throw err;
      } finally {
        await teardown();
      }
    });

    if (Array.isArray(fixture.runtime.manualEditScenarios) && fixture.runtime.manualEditScenarios.length > 0) {
      const manualScenarioFilter = process.env.IMPECCABLE_E2E_MANUAL_SCENARIO || '';
      for (const scenario of fixture.runtime.manualEditScenarios) {
        if (manualScenarioFilter && !scenario.name.includes(manualScenarioFilter)) continue;
        it(`Edit copy → Save → Apply/commit: ${scenario.name}`, async (t) => {
          const manualAgent = await createManualScenarioAgent(t, scenario);
          if (!manualAgent) return;
          const { agent, agentMode, probeState } = manualAgent;
          const session = await bootFixtureSession({
            name,
            fixture,
            browser,
            agent,
            wrapTarget: agentMode === 'llm' ? wrapTargetFromPickedElement : undefined,
            log: (m) => t.diagnostic(m),
          });
          const { page, teardown } = session;
          try {
            await waitForHandshake(page);
            if (fixture.runtime.preActions) await runPreActions(page, fixture.runtime.preActions);
            const stages = Array.isArray(scenario.stages) ? scenario.stages : [scenario];
            for (const stage of stages) {
              await runManualEditStage(page, stage, {
                t,
                fixture,
                session,
                agentMode,
                defaultSelector: stage.element?.selector || fixture.runtime.pickSelector || 'h1.hero-title',
              });
            }
            if (scenario.probeMalformedAckBeforeApply) {
              assert.equal(probeState?.malformedAckRejected, true, 'malformed manual Apply ack should fail loudly');
              assert.equal(probeState?.applyCalls, 1, 'manual_edit_apply event should not be redelivered after the correct ack');
            }
          } finally {
            await teardown();
          }
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createManualScenarioAgent(t, scenario = {}) {
  const requested = (process.env.IMPECCABLE_E2E_MANUAL_AGENT || process.env.IMPECCABLE_E2E_AGENT || 'auto')
    .trim()
    .toLowerCase();
  if (requested === 'fake' || requested === 'mock') {
    t.diagnostic('Using fake agent for manual-edit scenarios (explicit fallback)');
    const probeState = {};
    return {
      agent: maybeWrapMalformedAckProbe(createFakeAgent(), scenario, probeState, t),
      agentMode: 'fake',
      probeState,
    };
  }

  if (requested !== 'auto' && requested !== 'llm') {
    throw new Error(`Unsupported manual-edit e2e agent: ${requested}`);
  }

  const llmConfig = resolveLlmAgentConfig({
    provider: cliLlmProvider,
    model: cliLlmModel || process.env.IMPECCABLE_E2E_LLM_MODEL,
  });
  const agent = await createLlmAgent({
    config: llmConfig,
    log: (m) => t.diagnostic('[llm] ' + m),
  });
  if (agent) {
    t.diagnostic(`Using LLM agent for manual-edit scenarios (provider=${llmConfig.provider} model=${llmConfig.model})`);
    const probeState = {};
    return {
      agent: maybeWrapMalformedAckProbe(agent, scenario, probeState, t),
      agentMode: 'llm',
      probeState,
    };
  }

  if (requested === 'llm') {
    t.skip(`IMPECCABLE_E2E_AGENT=llm with provider=${llmConfig.provider} requires ${llmConfig.requiredEnv}`);
    return null;
  }

  t.diagnostic(`Using fake agent for manual-edit scenarios because ${llmConfig.requiredEnv} is unset`);
  const probeState = {};
  return {
    agent: maybeWrapMalformedAckProbe(createFakeAgent(), scenario, probeState, t),
    agentMode: 'fake',
    probeState,
  };
}

function maybeWrapMalformedAckProbe(agent, scenario, probeState, t) {
  if (!scenario.probeMalformedAckBeforeApply) return agent;
  return {
    ...agent,
    async applyManualEdits(event, context = {}) {
      probeState.applyCalls = (probeState.applyCalls || 0) + 1;
      const sourceFile = firstExpectedSourceFile(scenario) || 'src/App.jsx';
      try {
        execFileSync(
          process.execPath,
          [join(context.scriptsDir, 'live-poll.mjs'), '--reply', 'done', '--file', sourceFile],
          { cwd: context.tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        assert.fail('malformed manual Apply ack unexpectedly succeeded');
      } catch (err) {
        const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
        assert.match(output, /--reply EVENT_ID done|must be the event id|Missing reply status/);
        probeState.malformedAckRejected = true;
      }
      const buffer = JSON.parse(readFileSync(join(context.tmp, '.impeccable/live/pending-manual-edits.json'), 'utf-8'));
      assert.ok(buffer.entries.length > 0, 'malformed ack must not clear staged manual edits');
      t.diagnostic(`Malformed manual Apply ack rejected for ${event.id}; continuing with correct reply`);
      return agent.applyManualEdits(event, context);
    },
  };
}

function firstExpectedSourceFile(scenario) {
  const stages = Array.isArray(scenario.stages) ? scenario.stages : [scenario];
  for (const stage of stages) {
    for (const edit of stage.edits || []) {
      if (edit.expectedSourceFile) return edit.expectedSourceFile;
    }
  }
  return null;
}

function wrapTargetFromPickedElement(event) {
  const element = event.element || {};
  const tag = typeof element.tagName === 'string'
    ? element.tagName.trim().toLowerCase()
    : '';
  const classes = typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).join(' ')
    : extractClassAttr(element.outerHTML);
  const elementId = typeof element.id === 'string' ? element.id.trim() : '';

  return {
    tag: tag || 'h1',
    ...(classes ? { classes } : {}),
    ...(elementId ? { elementId } : {}),
  };
}

function extractClassAttr(outerHTML) {
  if (typeof outerHTML !== 'string') return '';
  const match = outerHTML.match(/\sclass=(["'])(.*?)\1/);
  return match ? match[2].trim().split(/\s+/).filter(Boolean).join(' ') : '';
}

/**
 * Drive a list of pre-pick / reload-probe actions. Used to set up tricky
 * scenarios: open a modal, switch tabs, navigate routes.
 *
 * Live mode's element picker intercepts every page click in capture phase
 * while `pickActive === true`, so any action that depends on the page's own
 * click handler (open a modal, switch a tab) gets swallowed. We bracket the
 * action sequence with two clicks of the global bar's pick toggle and leave
 * the picker in its original state once preActions complete.
 *
 * Supported action shapes:
 *   { "type": "click", "selector": "..." }
 *   { "type": "goto",  "path": "/about" }
 *   { "type": "wait",  "selector": "..." }
 */
async function runPreActions(page, actions) {
  const PICK_TOGGLE = '#impeccable-live-pick-toggle';
  const pickerToggle = await page.$(PICK_TOGGLE);
  const wasActive = pickerToggle
    ? await pickerToggle.evaluate((el) => el.dataset.active === 'true')
    : false;
  if (wasActive) await clickPickToggle(page, PICK_TOGGLE);

  try {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === 'click') {
        const next = actions[i + 1];
        if (next?.type === 'wait') {
          const alreadyVisible = await page.locator(next.selector).first().isVisible().catch(() => false);
          if (alreadyVisible) continue;
        }
        const loc = page.locator(a.selector);
        await loc.first().waitFor({ state: 'visible', timeout: 20_000 });
        await loc.first().click({ timeout: 10_000 });
        continue;
      }
      if (a.type === 'goto') {
        const target = new URL(a.path, page.url()).href;
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        continue;
      }
      if (a.type === 'wait') {
        await page.waitForSelector(a.selector, { timeout: 20_000 });
        continue;
      }
      throw new Error(`unknown preAction type: ${a.type}`);
    }
  } finally {
    if (wasActive) {
      // Re-arm the picker. If the page navigated mid-action the toggle may
      // belong to a freshly mounted bar — best-effort, no throw.
      const after = await page.$(PICK_TOGGLE);
      if (after) {
        const isActive = await after.evaluate((el) => el.dataset.active === 'true');
        if (!isActive) await clickPickToggle(page, PICK_TOGGLE);
      }
    }
  }
}

async function runManualScenarioActions(page, actions, { t, fixture, session, defaultSelector, agentMode }) {
  for (const action of actions || []) {
    if (action.type === 'variantAccept') {
      await runAcceptedVariantCycle(page, {
        t,
        fixture,
        session,
        pickSelector: action.selector || defaultSelector,
        pickFirst: true,
        agentMode,
      });
      continue;
    }
    if (action.type === 'acceptCurrentSelection') {
      await runAcceptedVariantCycle(page, {
        t,
        fixture,
        session,
        pickSelector: defaultSelector,
        pickFirst: false,
        agentMode,
      });
      continue;
    }
    await runPreActions(page, [action]);
  }
}

async function runManualEditStage(page, stage, { t, fixture, session, agentMode, defaultSelector }) {
  const { tmp } = session;

  if (stage.beforeManualEdit) {
    await runManualScenarioActions(page, stage.beforeManualEdit, {
      t,
      fixture,
      session,
      defaultSelector,
      agentMode,
    });
  }

  await pickElement(
    page,
    stage.element?.selector || defaultSelector,
    { position: stage.element?.position, resetPickMode: true },
  );
  t.diagnostic('Manual scenario clicking Edit copy');
  await clickEditCopy(page);
  for (const edit of stage.edits || []) {
    await editTextLeaf(page, edit.leafSelector, edit.newText);
  }
  t.diagnostic('Manual scenario clicking Save');
  await clickSaveEdit(page);
  const expectedStashCount = stage.expectedStashCount || Math.max(1, stage.edits?.length || 1);
  await assertApplyDockVisible(page, expectedStashCount, {
    timeout: agentMode === 'llm' ? 20_000 : 5_000,
  });
  assert.equal(
    await getServerManualEditStashCount(session.live),
    expectedStashCount,
    'manual edit stash count after Save',
  );

  if (stage.afterSave) {
    await runManualScenarioActions(page, stage.afterSave, {
      t,
      fixture,
      session,
      defaultSelector,
      agentMode,
    });
  }

  if (stage.skipApply === true) {
    assert.equal(
      await getServerManualEditStashCount(session.live),
      stage.expectedFinalStashCount ?? 0,
      'manual edit stash count after scenario action',
    );
    return;
  }

  t.diagnostic('Manual scenario clicking Apply/commit');
  await clickApplyEdits(page);
  await waitForServerManualEditStashCount(session.live, 0, {
    timeout: agentMode === 'llm' ? 120_000 : 20_000,
  });
  await waitForApplyDockHidden(page, { timeout: 10_000 });
  const remaining = await getServerManualEditStashCount(session.live);
  assert.equal(remaining, 0, 'manual edit stash cleared after Apply');

  for (const edit of stage.edits || []) {
    if (edit.expectedVisibleText) {
      await assertVisibleText(page, edit.leafSelector, edit.expectedVisibleText, {
        timeout: agentMode === 'llm' ? 60_000 : 20_000,
      });
    }
  }

  for (const edit of stage.edits || []) {
    if (edit.expectedSourceFile) {
      assertSourceApplied(
        tmp,
        edit.expectedSourceFile,
        edit.expectOriginalRemaining ? '' : edit.originalText,
        edit.expectedSourceMatch || edit.newText,
      );
      for (const snippet of edit.expectedSourceAlso || []) {
        assertSourceContains(tmp, edit.expectedSourceFile, snippet);
      }
      for (const snippet of edit.expectedSourceMissing || []) {
        assertSourceMissing(tmp, edit.expectedSourceFile, snippet);
      }
    }
  }

  if (stage.afterApply) {
    await runManualScenarioActions(page, stage.afterApply, {
      t,
      fixture,
      session,
      defaultSelector,
      agentMode,
    });
  }
}

async function runAcceptedVariantCycle(page, { t, fixture, session, pickSelector, pickFirst, agentMode }) {
  if (pickFirst) {
    t.diagnostic(`Manual scenario picking ${pickSelector} before variant accept`);
    await pickElement(page, pickSelector, { resetPickMode: true });
  }
  t.diagnostic('Manual scenario clicking Go');
  await clickGo(page);
  await waitForCycling(page, 3, {
    timeout: agentMode === 'llm' ? 240_000 : 30_000,
  });
  await clickNext(page);
  assert.equal(await getVisibleVariant(page), 2, 'variant 2 visible before manual scenario accept');
  await clickAccept(page, { expectedVariant: 2 });
  const sourceFile = await locateSessionFile(session.tmp);
  await waitForSourceClean(sourceFile, 20_000);
  await waitForBarHidden(page, { timeout: 10_000 }).catch(() => {});

  const expectSelector = fixture.runtime.reloadProbe?.expectSelector || pickSelector;
  await waitForAcceptedSelectionReady(page, expectSelector, {
    timeout: agentMode === 'llm' ? 60_000 : 20_000,
  });
}

async function waitForAcceptedSelectionReady(page, selector, { timeout }) {
  await page.waitForFunction(
    (sel) => {
      const all = document.querySelectorAll(sel);
      if (all.length < 1) return false;
      for (const el of all) {
        if (el.closest('[data-impeccable-variants],[data-impeccable-variant]')) return false;
      }
      return true;
    },
    selector,
    { timeout },
  );
}

function assertSourceMissing(tmp, file, text) {
  const full = join(tmp, file);
  const body = readFileSync(full, 'utf-8');
  assert.equal(
    body.includes(text),
    false,
    `source ${file} should not contain discarded text ${JSON.stringify(text)}`,
  );
}

function assertSourceContains(tmp, file, text) {
  const full = join(tmp, file);
  const body = readFileSync(full, 'utf-8');
  assert.equal(
    body.includes(text),
    true,
    `source ${file} should still contain ${JSON.stringify(text)}`,
  );
}

async function assertVisibleText(page, selector, text, { timeout = 20_000 } = {}) {
  await page.waitForFunction(
    ({ sel, expected }) => {
      const el = document.querySelector(sel);
      return Boolean(el && (el.textContent || '').includes(expected));
    },
    { sel: selector, expected: text },
    { timeout },
  );
}

async function getServerManualEditStashCount(live, pageUrl = '/') {
  const res = await fetch(
    `http://localhost:${live.port}/manual-edit-stash?token=${encodeURIComponent(live.token)}&pageUrl=${encodeURIComponent(pageUrl)}`,
  );
  if (!res.ok) throw new Error(`manual-edit-stash count failed: ${res.status}`);
  const body = await res.json();
  return body.count || 0;
}

async function waitForServerManualEditStashCount(live, expectedCount, { pageUrl = '/', timeout = 20_000 } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await getServerManualEditStashCount(live, pageUrl);
    if (last === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`manual edit stash count did not reach ${expectedCount}; last=${last}`);
}

async function clickPickToggle(page, selector) {
  try {
    await page.locator(selector).click({ timeout: 5_000 });
    return;
  } catch (err) {
    const clicked = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      btn.click();
      return true;
    }, selector);
    if (!clicked) throw err;
  }
}

/**
 * Poll the file until carbonize cleanup has landed: no variants wrapper, no
 * carbonize markers, no leftover variant divs. Returns the final contents.
 */
async function waitForSourceClean(filePath, timeoutMs) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = readFileSync(filePath, 'utf-8');
    const dirty =
      last.includes('data-impeccable-variants=') ||
      last.includes('impeccable-variants-start') ||
      last.includes('impeccable-carbonize-start') ||
      last.includes('data-impeccable-variant=');
    if (!dirty) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`source not clean after ${timeoutMs}ms — last contents:\n${last}`);
}

/**
 * Find the source file that received the wrapper. We look for any tracked
 * file containing the variants marker — the agent always writes to exactly
 * one file per session.
 */
async function locateSessionFile(tmp) {
  const candidates = walkSources(tmp);
  for (const f of candidates) {
    const body = readFileSync(f, 'utf-8');
    if (
      body.includes('data-impeccable-variants=') ||
      body.includes('impeccable-carbonize-start') ||
      body.includes('impeccable-variants-start')
    ) {
      return f;
    }
  }
  throw new Error('Could not locate session source file under ' + tmp);
}

function walkSources(root) {
  const results = [];
  const stack = [root];
  const SKIP = new Set(['node_modules', '.git', '.svelte-kit', 'dist', '.vite', 'build', '.next']);
  const EXTS = ['.html', '.jsx', '.tsx', '.svelte', '.astro', '.vue'];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(full);
        continue;
      }
      if (EXTS.some((x) => e.name.endsWith(x))) results.push(full);
    }
  }
  return results;
}
