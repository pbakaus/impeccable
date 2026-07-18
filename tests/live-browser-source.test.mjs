import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(process.cwd(), 'skill/scripts/live-browser.js'), 'utf-8');
const PENDING_DOCK_POSITION_SOURCE = SOURCE.match(/function positionPendingDock\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
const CAPTURE_AND_EMIT_SOURCE = SOURCE.match(/async function captureAndEmit\([\s\S]*?\n  \}/)?.[0] || '';

describe('live-browser source contracts', () => {
  it('reports foreground poll connectivity without a background worker dependency', () => {
    assert.match(
      SOURCE,
      /syncAgentPollingUi\(!!msg\.agentPolling\)/,
      'the initial SSE state should include foreground poll connectivity',
    );
    assert.doesNotMatch(SOURCE, /codexWorker|codex-worker|codex_cli_unavailable/);
  });

  it('dispatches plain generation before screenshot capture without bypassing annotated evidence', () => {
    const dispatchIndex = CAPTURE_AND_EMIT_SOURCE.indexOf('await sendEvent(basePayload);');
    const captureIndex = CAPTURE_AND_EMIT_SOURCE.indexOf('await captureElementToBlob');
    assert.ok(dispatchIndex >= 0, 'plain generation should dispatch immediately');
    assert.ok(captureIndex > dispatchIndex, 'plain generation dispatch must happen before capture begins');
    assert.match(
      CAPTURE_AND_EMIT_SOURCE,
      /if \(blob && hasAnnotations\)[\s\S]*?\/annotation\?token=/,
      'annotation screenshots should still upload before annotated generation dispatch',
    );
    assert.match(
      CAPTURE_AND_EMIT_SOURCE,
      /if \(hasAnnotations\) \{[\s\S]*?basePayload\.clientSentAt = Date\.now\(\);\s*sendEvent\(screenshotPath \? \{ \.\.\.basePayload, screenshotPath \} : basePayload\);\s*\}/,
      'annotated generation should dispatch exactly after capture and upload resolve',
    );
  });

  it('saves copy edits to the staged buffer with rich AI context', () => {
    assert.doesNotMatch(
      SOURCE,
      /type: 'manual_edit_apply'|beginManualApplySession|createManualApplyOverlay|manualApplySession/,
      'Save should not use the old direct manual_edit_apply loading path',
    );
    assert.match(
      SOURCE,
      /fetch\('http:\/\/localhost:' \+ PORT \+ '\/manual-edit-stash'[\s\S]{0,260}?pageUrl: location\.pathname[\s\S]{0,80}?element: extractContext\(contextElement\)[\s\S]{0,40}?ops,/,
      'Save should stage edits through /manual-edit-stash with element context and ops',
    );
    assert.match(
      SOURCE,
      /fetch\([^)]*\/manual-edit-commit\?token=[\s\S]*?&async=1/,
      'Apply copy edits should start /manual-edit-commit in async mode',
    );
    assert.match(
      SOURCE,
      /fetch\([^)]*\/manual-edit-discard\?token=/,
      'Discard copy edits should call /manual-edit-discard',
    );
    assert.match(
      SOURCE,
      /const result = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);[\s\S]{0,120}?restoreDiscardedManualEdits\(result\.entries \|\| \[\]\);/,
      'Discard copy edits should restore the visible staged DOM from returned buffer entries',
    );
    assert.match(
      SOURCE,
      /const restoreFailures = restoreDiscardedManualEdits\(result\.entries \|\| \[\]\);[\s\S]{0,260}?refresh to reset/,
      'Discard restore should report unsafe local DOM restores to the caller',
    );
    assert.match(
      SOURCE,
      /function canRestoreManualEditElement\(el, op\)[\s\S]*?el\.children && el\.children\.length > 0[\s\S]*?return false;[\s\S]*?normalizeManualContextText\(el\.textContent\) === normalizeManualContextText\(op\.newText\);/,
      'Discard restore should only write textContent into pure text leaves, never parent containers',
    );
    assert.match(
      SOURCE,
      /if \(!el \|\| typeof op\.originalText !== 'string' \|\| !canRestoreManualEditElement\(el, op\)\)[\s\S]*?failures \+= 1;[\s\S]*?continue;/,
      'Unsafe discard restores should be skipped instead of wiping parent markup',
    );
    assert.match(
      SOURCE,
      /function parseManualEditRefSegment\(segment\)[\s\S]*?function elementMatchesManualRefSegment\(el, segment\)/,
      'Discard restore should parse Impeccable document refs instead of treating them as raw CSS selectors',
    );
    const refMatchStart = SOURCE.indexOf('function elementMatchesManualRefSegment');
    const refMatchEnd = SOURCE.indexOf('function cssIdent', refMatchStart);
    const refMatchFn = SOURCE.slice(refMatchStart, refMatchEnd);
    assert.match(
      refMatchFn,
      /if \(segment\.id && el\.id !== segment\.id\) return false;[\s\S]*for \(const cls of segment\.classes\)[\s\S]*if \(segment\.nth && indexAmongSameTag\(el\) !== segment\.nth\) return false;/,
      'Discard restore refs should require id/classes and nth-of-type to match the same element',
    );
    assert.match(
      SOURCE,
      /const restoreHint = mixedTextWrapRestoreHint\(row\.el\);[\s\S]{0,80}if \(restoreHint\) op\.restore = restoreHint;/,
      'Staged mixed-content text edits should carry a restore hint for their parent text node',
    );
    assert.match(
      SOURCE,
      /function restoreMixedTextNodeManualEdit\(op\)[\s\S]*?byIndex\.nodeValue = op\.originalText;/,
      'Discard restore should restore unwrapped mixed-content text nodes by hint',
    );
    assert.doesNotMatch(
      SOURCE,
      /document\.querySelector\(ref\)/,
      'Discard restore must not pass saved document refs directly to querySelector',
    );
    assert.match(
      SOURCE,
      /function pendingApplyLabel\(count\)[\s\S]{0,80}return count === 1 \? 'Apply copy edit' : 'Apply copy edits';/,
      'the staged apply pill should use Apply copy edits copy',
    );
    assert.match(
      SOURCE,
      /function setPendingApplyLoading\(loading, count\)[\s\S]*?pendingPillSpinnerEl\.style\.display = pendingApplyInFlight \? 'inline-block' : 'none';[\s\S]*?pendingPillEl\.disabled = pendingApplyInFlight;[\s\S]*?pendingTrashBtn\.disabled = pendingApplyInFlight;[\s\S]*?schedulePendingDockPosition\(\);[\s\S]*?\n  \}/,
      'Apply copy edits should show a loading state and prevent double apply/discard while the AI batch runs',
    );
    assert.match(
      SOURCE,
      /function handleGo\(\)\s*\{\s*if \(pendingApplyInFlight\) \{ showManualApplyBusyToast\(\); return; \}[\s\S]*?captureAndEmit\(elForCapture, basePayload, snapshot, captureRect\);/,
      'Go should be blocked while manual copy edits are applying',
    );
    assert.match(
      SOURCE,
      /function buildConfigureRow\(\)[\s\S]{0,80}?const controlsLocked = pendingApplyInFlight === true;[\s\S]*?const go = buildConfigureSubmitButton\(\{\s*controlsLocked,/,
      'Configure controls should render disabled while manual copy edits are applying',
    );
    assert.match(
      SOURCE,
      /function buildConfigureSubmitButton\(\{ controlsLocked[\s\S]{0,700}?btn\.disabled = controlsLocked;/,
      'the configure submit button must disable itself while manual copy edits are applying',
    );
    assert.match(
      SOURCE,
      /function handleMouseMove\(e\) \{[\s\S]{0,80}?if \(pendingApplyInFlight\) return;/,
      'Element hover picking should pause while manual copy edits are applying',
    );
    assert.match(
      SOURCE,
      /function togglePick\(\) \{[\s\S]{0,100}?if \(pendingApplyInFlight\) \{ showManualApplyBusyToast\(\); return; \}/,
      'Pick mode should not toggle while manual copy edits are applying',
    );
    assert.match(
      SOURCE,
      /function updateGlobalBarState\(\)[\s\S]*?const controlsLocked = pendingApplyInFlight === true;[\s\S]*?btn\.disabled = controlsLocked;/,
      'Global live controls should be disabled while manual copy edits are applying',
    );
    assert.match(
      SOURCE,
      /function hidePendingApplyDock\(\)[\s\S]*?pendingDockEl\.style\.display = 'none';[\s\S]*?pendingPillEl\.style\.display = 'none';[\s\S]*?pendingTrashBtn\.style\.display = 'none';/,
      'Zero pending copy edits should fully hide the Apply dock controls',
    );
    assert.match(
      SOURCE,
      /case 'manual_edit_commit_done':[\s\S]{0,120}?handleManualEditActivity\(msg\);/,
      'Apply completion SSE should update the pending dock even if HMR interrupts the original fetch handler',
    );
    assert.match(
      SOURCE,
      /case 'manual_edit_apply_reply_received':[\s\S]{0,220}?case 'manual_edit_repair_needs_decision':[\s\S]{0,160}?handleManualEditActivity\(msg\);/,
      'Apply progress and repair SSE should reach the pending dock handler',
    );
    assert.match(
      SOURCE,
      /function remainingManualEditCount\(payload\)[\s\S]*?payload\?\.perPage\?\.\[location\.pathname\][\s\S]*?payload\?\.remainingCount[\s\S]*?payload\?\.totalCount[\s\S]*?if \(totalCount === 0\) return 0;/,
      'Apply completion counts should honor page count first and still hide the dock when only totalCount is zero',
    );
    assert.match(
      SOURCE,
      /if \(msg\.type === 'manual_edit_commit_done'\)[\s\S]*?const remainingCount = remainingManualEditCount\(msg\);[\s\S]*?updatePendingCounter\(remainingCount === null \? 0 : remainingCount\);/,
      'Apply completion SSE should use the shared remaining-count helper',
    );
    assert.match(
      SOURCE,
      /function updateManualApplyProgressFromChunk\(chunk\)[\s\S]*?remainingCount[\s\S]*?phase: remainingCount > 0 \? 'applying' : 'verifying'[\s\S]*?setPendingApplyLoading\(true, remainingCount\);/,
      'Apply progress should count completed chunk ops down and switch to verification after all chunk replies',
    );
    assert.match(
      SOURCE,
      /function manualApplyLoadingText\(fallbackCount\)[\s\S]*?Fixing apply issue, attempt[\s\S]*?Verifying copy edits[\s\S]*?Applying ' \+ remaining \+ ' copy edit/,
      'Apply loading text should cover applying, verifying, and repair states',
    );
    assert.match(
      SOURCE,
      /manual_edit_repair_needs_decision[\s\S]*?showManualApplyDecision\(msg\);/,
      'Repair exhaustion should show the user decision controls instead of hiding the dock',
    );
    assert.match(
      SOURCE,
      /function onPendingKeepFixingClick\(\)[\s\S]*?&repair=1/,
      'Keep fixing should restart the repair loop against the current transaction',
    );
    assert.match(
      SOURCE,
      /function onPendingRollbackClick\(\)[\s\S]*?\/manual-edit-repair-decision[\s\S]*?action: 'rollback'/,
      'Rollback should be an explicit user decision through the repair-decision endpoint',
    );
    const applyStart = SOURCE.indexOf('async function onPendingPillClick');
    const applyEnd = SOURCE.indexOf('async function onPendingTrashClick', applyStart);
    const applyFn = SOURCE.slice(applyStart, applyEnd);
    assert.match(applyFn, /if \(count <= 0 \|\| pendingApplyInFlight\) return;/);
    assert.doesNotMatch(applyFn, /page will reload/);
    assert.match(applyFn, /setPendingApplyLoading\(true, count\);[\s\S]*?\/manual-edit-commit\?token=/);
    assert.match(applyFn, /waitForSseCompletion = true;[\s\S]*?return;/);
    assert.match(applyFn, /finally \{[\s\S]*?if \(waitForSseCompletion\) return;/);
    assert.match(
      SOURCE,
      /String\(newText \|\| ''\)\.trim\(\) === ''[\s\S]{0,120}?Save rejected: copy edits cannot be empty\./,
      'manual copy edits should reject empty text instead of staging unverifiable deletes',
    );
    assert.match(
      SOURCE,
      /pendingTrashTooltipEl\.textContent = 'Discard copy edits';/,
      'the discard button should use tooltip copy',
    );
    assert.match(
      SOURCE,
      /const n = Array\.isArray\(result\.applied\) \? result\.applied\.length : \(result\.cleared \|\| 0\);/,
      'Apply success toast should use verified applied/cleared counts only',
    );
    assert.doesNotMatch(
      SOURCE,
      /result\.applied\?\.length \|\| count/,
      'Apply success toast must not fall back to the original staged count',
    );
    assert.match(
      SOURCE,
      /const width = globalBarEl\.offsetWidth;[\s\S]{0,80}?const height = globalBarEl\.offsetHeight;/,
      'pending dock should position from stable bar dimensions',
    );
    assert.match(
      SOURCE,
      /pendingDockEl\.style\.bottom = Math\.round\(14 \+ \(height \/ 2\)\) \+ 'px';/,
      'pending dock should use fixed bottom anchoring',
    );
    assert.doesNotMatch(
      PENDING_DOCK_POSITION_SOURCE,
      /rect\.top \+ rect\.height \/ 2/,
      'pending dock should not use animated bar rect top for vertical positioning',
    );
    assert.match(
      SOURCE,
      /const sourceHint = sourceHintForElement\(row\.el\);[\s\S]{0,80}?op\.sourceHint = sourceHint;/,
      'manual copy edits should preserve framework source hints when available',
    );
    assert.match(
      SOURCE,
      /const contextRef = documentRefForElement\(contextElement\);[\s\S]{0,80}?op\.contextRef = contextRef;/,
      'manual copy edits should preserve the selected/container DOM path',
    );
    assert.match(
      SOURCE,
      /data-astro-source-file[\s\S]{0,120}?data-astro-source-loc/,
      'Astro source metadata should be captured as optional source hints',
    );
    assert.match(
      SOURCE,
      /op\.leaf = copyEditLeafContext\(row\.el, row\.text, newText\);/,
      'manual copy edits should capture the edited leaf details',
    );
    assert.match(
      SOURCE,
      /op\.nearbyEditableTexts = nearbyEditableTextsForManualEdit\(inlineEditRows, row\.el, row\.text, newText\);/,
      'manual copy edits should capture nearby editable sibling text',
    );
    assert.match(
      SOURCE,
      /function sanitizedContextOuterHTML\(el, maxLength\)[\s\S]*?stripManualEditRuntimeState\(clone\);/,
      'manual copy edit prompt context should strip browser-only edit markers before staging HTML',
    );
    assert.match(
      SOURCE,
      /outerHTML: sanitizedContextOuterHTML\(el, 10000\),/,
      'staged element context should not include live edit runtime attributes',
    );
    assert.match(
      SOURCE,
      /function copyEditLeafContext\(el, originalText, newText\)[\s\S]*?outerHTML: sanitizedContextOuterHTML\(el, 3000\) \|\| null,/,
      'staged leaf context should not include live edit runtime attributes',
    );
    assert.match(
      SOURCE,
      /if \(container\) for \(const op of ops\) op\.container = container;/,
      'manual copy edits should attach selected/container context to each op',
    );
    assert.match(
      SOURCE,
      /const acceptPayload = \{[\s\S]{0,160}?pageUrl: location\.pathname,/,
      'accept events should carry pageUrl so post-accept staged-edit cleanup is page-scoped',
    );
    const sourceHintStart = SOURCE.indexOf('function sourceHintForElement');
    const sourceHintEnd = SOURCE.indexOf('function parseSourceLoc', sourceHintStart);
    const sourceHintFn = SOURCE.slice(sourceHintStart, sourceHintEnd);
    assert.doesNotMatch(
      sourceHintFn,
      /parentElement/,
      'source hints should come from the edited leaf itself, not inherited generated-container ancestors',
    );
  });

  it('keeps sendEvent fire-and-forget by default while accept/discard opt into rejection', () => {
    assert.match(
      SOURCE,
      /function sendEvent\(msg, opts\)[\s\S]*if \(opts && opts\.throwOnError\) \{[\s\S]*console\.error\('\[impeccable\] Failed to send event:', err\);[\s\S]*throw err;[\s\S]*\}[\s\S]*console\.debug\('\[impeccable\] Dropped optional live event:', err\);[\s\S]*return null;/,
      'event=live_browser.send_event_contract actor=browser operation=send_event_failure risk=fire_and_forget_callers_get_unhandled_rejections expected=default swallow with opt-in throw actual=missing',
    );
    assert.match(SOURCE, /if \(res\.ok\) return res;[\s\S]*const body = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);[\s\S]*handleFailure\(new Error\(body\.error \|\| \('HTTP ' \+ res\.status \+ ' ' \+ res\.statusText\)\)\)/);
    assert.match(
      SOURCE,
      /\.then\(async res => \{[\s\S]*if \(res\.ok\) return res;[\s\S]*\}\)\.catch\(handleFailure\)/,
      'event=live_browser.http_error_contract actor=browser operation=accept_discard_ack risk=http_500_clears_local_state_without_durable_receipt expected=non-ok response handled before then-success actual=missing',
    );
    assert.match(SOURCE, /sendEvent\(acceptPayload, \{ throwOnError: true \}\)/);
    assert.match(SOURCE, /sendEvent\(\{ type: 'discard', id: currentSessionId \}, \{ throwOnError: true \}\)/);
  });

  it('releases the foreground picker after deterministic accept while carbonize finishes', () => {
    assert.match(
      SOURCE,
      /let pendingAcceptedSession = null;/,
      'accept flow should keep pending completion state after the browser sends the accept intent',
    );
    assert.match(
      SOURCE,
      /case 'complete':\s*case 'accept':\s*if \(maybeCompleteAcceptedSession\(msg\)\) break;/,
      'final accepted DOM cleanup should be driven by explicit complete or harness accept replies',
    );
    assert.match(
      SOURCE,
      /case 'error':\s*if \(pendingAcceptedSession\?\.id && msg\.id === pendingAcceptedSession\.id\) \{[\s\S]{0,80}?pendingAcceptedSession = null;[\s\S]{0,80}?setLiveState\('CYCLING'\);[\s\S]{0,80}?updateBarContent\('cycling'\);[\s\S]{0,160}?break;/,
      'an SSE error for a queued accept should invalidate pending accept state and keep variants retryable',
    );
    assert.equal(
      SOURCE.match(/function cssIdent\(value\)/g)?.length || 0,
      1,
      'accepted DOM cleanup should reuse the existing cssIdent helper instead of shadowing it',
    );
    const agentDoneStart = SOURCE.indexOf("case 'agent_done':");
    const errorCaseStart = SOURCE.indexOf("case 'error':", agentDoneStart);
    const agentDoneSource = SOURCE.slice(agentDoneStart, errorCaseStart);
    assert.match(agentDoneSource, /must not hold the foreground picker hostage/);
    assert.match(agentDoneSource, /maybeCompleteAcceptedSession\(msg\)/);
    assert.match(
      SOURCE,
      /function handleGo\(\)[\s\S]{0,900}?pendingAcceptedSession = null;[\s\S]{0,80}?currentSessionId = id8\(\);/,
      'starting a new generation should clear any stale accepted-session sentinel first',
    );
    const handleAcceptStart = SOURCE.indexOf('function handleAccept()');
    const maybeCompleteStart = SOURCE.indexOf('function maybeCompleteAcceptedSession', handleAcceptStart);
    const handleAcceptSource = SOURCE.slice(handleAcceptStart, maybeCompleteStart);
    assert.match(
      handleAcceptSource,
      /sendEvent\(acceptPayload, \{ throwOnError: true \}\)[\s\S]*?markSessionHandled\(\);[\s\S]*?setLiveState\('CONFIRMED'\);[\s\S]*?scheduleAcceptCleanup\(pending\);/,
      'durable accept intent should release the foreground picker before background source cleanup completes',
    );
    assert.match(
      SOURCE,
      /function scheduleAcceptCleanup\(accepted\)[\s\S]*?queueMicrotask\(function\(\) \{[\s\S]*?cleanupAcceptedSession\(\);[\s\S]*?setTimeout\(function\(\) \{[\s\S]*?ensureAcceptedDomClean\(accepted\);[\s\S]*?\}, 1200\);/,
      'foreground cleanup should be immediate while the no-HMR DOM fallback stays deferred',
    );
    assert.match(
      SOURCE,
      /function ensureAcceptedDomClean\(pending\)[\s\S]*?acceptedDomAlreadyClean\(pending\)[\s\S]*?findAcceptedRuntimeWrappers\(sessionId\)[\s\S]*?for \(const wrapper of wrappers\)[\s\S]*?parent\.insertBefore\(accepted\.firstChild, wrapper\);[\s\S]*?wrapper\.remove\(\);[\s\S]*?acceptedDomAlreadyClean\(pending\)/,
      'post-cleanup fallback should unwrap the accepted variant instead of preserving live runtime wrappers',
    );
    assert.match(
      SOURCE,
      /function acceptedDomAlreadyClean\(pending\)[\s\S]*?matches\.length > 0[\s\S]*?matches\.every[\s\S]*?data-impeccable-carbonize/,
      'accepted DOM should not be considered clean while any matching root is still inside a carbonize wrapper',
    );
    assert.match(
      SOURCE,
      /function findAcceptedRuntimeWrappers\(sessionId\)[\s\S]*?querySelectorAll\('\[data-impeccable-variants=[\s\S]*?querySelectorAll\('\[data-impeccable-carbonize=/,
      'post-cleanup fallback should remove every stale variants/carbonize wrapper left by React HMR after accept',
    );
    assert.match(
      SOURCE,
      /if \(!accepted\) \{[\s\S]{0,80}?wrapper\.remove\(\);[\s\S]{0,80}?continue;/,
      'post-cleanup fallback should not leave a variants wrapper behind when the accepted variant node is missing',
    );
    assert.match(
      SOURCE,
      /function maybeCompleteAcceptedSession\(msg\)[\s\S]{0,260}?if \(currentSessionId && currentSessionId !== pending\.id\) \{[\s\S]{0,80}?pendingAcceptedSession = null;[\s\S]{0,80}?return false;/,
      'stale accepted completions should not clean up a newer active browser session',
    );
    assert.match(
      SOURCE,
      /function reloadAfterMissingAcceptedDom\(pending\)[\s\S]*?location\.reload\(\);/,
      'missing accepted DOM after clean source should recover by reloading the clean page',
    );
  });

  it('normalizes generated JSX source before source-fallback DOM parsing', () => {
    assert.match(
      SOURCE,
      /parser\.parseFromString\(normalizeSourceFallbackBlock\(block, filePath\), 'text\/html'\)/,
      'source fallback should normalize JSX wrapper syntax before DOMParser sees it',
    );
    assert.match(
      SOURCE,
      /function normalizeSourceFallbackBlock\(block, filePath\)[\s\S]*?<style\\b\(\[\^>\]\*\)>\\s\*\\\{\\s\*`\(\[\\s\\S\]\*\?\)`\\s\*\\\}\\s\*<\\\/style>/,
      'source fallback should unwrap JSX style template literals',
    );
    assert.match(
      SOURCE,
      /replace\(\/\\bclassName\\s\*=\/g, 'class='\)/,
      'source fallback should translate className back to HTML class attributes',
    );
    assert.match(
      SOURCE,
      /value\.replace\(\/\\\$\\\{\[\^}\]\*\\\}\/g, ' '\)/,
      'source fallback should reduce JSX template className values to literal class tokens',
    );
    assert.doesNotMatch(
      SOURCE,
      /querySelectorAll\(tag \+ '\\.' \+ cls\.split/,
      'source fallback should not construct unsafe selectors from JSX-ish class strings',
    );
    assert.match(
      SOURCE,
      /function jsxStyleObjectToCss\(body\)/,
      'source fallback should translate simple JSX style objects such as display:none',
    );
  });

  it('loads progressive source checkpoints through the no-HMR fallback', () => {
    assert.match(
      SOURCE,
      /case 'variant_progress':[\s\S]{0,1400}?msg\.previewMode === 'source'[\s\S]{0,1000}?arrivedVariants >= targetArrived[\s\S]{0,260}?injectVariantsFromSource\(msg\.previewFile \|\| msg\.file, msg\.id\)/,
      'source-mode progress should let framework HMR settle before using the no-HMR fallback',
    );
  });
});
