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
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createFakeAgent,
  republishSvelteComponentVariants,
  FAKE_VARIANT_FONT_WEIGHTS,
} from './live-e2e/agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR, SCRIPTS_DIR } from './live-e2e/session.mjs';
import {
  assertApplyDockVisible,
  assertApplyDockLoading,
  assertAnnotationUploadEvent,
  assertSourceApplied,
  chooseTuneStep,
  clickExitLiveMode,
  cycleToVariant,
  clickAccept,
  clickApplyEdits,
  clickEditCopy,
  clickDiscard,
  clickMountRetry,
  clickSaveEdit,
  clickGo,
  clickNext,
  clickPrev,
  editTextLeaf,
  drawAnnotationPinAndStroke,
  getVisibleVariant,
  installLiveQueryHelpers,
  isMountErrorCardVisible,
  openTunePanel,
  pickElement,
  readComputedFontWeight,
  runLiveChromeBottomBarSmoke,
  setTuneRange,
  waitForApplyDockHidden,
  waitForBarHidden,
  waitForComputedFontWeight,
  waitForCycling,
  waitForMountErrorCard,
  waitForMountErrorCardGone,
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

// Anything served out of the live preview / runtime tree. A 404 here is never
// benign: it means the variant preview module or its runtime never loaded, and
// the flow silently fell back to the untouched original.
const LIVE_TREE_URL_RE = /\.impeccable-live|impeccable\/live\/preview/i;

// The two framework dev-mode notices every React fixture emits.
const FRAMEWORK_NOISE_RE = /Download the React DevTools|StrictMode/i;

// Chromium's resource-failure console line. Only the favicon flavour is
// allowlisted; a favicon is not part of any fixture and its absence proves
// nothing about live mode.
const RESOURCE_404_RE = /Failed to load resource: the server responded with a status of 404/i;
const FAVICON_URL_RE = /favicon(\.[a-z0-9]+)?(\?|$)|\/favicon/i;

function isLiveTreeUrl(url) {
  return LIVE_TREE_URL_RE.test(String(url || ''));
}

function isBenignConsoleError(entry) {
  const text = String(entry || '');
  // Live-tree failures are never allowlisted, whatever else they match.
  if (LIVE_TREE_URL_RE.test(text)) return false;
  if (FRAMEWORK_NOISE_RE.test(text)) return true;
  if (RESOURCE_404_RE.test(text)) return FAVICON_URL_RE.test(text);
  return false;
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

      // `tmp` is the staged repo root; `appRoot` is the directory the dev
      // server serves. They differ only for fixtures declaring
      // `runtime.appDir`. Every fixture-relative source path resolves against
      // appRoot — the repo root may not contain a single source file.
      const { page, tmp, appRoot, consoleErrors, teardown } = session;
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
      // Component previews mount every variant into the same node, so one
      // selector serves all three; the HTML/JSX paths keep a div per variant.
      const variantContentSelectorFor = (variantNum) => (isInsert
        ? (usesSvelteComponentPreview ? '.inserted-copy' : `[data-impeccable-variant="${variantNum}"] .inserted-copy`)
        : usesSvelteComponentPreview
        ? pickSelector
        : `[data-impeccable-variant="${variantNum}"] > :first-child`);
      let stateProbeBaseline = null;
      let sourceFile = null;

      try {
        // 0. Root resolution — only for fixtures whose app is not the repo
        //    root. live.mjs booted from the repo root and had to find the app
        //    on its own; everything after this depends on it having done so.
        if (session.appDir) {
          t.diagnostic(`Asserting resolved roots for nested app ${session.appDir}/`);
          assertNestedAppRoots(session);
        }

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
          await runSteerSmoke(page, appRoot, fixture, (m) => t.diagnostic(m), steerTimeouts);
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
          await pickElement(page, pickSelector, { position: fixture.runtime.pickPosition });

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
        sourceFile = await locateSessionFile(appRoot);
        if (session.appDir) {
          assert.ok(
            relative(tmp, sourceFile).startsWith(session.appDir + '/'),
            `session source must live under ${session.appDir}/, got ${relative(tmp, sourceFile)}`,
          );
        }
        const after = readFileSync(sourceFile, 'utf-8');
        const svelteComponentSession = svelteComponentTargetFor(sourceFile);
        if (svelteComponentSession) {
          const componentExtension = svelteComponentSession.manifest.componentExtension || 'svelte';
          const variantFile = join(appRoot, svelteComponentSession.manifest.componentDir, `v2.${componentExtension}`);
          const variantBody = readFileSync(variantFile, 'utf-8');
          const routeBody = readFileSync(join(appRoot, svelteComponentSession.manifest.sourceFile), 'utf-8');
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
              ? readFileSync(join(appRoot, svelteComponentSession.manifest.sourceFile), 'utf-8')
              : after;
            assert.match(anchorSource, new RegExp(insertCfg.assertAnchorContains), 'anchor section untouched');
          }
        }
        if (svelteComponentSession) {
          const componentExtension = svelteComponentSession.manifest.componentExtension || 'svelte';
          assert.match(readFileSync(join(appRoot, svelteComponentSession.manifest.componentDir, `v2.${componentExtension}`), 'utf-8'), /<style\b/, 'component variant has a style block');
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
            ? readFileSync(join(appRoot, svelteComponentSession.manifest.componentDir, 'params.json'), 'utf-8')
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
        // Render proof, not bar-label proof: the fake agent gives every variant
        // a distinct font-weight, so a computed read says which variant the
        // user is actually looking at. Checked for each variant the run reaches.
        const styleCheckedVariants = new Set();
        const assertVisibleVariantStyle = async (variantNum) => {
          if (agentMode !== 'fake') return;
          const expected = FAKE_VARIANT_FONT_WEIGHTS[variantNum];
          if (!expected || styleCheckedVariants.has(variantNum)) return;
          styleCheckedVariants.add(variantNum);
          const selector = variantContentSelectorFor(variantNum);
          await waitForComputedFontWeight(page, selector, expected, { timeout: 5_000 }).catch(() => {});
          const variantWeight = await readComputedFontWeight(page, selector).catch(() => null);
          if (variantWeight !== expected) {
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
              selector,
              5_000,
              'variant style snapshot',
            ).catch((err) => ({ error: err.message }));
            t.diagnostic(`--- variant ${variantNum} style snapshot ---`);
            t.diagnostic(JSON.stringify(styleSnapshot, null, 2));
          }
          assert.equal(
            variantWeight,
            expected,
            `event=live_e2e.variant_css_applied actor=browser operation=render_visible_variant variant=${variantNum} risk=unstyled_live_preview expected=font-weight ${expected} actual=${variantWeight} suggestion=inspect live CSS style mode and selector shape`,
          );
        };
        await assertVisibleVariantStyle(visible);
        // Optional fixture hook: assert attribute/text values inside the
        // MOUNTED variant DOM. Component previews hydrate collection items
        // from the rendered page (text slots and attribute slots); a probe
        // here catches a preview that mounts but with empty hydrated values,
        // which every other assertion (style, counter, accept) misses.
        if (Array.isArray(fixture.runtime.mountedDomProbe)) {
          for (const probe of fixture.runtime.mountedDomProbe) {
            const actual = await evaluatePageWithTimeout(
              page,
              ({ sel, attr }) => {
                const query = window.__impeccableLiveQuery || ((s) => document.querySelector(s));
                const el = query(sel) || document.querySelector(sel);
                if (!el) return null;
                return attr ? el.getAttribute(attr) : (el.textContent || '').trim();
              },
              { sel: probe.selector, attr: probe.attr || null },
              5_000,
              'mounted DOM probe',
            );
            assert.equal(
              actual,
              probe.expect,
              `mounted variant DOM: ${probe.selector}${probe.attr ? ` [${probe.attr}]` : ' text'}`,
            );
          }
        }
        for (const targetVariant of cycleSequence) {
          t.diagnostic(`Cycling to variant ${targetVariant}`);
          visible = await cycleToVariant(page, targetVariant, expectedCount, {
            settleTimeout: agentMode === 'llm' ? 60_000 : 15_000,
          });
          assert.equal(visible, targetVariant, `variant ${targetVariant} visible`);
          await assertVisibleVariantStyle(targetVariant);
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
          const snapshotPath = join(appRoot, '.impeccable/live/sessions', `${svelteComponentTarget.manifest.id}.snapshot.json`);
          const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
          assert.equal(snapshot.phase, 'completed');
          assert.equal(snapshot.sourceFile, svelteComponentTarget.manifest.sourceFile);
          assert.doesNotMatch(snapshot.sourceFile, /node_modules\/\.impeccable-live|\.impeccable\/live\/previews/);
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

        // 9c. Network hygiene — nothing under the live preview/runtime tree
        //     may 404 or fail. A missing `.impeccable-live` module means the
        //     preview never mounted, which the DOM assertions above can miss
        //     when the original element still renders.
        const liveTreeFailures = (session.failedRequests || []).filter((f) => isLiveTreeUrl(f.url));
        assert.equal(
          liveTreeFailures.length,
          0,
          `live preview/runtime requests must all succeed, got:\n${
            liveTreeFailures.map((f) => `${f.reason} ${f.url}`).join('\n')
          }`,
        );

        // 10. Console hygiene — no errors during the whole flow.
        if (fixture.runtime.probe?.expectConsoleClean) {
          const realErrors = consoleErrors.filter((e) => !isBenignConsoleError(e));
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



    // -----------------------------------------------------------------
    // Params end-to-end: knob → accept → baked literal in source.
    //
    // The Svelte accept pipeline bakes params mechanically, so the unit
    // tests already cover the transform. What they cannot cover is that the
    // value the user actually dialled in the Tune popover is the value that
    // reaches it. This drives the real controls and reads the real source.
    // -----------------------------------------------------------------
    if (shouldRunScenario('params') && fixture.runtime.paramsScenario) {
      it('bakes tuned param values into the accepted source', liveE2eTestOptions, async (t) => {
        if (!canRunFakeAgentScenario(t)) return;
        const scenario = fixture.runtime.paramsScenario;
        const targetVariant = scenario.variant || 2;
        const run = await bootComponentScenario({ t, name, fixture, expectedCount: 3 });
        const { session, sourceFile, svelteComponentTarget } = run;
        const { page } = session;
        try {
          await cycleToVariant(page, targetVariant, 3);

          t.diagnostic('Opening the Tune popover');
          await openTunePanel(page);
          const applied = await setTuneRange(page, scenario.rangeLabel, scenario.rangeValue);
          assert.equal(applied, scenario.rangeValue, 'range knob took the requested value');
          await chooseTuneStep(page, scenario.stepsLabel, scenario.stepsOptionLabel);

          t.diagnostic(`Accepting variant ${targetVariant} with tuned params`);
          await clickAccept(page, { expectedVariant: targetVariant });
          await waitForBarHidden(page);
          const final = await waitForSourceClean(sourceFile, 20_000, { svelteComponentTarget });

          for (const needle of scenario.expectSourceContains || []) {
            assert.ok(
              final.includes(needle),
              `accepted source should bake ${JSON.stringify(needle)}; got:\n${final}`,
            );
          }
          for (const needle of scenario.expectSourceMissing || []) {
            assert.equal(
              final.includes(needle),
              false,
              `accepted source should drop the unchosen branch ${JSON.stringify(needle)}; got:\n${final}`,
            );
          }
          // The generic contract, independent of this fixture's values: every
          // preview-only param hook is gone once the source is accepted.
          assert.doesNotMatch(final, /data-p-[A-Za-z0-9_-]+/, 'no data-p-* param attributes survive accept');
          assert.doesNotMatch(final, /var\(--p-/, 'no unbaked var(--p-*) survives accept');
        } finally {
          await teardownAndResetBrowser(session.teardown);
        }
      });
    }

    // -----------------------------------------------------------------
    // Agent-initiated targeting (the `generate` command). The agent names
    // the element over the live-generate CLI; the overlay resolves the
    // selector, scrolls to it, enters the picked state, and fires Go with
    // no user click. Everything downstream (generate event, variants,
    // cycling, accept, carbonize) is the standard pipeline, so the second
    // half of this test reuses the core helpers unchanged.
    // -----------------------------------------------------------------
    if (shouldRunScenario('agent-target') && fixture.runtime.agentTargetScenario) {
      it('agent-initiated target scrolls, picks, and generates without a user click', liveE2eTestOptions, async (t) => {
        if (!canRunFakeAgentScenario(t)) return;
        const scenario = fixture.runtime.agentTargetScenario;
        const session = await bootFixtureSession({
          name,
          fixture,
          browser,
          agent: createFakeAgent(),
          wrapTarget: wrapTargetFromPickedElement,
          atomicDelayMs,
          log: (m) => t.diagnostic(m),
        });
        const { page, appRoot, teardown } = session;
        try {
          await waitForHandshake(page);

          // Failure contracts first; none of these may start a session.
          const miss = runLiveGenerate(appRoot, { selector: scenario.missSelector, action: scenario.action });
          assert.equal(miss.ok, false);
          assert.equal(miss.error, 'no_match');

          const ambiguous = runLiveGenerate(appRoot, { selector: scenario.ambiguousSelector, action: scenario.action });
          assert.equal(ambiguous.ok, false);
          assert.equal(ambiguous.error, 'ambiguous');
          assert.ok(ambiguous.matchCount >= 2, 'ambiguous reports the match count');
          assert.ok(
            Array.isArray(ambiguous.candidates) && ambiguous.candidates.length >= 2,
            'ambiguous lists candidate descriptors',
          );

          const dry = runLiveGenerate(appRoot, {
            selector: scenario.selector,
            action: scenario.action,
            'dry-run': true,
          });
          assert.equal(dry.ok, true, `dry-run resolved: ${JSON.stringify(dry)}`);
          assert.equal(dry.dryRun, true);
          assert.equal(dry.matchCount, 1);

          const noSession = await page.evaluate(() => window.__IMPECCABLE_LIVE_CHROME_CORE__.debugState());
          assert.equal(noSession.currentSessionId, null, 'failed and dry-run targets start no session');
          assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 0, 'page has not scrolled yet');

          // The happy path: resolve, scroll, pick, Go.
          t.diagnostic(`Agent-targeting ${scenario.selector} (${scenario.action} x${scenario.count || 3})`);
          const res = runLiveGenerate(appRoot, {
            selector: scenario.selector,
            action: scenario.action,
            count: scenario.count || 3,
          });
          assert.equal(res.ok, true, `live-generate succeeded: ${JSON.stringify(res)}`);
          assert.match(res.sessionId, /^[0-9a-f]{8}$/, 'a session id came back');
          assert.equal(res.action, scenario.action);

          const scrolled = await page.evaluate(() => Math.round(window.scrollY));
          assert.ok(
            scrolled >= (scenario.minScrollY || 100),
            `browser scrolled to the target (scrollY=${scrolled})`,
          );
          const dbg = await page.evaluate(() => window.__IMPECCABLE_LIVE_CHROME_CORE__.debugState());
          assert.equal(dbg.currentSessionId, res.sessionId, 'overlay session matches the CLI result');

          // A second target while the session is mid-flight must refuse.
          const busy = runLiveGenerate(appRoot, { selector: scenario.selector, action: scenario.action });
          assert.equal(busy.ok, false);
          assert.equal(busy.error, 'busy');

          await waitForCyclingRobust(page, 3, { agentMode: 'fake', log: (m) => t.diagnostic(m) });
          const sourceFile = await locateSessionFile(appRoot);
          assert.ok(sourceFile, 'the variants wrapper landed in a source file');

          await cycleToVariant(page, 2, 3);
          t.diagnostic('Accepting variant 2');
          await clickAccept(page, { expectedVariant: 2 });
          await waitForBarHidden(page);
          const final = await waitForSourceClean(sourceFile, 20_000, {});
          assert.match(
            final,
            new RegExp(fixture.runtime.acceptedSourcePattern),
            'accepted source element survives',
          );
          for (const needle of fixture.runtime.assertSourceContains || []) {
            assert.ok(final.includes(needle), `source still contains ${JSON.stringify(needle)} after accept`);
          }
          assert.doesNotMatch(final, /data-impeccable-variants="/, 'variants wrapper removed');
          assert.doesNotMatch(final, /impeccable-carbonize-start/, 'carbonize block rewritten');

          // The overlay is reusable after accept: a fresh dry-run resolves.
          const post = runLiveGenerate(appRoot, {
            selector: scenario.selector,
            action: scenario.action,
            'dry-run': true,
          });
          assert.equal(post.ok, true, 'a new target resolves after accept');
        } finally {
          await teardownAndResetBrowser(teardown);
        }
      });
    }

    // -----------------------------------------------------------------
    // Failure injection for component previews.
    // -----------------------------------------------------------------
    if (fixture.runtime.componentFailureScenarios) {
      const failure = fixture.runtime.componentFailureScenarios;
      const brokenVariant = failure.variant || 2;

      if (shouldRunScenario('mount-failure')) {
        it('surfaces a broken variant without losing the session, and recovers on Retry', liveE2eTestOptions, async (t) => {
          if (!canRunFakeAgentScenario(t)) return;
          // Auto-repair off: this scenario is about what the USER sees and can
          // do when a publish is unrenderable. An agent that silently
          // republishes would hide exactly the surface under test.
          const run = await bootComponentScenario({
            t,
            name,
            fixture,
            expectedCount: 3,
            agent: createFakeAgent({ autoRepairMountFailures: false }),
          });
          const { session, svelteComponentTarget } = run;
          const { page, appRoot } = session;
          try {
            const sessionId = svelteComponentTarget.manifest.id;
            const variantPath = revisionVariantPath(appRoot, run.manifestPath, brokenVariant);
            const saved = readFileSync(variantPath, 'utf-8');
            // Corrupt rather than delete: a published variant that does not
            // compile is the failure an agent actually produces, and it keeps
            // the module resolvable so the recovery is about the content.
            t.diagnostic(`Corrupting published revision file ${relative(appRoot, variantPath)}`);
            writeFileSync(variantPath, '<div class="impeccable-broken-variant">{ not valid svelte\n', 'utf-8');

            // One step forward onto the variant whose module is gone. The step
            // deliberately does not settle, so drive the click directly.
            t.diagnostic(`Stepping onto the broken variant ${brokenVariant}`);
            await clickNext(page);

            const cardText = await waitForMountErrorCard(page, { variant: brokenVariant });
            assert.match(cardText, /Retry/, 'the mount-error card offers a Retry');

            // The session must survive the failure: the old behaviour wiped
            // local state and orphaned a session the server still tracked.
            const barVisible = await page.evaluate(() => {
              const bar = window.__impeccableLiveQuery('#impeccable-live-bar');
              return Boolean(bar) && bar.style.display !== 'none';
            });
            assert.equal(barVisible, true, 'the cycling bar survives a mount failure');
            const stored = await readLiveSessionStorage(page);
            assert.equal(stored?.id, sessionId, 'the local session record survives a mount failure');

            const events = await waitForJournalEvent(appRoot, sessionId, 'variant_mount_failed', 15_000);
            const failedEvent = events.at(-1);
            assert.equal(failedEvent.variant, brokenVariant, 'the journal names the variant that failed');
            assert.ok(failedEvent.error, 'the journal carries the mount error text');

            // A failed step reverts to the variant that still renders, so the
            // comparison is usable rather than blank; Retry re-imports the
            // session, and the repaired variant is reachable again.
            t.diagnostic('Restoring the revision file and clicking Retry');
            writeFileSync(variantPath, saved, 'utf-8');
            await clickMountRetry(page);
            await waitForMountErrorCardGone(page);
            await cycleToVariant(page, brokenVariant, 3, { settleTimeout: 20_000 });
            await waitForComputedFontWeight(
              page,
              fixture.runtime.pickSelector || 'h1.hero-title',
              FAKE_VARIANT_FONT_WEIGHTS[brokenVariant],
              { timeout: 20_000 },
            );
            assert.equal(await getVisibleVariant(page), brokenVariant, 'the repaired variant is the visible one');
            assert.equal(await isMountErrorCardVisible(page), false, 'the repaired mount raises no new error');
          } finally {
            await teardownAndResetBrowser(session.teardown);
          }
        });
      }

      if (shouldRunScenario('republish')) {
        it('mounts republished variant content instead of a cached compile', liveE2eTestOptions, async (t) => {
          if (!canRunFakeAgentScenario(t)) return;
          const run = await bootComponentScenario({ t, name, fixture, expectedCount: 3 });
          const { session } = run;
          const { page, appRoot } = session;
          const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';
          try {
            await cycleToVariant(page, brokenVariant, 3);
            await waitForComputedFontWeight(page, pickSelector, FAKE_VARIANT_FONT_WEIGHTS[brokenVariant]);
            const beforeRevision = readManifest(run.manifestPath).revision;

            t.diagnostic('Republishing every variant with new styling');
            await republishSvelteComponentVariants({
              tmp: appRoot,
              manifestFile: relative(appRoot, run.manifestPath),
              live: session.live,
              css: (variantNum, shape) => `${shape.rootSelector} { font-weight: ${100 * variantNum}; }`,
            });

            // A stale transform cache would keep serving the previous compile;
            // the server-stamped revision dir is what makes the import path new.
            await waitForComputedFontWeight(page, pickSelector, String(100 * brokenVariant), { timeout: 20_000 });
            const afterRevision = readManifest(run.manifestPath).revision;
            assert.ok(
              afterRevision > beforeRevision,
              `republish must bump the preview revision (${beforeRevision} → ${afterRevision})`,
            );
            assert.equal(await isMountErrorCardVisible(page), false, 'a clean republish shows no mount error');
          } finally {
            await teardownAndResetBrowser(session.teardown);
          }
        });
      }

      if (shouldRunScenario('storage-loss') && failure.storageLoss !== false) {
        it('rehydrates the comparison from the server after localStorage is cleared', liveE2eTestOptions, async (t) => {
          if (!canRunFakeAgentScenario(t)) return;
          const run = await bootComponentScenario({ t, name, fixture, expectedCount: 3 });
          const { session } = run;
          const { page } = session;
          try {
            await cycleToVariant(page, brokenVariant, 3);
            assert.ok(await readLiveSessionStorage(page), 'a local session record exists before the wipe');

            t.diagnostic('Clearing localStorage and reloading');
            await page.evaluate(() => localStorage.clear());
            assert.equal(await readLiveSessionStorage(page), null, 'the local session record really was wiped');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForHandshake(page);
            if (fixture.runtime.preActions) await runPreActions(page, fixture.runtime.preActions);

            // Nothing local is left: reaching CYCLING again can only come from
            // the server's durable session record.
            await waitForCycling(page, 3, { timeout: 30_000 });
            const restored = await readLiveSessionStorage(page);
            assert.equal(restored?.id, run.svelteComponentTarget.manifest.id, 'the adopted session keeps its id');
            assert.equal(restored?.expected, 3, 'the adopted session knows the variant count');
          } finally {
            await teardownAndResetBrowser(session.teardown);
          }
        });
      }
    }

    if (shouldRunScenario('missed-done') && fixture.runtime.missedDoneReloadScenario) {
      it('recovers when the preflight reload makes the browser miss the done broadcast', liveE2eTestOptions, async (t) => {
        if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
          t.skip('manual scenario filter is active');
          return;
        }
        const scenarioLimitation = fixture.runtime.missedDoneReloadScenario.knownLimitation;
        if (scenarioLimitation) {
          t.diagnostic(`KNOWN LIMITATION: ${scenarioLimitation}`);
          t.skip(`known limitation: ${scenarioLimitation}`);
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
        const { page, appRoot, teardown } = session;
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
          const scaffoldSourceFile = join(appRoot, fixture.runtime.missedDoneReloadScenario.sourceFile);
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

    if (shouldRunScenario('orphan') && fixture.runtime.orphanedWrapperScenario) {
      it('self-discards an orphaned session when its wrapper is edited out of source', liveE2eTestOptions, async (t) => {
        if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
          t.skip('manual scenario filter is active');
          return;
        }
        // Repro of issue #439: a cycling session is abandoned (no Accept or
        // Discard), the wrapped region is edited out of source, and the page
        // reloads. The resumed session used to freeze the picker forever;
        // recovery required a manual live-complete --discarded. It must now
        // self-discard and hand the surface back to the picker.
        const agent = createFakeAgent();
        const session = await bootFixtureSession({
          name,
          fixture,
          browser,
          agent,
          wrapTarget: wrapTargetFromPickedElement,
          log: (m) => t.diagnostic(m),
        });
        const { page, appRoot, teardown } = session;
        const cfg = fixture.runtime.orphanedWrapperScenario;
        const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';
        try {
          await waitForHandshake(page);
          const sourceFile = join(appRoot, cfg.sourceFile);
          const pristine = readFileSync(sourceFile, 'utf-8');

          await pickElement(page, pickSelector, { position: fixture.runtime.pickPosition });
          await clickGo(page);
          await waitForCyclingRobust(page, 3, { timeout: 60_000, log: (m) => t.diagnostic(m) });
          const saved = await readLiveSessionStorage(page);
          assert.ok(saved?.id, 'cycling session persisted to local storage');

          t.diagnostic('Restoring pristine source (simulated external edit that removes the wrapper)');
          writeFileSync(sourceFile, pristine);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForHandshake(page);

          // Resume adopts the cycling session, the source read finds no
          // wrapper, retries, then self-discards: local session cleared.
          const deadline = Date.now() + 30_000;
          for (;;) {
            const current = await readLiveSessionStorage(page);
            if (!current?.id) break;
            if (Date.now() > deadline) throw new Error('orphaned session was never discarded');
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          t.diagnostic('Orphaned session discarded; verifying durable phase + picker rearm');

          const snapshotPath = join(appRoot, '.impeccable/live/sessions', `${saved.id}.snapshot.json`);
          const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
          assert.equal(
            snapshot.phase,
            'discarded',
            'an orphaned discard is terminalized server-side without agent involvement',
          );

          // The regression that mattered: the picker must arm again.
          await pickElement(page, pickSelector, { position: fixture.runtime.pickPosition });
        } finally {
          await teardownAndResetBrowser(teardown);
        }
      });
    }

    if (shouldRunScenario('foreign') && fixture.runtime.foreignSessionScenario) {
      it('clears another project\'s leftover browser session instead of resuming it', liveE2eTestOptions, async (t) => {
        if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
          t.skip('manual scenario filter is active');
          return;
        }
        // Repro of the cross-project leak: localStorage is per-ORIGIN, and two
        // projects routinely reuse the same localhost port across time. A
        // leftover cycling session from the other project used to be resumed
        // ("Variants ready" with no user action), and its checkpoints
        // materialized a ghost session in THIS project's durable store that
        // kept reattaching after every discard.
        const agent = createFakeAgent();
        const session = await bootFixtureSession({
          name,
          fixture,
          browser,
          agent,
          wrapTarget: wrapTargetFromPickedElement,
          log: (m) => t.diagnostic(m),
        });
        const { page, appRoot, teardown } = session;
        const pickSelector = fixture.runtime.pickSelector || 'h1.hero-title';
        try {
          await waitForHandshake(page);

          const cases = [
            // Stamped with another app's root: dropped at load time, before
            // any server roundtrip.
            { id: 'f0e1d2c3', appRoot: '/somewhere/else/entirely' },
            // Legacy shape without a stamp: dropped when the server refuses
            // its first checkpoint as unknown_session.
            { id: 'deadf00d' },
          ];
          for (const foreign of cases) {
            t.diagnostic(`Seeding foreign session ${foreign.id}${foreign.appRoot ? ' (stamped)' : ' (legacy shape)'}`);
            await page.evaluate((saved) => {
              localStorage.setItem('impeccable-live-session', JSON.stringify(saved));
              localStorage.removeItem('impeccable-live-session-handled');
            }, {
              id: foreign.id,
              state: 'CYCLING',
              expected: 3,
              arrived: 3,
              visible: 1,
              sourceFile: 'src/App.jsx',
              pageUrl: '/',
              checkpointRevision: 5,
              ...(foreign.appRoot ? { appRoot: foreign.appRoot } : {}),
            });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForHandshake(page);

            const deadline = Date.now() + 20_000;
            for (;;) {
              const current = await readLiveSessionStorage(page);
              if (!current || current.id !== foreign.id) break;
              if (Date.now() > deadline) throw new Error(`foreign session ${foreign.id} was never cleared`);
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            const sessionsDir = join(appRoot, '.impeccable/live/sessions');
            assert.equal(
              existsSync(join(sessionsDir, `${foreign.id}.jsonl`)),
              false,
              `no ghost journal for ${foreign.id} may materialize in this project's store`,
            );
          }

          // The surface is genuinely back: a fresh pick must work.
          await pickElement(page, pickSelector, { position: fixture.runtime.pickPosition });
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

          const sourceFile = await locateSessionFile(session.appRoot);
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

/**
 * The params and failure-injection scenarios assert on deterministic variant
 * content (exact CSS values, exact font weights). An LLM agent legitimately
 * produces neither, so they only run against the fake agent.
 */
/**
 * Run the live-generate CLI (agent-initiated targeting) against a staged
 * fixture and parse its JSON verdict. The CLI exits 1 for every ok:false
 * outcome, so the JSON is read from the thrown error's stdout in that case.
 */
function runLiveGenerate(appRoot, flags) {
  const args = [join(SCRIPTS_DIR, 'live-generate.mjs')];
  for (const [key, value] of Object.entries(flags)) {
    if (value === true) args.push(`--${key}`);
    else if (value !== undefined && value !== null) args.push(`--${key}`, String(value));
  }
  let stdout;
  try {
    stdout = execFileSync(process.execPath, args, { cwd: appRoot, encoding: 'utf-8' });
  } catch (err) {
    stdout = err.stdout || '';
    if (!stdout.trim()) throw err;
  }
  return JSON.parse(stdout);
}

function canRunFakeAgentScenario(t) {
  if (manualOnly || process.env.IMPECCABLE_E2E_MANUAL_SCENARIO) {
    t.skip('manual scenario filter is active');
    return false;
  }
  if ((process.env.IMPECCABLE_E2E_AGENT || 'fake') !== 'fake') {
    t.skip('scenario asserts on deterministic fake-agent output');
    return false;
  }
  return true;
}

/**
 * Boot a fixture straight to CYCLING on a component-preview session and hand
 * back the handles the scenarios need: the manifest, the route source, and the
 * session itself. Callers own teardown.
 */
async function bootComponentScenario({ t, name, fixture, expectedCount = 3, agent }) {
  const session = await bootFixtureSession({
    name,
    fixture,
    browser,
    agent: agent || createFakeAgent(),
    wrapTarget: wrapTargetFromPickedElement,
    log: (m) => t.diagnostic(m),
  });
  try {
    const { page, appRoot } = session;
    await waitForHandshake(page);
    if (fixture.runtime.preActions) await runPreActions(page, fixture.runtime.preActions);
    await pickElement(page, fixture.runtime.pickSelector || 'h1.hero-title', {
      position: fixture.runtime.pickPosition,
    });
    await clickGo(page);
    await waitForCyclingRobust(page, expectedCount, {
      agentMode: 'fake',
      preActions: fixture.runtime.preActions,
      log: (m) => t.diagnostic(m),
    });
    const manifestPath = await locateSessionFile(appRoot);
    const svelteComponentTarget = svelteComponentTargetFor(manifestPath);
    assert.ok(svelteComponentTarget, `expected a component-preview session, got ${manifestPath}`);
    return {
      session,
      manifestPath,
      svelteComponentTarget,
      sourceFile: manifestPath,
    };
  } catch (err) {
    await teardownAndResetBrowser(session.teardown);
    throw err;
  }
}

function readManifest(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

/**
 * The file the browser actually imports for a variant: the server snapshots
 * every publish into a fresh `r<N>/` dir and points the manifest at it, so the
 * session dir's copy is not what a mount reads.
 */
function revisionVariantPath(appRoot, manifestPath, variantNum) {
  const manifest = readManifest(manifestPath);
  const dir = manifest.revisionDir || manifest.componentDir;
  assert.ok(dir, 'manifest carries a preview directory');
  const extension = manifest.componentExtension || 'svelte';
  return join(appRoot, dir, `v${variantNum}.${extension}`);
}

/** Poll the session journal for events of a given type. */
async function waitForJournalEvent(appRoot, sessionId, type, timeoutMs = 15_000) {
  const journalPath = join(appRoot, '.impeccable', 'live', 'sessions', `${sessionId}.jsonl`);
  const deadline = Date.now() + timeoutMs;
  let seen = [];
  while (Date.now() < deadline) {
    seen = readJournalEvents(journalPath).filter((event) => event?.type === type);
    if (seen.length > 0) return seen;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `no ${type} event in ${journalPath} after ${timeoutMs}ms; saw types: ${
      [...new Set(readJournalEvents(journalPath).map((e) => e?.type))].join(', ') || '(none)'
    }`,
  );
}

function readJournalEvents(journalPath) {
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line)?.event || null; } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Assert the roots live.mjs resolved for an `appDir` fixture.
 *
 * The boot ran from the staged repo root, which carries no dev-server config
 * of its own. Live mode has to pick the nested app, keep PRODUCT.md/DESIGN.md
 * discovery at the git root, and leave its session state under the app plus a
 * pointer at the repo root. A repo-root server.json means the session forked
 * into a second, empty project — the failure this fixture exists to catch.
 */
function assertNestedAppRoots(session) {
  const { tmp, appRoot, appDir, liveBoot } = session;
  assert.ok(liveBoot, 'appDir fixtures boot through live.mjs and keep its payload');
  assert.equal(liveBoot.ok, true, `live.mjs boot payload: ${JSON.stringify(liveBoot)}`);

  const roots = liveBoot.roots || {};
  assert.ok(
    roots.appRoot && roots.appRoot.endsWith(`/${appDir}`),
    `roots.appRoot should end with /${appDir}, got ${roots.appRoot}`,
  );
  assertSamePath(roots.appRoot, appRoot, 'roots.appRoot');
  assertSamePath(roots.repoRoot, tmp, 'roots.repoRoot');
  assertSamePath(roots.contextRoot, tmp, 'roots.contextRoot');
  assertSamePath(liveBoot.projectRoot, appRoot, 'projectRoot');

  assert.equal(liveBoot.hasProduct, true, 'PRODUCT.md at the repo root is read from the nested app');
  assert.equal(liveBoot.hasDesign, true, 'DESIGN.md at the repo root is read from the nested app');

  assert.ok(
    existsSync(join(appRoot, '.impeccable/live/roots.json')),
    'the resolved manifest is persisted under the app',
  );
  assert.ok(
    existsSync(join(appRoot, '.impeccable/live/server.json')),
    'the live server registers itself under the app',
  );
  assert.ok(
    existsSync(join(tmp, '.impeccable/live/app-root.json')),
    'the repo root gets a pointer to the app',
  );
  assert.equal(
    existsSync(join(tmp, '.impeccable/live/server.json')),
    false,
    'no live session state may be written at the repo root',
  );
}

function assertSamePath(actual, expected, label) {
  const resolve = (p) => {
    try { return realpathSync(String(p)); } catch { return String(p); }
  };
  assert.equal(resolve(actual), resolve(expected), `${label}: ${actual} !== ${expected}`);
}

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
    writeFileSync(
      join(dir, 'failed-requests.log'),
      (session.failedRequests || []).map((f) => `${f.reason} ${f.url}`).join('\n'),
      'utf-8',
    );
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
    copyDirIfExists(join(tmp, '.impeccable', 'live', 'previews'), join(dir, 'impeccable-live-previews'));

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
  const tmp = session.appRoot;

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
  const sourceFile = await locateSessionFile(session.appRoot);
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
    `${sep}.impeccable${sep}live${sep}previews${sep}`,
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
    join(root, '.impeccable/live/previews'),
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
