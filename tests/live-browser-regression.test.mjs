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
  it('exposes adapter-neutral live chrome core metadata at runtime', () => {
    assert.match(
      SOURCE,
      /window\.__IMPECCABLE_LIVE_CHROME_CORE__\s*=\s*\{[\s\S]{0,600}?mountContract: LIVE_CHROME_MOUNT_CONTRACT/,
      'live-browser.js should expose the shared chrome mount contract for Svelte now and React/plain DOM later',
    );
    assert.match(
      SOURCE,
      /surfaces: LIVE_UI_SURFACES/,
      'live-browser.js should publish the live UI inventory used by parity audit recorders',
    );
    assert.match(
      SOURCE,
      /adapter: window\.__IMPECCABLE_LIVE_ADAPTER__ \|\| 'dom'/,
      'live-browser.js should default to a plain DOM adapter and not assume Svelte',
    );
  });

  it('routes Impeccable chrome through the supplied UI root', () => {
    assert.match(
      SOURCE,
      /function liveUiRoot\(\)[\s\S]{0,220}?window\.__IMPECCABLE_LIVE_UI_ROOT__[\s\S]{0,160}?return document\.body;/,
      'live chrome should mount into an adapter-provided root, falling back to document.body',
    );
    assert.match(
      SOURCE,
      /function uiAppendStyle\(styleEl\)[\s\S]{0,220}?root !== document\.body[\s\S]{0,80}?document\.head\.appendChild/,
      'live chrome styles should enter the shadow root when one is provided',
    );
    assert.match(
      SOURCE,
      /function uiGetById\(id\)[\s\S]{0,260}?root\.getElementById[\s\S]{0,260}?document\.getElementById/,
      'live chrome lookups should pierce the shared shadow root before falling back to document',
    );
  });

  it('does not define duplicate Svelte-only chrome controls in the browser bundle', () => {
    assert.doesNotMatch(
      SOURCE,
      /from ['"]svelte|@sveltejs|\$app\/environment/,
      'shared live chrome must remain plain JS, with Svelte limited to the adapter host',
    );
  });

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
      /function cancelEditingToPicking\(\) \{[\s\S]{0,600}?state = 'PICKING';/,
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
      /function hideBar\(\) \{[\s\S]{0,520}?if \(state === 'EDITING'\) restoreInlineEditDrafts\(\);[\s\S]{0,80}?disableInlineEdit\(\);/,
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
      /function handleServerLost\(\)[\s\S]{0,300}?const recoveryState = currentSessionId \? state : 'IDLE';[\s\S]{0,1200}?state = recoveryState;[\s\S]{0,120}?if \(currentSessionId\) saveSession\(\);/,
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

  it('nonfatal source reinjection misses do not pollute console.error', () => {
    assert.match(
      SOURCE,
      /console\.warn\('\[impeccable\] Could not find original element in live DOM\.'\);/,
      'transient HMR fallback misses should be warnings so console-clean tests catch real failures',
    );
  });

  it('source reinjection can re-anchor elements by class subset', () => {
    assert.match(
      SOURCE,
      /expectedClasses = String\(cls\)\.split\([\s\S]{0,500}?expectedClasses\.every\(\(name\) => c\.classList\.contains\(name\)\)/,
      'source reinjection should match source classes as a subset so framework-generated classes do not block DOM replacement',
    );
  });
  it('Svelte component previews mount real components from manifest.json', () => {
    assert.match(
      SOURCE,
      /function isSvelteComponentManifestPath\(filePath\)[\s\S]{0,120}?manifest\.json/,
      'source reinjection should detect Svelte component manifests',
    );
    assert.match(
      SOURCE,
      /async function mountSvelteComponentVariant\(variantNum\)[\s\S]{0,1200}?runtime\.mount\(Component,/,
      'Svelte component injection should dynamically import and mount compiled variants',
    );
    assert.match(
      SOURCE,
      /async function injectSvelteComponentsFromManifest\(manifestPath, sessionId\)[\s\S]{0,3000}?await mountSvelteComponentVariant\(/,
      'manifest injection should mount the visible Svelte component variant',
    );
    assert.match(
      SOURCE,
      /function buildSveltePropValuesFromLiveElement\(liveEl, manifest\)[\s\S]{0,500}?buildSvelteExpressionTextMap/,
      'Svelte component injection should map propContract expressions to live DOM values',
    );
  });

  it('orphaned Svelte component wrappers recover from the manifest instead of stranding the bar at 0/0', () => {
    assert.match(
      SOURCE,
      /wrapper\.dataset\.impeccablePreview === 'svelte-component'[\s\S]{0,220}?svelteComponentSession\?\.sessionId !== sessionId[\s\S]{0,160}?wrapper\.remove\(\);[\s\S]{0,160}?restoreSessionWithoutWrapper\('browser_resumed_svelte_orphan_wrapper'\)/,
      'resumeSession should remove an orphaned svelte-component wrapper and remount from the persisted manifest instead of clearing the session',
    );
    assert.match(
      SOURCE,
      /function abortSvelteComponentInjection\(sessionId, message\)[\s\S]{0,1500}?state = 'PICKING';/,
      'a failed Svelte mount should reset the bar to PICKING via abortSvelteComponentInjection',
    );
    assert.match(
      SOURCE,
      /const mounted = await mountSvelteComponentVariant\(visibleVariant\);[\s\S]{0,500}?abortSvelteComponentInjection\(sessionId,/,
      'injection should abort when the initial variant mount fails',
    );
  });

  it('persists preview/source metadata needed to restore Svelte variants after refresh', () => {
    assert.match(
      SOURCE,
      /let currentSourceFile = null;[\s\S]{0,140}?let currentPreviewFile = null;[\s\S]{0,140}?let currentPreviewMode = null;/,
      'browser runtime needs durable source/preview fields for refresh recovery',
    );
    assert.match(
      SOURCE,
      /function saveSession\(\)[\s\S]{0,600}?sourceFile: currentSourceFile \|\| undefined,[\s\S]{0,160}?previewFile: currentPreviewFile \|\| undefined,[\s\S]{0,160}?previewMode: currentPreviewMode \|\| undefined,[\s\S]{0,160}?paramValues: \{ \.\.\.paramsCurrentValues \}/,
      'saveSession should persist sourceFile, previewFile, previewMode, and current param values',
    );
    assert.match(
      SOURCE,
      /function checkpointPayload\(reason\)[\s\S]{0,500}?sourceFile: currentSourceFile \|\| undefined,[\s\S]{0,160}?previewFile: currentPreviewFile \|\| undefined,[\s\S]{0,160}?previewMode: currentPreviewMode \|\| undefined/,
      'checkpoints should carry file metadata so the live server can include it in activeSessions',
    );
  });

  it('SSE connected activeSessions can remount saved Svelte component sessions', () => {
    assert.match(
      SOURCE,
      /case 'connected':[\s\S]{0,500}?restoreFromActiveSessions\(msg\.activeSessions, 'sse_connected'\)/,
      'the connected handshake should ask the server for active sessions and try to remount the matching saved session',
    );
    assert.match(
      SOURCE,
      /const restoreFile = currentPreviewMode === 'svelte-component'[\s\S]{0,120}?\? currentPreviewFile[\s\S]{0,180}?injectVariantsFromSource\(restoreFile, currentSessionId\)/,
      'reload recovery should prefer previewFile for Svelte component sessions and inject that manifest',
    );
    assert.match(
      SOURCE,
      /function injectSvelteComponentsFromManifest\(manifestPath, sessionId\)[\s\S]{0,700}?rememberSessionFileMeta\(\{[\s\S]{0,160}?previewMode: 'svelte-component'/,
      'manifest injection should refresh local preview metadata for subsequent reloads',
    );
  });

  it('missing-anchor Svelte recovery waits instead of clearing the session', () => {
    assert.match(
      SOURCE,
      /if \(!liveEl\?\.parentElement\) \{[\s\S]{0,900}?recoveryWaitingForAnchor = true;[\s\S]{0,500}?waitForSvelteComponentTargetAndRetry\(\{ manifestPath, sessionId, manifest \}\);[\s\S]{0,220}?Variants ready\. Reveal the selected element to resume\./,
      'Svelte manifest injection should keep a recoverable session when the anchor disappeared after refresh',
    );
    assert.match(
      SOURCE,
      /if \(!wrapper\) \{[\s\S]{0,180}?restoreSessionWithoutWrapper\('browser_resumed_without_wrapper'\)[\s\S]{0,180}?return true;[\s\S]{0,180}?clearSession\(\);/,
      'no-wrapper refresh recovery should try the durable session restore path before clearing stale local state',
    );
  });

  it('Svelte component params load from a sidecar params.json, not a DOM attribute', () => {
    assert.match(
      SOURCE,
      /async function loadSvelteComponentParams\(manifest\)[\s\S]{0,400}?params\.json/,
      'Svelte component params should be fetched from componentDir/params.json',
    );
    assert.match(
      SOURCE,
      /function parseVariantParams\(variantEl\)[\s\S]{0,400}?svelteComponentSession\?\.sessionId === currentSessionId[\s\S]{0,200}?paramsByVariant/,
      'parseVariantParams should read the Svelte session sidecar params instead of the data-impeccable-params attribute',
    );
  });

  it('Svelte component accepts write source immediately instead of deferring to live exit', () => {
    assert.doesNotMatch(
      SOURCE,
      /acceptPayload\.deferSourceWrite\s*=/,
      'Svelte component accepts must not ask the agent to defer the real source write',
    );
    assert.doesNotMatch(
      SOURCE,
      /Accepted\. Svelte source will sync when live mode exits\./,
      'the browser should not promise exit-time source sync',
    );
    assert.match(
      SOURCE,
      /const acceptedIsSvelteComponent = svelteComponentSession\?\.sessionId === acceptedSessionId[\s\S]{0,120}?impeccablePreview === 'svelte-component';/,
      'Svelte component accepts should still bridge the accepted preview in the DOM while HMR catches up',
    );
  });

  it('Svelte component Insert previews mount beside the anchor instead of replacing it', () => {
    assert.match(
      SOURCE,
      /function isSvelteInsertManifest\(manifest\)[\s\S]{0,140}?manifest\?\.mode === 'insert'/,
      'Svelte insert manifests should be detected explicitly',
    );
    assert.match(
      SOURCE,
      /const insertMode = isSvelteInsertManifest\(manifest\);[\s\S]{0,260}?const detachedOriginal = insertMode \? null : liveEl;/,
      'Svelte insert previews should keep the live anchor in place',
    );
    assert.match(
      SOURCE,
      /if \(insertMode\) \{[\s\S]{0,120}?removeInsertPlaceholderDom\(\);[\s\S]{0,220}?insertBefore\(wrapper, liveEl\)[\s\S]{0,220}?insertBefore\(wrapper, liveEl\.nextSibling\)/,
      'Svelte insert previews should remove the placeholder and insert a component wrapper before/after the anchor',
    );
    assert.match(
      SOURCE,
      /if \(!isSvelteInsertManifest\(manifest\)\) \{[\s\S]{0,120}?applyOriginalAttrsToSvelteAnchor/,
      'Svelte insert variants must not receive source-anchor attrs while mounting',
    );
  });

  it('stale delayed hideBar timers cannot hide a newly shown live bar', () => {
    assert.match(
      SOURCE,
      /let barHideSeq = 0;/,
      'the live bar needs a hide/show generation token',
    );
    assert.match(
      SOURCE,
      /function showBar\(mode\) \{[\s\S]{0,80}?barHideSeq \+= 1;/,
      'showBar should invalidate any pending delayed hide',
    );
    assert.match(
      SOURCE,
      /const hideSeq = \+\+barHideSeq;[\s\S]{0,360}?hideSeq === barHideSeq[\s\S]{0,80}?style\.display = 'none'/,
      'hideBar should only hide if no newer show happened before the timeout',
    );
  });

  it('Exit removes the global bottom bar without a teardown transition', () => {
    assert.match(
      SOURCE,
      /function teardown\(\)[\s\S]{0,1400}?if \(globalBarEl\) \{\s*globalBarEl\.style\.transition = 'none';\s*globalBarEl\.remove\(\);\s*globalBarEl = null;\s*\}/,
      'clicking the bottom-bar X should remove live chrome immediately instead of animating it away',
    );
    assert.doesNotMatch(
      SOURCE,
      /function teardown\(\)[\s\S]{0,1400}?globalBarEl\.style\.transform = 'translateY\(100%\)'/,
      'teardown must not drop the global bar transform because that animates down/right from the centered position',
    );
  });

  it('Accept waits for final poll acknowledgement before confirming the UI', () => {
    assert.match(
      SOURCE,
      /let pendingAccept = null;/,
      'Accept needs a pending state that survives the browser POST completing before source promotion finishes',
    );
    assert.match(
      SOURCE,
      /sendEvent\(acceptPayload, \{ throwOnError: true \}\)\s*[\s\S]{0,80}?\.then\(\(\) => \{\}\)/,
      'the accept POST acknowledgement must not immediately mark the variant as applied',
    );
    assert.doesNotMatch(
      SOURCE,
      /sendEvent\(acceptPayload, \{ throwOnError: true \}\)[\s\S]{0,160}?confirmAcceptAfterReceipt\(\)/,
      'confirming on browser event receipt recreates the source-promotion race',
    );
    assert.match(
      SOURCE,
      /case 'complete':[\s\S]{0,120}?completePendingAccept\(msg\)/,
      'the browser should confirm only when the server broadcasts complete for the active accept',
    );
    assert.match(
      SOURCE,
      /function failPendingAccept\(msg\)[\s\S]{0,220}?state = 'CYCLING'/,
      'failed accept promotion should recover to cycling instead of hiding the bar',
    );
  });

  it('Svelte component cycling uses unmount and remount', () => {
    assert.match(
      SOURCE,
      /async function mountSvelteComponentVariant\(variantNum\)[\s\S]{0,900}?runtime\.unmount/,
      'Svelte component cycling should unmount the previous variant before mounting the next one',
    );
    assert.match(
      SOURCE,
      /svelteComponentSession\?\.sessionId === sessionId[\s\S]{0,200}?mountSvelteComponentVariant\(num\)/,
      'showVariantInDOM should route Svelte component sessions through mount-based cycling',
    );
  });

  it('Svelte component cycling keeps the highlight anchored during variant swaps', () => {
    assert.match(
      SOURCE,
      /function makeFrozenAnchor\(el\)[\s\S]{0,700}?__impeccableFrozenAnchor/,
      'Svelte component swaps should keep a frozen real-element rect while the old component unmounts and the next one mounts',
    );
    assert.match(
      SOURCE,
      /function resolveSvelteComponentAnchor\(session = svelteComponentSession\)[\s\S]{0,180}?session\?\.swapAnchor/,
      'the live overlay should use the frozen rect when the mount target is temporarily empty',
    );
    assert.match(
      SOURCE,
      /const mod = await import\([\s\S]{0,260}?moduleUrl\);[\s\S]{0,260}?if \(svelteComponentSession\.mountedInstance && runtime\.unmount\)/,
      'the next Svelte component should be imported before unmounting the current one to avoid an empty-frame highlight jump',
    );
    assert.doesNotMatch(
      SOURCE,
      /selectedElement = svelteComponentSession\.mountTargetEl\?\.firstElementChild\s*\|\|\s*svelteComponentSession\.mountTargetEl/,
      'selectedElement must not fall back to the display:contents mount target, because its rect is zero and makes the highlight jump',
    );
    assert.match(
      SOURCE,
      /let variantSelectionInFlight = false;/,
      'variant selection needs an in-flight guard for async Svelte remounts',
    );
    assert.match(
      SOURCE,
      /let variantSelectionPromise = null;/,
      'accept needs access to the active Svelte remount promise before reading the visible DOM variant',
    );
    assert.match(
      SOURCE,
      /async function selectVariant\(next, checkpointReason\)[\s\S]{0,240}?if \(variantSelectionInFlight\) return;/,
      'variant clicks should be serialized so overlapping Svelte mount promises cannot race the overlay anchor',
    );
    assert.match(
      SOURCE,
      /async function handleAccept\(\)[\s\S]{0,180}?if \(variantSelectionPromise\)[\s\S]{0,160}?await variantSelectionPromise;/,
      'Accept should wait for an in-flight Svelte variant mount before reading mountedVariant',
    );
    assert.match(
      SOURCE,
      /function applyOriginalAttrsToSvelteAnchor\(el, originalMarkup\)[\s\S]{0,650}?el\.setAttribute\(attr\.name, attr\.value\);/,
      'Svelte component preview DOM should preserve source attributes such as data-testid while cycling',
    );
    assert.match(
      SOURCE,
      /function commitAcceptedSvelteComponentToDom\(sessionId\)[\s\S]{0,900}?replaceChild\(committed, wrapperEl\)/,
      'Svelte accept should promote the accepted preview out of the data-impeccable wrapper immediately',
    );
    assert.match(
      SOURCE,
      /function completePendingAccept\(msg\)[\s\S]{0,260}?commitAcceptedSvelteComponentToDom\(accepted\.id\);/,
      'completed Svelte accepts should remove the live preview wrapper before cleanup',
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
      /function keepSteerPointerInside\(e[\s\S]{0,120}?preventDefault/,
      'steer pointer events must stay inside the shadow chrome and not be stolen by the host app',
    );
    assert.match(
      SOURCE,
      /function submitSteerMessage\(\)[\s\S]{0,700}?steerPendingMessage = text;[\s\S]{0,900}?steer_send_failed[\s\S]{0,220}?restoreMessage: text/,
      'failed steer submits should restore the typed prompt instead of clearing the input',
    );
    assert.match(
      SOURCE,
      /function lockSteerChat\(\)[\s\S]{0,650}?preparePageChatInputForTyping\(\)/,
      'steer processing must not clear/collapse the input before final acknowledgement',
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
      /if \(state === 'IDLE' && \(pickActive \|\| insertActive\)\) state = 'PICKING';/,
      'SSE connected must arm insert mode when saved preference has insert on',
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
      /function syncPageInteractionCursor\(\)[\s\S]{0,280}?cursorForInsertAxis/,
      'insert picking cursor follows row/column axis',
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
      /buildInsertConfigureRow[\s\S]*?const count = el\('button', \{[\s\S]{0,320}?height: '28px'/,
      'insert count toggle must match input height',
    );
    assert.match(
      SOURCE,
      /buildInsertConfigureRow[\s\S]*?const create = el\('button', \{[\s\S]{0,320}?height: '28px'/,
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
      /async function handleAccept\(\)[\s\S]{0,360}?const domVisibleVariant = readVisibleVariantFromDOM\(currentSessionId\);[\s\S]{0,120}?if \(domVisibleVariant > 0\) visibleVariant = domVisibleVariant;[\s\S]{0,160}?variantId: String\(visibleVariant\)/,
      'event=live_browser.accept_stale_visible_variant actor=browser operation=accept_after_hmr risk=accept_sends_variant_1_after_user_cycles_to_2 expected=read_dom_visible_variant actual=stale_state_variable',
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
