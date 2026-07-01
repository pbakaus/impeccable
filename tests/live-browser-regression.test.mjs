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

  it('uses a Svelte-gated painted-ancestor crop proxy for shader capture', () => {
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
      /function shouldUseAncestorCropShaderProxy\(el\) \{[\s\S]{0,260}?window\.__IMPECCABLE_LIVE_ADAPTER__[\s\S]{0,280}?currentPreviewMode === 'svelte-component' \|\| svelteComponentSession[\s\S]{0,260}?dataset\?\.impeccablePreview === 'svelte-component';/,
      'ancestor crop proxy must be gated to the Svelte adapter / Svelte component previews',
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
      /function hideBar\(\) \{[\s\S]{0,620}?if \(state === 'EDITING'\) restoreInlineEditDrafts\(\);[\s\S]{0,80}?disableInlineEdit\(\);/,
      'hideBar should not leave unsaved contenteditable drafts in the DOM when an external event hides the bar',
    );
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
      /function syncAgentPollingUi\(/,
      'global bar brand must reflect agent poll connectivity',
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
      /function setVariantShown\(el, shown\)[\s\S]{0,200}?removeAttribute\('hidden'\)/,
      'variant cycling must clear the hidden attribute, not only style.display',
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
});
