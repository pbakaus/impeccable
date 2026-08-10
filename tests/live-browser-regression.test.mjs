/**
 * Static-source regression guards for live-browser.js.
 *
 * `skill/scripts/live-browser.js` is a self-contained
 * IIFE served directly to user pages by live-server.mjs (no bundle step,
 * no module exports). That makes its internal helpers untestable via
 * normal import — but a few behaviors have failed in real-world live
 * sessions in ways that are easy to express as "this exact code shape
 * MUST NOT come back." This file pins those down.
 *
 * Add a guard whenever a bug we fix has a one-line "anti-pattern" cause
 * that's easy to reintroduce on an unrelated edit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIVE_UI_COMPONENT_IDS, LIVE_UI_PREFIX } from '../skill/scripts/live/ui-surfaces.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_BROWSER = path.resolve(
  __dirname,
  '..',
  'skill/scripts/live-browser.js',
);
const SOURCE = fs.readFileSync(LIVE_BROWSER, 'utf-8');

describe('live-browser.js regression guards', () => {
  it('resolveCanvasBackground does not fall back to `getComputedStyle(...).backgroundColor || ...`', () => {
    // The browser returns the literal string `"rgba(0, 0, 0, 0)"` for an
    // unset body/html background. That string is non-empty and truthy, so a
    // `||` chain short-circuits to transparent-black, which modern-screenshot
    // hands to its WebGL shader as the canvas color and the screenshot
    // overlay flashes solid black during loading on any page that doesn't
    // explicitly set its own background. Forbid the pattern outright; the
    // correct fallback is a literal `'#ffffff'` (the browser's default
    // canvas color).
    const buggy =
      /getComputedStyle\(document\.(?:body|documentElement)\)\.backgroundColor\s*\|\|/;
    assert.ok(
      !buggy.test(SOURCE),
      'live-browser.js must not chain `getComputedStyle(...).backgroundColor || ...` — that returns transparent-black for default-bg pages and renders the screenshot overlay as solid black during loading. Use a literal fallback (`#ffffff`) instead.',
    );
  });

  it('detectPageTheme honors alpha when reading body / html backgroundColor', () => {
    // Equivalent trap: `rgba(0, 0, 0, 0)` parsed naively as `(0,0,0)` makes
    // a perfectly white default page register as "dark," which flips the
    // chrome to the wrong palette. The fix introduced an alpha guard
    // (function readOpaque) — keep that signature in source.
    assert.match(
      SOURCE,
      /function detectPageTheme\b[\s\S]{0,1500}?function readOpaque\b/,
      'detectPageTheme must keep its readOpaque helper that filters out fully-transparent backgrounds before computing luminance',
    );
  });

  it('shader bitmap decode failure keeps a visible fallback overlay', () => {
    assert.match(
      SOURCE,
      /function showShaderBitmapFallback\(canvas, blob\)[\s\S]{0,900}?fallback\.style\.backgroundImage = 'url\("' \+ objectUrl \+ '"\)';[\s\S]{0,300}?shaderState = \{ canvas: fallback,[\s\S]{0,180}?objectUrl \};/,
      'shader fallback should render the captured bitmap via a background-image div and keep its object URL revocable',
    );
    assert.match(
      SOURCE,
      /catch \(err\) \{[\s\S]{0,220}?shader bitmap decode failed[\s\S]{0,220}?showShaderBitmapFallback\(canvas, blob\);[\s\S]{0,80}?return;/,
      'createImageBitmap failures should fall back to a visible captured-bitmap overlay',
    );
    assert.doesNotMatch(
      SOURCE,
      /new Image\(/,
      'shader fallback should not use an image element fallback',
    );
  });

  it('uses a framework-component-gated painted-ancestor crop proxy for shader capture', () => {
    assert.match(
      SOURCE,
      /function findShaderProxyCaptureRoot\(el\) \{[\s\S]{0,500}?let node = el\.parentElement;[\s\S]{0,700}?containsElement && paintsShaderProxySurface\(node\)[\s\S]{0,120}?return null;/,
      'shader proxy should choose the nearest painted ancestor, not the document root',
    );
    assert.match(
      SOURCE,
      /async function captureElementFromRenderedAncestor\(ms, el, opts\) \{[\s\S]{0,360}?const captureRoot = findShaderProxyCaptureRoot\(el\);[\s\S]{0,220}?ms\.domToCanvas\(captureRoot, opts\)[\s\S]{0,900}?cctx\.drawImage\(rootCanvas, sx, sy, sw, sh, 0, 0, crop\.width, crop\.height\);/,
      'shader capture should render the minimal painted ancestor and crop the selected element rect',
    );
    assert.match(
      SOURCE,
      /function shouldUseAncestorCropShaderProxy\(el\) \{[\s\S]{0,260}?window\.__IMPECCABLE_LIVE_ADAPTER__[\s\S]{0,280}?isFrameworkComponentPreviewMode\(currentPreviewMode\) \|\| svelteComponentSession[\s\S]{0,260}?isFrameworkComponentPreviewMode\(wrapper\?\.dataset\?\.impeccablePreview\);/,
      'ancestor crop proxy must be gated to Svelte/Vue component previews',
    );
    assert.match(
      SOURCE,
      /if \(shouldUseAncestorCropShaderProxy\(el\)\) \{[\s\S]{0,240}?return await hideCaptureChromeForShaderProxy\(\(\) => captureElementFromRenderedAncestor\(ms, el, opts\)\);[\s\S]{0,280}?Svelte ancestor crop capture failed, falling back to element capture/,
      'Svelte ancestor crop must run before the legacy capture path and hide live chrome while doing so',
    );
    assert.match(
      SOURCE,
      /const paper = dominantRgb01\(cctx, crop\.width, crop\.height\) \|\| averageRgb01\(cctx, crop\.width, crop\.height\);/,
      'shader paper should come from the cropped pixels so framework/backdrop composition is preserved',
    );
    assert.match(
      SOURCE,
      /const radius = getComputedStyle\(el\)\.borderRadius;[\s\S]{0,420}?borderRadius: radius,[\s\S]{0,80}?overflow: 'hidden'/,
      'the shader canvas should clip to the selected element radius when using a rectangular ancestor crop',
    );
    assert.doesNotMatch(
      SOURCE,
      /isSemiTransparentOwnBackground|findCompositedBackdropAncestor|compositeRgbOver|cssColorToRgba01/,
      'the shader fix should not depend on semi-transparent CSS special cases',
    );
  });

  it('locks every global bar mode toggle while manual Apply is in flight', () => {
    assert.match(
      SOURCE,
      /const controlsLocked = pendingApplyInFlight === true;[\s\S]{0,120}?\[pickToggle, insertToggle, detectToggle, designToggle\]\.forEach/,
      'pending manual Apply must visually disable Pick, Insert, Detect, and Design together',
    );
    assert.match(
      SOURCE,
      /function toggleInsert\(\) \{[\s\S]{0,120}?if \(pendingApplyInFlight\) \{ showManualApplyBusyToast\(\); return; \}/,
      'Insert must have the same in-flight Apply guard as the other mode toggles',
    );
  });

  it('exits inline editing directly on outside click', () => {
    assert.match(
      SOURCE,
      /function cancelEditingToPicking\(\) \{[\s\S]{0,600}?setLiveState\('PICKING'\);/,
      'outside-click editing cancel should avoid rebuilding configure UI before hiding it',
    );
    assert.match(
      SOURCE,
      /state === 'EDITING'[\s\S]{0,180}?cancelEditingToPicking\(\);[\s\S]{0,40}?return;/,
      'outside-click handler should leave EDITING directly',
    );
  });

  it('restores unsaved inline edit drafts before hideBar tears editing down', () => {
    assert.match(
      SOURCE,
      /function hideBar\(instant\) \{[\s\S]{0,720}?if \(state === 'EDITING'\) restoreInlineEditDrafts\(\);[\s\S]{0,80}?disableInlineEdit\(\);/,
      'hideBar should not leave unsaved contenteditable drafts in the DOM when an external event hides the bar',
    );
  });

  it('discards variants without hiding the original or animating stale chrome', () => {
    assert.match(SOURCE, /function showOriginalDuringDiscard\(sessionId\)[\s\S]{0,900}?data-impeccable-variant="original"/);
    assert.match(SOURCE, /function handleDiscard\(\)[\s\S]{0,420}?cleanup\(\{ restoreOriginal: true, instantChrome: true \}\)/);
    assert.match(SOURCE, /if \(instant\) barEl\.style\.display = 'none'/);
    assert.match(
      SOURCE,
      /if \(restoreOriginal\) showOriginalDuringDiscard\(cleanupSessionId\);\s*else wrapper\.style\.display = 'none';/,
      'only non-discard cleanup may blank the wrapper while waiting for HMR',
    );
  });

  it('stores live state off the document root and preserves the selected anchor top', () => {
    assert.match(SOURCE, /window\.__IMPECCABLE_LIVE_STATE__ = next/);
    assert.doesNotMatch(SOURCE, /document\.documentElement\.dataset\.impeccableLiveState/);
    assert.match(SOURCE, /pickedAnchorViewportTop: Number\.isFinite\(pickedAnchorViewportTop\)/);
    assert.match(SOURCE, /scrollLockAnchorTop = typeof initialAnchorTop === 'number' && isFinite\(initialAnchorTop\)/);
    assert.match(SOURCE, /const anchorDelta = anchorTop - scrollLockAnchorTop/);
  });

  it('does not autofocus the steering chat while inline editing', () => {
    assert.match(
      SOURCE,
      /function shouldFocusSteerChat\(\) \{\s*return state !== 'CONFIGURING'\s*&& state !== 'EDITING'\s*&& !steerLocked;\s*\}/,
      'edit-mode contenteditable focus must not be stolen by the global steering chat focus recovery',
    );
  });

  it('keeps the Steer pill from clipping its label or the global bar exit control', () => {
    assert.match(
      SOURCE,
      /const PAGE_CHAT_COLLAPSED_W = '104px';/,
      'collapsed Steer pill should reserve enough room for icon, "Steer", and voice button',
    );
    assert.match(
      SOURCE,
      /function pageChatExpandedWidth\(\)[\s\S]{0,520}?window\.innerWidth - 16 - nonChatWidth[\s\S]{0,220}?Math\.max\(pageChatCollapsedWidthPx\(\), Math\.min\(PAGE_CHAT_EXPANDED_MAX_W, available\)\)/,
      'expanded Steer width should reserve viewport room for the rest of the global bar',
    );
    assert.match(
      SOURCE,
      /syncGlobalBarExpandedLabels\(false\);[\s\S]{0,80}?pageChatEl\.style\.width = pageChatExpandedWidth\(\);/,
      'opening Steer should collapse inactive mode labels before measuring input width',
    );
    assert.match(
      SOURCE,
      /maxWidth: 'calc\(100vw - 16px\)'[\s\S]{0,80}?boxSizing: 'border-box'/,
      'global bar should be constrained to the viewport instead of clipping the exit control offscreen',
    );
    assert.match(
      SOURCE,
      /globalBarEl = el\('div', \{[\s\S]{0,360}?width: 'max-content'/,
      'fixed-position global bar must use max-content sizing before maxWidth clamps it, or narrow panes clip the exit button',
    );
    assert.match(
      SOURCE,
      /const inner = el\('div', \{[\s\S]{0,220}?flex: '0 0 auto'/,
      'global bar inner controls must not flex-shrink and crop hover labels',
    );
    assert.match(
      SOURCE,
      /function makeIconBtn[\s\S]{0,360}?flex: '0 0 auto'[\s\S]{0,80}?minWidth: '30px'/,
      'global bar icon buttons must keep stable hitboxes when Steer expands',
    );
    assert.match(
      SOURCE,
      /applyGlobalBarLabelState\(expandInactive, pageChatExpanded\)/,
      'expanded Steer should force labels closed without shrinking the icons',
    );
  });

  it('does not autofocus the steering chat while a page editable is focused', () => {
    assert.match(
      SOURCE,
      /function isPageEditableElement\(el\) \{[\s\S]{0,160}?own\(el\)[\s\S]{0,160}?\^\(INPUT\|TEXTAREA\|SELECT\)\$[\s\S]{0,80}?el\.isContentEditable/,
      'page-owned inputs, textareas, selects, and contenteditables must be recognized before steer focus recovery runs',
    );
    assert.match(
      SOURCE,
      /function isPageEditableActive\(\) \{[\s\S]{0,120}?activeElementDeep\(\)[\s\S]{0,120}?isPageEditableElement\(active\) && !isInlineEditActive\(active\)/,
      'auto-focus recovery must check the deep active element instead of only host text selection',
    );
    assert.match(
      SOURCE,
      /function shouldSteerAutoFocus\(\) \{[\s\S]{0,160}?&& !isPageEditableActive\(\)/,
      'steer chat auto-focus must back off while the page owns an editable caret',
    );
  });

  it('pins edit badge button metrics instead of inheriting host button chrome', () => {
    const start = SOURCE.indexOf('const calloutStyle = (color, borderColor) => ({');
    const end = SOURCE.indexOf('    });', start);
    const calloutStyle = SOURCE.slice(start, end);
    assert.match(
      calloutStyle,
      /fontSize: '10px'/,
      'edit badge controls should not scale from host rem settings',
    );
    assert.match(
      calloutStyle,
      /lineHeight: '16px'/,
      'edit badge controls need the same 22px button height on pages with or without button resets',
    );
    assert.match(
      calloutStyle,
      /boxSizing: 'border-box'/,
      'edit badge controls should include padding and border in their rendered dimensions',
    );
    assert.doesNotMatch(
      calloutStyle,
      /fontSize: '0\.625rem'/,
      'edit badge controls should not depend on the host root font-size',
    );
  });

  it('does not shadow the global live state when storing Apply state', () => {
    assert.doesNotMatch(
      SOURCE,
      /function readStoredManualApplyState\(\)[\s\S]{0,240}?const state = JSON\.parse\(raw\);/,
      'stored manual Apply JSON should not shadow the outer UI state variable',
    );
    assert.doesNotMatch(
      SOURCE,
      /function writeManualApplyState\(state\)/,
      'stored manual Apply object should not shadow the outer UI state variable',
    );
  });

  it('SSE error reply clears the durable session checkpoint like discarded', () => {
    // Issue #362: `live-poll.mjs --reply <id> error "..."` is the documented
    // abort flow in reference/live.md, and an agent error reply is terminal
    // for the session it names. The 'error' case used to reset only the UI
    // (hideBar + PICKING) while the localStorage checkpoint written for the
    // GENERATING phase survived — so every reload resurrected a dead session
    // the server no longer knew about, until the user hand-cleared the
    // impeccable-live* keys in the console. The error path must tear down the
    // named session exactly like 'discarded' does (markSessionHandled +
    // cleanup, which includes clearSession), and drop a stored-but-not-
    // current checkpoint that matches the errored id.
    const errorCase = SOURCE.match(/case 'error':[\s\S]{0,2500}?setLiveState\('PICKING'\);\s*break;/);
    assert.ok(errorCase, 'expected an SSE case \'error\' handler in live-browser.js');
    assert.match(
      errorCase[0],
      /if \(msg\.id && msg\.id === currentSessionId\) \{[\s\S]{0,160}?markSessionHandled\(\);[\s\S]{0,80}?cleanup\(\);[\s\S]{0,80}?break;/,
      'an error reply naming the current session must run the same markSessionHandled + cleanup teardown as \'discarded\' so the durable checkpoint is cleared',
    );
    assert.match(
      errorCase[0],
      /if \(msg\.id && loadSession\(\)\?\.id === msg\.id\) clearSession\(\);/,
      'an error reply naming a stored-but-not-current session must drop that checkpoint so a reload cannot resurrect it',
    );
  });

  it('a late accept failure is recognized after the optimistic teardown (#384)', () => {
    // Accept is optimistic: POST /events acknowledging the intent schedules
    // cleanupAcceptedSession(), which nulls pendingAcceptedSession before
    // live-accept.mjs has actually run. When the accept later fails (missing
    // markers, preview error, receipt conflict, source_locked), the SSE
    // 'error' guard keyed on pendingAcceptedSession could no longer match,
    // so the user got only the generic error toast with no hint that their
    // variant was never written. An awaitingAcceptResult id must be set on
    // the optimistic success path, survive cleanupAcceptedSession, be
    // matched in the 'error' case with an explicit not-saved message, and
    // be released when the real accept result arrives.
    assert.match(
      SOURCE,
      /awaitingAcceptResult = \{ id: acceptedSessionId \};[\s\S]{0,400}?scheduleAcceptCleanup\(pending\);/,
      'the optimistic POST-success path must record awaitingAcceptResult before scheduling the teardown',
    );
    const errorCase = SOURCE.match(/case 'error':[\s\S]{0,2600}?setLiveState\('PICKING'\);\s*break;/);
    assert.ok(errorCase, 'expected an SSE case \'error\' handler in live-browser.js');
    assert.match(
      errorCase[0],
      /if \(awaitingAcceptResult\?\.id && msg\.id === awaitingAcceptResult\.id\) \{[\s\S]{0,700}?awaitingAcceptResult = null;[\s\S]{0,700}?may not have been saved[\s\S]{0,300}?break;/,
      'an error naming the awaited accept must clear the marker and warn that the variant may not have been saved (hedged: a carbonize-phase failure fires this after the source WAS promoted)',
    );
    // Accept unlocks at the first variant, so a late generation agent_done
    // for the same session id can arrive after Accept; only a carbonize
    // agent_done is provably accept-side and may close the window.
    const agentDoneCase = SOURCE.match(/case 'agent_done':[\s\S]{0,1200}?break;/);
    assert.ok(agentDoneCase, 'expected an SSE case \'agent_done\' handler in live-browser.js');
    assert.match(
      agentDoneCase[0],
      /msg\.data\?\.carbonize === true && awaitingAcceptResult\?\.id && msg\.id === awaitingAcceptResult\.id/,
      'agent_done must only release the awaited accept marker for carbonize completions, or a late generation agent_done reopens the #384 hole',
    );
    const cleanupFn = SOURCE.match(/function cleanupAcceptedSession\(\) \{[\s\S]{0,1200}?\n  \}/);
    assert.ok(cleanupFn, 'expected cleanupAcceptedSession in live-browser.js');
    assert.doesNotMatch(
      cleanupFn[0],
      /awaitingAcceptResult\s*=/,
      'cleanupAcceptedSession must not clear awaitingAcceptResult - surviving the teardown is the point',
    );
  });

  it('handleServerLost preserves the current recoverable phase', () => {
    assert.doesNotMatch(
      SOURCE,
      /state\s*=\s*currentSessionId\s*\?\s*['"]GENERATING['"]\s*:\s*['"]IDLE['"]/,
      'event=live_browser.server_lost_phase actor=browser operation=sse_disconnect risk=cycling_or_saving_session_saved_as_generating expected=preserve current phase actual=forced generating',
    );
    assert.match(
      SOURCE,
      /function handleServerLost\(\)[\s\S]{0,300}?const recoveryState = currentSessionId \? state : 'IDLE';[\s\S]{0,1200}?setLiveState\(recoveryState\);[\s\S]{0,120}?if \(currentSessionId\) saveSession\(\);/,
      'server-lost cleanup should keep the current session phase in local recovery state instead of rewriting it to GENERATING',
    );
  });

  it('server-lost toast frames the disconnect as resumable, not ended', () => {
    assert.doesNotMatch(
      SOURCE,
      /Live server disconnected\. Session ended\./,
      'the "Session ended" copy made agents rationalize bailing to direct edits; the session is resumable',
    );
    assert.match(
      SOURCE,
      /Live server connection lost\. Your session is saved;[^']*restart live-poll\.mjs to continue\./,
      'server-lost toast should tell the user the session is saved and how to continue',
    );
  });

  it('the agent-phase progress bar advances monotonically', () => {
    // A behind/resumed checkpoint must not move the visible bar backward.
    assert.doesNotMatch(
      SOURCE,
      /generationPhase = msg\.phase \|\| generationPhase;/,
      'raw phase assignment lets a behind checkpoint regress the visible bar to an earlier phase',
    );
    assert.match(
      SOURCE,
      /case 'agent_phase':[\s\S]{0,400}?if \(shouldAdvancePhase\(generationPhase, msg\.phase\)\) generationPhase = msg\.phase;/,
      'agent_phase should only advance the phase when it moves forward',
    );
    // The rank table must order the lifecycle so scaffolding/source_ready sit
    // below generating and the reviewable phases.
    assert.match(SOURCE, /function shouldAdvancePhase\(current, next\)/);
    assert.match(
      SOURCE,
      /scaffolding: 2,[\s\S]{0,120}?source_ready: 4,[\s\S]{0,120}?(generation_ready|generating): 5,/,
      'scaffolding and source_ready must rank below generating',
    );
  });

  it('source reinjection preserves the visible variant after cycling', () => {
    assert.doesNotMatch(
      SOURCE,
      /Replace the live element[\s\S]{0,900}?visibleVariant\s*=\s*1;\s*showVariantInDOM\(sessionId,\s*1\);/,
      'event=live_browser.visible_variant_reset actor=browser operation=hmr_source_reinject risk=late_hmr_accepts_variant_1_after_user_cycles expected=preserve visible variant actual=reset_to_first',
    );
    assert.match(
      SOURCE,
      /previousVisibleVariant[\s\S]{0,900}?savedVisibleVariant[\s\S]{0,500}?showVariantInDOM\(sessionId, visibleVariant\);/,
      'source reinjection should preserve the in-memory or saved visible variant instead of always showing variant 1',
    );
  });

  it('suppresses scroll anchoring via a stylesheet rule, not inline html/body style', () => {
    // The scroll lock disables the browser's scroll-anchoring on the scroll
    // root so it can't fight our manual scroll correction. Doing that by
    // mutating `document.documentElement.style` / `document.body.style`
    // inline makes React 19 report a hydration mismatch on the next
    // Fast-Refresh re-render: <html>/<body> are server-rendered by frameworks
    // like Next.js App Router, so a client-only inline `style` the server HTML
    // never emitted trips "a tree hydrated but some attributes ... didn't
    // match." That surfaced as a console.error and failed the
    // nextjs-app-router live-e2e fixture's expectConsoleClean probe. The fix
    // injects a <style> rule with the same computed effect instead.
    assert.doesNotMatch(
      SOURCE,
      /document\.documentElement\.style\.overflowAnchor\s*=/,
      'event=live_browser.scroll_anchor_hydration actor=browser operation=start_scroll_lock risk=react19_hydration_mismatch_on_next_app_router expected=stylesheet_rule actual=inline_style_on_html',
    );
    assert.doesNotMatch(
      SOURCE,
      /document\.body\.style\.overflowAnchor\s*=/,
      'scroll lock must not mutate <body> inline overflowAnchor — it desyncs server/client hydration on SSR frameworks',
    );
    assert.match(
      SOURCE,
      /const SCROLL_ANCHOR_LOCK_ID = 'impeccable-scroll-anchor-lock';/,
      'the anchor-suppression style needs a stable id constant so it can be created and removed by id',
    );
    assert.match(
      SOURCE,
      /document\.getElementById\(SCROLL_ANCHOR_LOCK_ID\);[\s\S]{0,400}?createElement\('style'\)[\s\S]{0,400}?overflow-anchor:none[\s\S]{0,400}?\(document\.head \|\| document\.documentElement\)\.appendChild/,
      'the scroll lock must suppress scroll anchoring with an injected <style> rule keyed by SCROLL_ANCHOR_LOCK_ID',
    );
    assert.match(
      SOURCE,
      /scrollLockAbort\.signal\.addEventListener\('abort', \(\) => \{\s*document\.getElementById\(SCROLL_ANCHOR_LOCK_ID\)\?\.remove\(\);/,
      'stopping the scroll lock must remove the injected anchor-suppression <style> so it never outlives the session',
    );
  });

  it('drives variant visibility and --p-* params through a stylesheet, not inline SSR element mutation', () => {
    // Variant divs live in page source, so Next.js App Router server-renders
    // them. Toggling hidden/style.display/--p-* on those nodes client-side
    // makes React 19 report a hydration mismatch on the next Fast-Refresh
    // re-render — the same failure mode as scroll-anchor (#276) and pick-cursor
    // (#286). Visibility and range/toggle custom properties must go through an
    // injected <style> rule instead.
    assert.doesNotMatch(
      SOURCE,
      /function setVariantShown\(/,
      'event=live_browser.variant_visibility_hydration actor=browser operation=show_variant_in_dom risk=react19_hydration_mismatch_on_next_app_router expected=stylesheet_rule actual=hidden_and_inline_display_on_variant_div',
    );
    assert.match(
      SOURCE,
      /if \(svelteComponentSession\?\.sessionId === currentSessionId\)[\s\S]{0,280}?variantEl\.style\.setProperty\('--p-'/,
      'client-mounted Svelte component variants drive --p-* inline (no SSR div, no hydration), unlike server-rendered variant divs',
    );
    assert.match(
      SOURCE,
      /function applyParamValue\([\s\S]{0,1200}?svelteComponentSession\?\.sessionId === currentSessionId[\s\S]{0,400}?return;[\s\S]{0,400}?updateVariantStateStylesheet\(currentSessionId, visibleVariant\)/,
      'applyParamValue must short-circuit the Svelte inline path before the SSR stylesheet path',
    );
    assert.match(
      SOURCE,
      /const VARIANT_STATE_STYLE_ID = 'impeccable-variant-state';/,
      'the variant-state style needs a stable id constant so it can be created and removed by id',
    );
    assert.match(
      SOURCE,
      /const VARIANT_HIDE_DECL = 'display: none !important;';/,
      'the hidden-variant rule should be a named constant for readability',
    );
    assert.match(
      SOURCE,
      /function updateVariantStateStylesheet\(sessionId, num\)[\s\S]{0,500}?createElement\('style'\)[\s\S]{0,500}?VARIANT_HIDE_DECL/,
      'variant cycling must hide non-visible variants with an injected <style> rule keyed by VARIANT_STATE_STYLE_ID',
    );
    assert.match(
      SOURCE,
      /function removeVariantStateStylesheet\(\)[\s\S]{0,120}?document\.getElementById\(VARIANT_STATE_STYLE_ID\)\?\.remove\(\)/,
      'leaving CYCLING or tearing down live mode must remove the injected variant-state <style>',
    );
    assert.doesNotMatch(
      SOURCE,
      /function refreshParamsPanel\(\)[\s\S]{0,220}?if \(state !== 'CYCLING'\)[\s\S]{0,220}?removeVariantStateStylesheet\(\)/,
      'refreshParamsPanel must not strip the variant-state sheet during GENERATING first-reveal',
    );
    assert.match(
      SOURCE,
      /function refreshParamsPanel\(\)[\s\S]{0,600}?if \(!variantEl \|\| params\.length === 0\)[\s\S]{0,220}?updateVariantStateStylesheet\(currentSessionId, visibleVariant\)/,
      'paramless variant switches must re-sync the variant-state sheet to clear stale --p-* params',
    );
    assert.match(
      SOURCE,
      /function isVariantShown\(el\)[\s\S]{0,120}?getComputedStyle\(el\)\.display/,
      'visible-variant detection must read computed display, not el.hidden or el.style.display',
    );
  });

  it('global bar includes expandable page chat affordance', () => {
    assert.match(
      SOURCE,
      /function initPageChat\(/,
      'live-browser must mount a page-level chat control in the global bar',
    );
    assert.match(
      SOURCE,
      /pageChatEl\.id = PREFIX \+ '-page-chat'/,
      'page chat container needs a stable id for future wiring and tests',
    );
    assert.match(
      SOURCE,
      /function syncPageChatFocus\(reason\)[\s\S]{0,220}?if \(state === 'CONFIGURING'\) focusConfigureInput\(reason\);[\s\S]{0,120}?else if \(shouldSteerAutoFocus\(\)\) focusSteerChat\(reason\);/,
      'focus configure input while configuring; steer auto-focus unless page text is selected',
    );
    assert.match(
      SOURCE,
      /function steerFocusLog\(reason, extra\)/,
      'steer focus attempts should be logged for debugging before adding retries',
    );
    assert.match(
      SOURCE,
      /function submitSteerMessage\(\)[\s\S]{0,1200}?type: 'steer'/,
      'steer submit must post a steer event to the live poller',
    );
    assert.match(
      SOURCE,
      /case 'steer_done':[\s\S]{0,80}?maybeCompleteSteer\(msg\)/,
      'steer_done SSE must unlock the chat bar',
    );
    assert.match(
      SOURCE,
      /function toggleSteerVoice\(\)/,
      'steer voice must toggle Web Speech recognition from the mic button',
    );
    assert.match(
      SOURCE,
      /webkitSpeechRecognition|SpeechRecognition/,
      'steer voice must use the Web Speech API',
    );
    assert.doesNotMatch(
      SOURCE,
      /Voice mode coming soon/,
      'steer voice placeholder toast must not ship once voice is wired',
    );
    assert.match(
      SOURCE,
      /function isEmbeddedPreviewBrowser\(\)/,
      'steer voice must detect embedded preview browsers (Cursor/Electron)',
    );
    assert.match(
      SOURCE,
      /steerVoiceUnavailableMessage\(\)/,
      'steer voice must explain when preview browsers cannot reach speech services',
    );
    assert.doesNotMatch(
      SOURCE,
      /Handing off|pageChatHint\.textContent = 'Working'/,
      'steer processing state should use dots-only animation, not truncated text',
    );
    assert.match(
      SOURCE,
      /function buildSteerProcessingDots\(\)[\s\S]{0,500}?justifyContent: 'flex-end'[\s\S]{0,220}?marginLeft: 'auto'/,
      'steer processing dots should stay aligned to the input trailing edge',
    );
    assert.match(
      SOURCE,
      /function syncAgentPollingUi\(/,
      'global bar brand must reflect agent poll connectivity',
    );
    // The indicator goes quiet both when nobody is polling and when the agent
    // holds leased work. Under one-shot foreground polling the second case is
    // every normal generation, so a single "run live-poll.mjs to connect" tip
    // told users to fix a healthy session.
    assert.match(
      SOURCE,
      /function agentHasWorkInFlight\(\)\s*\{\s*return state === 'GENERATING' \|\| state === 'SAVING';/,
      'agent poll copy must distinguish a busy agent from an absent one',
    );
    assert.match(
      SOURCE,
      /agentHasWorkInFlight\(\) \? AGENT_BUSY_TIP : AGENT_DISCONNECTED_TIP/,
      'a busy agent must not be described as disconnected',
    );
    assert.match(
      SOURCE,
      /tip\.textContent = agentStatusText\(\)/,
      'tooltip copy must be derived at display time, not read from a cache the 5s status poll last wrote',
    );
    assert.match(
      SOURCE,
      /case 'agent_polling':/,
      'browser must listen for agent_polling SSE updates',
    );
    assert.match(
      SOURCE,
      /function showAgentPollTooltip\(/,
      'disconnected agent state must use an instant custom tooltip on brand hover',
    );
    assert.match(
      SOURCE,
      /function scheduleSteerFocusRecover\(reason\)/,
      'steer focus must reschedule after page clicks once selection/pause gates clear',
    );
    assert.match(
      SOURCE,
      /steer-blur-recover/,
      'steer blur should recover focus for type-to-steer when not selecting page text',
    );
    assert.match(
      SOURCE,
      /function syncPageChatFocusRing\(\)[\s\S]{0,900}?typingReady[\s\S]{0,500}?pageChatInput\.style\.opacity = '1'/,
      'collapsed steer focus must reveal the real input and caret instead of a patina truncated label',
    );
    assert.match(
      SOURCE,
      /armPageChatForTyping\([\s\S]{0,120}?expand: true/,
      'steer pill pointerdown must expand before click so focus never flashes a dead collapsed state',
    );
    assert.match(
      SOURCE,
      /function syncPageChatChrome\(\)[\s\S]{0,400}?pageChatEl\.style\.borderColor = 'transparent'/,
      'steer pill must stay borderless; surface contrast carries the affordance',
    );
    assert.match(
      SOURCE,
      /floating bar surface IS the input; modifier pills sit left of the field/,
      'element configure bar must use the bar surface as the input, not a nested field',
    );
  });

  it('empty configure and steer inputs passthrough arrow nav to handleKeyDown', () => {
    assert.match(
      SOURCE,
      /function shouldPassthroughElementNav\(deepActive, e\)[\s\S]{0,500}?PREFIX \+ '-input' && state === 'CONFIGURING'/,
      'configure prompt must passthrough empty arrow keys for sibling navigation',
    );
    assert.match(
      SOURCE,
      /function shouldPassthroughElementNav\(deepActive, e\)[\s\S]{0,700}?PREFIX \+ '-page-chat-input' && state === 'PICKING'/,
      'steer prompt must passthrough empty arrow keys while picking',
    );
    assert.match(
      SOURCE,
      /&& !shouldPassthroughElementNav\(deepActive, e\)/,
      'global input guard must honor empty-input arrow passthrough',
    );
  });

  it('lets page editables keep Enter and arrow keydown events', () => {
    const start = SOURCE.indexOf('function handleKeyDown(e)');
    const pendingApplyStart = SOURCE.indexOf('if (pendingApplyInFlight)', start);
    const guardSource = SOURCE.slice(start, pendingApplyStart);
    assert.match(
      guardSource,
      /isPageEditableElement\(deepActive\) && !isInlineEditActive\(deepActive\)[\s\S]{0,40}?return;/,
      'page-owned editables must short-circuit global key handling before variant navigation or accept handling',
    );
    assert.match(
      guardSource,
      /e\.target\.isContentEditable && isInlineEditActive\(e\.target\)/,
      'impeccable inline edit rows must keep their existing Escape-cancel path',
    );
  });

  it('configure input Escape tears down annotation overlay before returning to picking', () => {
    // The configure prompt auto-focuses. While focused, the global keydown
    // handler bails on own() inputs, so this local Escape path must hide the
    // annotation overlay. Leaving it active strands a crosshair layer that
    // flashes comment pins on every click after pick mode is turned off.
    assert.match(
      SOURCE,
      /input\.addEventListener\('keydown', \(e\) => \{[\s\S]{0,400}?if \(e\.key === 'Escape'\) \{[\s\S]{0,200}?exitConfigureToPicking\('configure-input-escape'\)/,
      'configure input Escape must call exitConfigureToPicking so annot overlay is removed',
    );
    assert.match(
      SOURCE,
      /function togglePick\(\)[\s\S]{0,500}?teardownConfigureChrome\(\);/,
      'togglePick off must tear down configure chrome so a stuck annot overlay cannot survive IDLE',
    );
  });

  it('pick mode preference persists in localStorage', () => {
    assert.match(
      SOURCE,
      /const INTERACTION_PREFS_KEY = 'impeccable-live-interaction';[\s\S]{0,3000}?function saveInteractionPrefs\(\)/,
      'pick/insert interaction prefs must persist in localStorage',
    );
    assert.match(
      SOURCE,
      /function togglePick\(\)[\s\S]{0,200}?saveInteractionPrefs\(\);/,
      'togglePick must persist interaction prefs',
    );
    assert.match(
      SOURCE,
      /function toggleInsert\(\)[\s\S]{0,800}?saveInteractionPrefs\(\);/,
      'toggleInsert must persist interaction prefs',
    );
    assert.match(
      SOURCE,
      /if \(state === 'IDLE' && \(pickActive \|\| insertActive\)\) setLiveState\('PICKING'\);/,
      'SSE connected must arm insert mode when saved preference has insert on',
    );
  });

  it('detect mode shows an empty result toast once per requested scan', () => {
    assert.match(
      SOURCE,
      /const DETECT_EMPTY_MESSAGE = 'No detector issues found\.';/,
      'live detector zero result copy should live in one named constant',
    );
    assert.match(
      SOURCE,
      /function requestDetectScan\(\)[\s\S]{0,240}?const scanId = String\(\+\+detectScanSeq\);[\s\S]{0,80}?activeDetectScanId = scanId;[\s\S]{0,160}?config: \{ scanId \}/,
      'Detect scans must send a fresh scan id to the detector',
    );
    assert.match(
      SOURCE,
      /if \(!detectActive\) return;[\s\S]{0,80}?if \(activeDetectScanId && e\.data\.scanId !== activeDetectScanId\) return;/,
      'live detector results must ignore inactive and stale scan ids',
    );
    assert.match(
      SOURCE,
      /if \(detectActive && pendingDetectScanId && detectCount === 0\) \{[\s\S]{0,80}?showToast\(DETECT_EMPTY_MESSAGE, 3200\);[\s\S]{0,120}?pendingDetectScanId = null;/,
      'a matching zero result scan must use the existing toast UI and clear the pending scan id',
    );
    assert.match(
      SOURCE,
      /window\.postMessage\(\{ source: 'impeccable-command', action: 'remove' \}, '\*'\);[\s\S]{0,80}?activeDetectScanId = null;[\s\S]{0,80}?pendingDetectScanId = null;/,
      'turning Detect off must clear scan ids',
    );
  });

  it('toast enter and dismiss timers only touch the current toast element', () => {
    assert.match(
      SOURCE,
      /function showToast\(message, duration\)[\s\S]{0,1200}?const currentToast = el\('div'/,
      'showToast must capture the created toast in a local so delayed callbacks cannot dereference or remove a stale global toastEl',
    );
    assert.match(
      SOURCE,
      /requestAnimationFrame\(\(\) => \{[\s\S]{0,80}?if \(toastEl !== currentToast\) return;[\s\S]{0,120}?currentToast\.style\.opacity = '1';/,
      'toast enter rAF must no-op when dismissToast or a newer toast replaced toastEl before the frame fires',
    );
    assert.match(
      SOURCE,
      /setTimeout\(\(\) => \{[\s\S]{0,80}?if \(toastEl !== currentToast\) return;[\s\S]{0,120}?currentToast\.style\.opacity = '0';/,
      'toast auto-dismiss timer must not animate a newer toast created after this timer was scheduled',
    );
    assert.match(
      SOURCE,
      /setTimeout\(\(\) => \{[\s\S]{0,80}?if \(toastEl !== currentToast\) return;[\s\S]{0,80}?currentToast\.remove\(\);[\s\S]{0,80}?toastEl = null;/,
      'toast removal timer must only remove and clear the same toast it scheduled',
    );
    assert.doesNotMatch(
      SOURCE,
      /requestAnimationFrame\(\(\) => \{\s*toastEl\.style/,
      'toast enter rAF must not read toastEl.style directly after dismissToast can null it',
    );
  });

  it('insert mode UI and generate payload guards', () => {
    assert.match(SOURCE, /function toggleInsert\(\)/, 'global bar must expose insert toggle');
    assert.match(SOURCE, /PREFIX \+ '-insert-toggle'/, 'insert toggle needs stable id');
    assert.match(SOURCE, /function buildInsertConfigureRow\(\)/, 'insert configure bar required');
    assert.match(SOURCE, /function handleInsertCreate\(\)/, 'insert create handler required');
    assert.match(SOURCE, /mode: 'insert'/, 'insert generate must set mode insert');
    assert.match(SOURCE, /function syncInsertCreateButton\(btn, input\)/, 'Create button must reflect prompt/annotation gate');
    assert.match(
      SOURCE,
      /syncInsertCreateButton\(create, input\)/,
      'Create gate must sync before the row is attached to the document',
    );
    assert.match(SOURCE, /function showInsertCreateTooltip\(/, 'Create disabled state uses a custom hover tooltip');
    assert.match(
      SOURCE,
      /function buildCyclingRow\(\)[\s\S]*?background: C\.brand, color: C\.ink/,
      'Accept button uses lacquer-deep text on kinpaku gold',
    );
    assert.match(SOURCE, /insertCreateDisabledReason/, 'disabled Create hover must explain why');
    assert.match(SOURCE, /data-impeccable-insert-placeholder/, 'placeholder element must be marked');
    assert.match(
      SOURCE,
      /showHighlight\(el\)[\s\S]{0,120}?data-impeccable-insert-placeholder/,
      'pick highlight must not stack on insert placeholder',
    );
    assert.match(SOURCE, /border: '2px dotted ' \+ BP\.accent/, 'placeholder border matches insert line (dotted)');
    assert.match(
      SOURCE,
      /function syncPageInteractionCursor\(\)[\s\S]{0,420}?cursorForInsertAxis/,
      'insert picking cursor follows row/column axis',
    );
    // The pick / insert cursor must be driven by an injected <style>, never by a
    // class or inline style on <html>. <html>/<body> are server-rendered by
    // frameworks like Next.js App Router, so a client-only attribute the server
    // HTML never emitted trips React 19's "a tree hydrated but some attributes
    // ... didn't match" on the next Fast-Refresh re-render — surfacing as a
    // console.error that fails the nextjs-app-router live-e2e expectConsoleClean
    // probe. Same fix shape as the scroll-anchor lock above.
    assert.doesNotMatch(
      SOURCE,
      /document\.documentElement\.classList\.(?:add|remove|toggle)\(/,
      'event=live_browser.pick_cursor_hydration actor=browser operation=sync_page_interaction_cursor risk=react19_hydration_mismatch_on_next_app_router expected=stylesheet_rule actual=class_on_html',
    );
    assert.match(
      SOURCE,
      /const PICK_CURSOR_STYLE_ID = PREFIX \+ '-pick-cursor-style';/,
      'the pick-cursor style needs a stable id constant so it can be created and removed by id',
    );
    assert.match(
      SOURCE,
      /function setPageInteractionCursor\(cursor\)[\s\S]{0,700}?cursor: ' \+ cursor \+ ' !important/,
      'pick / insert cursor is applied through the injected <style> textContent, keyed by PICK_CURSOR_STYLE_ID',
    );
    assert.match(
      SOURCE,
      /cursor = 'crosshair'/,
      'pick mode uses a crosshair cursor that wins over page pointer styles',
    );
    assert.match(
      SOURCE,
      /document\.getElementById\(PICK_CURSOR_STYLE_ID\)\?\.remove\(\)/,
      'exiting live mode removes the injected pick-cursor <style> so it never outlives the session',
    );
    assert.match(SOURCE, /function hitSiblingInsertGap\(/, 'insert mode detects gaps between siblings');
    assert.match(SOURCE, /function resolveInsertHover\(/, 'insert hover resolves axis-aware boundaries');
    assert.match(SOURCE, /data-impeccable-placeholder-resize/, 'placeholder edge handles on annotation overlay');
    assert.match(SOURCE, /resizeEdge && configureKind === 'insert'/, 'resize takes priority over draw');
    assert.match(SOURCE, /cursorForPlaceholderEdge\(spec\.edge\)/, 'edge handles use resize cursors');
    assert.match(
      SOURCE,
      /create\.id = PREFIX \+ '-insert-create'/,
      'Create button id must be set on the element, not passed to el() styles',
    );
    assert.doesNotMatch(
      SOURCE,
      /buildInsertConfigureRow[\s\S]{0,1200}?toggleActionPicker/,
      'insert configure bar must not include action picker',
    );
    assert.match(
      SOURCE,
      /buildInsertConfigureRow[\s\S]*?buildConfigureCountControl\(/,
      'insert count toggle uses the same inline bar control as configure mode',
    );
    assert.match(
      SOURCE,
      /buildInsertConfigureRow[\s\S]*?buildConfigureSubmitButton\(/,
      'insert Create button must match input height',
    );
    assert.match(SOURCE, /function resolveBarAnchor\(\)/, 'bar positions from a connected anchor');
    assert.match(SOURCE, /function finalizeInsertSession\(\)/, 'insert placeholder outlives capture');
    assert.match(SOURCE, /function placeholderSizing\(/, 'insert placeholder picks implicit vs explicit width');
    assert.match(SOURCE, /applyPlaceholderSizingStyles\(placeholder, sizing\)/, 'placeholder width styles applied by kind');
    assert.match(
      SOURCE,
      /function createInsertPlaceholder[\s\S]*?applyPlaceholderSizingStyles\(placeholder, sizing\)/,
      'createInsertPlaceholder must not always set parent pixel width',
    );
    assert.doesNotMatch(
      SOURCE,
      /sendEvent\(screenshotPath[\s\S]{0,200}?removeInsertPlaceholder/,
      'capture must not remove insert placeholder before variants land',
    );
    assert.match(
      SOURCE,
      /function updateVariantStateStylesheet\(sessionId, num\)[\s\S]{0,900}?VARIANT_HIDE_DECL/,
      'variant cycling must hide non-visible variants via injected stylesheet, not hidden/style.display on SSR divs',
    );
    assert.match(
      SOURCE,
      /count > 0 \? pickVariantContent\(wrapper, visibleVariant \|\| 1\) : null/,
      'insert HMR re-anchor must not drop placeholder until variants exist',
    );
    assert.match(
      SOURCE,
      /function ensureInsertPlaceholder\(\)/,
      'insert generating must recreate placeholder after scaffold HMR',
    );
    assert.match(
      SOURCE,
      /insertPlaceholder: insertPlaceholderSnapshot/,
      'insert placeholder snapshot must persist across HMR resume',
    );
  });

  it('handleAccept reads the visible DOM variant before sending accept', () => {
    assert.match(
      SOURCE,
      /function readVisibleVariantFromDOM\(sessionId\)[\s\S]{0,900}?isVariantShown\(variant\)[\s\S]{0,500}?return idx;/,
      'live-browser should be able to derive the accepted variant from the currently visible DOM node',
    );
    assert.match(
      SOURCE,
      /function handleAccept\(\)[\s\S]{0,360}?const domVisibleVariant = readVisibleVariantFromDOM\(currentSessionId\);[\s\S]{0,120}?if \(domVisibleVariant > 0\) visibleVariant = domVisibleVariant;[\s\S]{0,160}?variantId: String\(visibleVariant\)/,
      'event=live_browser.accept_stale_visible_variant actor=browser operation=accept_after_hmr risk=accept_sends_variant_1_after_user_cycles_to_2 expected=read_dom_visible_variant actual=stale_state_variable',
    );
  });

  it('configure row groups selection and input on the left, trailing controls before submit', () => {
    assert.match(
      SOURCE,
      /function configureModifierPillStyle\(extra = \{\}\)[\s\S]{0,480}?background: 'transparent'[\s\S]{0,120}?color: P\.textDim/,
      'configure modifier chips use muted global-bar idle chrome, not active gold',
    );
    assert.match(
      SOURCE,
      /const CONFIGURE_ROW_TRACK_H = '18px'/,
      'configure row shares one text track height across pills and input',
    );
    assert.match(
      SOURCE,
      /function configureInputFieldStyle\(extra = \{\}\)[\s\S]{0,320}?height: CONFIGURE_ROW_TRACK_H/,
      'configure input uses the same track height as modifier pills',
    );
    assert.match(
      SOURCE,
      /const CONFIGURE_PILL_PAD_Y = '3px'/,
      'modifier pills share 3px vertical padding',
    );
    assert.match(
      SOURCE,
      /function configureInputShellStyle\(\)[\s\S]{0,200}?alignItems: 'center'[\s\S]{0,120}?padding: '0 6px 0 ' \+ CONFIGURE_BAR_INSET/,
      'configure shell vertically centers the row; inset matches centered pill margin',
    );
    assert.match(
      SOURCE,
      /inputShell\.appendChild\(buildSelectionPill[\s\S]{0,120}?inputShell\.appendChild\(input\)/,
      'selection pill and prompt input share the left side of the bar',
    );
    assert.match(
      SOURCE,
      /buildConfigureTrailingCluster\(\[action, count\], voiceBtn, go\)/,
      'freeform and variant count sit just left of voice and submit',
    );
  });

  it('configure bar keeps selection pill, inline controls, outline, and instant tooltips', () => {
    assert.match(SOURCE, /function buildSelectionPill\(/, 'selected element tag lives in the configure bar');
    assert.match(SOURCE, /CONFIGURE_SELECTION_PILL_PAD = '1px 4px'/, 'selection pill uses 1px 4px padding');
    assert.match(
      SOURCE,
      /function configureSelectionPillStyle\(extra = \{\}\)[\s\S]{0,400}?color: P\.patina/,
      'selection pill label uses patina text color',
    );
    assert.doesNotMatch(
      SOURCE,
      /function configureSelectionPillStyle\(extra = \{\}\)[\s\S]{0,400}?minHeight:/,
      'selection pill must not impose a min-height',
    );
    assert.match(
      SOURCE,
      /gridArea: '1 \/ 1'/,
      'selection pill swaps tag and clear faces without resizing the bar',
    );
    assert.match(
      SOURCE,
      /function shouldShowHighlightTagTooltip\(\)[\s\S]{0,160}?state !== 'CONFIGURING'/,
      'configure mode keeps the outline but drops the floating tag tooltip',
    );
    assert.match(SOURCE, /function buildConfigureActionControl\(/, 'action dropdown is an inline bar control, not a pill');
    assert.match(SOURCE, /function buildConfigureCountControl\(/, 'variant count is an inline bar control, not a pill');
    assert.match(
      SOURCE,
      /const hiTarget = resolveBarAnchor\(\);[\s\S]{0,200}?showHighlight\(hiTarget\);/,
      'scroll tracking keeps the element outline visible while configuring',
    );
    assert.match(SOURCE, /function showConfigureBarTooltip\(/, 'configure controls use instant custom tooltips');
    assert.doesNotMatch(
      SOURCE,
      /count\.title = controlsLocked \? 'Apply is still running' : 'Variants: click to change'/,
      'variant count must not rely on native title tooltips',
    );
  });

  it('variant count pill cycles through x1', () => {
    assert.match(
      SOURCE,
      /function cycleSelectedCount\(\)[\s\S]{0,200}?selectedCount = VARIANT_COUNT_MIN/,
      'variant count must wrap back to x1 after the max',
    );
    assert.doesNotMatch(
      SOURCE,
      /selectedCount >= 4 \? 2/,
      'variant count must not skip x1 by wrapping 4 back to 2',
    );
  });

  it('makes every arrived progressive variant immediately actionable', () => {
    assert.match(
      SOURCE,
      /if \(arrivedVariants > 0\) \{[\s\S]{0,180}?setLiveState\('CYCLING'\)/,
      'the first arrived variant should leave the generating-only state',
    );
    assert.doesNotMatch(
      SOURCE,
      /arrivedVariants < expectedVariants\) \{[\s\S]{0,180}?accept\.style\.pointerEvents = 'none'/,
      'Accept must not wait for variants the user did not choose',
    );
    assert.doesNotMatch(
      SOURCE,
      /arrivedVariants < expectedVariants\) \{[\s\S]{0,180}?discard\.style\.pointerEvents = 'none'/,
      'Discard must cancel remaining work immediately',
    );
    assert.match(
      SOURCE,
      /const resumedState = arrivedVariants > 0 \? 'CYCLING' : 'GENERATING'/,
      'reload recovery should preserve a partially delivered review state',
    );
    assert.match(
      SOURCE,
      /arrivedVariants >= expectedVariants && expectedVariants > 0[\s\S]{0,100}?\? 'variants_ready'[\s\S]{0,60}?: 'variants_progress'/,
      'checkpoint timing must distinguish partial review from complete delivery by counts',
    );
  });

  it('keeps deferred Tune controls visible and refreshes params-only publications', () => {
    assert.match(
      SOURCE,
      /const paramsPending = !hasParams && \(parameterGenerationState === 'pending' \|\| parameterGenerationState === 'loading'\)/,
      'the cycling bar must expose Tune while parameter generation is outstanding',
    );
    assert.match(SOURCE, /tune\.disabled = true/, 'pending Tune must be visibly loading but non-interactive');
    assert.match(SOURCE, /Tune controls are ready\./, 'parameter arrival needs a clear ready indication');
    // Source-mode DOM injection is gated to the `done` branch (it races
    // framework ownership mid-generation), but a params-only publication must
    // still flip the Tune controls into their loading state on the checkpoint.
    assert.match(
      SOURCE,
      /case 'variant_progress':[\s\S]{0,120}?if \(msg\.publicationKind === 'params'\) parameterGenerationState = 'loading';/,
      'a params-only publication must mark Tune controls loading even though the variant count is unchanged',
    );
    assert.match(SOURCE, /revisionDomain: 'browser'/, 'browser checkpoints must use their own revision domain');
  });

  it('promotes an early-accepted Svelte preview before releasing the picker', () => {
    assert.match(
      SOURCE,
      /function scheduleAcceptCleanup\(accepted\) \{[\s\S]{0,420}?if \(accepted\?\.isSvelteComponent\) \{[\s\S]{0,120}?commitAcceptedSvelteComponentToDom\(accepted\.id\);[\s\S]{0,120}?cleanupAcceptedSession\(\);/,
      'Svelte early accept must tear down its adapter mount before the next picking session starts',
    );
  });

  it('variant injection resolves the picked anchor before entering recovery', () => {
    assert.match(
      SOURCE,
      /function resolveLiveInjectionAnchor\(originalMarkup\)/,
      'variant source fallback must try the live picked element before giving up on anchor resolution',
    );
    assert.match(
      SOURCE,
      /pickedAnchor: pickedAnchorSnapshot/,
      'picked anchor snapshot must persist in session storage for resume and reinjection',
    );
    assert.doesNotMatch(
      SOURCE,
      /showToast\('Variants ready\. Reveal the selected element to resume\.'/,
      'recovery chrome already shows this message in the generating bar; a duplicate toast stacks two bars',
    );
  });

  it('uses dark ink for every control filled with kinpaku gold in the Tune drawer', () => {
    assert.match(
      SOURCE,
      /background: tuneOpen \? C\.brand : BP\.hairline,[\s\S]{0,100}?color: tuneOpen \? C\.ink : 'inherit'/,
      'the active Tune count badge needs dark ink on gold',
    );
    assert.match(
      SOURCE,
      /background: active \? C\.brand : 'transparent',[\s\S]{0,100}?color: active \? C\.ink : P\.text/,
      'active segmented options need dark ink on gold',
    );
    assert.match(
      SOURCE,
      /btn\.style\.background = on \? C\.brand : 'transparent';\s*btn\.style\.color = on \? C\.ink : P\.text;/,
      'segmented options must keep dark ink after interaction',
    );
    assert.match(
      SOURCE,
      /const knob = el\('span',[\s\S]{0,300}?background: C\.ink/,
      'the toggle knob needs a visible dark edge against gold',
    );
  });

  it('acknowledges every successful component mount back to the server', () => {
    // `arrivedVariants` counts what the agent published. Without this ack the
    // server has no way to tell "the user is comparing three variants" from
    // "three modules 404'd and the page is blank".
    assert.match(
      SOURCE,
      /reportVariantMounted\(sessionId, variantNum, moduleUrl\);/,
      'a successful mount must post variant_mounted so the journal carries render truth',
    );
    assert.match(
      SOURCE,
      /function reportVariantMounted\([\s\S]{0,400}?sendEvent\(\{\s*type: 'variant_mounted',/,
      'variant_mounted must go through the normal event POST helper',
    );
  });

  it('reports mount failures to the server instead of only logging them', () => {
    assert.match(
      SOURCE,
      /console\.error\('\[impeccable\] Failed to mount component variant[\s\S]{0,200}?reportVariantMountFailed\(sessionId, variantNum, moduleUrl, err\);/,
      'event=live_browser.silent_mount_failure actor=browser operation=mount_component_variant risk=agent_never_learns_render_failed expected=variant_mount_failed posted actual=console.error only',
    );
    assert.match(
      SOURCE,
      /function reportVariantMountFailed\([\s\S]{0,900}?sendEvent\(\{ type: 'variant_mount_failed', id: sessionId, variant, url, error: message \}\);/,
      'variant_mount_failed must carry the failed module URL and the error text',
    );
    // Both the first mount and a variant switch route through this one catch,
    // so the switch path can no longer revert with zero feedback.
    assert.match(
      SOURCE,
      /reportVariantMountFailed\(sessionId, variantNum, moduleUrl, err\);[\s\S]{0,300}?showMountErrorCard\(sessionId, \{/,
      'a failed mount must raise the persistent error card from the shared catch',
    );
  });

  it('keeps the session alive when a component variant fails to mount', () => {
    const abort = SOURCE.match(
      /function abortSvelteComponentInjection\(sessionId, details\) \{[\s\S]*?\n  \}\n/,
    );
    assert.ok(abort, 'abortSvelteComponentInjection must still exist');
    const body = abort[0];
    assert.doesNotMatch(
      body,
      /clearSession\(\)/,
      'event=live_browser.mount_failure_wipe actor=browser operation=abort_svelte_injection risk=durable_session_orphaned expected=localStorage preserved actual=clearSession() called',
    );
    assert.doesNotMatch(
      body,
      /currentSessionId = null/,
      'the session id is the only handle Retry and a republish have; abort must not drop it',
    );
    assert.doesNotMatch(
      body,
      /setLiveState\('PICKING'\)/,
      'a mount failure is not the end of the session, so the bar must not fall back to PICKING',
    );
    assert.doesNotMatch(
      body,
      /showToast\(/,
      'the 5s toast was replaced by a persistent card; a toast that vanishes reads as no feedback at all',
    );
    assert.match(body, /showMountErrorCard\(/, 'abort must raise the persistent error card');
    assert.match(body, /saveSession\(\)/, 'abort must keep the localStorage cache in step with the server');
  });

  it('gives the manifest fetch failure and the session mismatch the same error card', () => {
    assert.doesNotMatch(
      SOURCE,
      /if \(manifest\.id !== sessionId\) return;/,
      'event=live_browser.silent_manifest_mismatch actor=browser operation=inject_from_manifest risk=bar_stuck_in_generating expected=error card actual=bare return',
    );
    assert.match(
      SOURCE,
      /if \(manifest\.id !== sessionId\) \{[\s\S]{0,700}?showMountErrorCard\(sessionId, \{/,
      'a manifest belonging to another session must surface, not disappear',
    );
    assert.match(
      SOURCE,
      /Failed to mount component-preview variants:[\s\S]{0,400}?reportVariantMountFailed\(sessionId, visibleVariant \|\| 1, manifestPath, err\);/,
      'a manifest that cannot be read is a render failure the agent must hear about',
    );
    assert.doesNotMatch(
      SOURCE,
      /reportVariantMountFailed\(sessionId, visibleVariant \|\| 1, url,/,
      'the /source fetch URL carries the live token and must never be journaled; report the manifest path',
    );
  });

  it('offers a retry that re-runs injection for the same session', () => {
    assert.match(
      SOURCE,
      /function retryMountErrorCard\(\) \{[\s\S]{0,900}?injectSvelteComponentsFromManifest\(manifestPath, sessionId\);/,
      'the Retry button must re-enter the normal injection path rather than restarting the session',
    );
    assert.match(
      SOURCE,
      /function truncateMiddle\(value, max\)/,
      'the card shows the failed module URL truncated in the middle so both ends stay readable',
    );
  });

  it('rehydrates from the server when localStorage has no session', () => {
    assert.doesNotMatch(
      SOURCE,
      /function restoreSessionWithoutWrapper\(reason, activeSessions\) \{\s*const saved = loadSession\(\);/,
      'event=live_browser.storage_gated_restore actor=browser operation=sse_connected risk=durable_session_unreachable expected=server summary can seed a restore actual=localStorage is a gate',
    );
    assert.match(
      SOURCE,
      /const adopted = cached\?\.id \? null : findAdoptableServerSession\(activeSessions\);/,
      'a page with no cached session must be able to adopt the durable one the server reports',
    );
    assert.match(
      SOURCE,
      /function findAdoptableServerSession\(activeSessions\) \{[\s\S]{0,600}?&& session\.pageUrl\s*&& pageMatchesCurrent\(session\.pageUrl\)/,
      'adoption must require an explicit pageUrl match so it cannot hijack an unrelated route',
    );
    assert.match(
      SOURCE,
      /function findAdoptableServerSession\(activeSessions\) \{[\s\S]{0,600}?!isTerminalSessionSummary\(session\)/,
      'accepted, discarded, and completed sessions must never be adopted',
    );
  });

  it('carries no agent phase the server cannot emit', () => {
    // Every one of these lived in PHASE_RANK and, for most, in a status string
    // the user could never see: recordAgentPhase() in live-server.mjs has
    // never emitted them. The validator now rejects them outright, so a
    // leftover branch here is a branch that cannot run.
    for (const retired of [
      'first_variant_generating',
      'first_variant_validating',
      'remaining_variants_generating',
      'remaining_variants_validating',
      'variant_parameters_generating',
      'variant_parameters_validating',
      'parameters_ready',
    ]) {
      assert.doesNotMatch(
        SOURCE,
        new RegExp(retired),
        'event=live_browser.dead_agent_phase actor=browser operation=phase_rank risk=ui_branches_on_phase_nothing_sends phase=' + retired,
      );
    }
    // The phases the server does emit must all still rank.
    for (const live of [
      'picked_up', 'scaffolding', 'scaffold_fallback', 'source_ready',
      'generation_ready', 'first_reviewable', 'second_reviewable', 'all_variants_ready',
    ]) {
      assert.match(SOURCE, new RegExp('\\n\\s+' + live + ': \\d+,'), live + ' must keep a rank');
    }
  });

  it('renders the cycling counter through one function with one denominator', () => {
    // buildCyclingRow showed visibleVariant/expectedVariants while
    // syncCyclingControls wrote shown/arrivedVariants, so the same unchanged
    // state rendered as "2/3" or "2/2" depending on which path ran last.
    assert.doesNotMatch(
      SOURCE,
      /visibleVariant \+ '\/' \+ expectedVariants/,
      'event=live_browser.counter_drift actor=browser operation=cycling_counter risk=two_denominators_for_one_counter',
    );
    assert.doesNotMatch(SOURCE, /shown \+ '\/' \+ arrivedVariants/);
    assert.match(
      SOURCE,
      /function cyclingCounterText\(\) \{[\s\S]{0,300}?arrivedVariants > 0 \? arrivedVariants : expectedVariants/,
      'the denominator policy is arrived-when-known, expected otherwise, in one place',
    );
    const counterAssignments = SOURCE.match(/-variant-counter'\)?;?[\s\S]{0,120}?textContent = ([^;]+);/g) || [];
    for (const assignment of counterAssignments) {
      assert.match(assignment, /cyclingCounterText\(\)/, 'every counter write goes through cyclingCounterText');
    }
  });

  it('gives the steer bar a visible Send control alongside Enter', () => {
    assert.match(
      SOURCE,
      /pageChatSendBtn = el\('button'/,
      'event=live_browser.steer_send_affordance actor=user operation=steer risk=enter_only_submit_reads_as_dead_input',
    );
    assert.match(SOURCE, /pageChatSendBtn\.id = PREFIX \+ '-page-chat-send'/);
    assert.match(
      SOURCE,
      /function syncPageChatSendButton\(\)[\s\S]{0,900}?pageChatSendBtn\.disabled = !visible \|\| !hasText/,
      'Send is disabled with an empty input',
    );
    assert.match(
      SOURCE,
      /function syncPageChatSendButton\(\)[\s\S]{0,900}?const visible = !steerLocked/,
      'Send disappears while a steer is in flight',
    );
    // Enter must still submit.
    assert.match(
      SOURCE,
      /if \(e\.key === 'Enter'\) \{\s*e\.preventDefault\(\);\s*submitSteerMessage\(\);/,
      'keyboard submit stays',
    );
    // The inventory used to be an inline literal here, so this used to be a
    // source-text match on the surface entry. It now lives in
    // live/ui-surfaces.mjs (importable, one definition), so assert membership
    // in the real list instead of the shape of the line that declares it.
    assert.ok(
      LIVE_UI_COMPONENT_IDS.includes(`${LIVE_UI_PREFIX}-page-chat-send`),
      'the Send control must be registered as live UI chrome so it is excluded from capture',
    );
  });

  it('says a queued steer is queued instead of pulsing at the user', () => {
    assert.match(
      SOURCE,
      /function steerQueuedBehindGeneration\(\) \{[\s\S]{0,220}?steerLocked && !agentPollingConnected && agentHasWorkInFlight\(\)/,
      'event=live_browser.steer_queue_feedback actor=user operation=steer_during_generation risk=queued_request_reads_as_lost',
    );
    assert.match(SOURCE, /Queued behind current generation/);
    assert.match(
      SOURCE,
      /function syncSteerQueueHint\(\)[\s\S]{0,400}?pageChatDotsEl\.style\.display = 'none'/,
      'the queue hint replaces the bare dots rather than sitting beside them',
    );
    assert.match(SOURCE, /function syncAgentPollingUi\(connected\) \{[\s\S]{0,140}?syncSteerQueueHint\(\)/);
  });

  it('names the actual cause when a steer times out', () => {
    assert.doesNotMatch(
      SOURCE,
      /Check that live-poll is running and replies with steer_done/,
      'event=live_browser.steer_timeout_copy actor=user operation=steer_timeout risk=blames_live_poll_for_a_busy_agent',
    );
    assert.match(
      SOURCE,
      /function steerTimeoutMessage\(\)[\s\S]{0,900}?steerQueuedBehindGeneration\(\)[\s\S]{0,400}?!agentPollingConnected/,
      'the timeout message branches on agent-busy vs nobody-polling',
    );
  });

  it('distinguishes an empty DESIGN.md from a missing one in the design panel', () => {
    assert.match(
      SOURCE,
      /function designEmptyMessage\(\)[\s\S]{0,700}?designState\.hasMd && !designState\.hasSidecar[\s\S]{0,300}?DESIGN\.md found, no structured tokens to display/,
      'event=live_browser.design_empty_state actor=user operation=open_design_panel risk=present_design_md_reported_as_missing',
    );
    assert.match(
      SOURCE,
      /const beforeCount = body\.childElementCount;/,
      'the empty check must ignore the stale hint and CTA the caller already appended',
    );
    assert.doesNotMatch(
      SOURCE,
      /msgDiv\('empty', 'No design system data available\.'\)/,
      'the bare message may only survive as the genuinely-absent branch of designEmptyMessage',
    );
  });

  it('includes named rules from every canonical narrative section', () => {
    const narrativeStart = SOURCE.indexOf('  function synthesizeNarrative(parsed) {');
    const narrativeEnd = SOURCE.indexOf('\n  function renderColorTiles', narrativeStart);
    assert.notEqual(narrativeStart, -1, 'synthesizeNarrative must exist');
    assert.notEqual(narrativeEnd, -1, 'synthesizeNarrative must end before renderColorTiles');
    const narrativeSource = SOURCE.slice(narrativeStart, narrativeEnd);

    for (const section of ['colors', 'typography', 'layout', 'elevation', 'shapes']) {
      assert.match(
        narrativeSource,
        new RegExp(`md\\.${section}\\?\\.rules[^\\n]*section: '${section}'`),
        `the design panel must carry named rules tagged with their ${section} section`,
      );
    }
  });

  it('editing focus timeout does not read a stale inline edit row', () => {
    assert.doesNotMatch(
      SOURCE,
      /setTimeout\(\(\) => \{\s*const el = inlineEditRows\[0\]\.el;/,
      'event=live_browser.stale_edit_focus actor=browser operation=edit_mode_focus_timeout risk=post_apply_or_accept_pageerror expected=capture editable element before timeout and guard state actual=reads inlineEditRows[0].el after rows can be cleared',
    );
    assert.match(
      SOURCE,
      /const firstEditable = inlineEditRows\[0\] && inlineEditRows\[0\]\.el;[\s\S]{0,120}?setTimeout\(\(\) => \{[\s\S]{0,120}?if \(!el \|\| !el\.isConnected \|\| state !== 'EDITING'\) return;/,
      'edit-mode delayed focus should capture the element before scheduling and no-op if editing ended before the timeout fires',
    );
  });
  it('adopts only variant comparisons from the server, never steer or manual sessions', () => {
    // A completed-steer session is non-terminal and carries a sourceFile;
    // adopting it as a comparison hunts for a variant wrapper that never
    // existed and wedges the bar before the user's next pick (found by the
    // vite8-react-base-path e2e after server-first rehydration landed).
    assert.match(
      SOURCE,
      /function findAdoptableServerSession\([\s\S]{0,900}?Number\(session\.expectedVariants\) > 0/,
      'adoption must require a generation-shaped session (expectedVariants > 0)',
    );
    assert.match(
      SOURCE,
      /function findAdoptableServerSession\([\s\S]{0,900}?ADOPTABLE_SESSION_PHASES\.has\(String\(session\.phase/,
      'adoption must be limited to the comparison-phase allowlist',
    );
    // Accept/carbonize phases are agent-side work; adopting them resurrects
    // the bar over a decided comparison (the slow-CI astro accept hang).
    assert.doesNotMatch(
      SOURCE,
      /ADOPTABLE_SESSION_PHASES = new Set\(\[[\s\S]{0,200}?(accept_requested|carbonize|steer|manual_edit)/,
      'accept, carbonize, steer, and manual-edit phases must not be adoptable',
    );
  });

});
