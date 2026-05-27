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
      /function syncPageChatFocus\(reason\)[\s\S]{0,160}?if \(state === 'CONFIGURING'\) focusConfigureInput\(reason\);[\s\S]{0,80}?else focusSteerChat\(reason\);/,
      'focus should sit on the configure input while picking an element, otherwise on steer',
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
  });

  it('pick mode preference persists in localStorage', () => {
    assert.match(
      SOURCE,
      /const PICK_PREFS_KEY = 'impeccable-live-pick';[\s\S]{0,400}?function savePickPref\(\)/,
      'pick mode must use a dedicated localStorage key with savePickPref',
    );
    assert.match(
      SOURCE,
      /function togglePick\(\)[\s\S]{0,120}?savePickPref\(\);/,
      'togglePick must persist pickActive so Escape / bar toggle survive reloads',
    );
    assert.match(
      SOURCE,
      /if \(state === 'IDLE' && pickActive\) state = 'PICKING';/,
      'SSE connected must not arm pick mode when the saved preference has pick off',
    );
  });

  it('handleAccept reads the visible DOM variant before sending accept', () => {
    assert.match(
      SOURCE,
      /function readVisibleVariantFromDOM\(sessionId\)[\s\S]{0,900}?variant\.style\.display === 'none'[\s\S]{0,500}?return idx;/,
      'live-browser should be able to derive the accepted variant from the currently visible DOM node',
    );
    assert.match(
      SOURCE,
      /function handleAccept\(\)[\s\S]{0,180}?const domVisibleVariant = readVisibleVariantFromDOM\(currentSessionId\);[\s\S]{0,120}?if \(domVisibleVariant > 0\) visibleVariant = domVisibleVariant;[\s\S]{0,160}?variantId: String\(visibleVariant\)/,
      'event=live_browser.accept_stale_visible_variant actor=browser operation=accept_after_hmr risk=accept_sends_variant_1_after_user_cycles_to_2 expected=read_dom_visible_variant actual=stale_state_variable',
    );
  });
});
