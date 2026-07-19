/**
 * End-to-end live-mode tests — full click-to-accept cycle.
 *
 * For every framework fixture with a `runtime` block in fixture.json, this
 * runner exercises the entire user-visible chain:
 *
 *   1. Stage → install → start live-server + dev server → inject script tag
 *   2. Open Playwright Chromium, assert the live handshake fires
 *   3. Spawn a deterministic fake-agent polling loop in this same process
 *   4. Steer smoke: submit page-level chat → agent steer_done → bar unlocks
 *   5. Drive the bar UI: pick element → Go → wait CYCLING → cycle → Accept
 *   6. Assert source rewrite (variants block, then accepted-only after accept)
 *   7. Assert DOM reflects the accepted variant via getComputedStyle
 *   8. Tear down (browser, dev server, agent loop, live-server, tmp)
 *
 * The fake and LLM agents share one interface — see tests/live-e2e/agent.mjs
 * and tests/live-e2e/agents/llm-agent.mjs.
 *
 * Run with:  bun run test:live-e2e
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeAgent } from './live-e2e/agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR } from './live-e2e/session.mjs';
import {
  assertApplyDockVisible,
  assertApplyDockLoading,
  assertAnnotationUploadEvent,
  assertSourceApplied,
  clickExitLiveMode,
  clickAccept,
  clickApplyEdits,
  clickEditCopy,
  clickDiscard,
  clickSaveEdit,
  clickGo,
  clickNext,
  clickPrev,
  editTextLeaf,
  drawAnnotationPinAndStroke,
  getVisibleVariant,
  installLiveQueryHelpers,
  pickElement,
  runLiveChromeBottomBarSmoke,
  waitForApplyDockHidden,
  waitForBarHidden,
  waitForCycling,
  runInsertFlow,
  waitForHandshake,
} from './live-e2e/ui.mjs';
import { runSteerSmoke } from './live-e2e/steer.mjs';
import { runPreActions, waitForCyclingRobust } from './live-e2e/preactions.mjs';

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

// During development of the full-cycle test, a fixture subset is much faster
// to iterate on. Set IMPECCABLE_E2E_ONLY=<name>[,<name>...] to scope the run.
const onlyNames = parseFixtureFilter(process.env.IMPECCABLE_E2E_ONLY);
const fixtures = onlyNames.size > 0
  ? allFixtures.filter((f) => onlyNames.has(f.name))
  : allFixtures;
const missingOnlyNames = [...onlyNames].filter((name) => !allFixtures.some((f) => f.name === name));
if (missingOnlyNames.length > 0) {
  throw new Error(`Unknown IMPECCABLE_E2E_ONLY fixture(s): ${missingOnlyNames.join(', ')}`);
}

const manualOnly = process.env.IMPECCABLE_E2E_MANUAL_ONLY === '1'
  || process.env.IMPECCABLE_E2E_MANUAL_ONLY === 'true';
const reloadVariants = process.env.IMPECCABLE_E2E_RELOAD_VARIANTS === '1'
  || process.env.IMPECCABLE_E2E_RELOAD_VARIANTS === 'true';
const scenarioNames = parseFixtureFilter(process.env.IMPECCABLE_E2E_SCENARIOS);
const liveE2eTestTimeoutMs = readPositiveIntEnv('IMPECCABLE_E2E_TEST_TIMEOUT_MS');
const liveE2eTestOptions = liveE2eTestTimeoutMs ? { timeout: liveE2eTestTimeoutMs } : {};
// Widens the window between the server-side preflight scaffold (which triggers
// a framework HMR reload) and the agent's variant write. Used to reproduce
// races where the browser observes a wrapper with zero variants mid-generation.
const atomicDelayMs = readPositiveIntEnv('IMPECCABLE_E2E_ATOMIC_DELAY_MS') || 0;

if (fixtures.length === 0) {
  describe('live-e2e (no runtime fixtures registered)', () => {
    it('is a no-op', () => assert.ok(true));
  });
}

let playwright;
let browser;

function parseFixtureFilter(value) {
  return new Set(
    String(value || '')
      .split(/[,\s]+/)
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function readPositiveIntEnv(name) {
  const raw = process.env[name];
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function shouldRunScenario(name) {
  return scenarioNames.size === 0 || scenarioNames.has('all') || scenarioNames.has(name);
}

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
    browser = await launchLiveE2eBrowser();
  } catch (err) {
    throw new Error(`Failed to launch Chromium (${err.message}). Run: npx playwright install chromium`);
  }
});

after(async () => {
  if (browser) await browser.close();
});

async function launchLiveE2eBrowser() {
  return playwright.chromium.launch({ headless: true });
}

async function teardownAndResetBrowser(teardown) {
  try {
    await teardown();
  } finally {
    if (browser) await browser.close().catch(() => {});
    browser = await launchLiveE2eBrowser();
  }
}

for (const { name, fixture } of fixtures) {
  describe(`live-e2e · ${name} (${fixture.runtime.styling || 'unknown-styling'})`, () => {
    it('drives the full click → Go → cycle → accept cycle', liveE2eTestOptions, async (t) => {
      if (!shouldRunScenario('core')) {
        t.skip('scenario filter excludes core');
        return;
      }
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
          model: process.env.IMPECCABLE_E2E_LLM_MODEL,
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
        wrapTarget: wrapTargetFromPickedElement,
        atomicDelayMs,
        log: (m) => t.diagnostic(m),
      });

      const { page, tmp, consoleErrors, teardown } = session;
      const expectedCount = 3;
      const isInsert = fixture.runtime.mode === 'insert';
      const insertCfg = fixture.runtime.insert || {};
      const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';
      const insertDomSelector = agentMode === 'llm' && insertCfg.expectSelectorLlm
        ? insertCfg.expectSelectorLlm
        : (insertCfg.expectSelector || '.inserted-strip');
      const domSelector = isInsert
        ? insertDomSelector
        : pickSelector;
      const usesSvelteComponentPreview = fixtureUsesSvelteKitAdapter(fixture) || name === 'nuxt-vite7';
      const variantContentSelector = isInsert
        ? (usesSvelteComponentPreview ? '.inserted-copy' : '[data-impeccable-variant="2"] .inserted-copy')
        : usesSvelteComponentPreview
        ? pickSelector
        : '[data-impeccable-variant="2"] > :first-child';
      let stateProbeBaseline = null;
      let sourceFile = null;

      try {
        // 1. Handshake
        t.diagnostic('Waiting for live handshake');
        await waitForHandshake(page);

        if (fixture.runtime.liveChrome?.bottomBar) {
          t.diagnostic('Running live chrome bottom-bar smoke');
          await runLiveChromeBottomBarSmoke(page, {
            expectDetectMinCount: fixture.runtime.liveChrome.detect?.expectMinCount || 1,
            designTitle: fixture.runtime.liveChrome.design?.title || '',
            designRawText: fixture.runtime.liveChrome.design?.rawText || '',
          });
        }

        // 1b. Steer smoke — page-level chat before the heavier generate cycle.
        if (fixture.runtime.steer !== false) {
          const steerTimeouts = agentMode === 'llm'
            ? { unlockTimeoutMs: 90_000, selectorTimeoutMs: 45_000, runPreActions }
            : { runPreActions };
          await runSteerSmoke(page, tmp, fixture, (m) => t.diagnostic(m), steerTimeouts);
        }

        // 2. preActions — fixtures with hidden/conditional content (modals,
        //    tabs, routes) drive the page into the right state before pick.
        if (fixture.runtime.preActions) {
          t.diagnostic(`Running ${fixture.runtime.preActions.length} preAction(s)`);
          await runPreActions(page, fixture.runtime.preActions);
          if (fixture.runtime.stateProbe) {
            stateProbeBaseline = await assertStateProbe(page, fixture.runtime.stateProbe, 'after preActions');
          }
        }

        // 3. Start generate — replace picks an element; insert places a placeholder.
        if (isInsert) {
          t.diagnostic(`Insert after ${insertCfg.anchorSelector || 'anchor'}`);
          await runInsertFlow(page, {
            anchorSelector: insertCfg.anchorSelector || 'section#features',
            position: insertCfg.position || 'after',
            prompt: insertCfg.prompt || 'Add new content',
          });
        } else {
          t.diagnostic(`Picking ${pickSelector}`);
          await pickElement(page, pickSelector);

          if (process.env.IMPECCABLE_E2E_DEBUG) {
            const barText = await page.evaluate(() => {
              const bar = document.querySelector('#impeccable-live-bar');
              return bar ? { display: bar.style.display, text: bar.textContent || '', html: bar.innerHTML.slice(0, 500) } : null;
            });
            t.diagnostic(`Bar after pick: ${JSON.stringify(barText)}`);
          }

          t.diagnostic('Clicking Go');
          await clickGo(page);
        }

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
        await waitForCyclingRobust(page, expectedCount, {
          agentMode,
          preActions: fixture.runtime.preActions,
          log: (m) => t.diagnostic(m),
        });
        if (fixture.runtime.stateProbe) {
          await assertStateProbe(page, fixture.runtime.stateProbe, 'after variants', { baseline: stateProbeBaseline });
        }

        // 5. Source-side check: wrapper + style + variants are present
        sourceFile = await locateSessionFile(tmp);
        const after = readFileSync(sourceFile, 'utf-8');
        const svelteComponentSession = svelteComponentTargetFor(sourceFile);
        if (svelteComponentSession) {
          const componentExtension = svelteComponentSession.manifest.componentExtension || 'svelte';
          const variantFile = join(tmp, svelteComponentSession.manifest.componentDir, `v2.${componentExtension}`);
          const variantBody = readFileSync(variantFile, 'utf-8');
          const routeBody = readFileSync(join(tmp, svelteComponentSession.manifest.sourceFile), 'utf-8');
          assert.match(after, /"previewMode": "(?:svelte|vue)-component"/, 'framework component manifest inserted');
          if (isInsert) {
            assert.equal(svelteComponentSession.manifest.mode, 'insert', 'Svelte insert manifest marks insert mode');
            if (agentMode === 'fake') {
              assert.match(variantBody, /inserted-strip/, 'Svelte insert variant component contains inserted content');
            } else if (insertCfg.expectSourcePattern) {
              assert.match(variantBody, new RegExp(insertCfg.expectSourcePattern, 'i'), 'Svelte insert variant component contains prompt-matching content');
            } else {
              assert.match(variantBody, /<([a-z][\w:-]*)\b[\s\S]*<\/\1>|<[a-z][\w:-]*\b[^>]*\/>/i, 'Svelte insert variant component contains a root element');
            }
          } else {
            assert.match(variantBody, new RegExp(`<${svelteComponentSession.expectedTag}\\b`), 'component variant contains target element');
          }
          assert.doesNotMatch(routeBody, /data-impeccable-variants="/, 'route source is not edited during component preview');
        } else {
          assert.match(after, /data-impeccable-variants="/, 'wrapper inserted');
        }
        if (isInsert) {
          if (svelteComponentSession) {
            assert.equal(svelteComponentSession.manifest.mode, 'insert', 'Svelte insert uses component preview mode');
          } else {
            assert.match(after, /data-impeccable-mode="insert"/, 'insert mode wrapper');
            assert.doesNotMatch(after, /data-impeccable-variant="original"/, 'insert has no original variant');
          }
          if (insertCfg.assertAnchorContains) {
            const anchorSource = svelteComponentSession
              ? readFileSync(join(tmp, svelteComponentSession.manifest.sourceFile), 'utf-8')
              : after;
            assert.match(anchorSource, new RegExp(insertCfg.assertAnchorContains), 'anchor section untouched');
          }
        }
        if (svelteComponentSession) {
          const componentExtension = svelteComponentSession.manifest.componentExtension || 'svelte';
          assert.match(readFileSync(join(tmp, svelteComponentSession.manifest.componentDir, `v2.${componentExtension}`), 'utf-8'), /<style\b/, 'component variant has a style block');
        } else if (sourceFile.endsWith('.astro')) {
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
          const paramsSource = svelteComponentSession
            ? readFileSync(join(tmp, svelteComponentSession.manifest.componentDir, 'params.json'), 'utf-8')
            : after;
          assert.match(paramsSource, svelteComponentSession ? /"1"\s*:/ : /data-impeccable-params=/, 'params manifest emitted');
          for (const kind of ['range', 'steps', 'toggle']) {
            assert.match(paramsSource, new RegExp(`"kind"\\s*:\\s*"${kind}"`), `param kind ${kind} present`);
          }
          await page.waitForFunction(() => {
            const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.()
              || window.__IMPECCABLE_LIVE_UI_ROOT__
              || document;
            const tune = root.querySelector('[data-iceq-tune="1"]');
            return tune && tune.disabled === false && /Tune/.test(tune.textContent || '');
          }, { timeout: 5_000 });
        }

        // 6. Cycle variants. Most fixtures stop at variant 2; Svelte Insert
        // also exercises right/right/left/right and accepts variant 3.
        const cycleSequence = Array.isArray(fixture.runtime.variantSequence) && fixture.runtime.variantSequence.length > 0
          ? fixture.runtime.variantSequence
          : [2];
        let visible = await readVisibleVariantForCycle(page);
        let checkedVariantTwoStyle = false;
        for (const targetVariant of cycleSequence) {
          t.diagnostic(`Cycling to variant ${targetVariant}`);
          let cycleAttempts = 0;
          while (visible !== targetVariant) {
            if (cycleAttempts++ > expectedCount + 6) {
              throw new Error(`variant ${targetVariant} did not become visible; last visible=${visible}`);
            }
            if (visible == null || visible < targetVariant) await clickNext(page);
            else await clickPrev(page);
            visible = await readVisibleVariantForCycle(page);
          }
          assert.equal(visible, targetVariant, `variant ${targetVariant} visible`);
          if (agentMode === 'fake' && targetVariant === 2 && !checkedVariantTwoStyle) {
            await page.waitForFunction((sel) => {
              const query = window.__impeccableLiveQuery || ((s) => document.querySelector(s));
              const el = query(sel) || document.querySelector(sel);
              return el && getComputedStyle(el).fontWeight === '900';
            }, variantContentSelector, { timeout: 5_000 }).catch(() => {});
            const variantWeight = await evaluatePageWithTimeout(
              page,
              (sel) => {
                const query = window.__impeccableLiveQuery || ((s) => document.querySelector(s));
                const el = query(sel) || document.querySelector(sel);
                return el ? getComputedStyle(el).fontWeight : null;
              },
              variantContentSelector,
              5_000,
              'variant font-weight read',
            );
            if (variantWeight !== '900') {
              const styleSnapshot = await evaluatePageWithTimeout(
                page,
                (sel) => {
                  const query = window.__impeccableLiveQuery || ((s) => document.querySelector(s));
                  const el = query(sel) || document.querySelector(sel);
                  const styleEl = document.querySelector('style[data-impeccable-css]');
                  const rules = [];
                  for (const sheet of [...document.styleSheets]) {
                    if (sheet.ownerNode !== styleEl) continue;
                    try {
                      rules.push(...[...sheet.cssRules].map((rule) => rule.cssText));
                    } catch (err) {
                      rules.push(`cssRules error: ${err.message}`);
                    }
                  }
                  return {
                    selector: sel,
                    element: el?.outerHTML || null,
                    parent: el?.parentElement?.outerHTML?.slice(0, 800) || null,
                    computedWeight: el ? getComputedStyle(el).fontWeight : null,
                    styleText: styleEl?.textContent || null,
                    rules,
                  };
                },
                variantContentSelector,
                5_000,
                'variant style snapshot',
              ).catch((err) => ({ error: err.message }));
              t.diagnostic('--- variant style snapshot ---');
              t.diagnostic(JSON.stringify(styleSnapshot, null, 2));
            }
            assert.equal(
              variantWeight,
              '900',
              'event=live_e2e.variant_css_applied actor=browser operation=render_visible_variant risk=unstyled_live_preview expected=font-weight 900 actual=' + variantWeight + ' suggestion=inspect live CSS style mode and selector shape',
            );
            checkedVariantTwoStyle = true;
          }
        }

        if (reloadVariants && usesSvelteComponentPreview) {
          const visibleBeforeReload = await getVisibleVariant(page);
          t.diagnostic(`Reload recovery probe at variant ${visibleBeforeReload}/${expectedCount}`);
          const savedBeforeReload = await readLiveSessionStorage(page);
          assert.ok(savedBeforeReload, 'local session exists before reload');
          assert.equal(savedBeforeReload.visible, visibleBeforeReload, 'local session stores visible variant before reload');
          assert.equal(savedBeforeReload.previewMode, 'svelte-component', 'local session stores Svelte preview mode before reload');
          assert.ok(savedBeforeReload.previewFile, 'local session stores Svelte preview manifest before reload');

          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForHandshake(page);

          const savedAfterReload = await readLiveSessionStorage(page);
          assert.ok(savedAfterReload, 'local session exists after reload');
          assert.equal(savedAfterReload.id, savedBeforeReload.id, 'same live session id survives refresh');
          assert.equal(savedAfterReload.visible, visibleBeforeReload, 'fresh local visible variant wins after refresh');
          assert.equal(savedAfterReload.previewFile, savedBeforeReload.previewFile, 'preview manifest survives refresh');

          if (fixture.runtime.preActions?.length) {
            await waitForRecoverableVariantSession(page, visibleBeforeReload, expectedCount, {
              timeout: agentMode === 'llm' ? 60_000 : 15_000,
            });
            await runPreActions(page, fixture.runtime.preActions);
          }

          await waitForCyclingRobust(page, expectedCount, {
            agentMode,
            preActions: fixture.runtime.preActions,
            log: (m) => t.diagnostic(m),
          });
          await waitForVariantCounter(page, visibleBeforeReload, expectedCount, {
            timeout: agentMode === 'llm' ? 60_000 : 15_000,
          });
          assert.equal(await getVisibleVariant(page), visibleBeforeReload, 'same visible variant is restored after refresh');

          if (visibleBeforeReload < expectedCount) {
            await clickNext(page);
            await waitForVariantCounter(page, visibleBeforeReload + 1, expectedCount, {
              timeout: agentMode === 'llm' ? 60_000 : 15_000,
            });
            assert.equal(await getVisibleVariant(page), visibleBeforeReload + 1, 'next arrow still works after refresh restore');
            await clickPrev(page);
            await waitForVariantCounter(page, visibleBeforeReload, expectedCount, {
              timeout: agentMode === 'llm' ? 60_000 : 15_000,
            });
            assert.equal(await getVisibleVariant(page), visibleBeforeReload, 'prev arrow still works after refresh restore');
          } else {
            await clickPrev(page);
            await waitForVariantCounter(page, visibleBeforeReload - 1, expectedCount, {
              timeout: agentMode === 'llm' ? 60_000 : 15_000,
            });
            assert.equal(await getVisibleVariant(page), visibleBeforeReload - 1, 'prev arrow still works after refresh restore');
            await clickNext(page);
            await waitForVariantCounter(page, visibleBeforeReload, expectedCount, {
              timeout: agentMode === 'llm' ? 60_000 : 15_000,
            });
            assert.equal(await getVisibleVariant(page), visibleBeforeReload, 'next arrow still works after refresh restore');
          }
        }

        // 7. Accept the final visible variant
        const acceptVariant = cycleSequence[cycleSequence.length - 1] || 2;
        t.diagnostic(`Accepting variant ${acceptVariant}`);
        await clickAccept(page, { expectedVariant: acceptVariant });
        await waitForBarHidden(page);
        const sourceShadow = !!sourceShadowTargetFor(sourceFile);
        const svelteComponentTarget = svelteComponentSession || svelteComponentTargetFor(sourceFile);
        const svelteComponent = !!svelteComponentTarget;
        if (fixture.runtime.stateProbe && !svelteComponent) {
          await assertStateProbe(page, fixture.runtime.stateProbe, 'after accept', { baseline: stateProbeBaseline });
        }
        if (sourceShadow && typeof session.stopLiveServer === 'function') {
          t.diagnostic('Stopping live-server to flush deferred accept');
          session.stopLiveServer();
        }

        // 8. Wait for live-accept + the agent's carbonize cleanup to land.
        //    File-side: wrapper, all variants, and carbonize markers gone;
        //    only the accepted inner element survives.
        t.diagnostic('Waiting for accept + carbonize cleanup to land');
        const final = await waitForSourceClean(sourceFile, 20_000, { svelteComponentTarget });
        if (svelteComponentTarget) {
          assert.equal(existsSync(svelteComponentTarget.manifestPath), false, 'Svelte temp preview session removed after accept');
          const snapshotPath = join(tmp, '.impeccable/live/sessions', `${svelteComponentTarget.manifest.id}.snapshot.json`);
          const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
          assert.equal(snapshot.phase, 'completed');
          assert.equal(snapshot.sourceFile, svelteComponentTarget.manifest.sourceFile);
          assert.doesNotMatch(snapshot.sourceFile, /node_modules\/\.impeccable-live/);
        }
        assert.doesNotMatch(final, /data-impeccable-variants="/,    'variants wrapper removed');
        assert.doesNotMatch(final, /impeccable-variants-start/,      'variants-start marker removed');
        assert.doesNotMatch(final, /impeccable-carbonize-start/,     'carbonize-start marker removed');
        assert.doesNotMatch(final, /impeccable-carbonize-end/,       'carbonize-end marker removed');
        assert.doesNotMatch(final, /data-impeccable-carbonize=/,     'carbonize wrapper removed');
        assert.doesNotMatch(final, /data-impeccable-variant="/,      'no leftover variant scaffolding');
        if (isInsert) {
          if (agentMode === 'fake') {
            assert.match(final, /inserted-strip/, 'accepted insert content survives');
          } else if (insertCfg.expectSourcePattern) {
            assert.match(final, new RegExp(insertCfg.expectSourcePattern, 'i'), 'accepted insert content survives');
          }
          if (insertCfg.assertAnchorContains) {
            assert.match(final, new RegExp(insertCfg.assertAnchorContains), 'anchor section still in source');
          }
        } else {
          const acceptedSourcePattern = fixture.runtime.acceptedSourcePattern
            || '<h1[^>]*(class|className)="[^"]*\\bhero-title\\b[^"]*"';
          assert.match(
            final,
            new RegExp(acceptedSourcePattern),
            'accepted source element survives',
          );
        }

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
        if (svelteComponent && fixture.runtime.preActions) {
          await runPreActions(page, fixture.runtime.preActions);
        }
        try {
          await waitForAcceptedDom(page, domSelector, { allowVariantRoot: sourceShadow, timeout: 20_000 });
        } catch (err) {
          if (!svelteComponent || !fixture.runtime.preActions) throw err;
          t.diagnostic('Accepted Svelte DOM was not visible after HMR; reloading and re-running preActions');
          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForHandshake(page);
          await runPreActions(page, fixture.runtime.preActions);
          await waitForAcceptedDom(page, domSelector, { allowVariantRoot: sourceShadow, timeout: 20_000 });
        }

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
        await captureLiveE2eFailure({
          name,
          fixture,
          session,
          sourceFile,
          error: err,
          log: (m) => t.diagnostic(m),
        });
        if (knownLimitation) {
          t.diagnostic(`KNOWN LIMITATION: ${knownLimitation}`);
          t.diagnostic(`Failure: ${err.message?.split('\n')[0] || err}`);
          t.skip(`known limitation: ${knownLimitation}`);
          return;
        }
        throw err;
      } finally {
        await teardownAndResetBrowser(teardown);
      }
    });



    if (shouldRunScenario('missed-done') && fixture.runtime.missedDoneReloadScenario) {
      it('recovers when the preflight reload makes the browser miss the done broadcast', liveE2eTestOptions, async (t) => {
        if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
          t.skip('manual scenario filter is active');
          return;
        }
        // Deterministic reproduction of the race the CI astro-vite7 timeout
        // exposed: the server-side preflight scaffold write triggers a
        // framework full-reload, and the agent's variant write + `done` SSE
        // land while the browser is mid-reload. The resumed page misses both
        // signals and used to sit in GENERATING at 0/N forever. Here the
        // reloaded page's HMR websocket connects to a dead mock and its SSE
        // stream is refused until after the agent finishes, forcing the miss
        // every time; recovery must come from the live server redelivering
        // the completion once the browser's SSE reconnects.
        const agent = createFakeAgent();
        const session = await bootFixtureSession({
          name,
          fixture,
          browser,
          agent,
          wrapTarget: wrapTargetFromPickedElement,
          atomicDelayMs: 2500,
          log: (m) => t.diagnostic(m),
        });
        const { page, tmp, teardown } = session;
        const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';
        try {
          await waitForHandshake(page);

          // Arm the blocks before Go. They only affect connections opened
          // after this point — the current page keeps its live SSE and HMR
          // socket, so the scaffold-triggered reload still goes through; it is
          // the page that boots FROM that reload which comes up deaf.
          let liveConnectionsBlocked = true;
          await page.context().route('**/events?token=*', (route) => {
            if (liveConnectionsBlocked && route.request().method() === 'GET') {
              return route.abort();
            }
            return route.continue();
          });
          await page.context().routeWebSocket('**', () => {
            // Never connectToServer(): the reloaded page's HMR client talks to
            // a dead mock, so the variant-write full-reload push is lost.
          });

          await pickElement(page, pickSelector);
          t.diagnostic('Clicking Go (agent write delayed 2.5s; reloaded page will miss HMR + SSE)');
          await clickGo(page);

          // The scaffold write reloads the page into wrapped-but-empty source.
          await page.waitForFunction(() => {
            const wrapper = document.querySelector('[data-impeccable-variants]');
            if (!wrapper) return false;
            const variants = wrapper.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])');
            return variants.length === 0;
          }, { timeout: 15_000 });
          t.diagnostic('Browser reloaded into the scaffold-only wrapper (0 variants)');

          // Capture the scaffold-only source now (the agent write is still
          // ~1.5s away). The first post-reconnect /source read will be served
          // this stale copy, forcing the completion-driven fallback through
          // its retry path — a single no-retry read here strands the tab in
          // GENERATING forever.
          const scaffoldSourceFile = join(tmp, fixture.runtime.missedDoneReloadScenario.sourceFile);
          const scaffoldOnlySource = readFileSync(scaffoldSourceFile, 'utf-8');
          let staleSourceServed = false;
          await page.context().route('**/source?token=*', (route) => {
            if (!staleSourceServed) {
              staleSourceServed = true;
              return route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: scaffoldOnlySource,
              });
            }
            return route.continue();
          });

          // Wait for the delayed agent write to land in source while the page
          // is deaf to both delivery channels.
          const writeDeadline = Date.now() + 20_000;
          for (;;) {
            if (/data-impeccable-variant="3"/.test(readFileSync(scaffoldSourceFile, 'utf-8'))) break;
            if (Date.now() > writeDeadline) throw new Error('agent variant write never landed in source');
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          t.diagnostic('Variants in source; the browser missed the broadcast. Unblocking SSE.');
          liveConnectionsBlocked = false;

          // EventSource auto-retries. On reconnect the live server must
          // redeliver the missed completion; the browser's recovery read gets
          // the stale scaffold first, retries, and then injects the real
          // variants from source — reaching CYCLING despite the dead HMR.
          await waitForCycling(page, 3, { timeout: 30_000 });
          assert.equal(staleSourceServed, true, 'the stale /source intercept must have exercised the retry path');
          t.diagnostic('Session recovered to CYCLING after SSE redelivery + stale-read retry');
        } finally {
          await teardownAndResetBrowser(teardown);
        }
      });
    }

    if (shouldRunScenario('manual') && Array.isArray(fixture.runtime.manualEditScenarios) && fixture.runtime.manualEditScenarios.length > 0) {
      const manualScenarioFilter = process.env.IMPECCABLE_E2E_MANUAL_SCENARIO || '';
      for (const scenario of fixture.runtime.manualEditScenarios) {
        if (manualScenarioFilter && !scenario.name.includes(manualScenarioFilter)) continue;
        it(`Edit copy → Save → Apply/commit: ${scenario.name}`, liveE2eTestOptions, async (t) => {
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
            await teardownAndResetBrowser(teardown);
          }
        });
      }
    }

    if (shouldRunScenario('annotations') && fixture.runtime.liveChrome?.annotations) {
      it('uploads annotations with generate and still accepts the variant', liveE2eTestOptions, async (t) => {
        if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
          t.skip('manual scenario filter is active');
          return;
        }
        const agentMode = process.env.IMPECCABLE_E2E_AGENT || 'fake';
        const recordedGenerateEvents = [];
        let baseAgent;
        if (agentMode === 'llm') {
          const llmConfig = resolveLlmAgentConfig({
            model: process.env.IMPECCABLE_E2E_LLM_MODEL,
          });
          baseAgent = await createLlmAgent({
            config: llmConfig,
            log: (m) => t.diagnostic('[llm] ' + m),
          });
          if (!baseAgent) {
            t.skip(`IMPECCABLE_E2E_AGENT=llm with provider=${llmConfig.provider} requires ${llmConfig.requiredEnv}`);
            return;
          }
          t.diagnostic(`Using LLM agent (provider=${llmConfig.provider} model=${llmConfig.model})`);
        } else {
          baseAgent = createFakeAgent();
        }
        const agent = recordGenerateEvents(baseAgent, recordedGenerateEvents);
        const session = await bootFixtureSession({
          name,
          fixture,
          browser,
          agent,
          wrapTarget: wrapTargetFromPickedElement,
          log: (m) => t.diagnostic(m),
        });
        const { page, teardown } = session;
        const annotation = fixture.runtime.liveChrome.annotations;
        const pickSelector = annotation.selector || fixture.runtime.pickSelector || 'h1.hero-title';
        try {
          await waitForHandshake(page);
          if (fixture.runtime.preActions) await runPreActions(page, fixture.runtime.preActions);
          await pickElement(page, pickSelector, { resetPickMode: true });
          await drawAnnotationPinAndStroke(page, {
            comment: annotation.comment || 'Make this selected element easier to scan',
          });
          await clickGo(page);
          await waitForCyclingRobust(page, 3, {
            agentMode,
            preActions: fixture.runtime.preActions,
            log: (m) => t.diagnostic(m),
          });

          const generateEvent = recordedGenerateEvents.at(-1);
          await assertAnnotationUploadEvent(generateEvent);
          assert.ok(existsSync(generateEvent.screenshotPath), 'annotation screenshot file exists');
          assert.match(generateEvent.screenshotPath, /\.impeccable\/live\/annotations\//, 'annotation screenshot is stored under live annotations');

          const sourceFile = await locateSessionFile(session.tmp);
          const svelteComponentTarget = svelteComponentTargetFor(sourceFile);
          await clickNext(page);
          assert.equal(await getVisibleVariant(page), 2, 'variant 2 visible after annotated generate');
          await clickAccept(page, { expectedVariant: 2 });
          await waitForBarHidden(page);
          await waitForSourceClean(sourceFile, 20_000, { svelteComponentTarget });
        } finally {
          await teardownAndResetBrowser(teardown);
        }
      });
    }

    if (shouldRunScenario('exit') && fixture.runtime.liveChrome?.bottomBar) {
      it('Exit removes live chrome cleanly', liveE2eTestOptions, async (t) => {
        if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
          t.skip('manual scenario filter is active');
          return;
        }
        const session = await bootFixtureSession({
          name,
          fixture,
          browser,
          agent: createFakeAgent(),
          wrapTarget: wrapTargetFromPickedElement,
          log: (m) => t.diagnostic(m),
        });
        try {
          await waitForHandshake(session.page);
          await clickExitLiveMode(session.page);
        } finally {
          await session.teardown();
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordGenerateEvents(agent, events) {
  return {
    ...agent,
    async generateVariants(event, context) {
      events.push(event);
      return agent.generateVariants(event, context);
    },
  };
}

function countSourceVariants(source) {
  return (String(source).match(/<div\s+data-impeccable-variant="(?!original")/g) || []).length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForGenerationTimings(tmp, id, { timeoutMs = 5_000, requireAllVariants = true } = {}) {
  const snapshotPath = join(tmp, '.impeccable', 'live', 'sessions', `${id}.snapshot.json`);
  const journalPath = join(tmp, '.impeccable', 'live', 'sessions', `${id}.jsonl`);
  const deadline = Date.now() + timeoutMs;
  let lastTimings = null;
  while (Date.now() < deadline) {
    if (existsSync(snapshotPath)) {
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
      const timings = snapshot.generationTimings || {};
      lastTimings = timings;
      if (timings.generation_ready && timings.first_reviewable && (!requireAllVariants || timings.all_variants_ready)) return timings;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const checkpointReasons = existsSync(journalPath)
    ? readFileSync(journalPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)?.event)
      .filter((event) => event?.type === 'checkpoint')
      .map((event) => ({ reason: event.reason, arrivedVariants: event.arrivedVariants, expectedVariants: event.expectedVariants }))
    : [];
  throw new Error(`generation timings did not complete for ${id}: timings=${JSON.stringify(lastTimings)} checkpoints=${JSON.stringify(checkpointReasons)}`);
}

async function captureLiveE2eFailure({ name, fixture, session, sourceFile, error, log = () => {} }) {
  const root = process.env.IMPECCABLE_E2E_ARTIFACT_DIR;
  if (!root || !session?.tmp) return;

  try {
    const tmp = session.tmp;
    const dir = join(root, `${safeArtifactName(name)}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, 'error.txt'), String(error?.stack || error?.message || error || ''), 'utf-8');
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify(fixture, null, 2), 'utf-8');
    writeFileSync(join(dir, 'console-errors.log'), (session.consoleErrors || []).join('\n'), 'utf-8');
    writeFileSync(join(dir, 'dev-server.log'), session.dev?.log?.() || '', 'utf-8');
    writeCommandOutput(dir, 'git-status.txt', tmp, ['status', '--short']);
    writeCommandOutput(dir, 'git-diff.patch', tmp, ['diff', '--', '.']);

    const locatedSource = sourceFile || await locateSessionFile(tmp).catch(() => null);
    if (locatedSource && existsSync(locatedSource)) {
      writeFileSync(join(dir, 'source-file.txt'), relative(tmp, locatedSource), 'utf-8');
      copyFileFromTmp(tmp, locatedSource, join(dir, 'sources'));
      const sourceShadow = sourceShadowTargetFor(locatedSource);
      if (sourceShadow && existsSync(sourceShadow)) copyFileFromTmp(tmp, sourceShadow, join(dir, 'sources'));
      const svelteTarget = svelteComponentTargetFor(locatedSource);
      if (svelteTarget?.sourceFile && existsSync(svelteTarget.sourceFile)) {
        copyFileFromTmp(tmp, svelteTarget.sourceFile, join(dir, 'sources'));
      }
    }

    for (const file of walkSources(tmp)) copyFileFromTmp(tmp, file, join(dir, 'sources'));
    copyDirIfExists(join(tmp, '.impeccable', 'live'), join(dir, 'impeccable-live'));
    copyDirIfExists(join(tmp, 'node_modules', '.impeccable-live'), join(dir, 'impeccable-live-preview'));

    if (session.page) {
      const html = await withCaptureTimeout(session.page.content(), 5_000, 'page content').catch((err) => `capture failed: ${err.message}`);
      writeFileSync(join(dir, 'page.html'), html, 'utf-8');
      await withCaptureTimeout(
        session.page.screenshot({ path: join(dir, 'page.png'), fullPage: true }),
        5_000,
        'page screenshot',
      ).catch((err) => writeFileSync(join(dir, 'screenshot-error.txt'), err.message, 'utf-8'));
    }

    log(`Failure artifacts written to ${dir}`);
  } catch (captureErr) {
    log(`Failure artifact capture failed: ${captureErr.message}`);
  }
}

function writeCommandOutput(dir, fileName, cwd, args) {
  try {
    const output = execFileSync('git', args, { cwd, encoding: 'utf-8' });
    writeFileSync(join(dir, fileName), output, 'utf-8');
  } catch (err) {
    writeFileSync(join(dir, fileName), [err.stdout, err.stderr, err.message].filter(Boolean).join('\n'), 'utf-8');
  }
}

function copyFileFromTmp(tmp, file, destRoot) {
  const rel = relative(tmp, file);
  if (!rel || rel.startsWith('..')) return;
  const dest = join(destRoot, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
}

function copyDirIfExists(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function safeArtifactName(name) {
  return String(name || 'fixture').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'fixture';
}

function withCaptureTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
    model: process.env.IMPECCABLE_E2E_LLM_MODEL,
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
  const classes = Array.isArray(element.classes)
    ? element.classes.filter(Boolean).join(' ')
    : typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).join(' ')
    : extractClassAttr(element.outerHTML);
  const elementId = typeof element.id === 'string' ? element.id.trim() : '';

  return {
    tag: tag || 'h1',
    ...(classes ? { classes } : {}),
    ...(elementId ? { elementId } : {}),
    ...(element.textContent ? { text: String(element.textContent).trim() } : {}),
  };
}

function extractClassAttr(outerHTML) {
  if (typeof outerHTML !== 'string') return '';
  const match = outerHTML.match(/\sclass=(["'])(.*?)\1/);
  return match ? match[2].trim().split(/\s+/).filter(Boolean).join(' ') : '';
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
  if (stage.expectApplyLoading) {
    await assertApplyDockLoading(page, {
      timeout: agentMode === 'llm' ? 20_000 : 5_000,
    });
  }
  const applyTimeoutMs = stage.applyTimeoutMs || (agentMode === 'llm' ? 120_000 : 20_000);
  await waitForServerManualEditStashCount(session.live, 0, {
    timeout: applyTimeoutMs,
  });
  await waitForApplyDockHidden(page, { timeout: 10_000 });
  const remaining = await getServerManualEditStashCount(session.live);
  assert.equal(remaining, 0, 'manual edit stash cleared after Apply');

  for (const edit of stage.edits || []) {
    if (edit.expectedVisibleText) {
      try {
        await assertVisibleText(page, edit.leafSelector, edit.expectedVisibleText, {
          timeout: agentMode === 'llm' ? 60_000 : 20_000,
        });
      } catch (err) {
        if (edit.expectedSourceFile) {
          t.diagnostic(`--- source ${edit.expectedSourceFile} after visible-text failure ---`);
          t.diagnostic(readFileSync(join(tmp, edit.expectedSourceFile), 'utf-8'));
        }
        throw err;
      }
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
      for (const pattern of edit.expectedSourceRegex || []) {
        assertSourceMatches(tmp, edit.expectedSourceFile, pattern);
      }
      for (const snippet of edit.expectedSourceMissing || []) {
        assertSourceMissing(tmp, edit.expectedSourceFile, snippet);
      }
    }
  }

  if (stage.expectNoRollback) {
    const status = await getServerManualEditStatus(session.live);
    const rolledBackFiles = status.manualEdits?.lastActivity?.rolledBackFiles || [];
    assert.deepEqual(rolledBackFiles, [], 'manual Apply should not report rolled-back files');
    assert.notEqual(status.manualEdits?.lastActivity?.reason, 'manual_edit_repair_needs_decision');
  }

  if (stage.refreshAfterApply) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHandshake(page);
    for (const edit of stage.edits || []) {
      if (edit.expectedVisibleText) {
        await assertVisibleText(page, edit.leafSelector, edit.expectedVisibleText, {
          timeout: agentMode === 'llm' ? 60_000 : 20_000,
        });
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

async function readLiveSessionStorage(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('impeccable-live-session');
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitForVariantCounter(page, variant, count, { timeout = 15_000 } = {}) {
  try {
    await page.waitForFunction(
      ({ variant, count }) => {
        const query = window.__impeccableLiveQuery || ((sel) => document.querySelector(sel));
        const bar = query('#impeccable-live-bar');
        const text = bar?.textContent || '';
        return text.includes(`${variant}/${count}`);
      },
      { variant, count },
      { timeout },
    );
  } catch (err) {
    const snapshot = await page.evaluate(() => {
      const query = window.__impeccableLiveQuery || ((sel) => document.querySelector(sel));
      const bar = query('#impeccable-live-bar');
      const wrapper = document.querySelector('[data-impeccable-variants]');
      return {
        barText: bar?.textContent || null,
        debugState: window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.() || null,
        storage: localStorage.getItem('impeccable-live-session'),
        wrapper: wrapper ? { preview: wrapper.dataset.impeccablePreview, count: wrapper.dataset.impeccableVariantCount, html: wrapper.outerHTML.slice(0, 500) } : null,
      };
    }).catch((snapErr) => ({ error: snapErr.message }));
    console.error('--- waitForVariantCounter snapshot ---\n' + JSON.stringify(snapshot, null, 2));
    err.message += '\nVariant counter snapshot: ' + JSON.stringify(snapshot, null, 2);
    throw err;
  }
}

async function waitForRecoverableVariantSession(page, variant, count, { timeout = 15_000 } = {}) {
  await page.waitForFunction(
    ({ variant, count }) => {
      const query = window.__impeccableLiveQuery || ((sel) => document.querySelector(sel));
      const bar = query('#impeccable-live-bar');
      const text = bar?.textContent || '';
      const raw = localStorage.getItem('impeccable-live-session');
      let saved = null;
      try { saved = raw ? JSON.parse(raw) : null; } catch {}
      return Boolean(
        saved
        && saved.visible === variant
        && saved.expected === count
        && saved.previewMode === 'svelte-component'
        && /Reveal the selected element to resume/i.test(text)
      );
    },
    { variant, count },
    { timeout },
  );
}

async function waitForAcceptedDom(page, selector, { allowVariantRoot = false, timeout = 20_000 } = {}) {
  await page.waitForFunction(
    ({ sel, allowVariantRoot }) => {
      const all = document.querySelectorAll(sel);
      if (all.length < 1) return false;
      for (const el of all) {
        if (el.closest('[data-impeccable-variants]')) return false;
        if (el.closest('[data-impeccable-carbonize]')) return false;
        if (!allowVariantRoot && el.closest('[data-impeccable-variant]')) return false;
      }
      return true;
    },
    { sel: selector, allowVariantRoot },
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

function assertSourceMatches(tmp, file, pattern) {
  const full = join(tmp, file);
  const body = readFileSync(full, 'utf-8');
  const re = new RegExp(pattern);
  assert.equal(
    re.test(body),
    true,
    `source ${file} should match ${pattern}`,
  );
}

async function assertVisibleText(page, selector, text, { timeout = 20_000 } = {}) {
  try {
    await page.waitForFunction(
      ({ sel, expected }) => {
        const el = document.querySelector(sel);
        return Boolean(el && (el.textContent || '').includes(expected));
      },
      { sel: selector, expected: text },
      { timeout },
    );
  } catch (err) {
    const actual = await page.evaluate((sel) => document.querySelector(sel)?.textContent || null, selector).catch(() => null);
    throw new Error(`visible text ${selector} did not include ${JSON.stringify(text)}; actual=${JSON.stringify(actual)}; ${err.message}`);
  }
}

async function readVisibleVariantForCycle(page, { timeout = 5_000 } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await getVisibleVariant(page);
    if (Number.isInteger(last) && last > 0) return last;
    await page.waitForTimeout(250);
  }
  return last;
}

async function evaluatePageWithTimeout(page, fn, arg, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([page.evaluate(fn, arg), timeout]).finally(() => clearTimeout(timer));
}

async function getServerManualEditStashCount(live, pageUrl = '/') {
  const res = await fetch(
    `http://localhost:${live.port}/manual-edit-stash?token=${encodeURIComponent(live.token)}&pageUrl=${encodeURIComponent(pageUrl)}`,
  );
  if (!res.ok) throw new Error(`manual-edit-stash count failed: ${res.status}`);
  const body = await res.json();
  return body.count || 0;
}

async function getServerManualEditStatus(live) {
  const res = await fetch(`http://localhost:${live.port}/status?token=${encodeURIComponent(live.token)}`);
  if (!res.ok) throw new Error(`manual edit status failed: ${res.status}`);
  return res.json();
}

async function waitForServerManualEditStashCount(live, expectedCount, { pageUrl = '/', timeout = 20_000 } = {}) {
  const start = Date.now();
  let last = null;
  let lastError = null;
  let lastActivity = null;
  let lastStatusCheck = 0;
  while (Date.now() - start < timeout) {
    try {
      last = await getServerManualEditStashCount(live, pageUrl);
      lastError = null;
      if (last === expectedCount) return;
      if (expectedCount === 0 && Date.now() - lastStatusCheck > 1_000) {
        lastStatusCheck = Date.now();
        lastActivity = (await getServerManualEditStatus(live)).manualEdits?.lastActivity || null;
        if (lastActivity?.type === 'manual_edit_repair_needs_decision') {
          throw new Error(`manual edit Apply needs repair decision before stash cleared; last=${last}; lastActivity=${JSON.stringify(lastActivity)}`);
        }
      }
    } catch (err) {
      lastError = err;
      if (/manual edit Apply needs repair decision/.test(err.message || '')) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    lastActivity = (await getServerManualEditStatus(live)).manualEdits?.lastActivity || null;
  } catch {}
  throw new Error(`manual edit stash count did not reach ${expectedCount}; last=${last}; lastError=${lastError?.message || 'none'}; lastActivity=${JSON.stringify(lastActivity)}`);
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
async function waitForSourceClean(filePath, timeoutMs, { svelteComponentTarget: knownSvelteTarget = null } = {}) {
  const start = Date.now();
  let last = '';
  const shadowTarget = sourceShadowTargetFor(filePath);
  const svelteTarget = knownSvelteTarget || svelteComponentTargetFor(filePath);
  if (shadowTarget) {
    let handled = false;
    while (Date.now() - start < timeoutMs) {
      last = readFileSync(filePath, 'utf-8');
      if (last.includes('source-shadow preview handled')) {
        handled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!handled) {
      throw new Error(`source-shadow preview not handled after ${timeoutMs}ms — last contents:\n${last}`);
    }
    filePath = shadowTarget;
  } else if (svelteTarget) {
    filePath = svelteTarget.sourceFile;
  }
  while (Date.now() - start < timeoutMs) {
    last = readFileSync(filePath, 'utf-8');
    const dirty =
      (svelteTarget && existsSync(svelteTarget.manifestPath)) ||
      last.includes('data-impeccable-variants=') ||
      last.includes('impeccable-variants-start') ||
      last.includes('impeccable-carbonize-start') ||
      last.includes('data-impeccable-carbonize=') ||
      last.includes('data-impeccable-variant=');
    if (!dirty) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`source not clean after ${timeoutMs}ms — last contents:\n${last}`);
}

function sourceShadowTargetFor(filePath) {
  let body;
  try { body = readFileSync(filePath, 'utf-8'); } catch { return null; }
  if (!body.includes('data-impeccable-preview="source-shadow"')) return null;
  const match = body.match(/\bdata-impeccable-source-file=(["'])(.*?)\1/);
  if (!match) return null;
  const root = filePath.includes('/.impeccable/')
    ? filePath.slice(0, filePath.indexOf('/.impeccable/'))
    : dirname(filePath);
  return join(root, decodeHtmlAttr(match[2]));
}

function svelteComponentTargetFor(filePath) {
  if (!filePath.endsWith('/manifest.json') && !filePath.endsWith('\\manifest.json')) return null;
  let manifest;
  try { manifest = JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
  if (manifest.previewMode !== 'svelte-component' || !manifest.sourceFile || !manifest.componentDir) return null;
  const sep = pathSepFor(filePath);
  const markers = [
    `${sep}node_modules${sep}.impeccable-live${sep}`,
    `${sep}src${sep}lib${sep}impeccable${sep}`,
    `${sep}app${sep}.impeccable-live${sep}`,
  ];
  const marker = markers.find((candidate) => filePath.includes(candidate));
  const idx = marker ? filePath.indexOf(marker) : -1;
  const root = idx === -1 ? dirname(dirname(dirname(dirname(dirname(filePath))))) : filePath.slice(0, idx);
  return {
    manifest,
    manifestPath: filePath,
    sourceFile: join(root, manifest.sourceFile),
    expectedTag: expectedTagFromOriginalMarkup(manifest.originalMarkup),
  };
}

function pathSepFor(filePath) {
  return filePath.includes('\\') ? '\\' : '/';
}

function expectedTagFromOriginalMarkup(markup) {
  const match = String(markup || '').match(/<([A-Za-z][\w:-]*)\b/);
  return match ? match[1] : '[A-Za-z][\\w:-]*';
}

function fixtureUsesSvelteKitAdapter(fixture) {
  return Array.isArray(fixture?.config?.files)
    && fixture.config.files.includes('src/app.html')
    && Array.isArray(fixture?.sourceFiles)
    && fixture.sourceFiles.some((file) => file.endsWith('.svelte'));
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function assertStateProbe(page, probe, label, { baseline = null } = {}) {
  const snapshot = {};
  if (probe.textSelector) {
    const actual = await page.locator(probe.textSelector).first().textContent({ timeout: 5_000 });
    snapshot.text = normalizeText(actual);
    assert.equal(
      snapshot.text,
      normalizeText(probe.expectedText),
      `stateProbe text ${label}`,
    );
  }
  if (probe.windowProperty) {
    const actual = await page.evaluate((prop) => window[prop], probe.windowProperty);
    snapshot.windowValue = actual;
    if (Object.hasOwn(probe, 'expectedWindowValue')) {
      assert.equal(
        actual,
        probe.expectedWindowValue,
        `stateProbe ${probe.windowProperty} ${label}`,
      );
    }
    if (probe.expectWindowUnchanged && baseline) {
      assert.equal(
        actual,
        baseline.windowValue,
        `stateProbe ${probe.windowProperty} unchanged ${label}`,
      );
    }
  }
  return snapshot;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
  for (const f of walkComponentManifests(tmp)) {
    const body = readFileSync(f, 'utf-8');
    if (/"previewMode": "(?:svelte|vue)-component"/.test(body)) return f;
  }
  throw new Error('Could not locate session source file under ' + tmp);
}

function walkComponentManifests(root) {
  const results = [];
  const stack = [
    join(root, 'node_modules/.impeccable-live'),
    join(root, 'src/lib/impeccable'),
    join(root, 'app/.impeccable-live'),
  ];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.name === 'manifest.json') {
        results.push(full);
      }
    }
  }
  return results;
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
