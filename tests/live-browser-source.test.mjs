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
      /fetch\('http:\/\/localhost:' \+ PORT \+ '\/manual-edit-stash\?token=' \+ encodeURIComponent\(TOKEN\)[\s\S]{0,300}?pageUrl: location\.pathname[\s\S]{0,80}?element: extractContext\(contextElement\)[\s\S]{0,40}?ops,/,
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
      /case 'complete':\s*case 'accept':[\s\S]{0,400}?if \(maybeCompleteAcceptedSession\(msg\)\) break;/,
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
      /function handleGo\(\)[\s\S]{0,900}?pendingAcceptedSession = null;[\s\S]{0,400}?awaitingAcceptResult = null;[\s\S]{0,120}?currentSessionId = id8\(\);/,
      'starting a new generation should clear any stale accepted-session sentinel (and the awaited accept-result marker, #384) first',
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
      /function scheduleAcceptCleanup\(accepted\)[\s\S]*?queueMicrotask\(function\(\) \{[\s\S]*?cleanupAcceptedSession\(\);[\s\S]*?setTimeout\(function\(\) \{[\s\S]*?ensureAcceptedDomClean\(accepted, recoveryRevision\);[\s\S]*?\}, 1200\);/,
      'foreground cleanup should be immediate while the no-HMR DOM fallback stays deferred',
    );
    assert.match(
      SOURCE,
      /function ensureAcceptedDomClean\(pending, recoveryRevision\)[\s\S]*?acceptedDomAlreadyClean\(pending\)[\s\S]*?findAcceptedRuntimeWrappers\(sessionId\)[\s\S]*?for \(const wrapper of wrappers\)[\s\S]*?parent\.insertBefore\(accepted\.firstChild, wrapper\);[\s\S]*?wrapper\.remove\(\);[\s\S]*?acceptedDomAlreadyClean\(pending\)/,
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
      /function reloadAfterMissingAcceptedDom\(pending, recoveryRevision\)[\s\S]*?location\.reload\(\);/,
      'missing accepted DOM after clean source should recover by reloading the clean page',
    );
    assert.match(
      SOURCE,
      /restoreAcceptedDomFromSnapshot\(pending, recoveryRevision\)[\s\S]*?function restoreAcceptedDomFromSnapshot\(pending, recoveryRevision\)[\s\S]*?reloadAfterMissingAcceptedDom\(pending, recoveryRevision\)/,
      'snapshot restoration must carry the originating recovery revision into its reload fallback',
    );
    assert.match(
      SOURCE,
      /function ensureAcceptedDomClean\(pending, recoveryRevision\) \{[\s\S]{0,250}?deferredRecoverySuperseded\(pending\?\.id, recoveryRevision\)[\s\S]*?setTimeout\(function\(\) \{[\s\S]{0,180}?deferredRecoverySuperseded\(pending\?\.id, recoveryRevision\)[\s\S]{0,180}?location\.reload\(\);/,
      'accepted-session cleanup and its reload fallback must yield to a newer Live session',
    );
  });

  it('never runs accept or discard structural fallbacks inside framework-owned HMR DOM', () => {
    assert.match(
      SOURCE,
      /if \(hasFrameworkHmrOwnership\(wrappers\[0\] \|\| pending\?\.parentElement\)\) \{[\s\S]{0,500}?acceptedDomAlreadyClean\(pending\)[\s\S]{0,80}?location\.reload\(\);[\s\S]{0,80}?return;[\s\S]{0,120}?if \(wrappers\.length === 0\)/,
      'accept cleanup must use a reload grace fallback before any framework-owned structural mutation',
    );
    assert.match(
      SOURCE,
      /if \(hasFrameworkHmrOwnership\(lateWrapper\)\) \{[\s\S]{0,900}?location\.reload\(\);[\s\S]{0,100}?return;[\s\S]{0,150}?releaseDiscardedStaticWrapper\(lateWrapper, cleanupSessionId\)/,
      'discard cleanup must use a reload grace fallback before replacing a framework-owned wrapper',
    );
    assert.match(
      SOURCE,
      /function releaseDiscardedStaticWrapper\(wrapper, sessionId\)[\s\S]{0,400}?replaceChild\(content, wrapper\)/,
      'only the static-wrapper release helper may structurally restore discarded DOM',
    );
    assert.match(
      SOURCE,
      /if \(hasFrameworkHmrOwnership\(lateWrapper\)\) \{[\s\S]{0,700}?removeDiscardStateStylesheet\(cleanupSessionId\);[\s\S]{0,120}?location\.reload\(\);/,
      'discard must keep its original-visibility stylesheet until the HMR grace window ends',
    );
    assert.match(
      SOURCE,
      /const recoverySuperseded = deferredRecoverySuperseded\(cleanupSessionId, cleanupRevision\);[\s\S]{0,500}?if \(recoverySuperseded\) \{[\s\S]{0,250}?watchForDiscardedFrameworkWrapperRemoval\(cleanupSessionId\)[\s\S]{0,150}?releaseDiscardedStaticWrapper\(lateWrapper, cleanupSessionId\)[\s\S]{0,80}?return;/,
      'discard cleanup and its reload grace callback must yield to a newer Live session',
    );
    assert.match(
      SOURCE,
      /function discardStateStyleId\(sessionId\)[\s\S]{0,100}?DISCARD_STATE_STYLE_ID \+ '-' \+ sessionId[\s\S]{0,400}?getElementById\(discardStateStyleId\(sessionId\)\)/,
      'concurrent discard sessions must retain independent visibility stylesheets',
    );
    assert.match(
      SOURCE,
      /function removeDiscardStateStylesheet\(sessionId\)[\s\S]{0,100}?if \(!sessionId\) return;[\s\S]{0,100}?getElementById\(discardStateStyleId\(sessionId\)\)\?\.remove\(\);/,
      'an older discard callback must remove only its own session stylesheet',
    );
    assert.match(
      SOURCE,
      /setTimeout\(function\(\) \{[\s\S]{0,300}?const staleWrapper = document\.querySelector[\s\S]{0,250}?deferredRecoverySuperseded\(cleanupSessionId, cleanupRevision\)[\s\S]{0,250}?watchForDiscardedFrameworkWrapperRemoval\(cleanupSessionId\)[\s\S]{0,100}?return;[\s\S]{0,100}?removeDiscardStateStylesheet\(cleanupSessionId\);[\s\S]{0,100}?location\.reload\(\);/,
      'framework discard recovery may observe safe HMR cleanup but must not reload replacement work',
    );
    assert.match(
      SOURCE,
      /const discardedFrameworkWrapperWatchers = new Map\(\);[\s\S]*?function watchForDiscardedFrameworkWrapperRemoval\(sessionId\)[\s\S]{0,1500}?const replacementActive = !!currentSessionId[\s\S]{0,180}?state !== 'IDLE' && state !== 'PICKING'[\s\S]{0,300}?setTimeout\(resolveStillMounted, 12000\)[\s\S]{0,300}?location\.reload\(\);/,
      'discard recovery must keep observing during replacement work and reload stale framework DOM once Live is idle',
    );
  });

  it('recovers a handled variant or carbonize wrapper after HMR cancels the original cleanup timer', () => {
    const start = SOURCE.indexOf('function scheduleHandledRuntimeWrapperReload(wrapper,');
    const end = SOURCE.indexOf('\n  function resumeSession(', start);
    const recovery = SOURCE.slice(start, end);
    assert.match(recovery, /impeccableCarbonize/);
    assert.match(recovery, /sessionStorage\.getItem\(handledWrapperReloadKey\(sessionId\)\)/);
    assert.match(recovery, /sessionStorage\.setItem\(handledWrapperReloadKey\(sessionId\), String\(reloadAttempts \+ 1\)\)/);
    assert.match(recovery, /if \(reloadAttempts >= 2\) return true;/);
    assert.match(recovery, /handledRuntimeWrapperReloadSessions\.has\(sessionId\)/);
    assert.match(recovery, /handledRuntimeWrapperReloadSessions\.add\(sessionId\)/);
    assert.match(
      recovery,
      /deferredRecoverySuperseded\(sessionId, recoveryRevision\)[\s\S]*?return true;[\s\S]*?setTimeout\(function\(\) \{[\s\S]{0,180}?deferredRecoverySuperseded\(sessionId, recoveryRevision\)[\s\S]{0,220}?handledRuntimeWrapperReloadSessions\.delete\(sessionId\);[\s\S]{0,80}?return;/,
      'handled-wrapper recovery must never reload a newer Live session',
    );
    assert.match(
      SOURCE,
      /const handledRuntimeWrapperReloadSessions = new Set\(\);[\s\S]*?function handledWrapperReloadKey\(sessionId\)[\s\S]{0,100}?HANDLED_WRAPPER_RELOAD_KEY \+ ':' \+ sessionId/,
      'overlapping handled sessions must have independent timers and retry budgets',
    );
    assert.match(recovery, /\[data-impeccable-variants=.+\[data-impeccable-carbonize=/s);
    assert.match(recovery, /if \(staleWrapper\) location\.reload\(\);/);
    assert.match(
      SOURCE,
      /function resumeSession\(recoveryRevision = liveInteractionRevision, opts = \{\}\)[\s\S]{0,700}?\[data-impeccable-carbonize\][\s\S]{0,180}?scheduleHandledRuntimeWrapperReload\(runtimeWrapper, recoveryRevision\)/,
      'resume must inspect handled carbonize wrappers before clearing handled state',
    );
    assert.match(
      SOURCE,
      /function restoreSessionSupersedingHandledWrapper\(runtimeWrapper\)[\s\S]{0,900}?saved\.id === handledSessionId[\s\S]{0,300}?restoreSessionWithoutWrapper\('browser_resumed_over_handled_wrapper'\)/,
      'handled-wrapper recovery must recognize a different durable session as newer work',
    );
    assert.match(
      SOURCE,
      /function isUsableInjectionAnchor\(el\)[\s\S]{0,250}?closest\?\.\('\[data-impeccable-variants\],\[data-impeccable-carbonize\]'\)/,
      'a newer restored session must wait for a real page anchor outside stale handled wrappers',
    );
    const resumeStart = SOURCE.indexOf('function resumeSession(');
    const resumeEnd = SOURCE.indexOf('\n  //', resumeStart);
    const resume = SOURCE.slice(resumeStart, resumeEnd);
    assert.ok(
      resume.indexOf('restoreSessionSupersedingHandledWrapper(runtimeWrapper)')
        < resume.indexOf('scheduleHandledRuntimeWrapperReload(runtimeWrapper, recoveryRevision)'),
      'a newer durable session must restore before a stale handled wrapper can schedule another reload',
    );
    assert.doesNotMatch(
      resume,
      /clearHandled\(\);/,
      'bounded handled state must survive arbitrarily late wrapper hydration and later reloads',
    );
    assert.match(
      resume,
      /browser_resumed_svelte_orphan_wrapper[\s\S]{0,150}?clearHandled\(sessionId\);/,
      'orphan cleanup must clear only its own handled id',
    );
    assert.match(
      SOURCE,
      /if \(!accepted\?\.isSvelteComponent\) \{[\s\S]{0,100}?watchForHandledRuntimeWrapper\(accepted\?\.id, recoveryRevision\);/,
      'accept cleanup should watch for a carbonize wrapper mounted by a delayed framework refresh',
    );
    assert.match(
      recovery,
      /function watchForHandledRuntimeWrapper\(sessionId, recoveryRevision = liveInteractionRevision\)[\s\S]*?handledRuntimeWrapperWatchers\.get\(sessionId\)[\s\S]*?observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)[\s\S]*?handledRuntimeWrapperWatchers\.set\(sessionId, \{ observer, timer \}\);/,
      'late handled-wrapper recovery should remain bounded while covering slow HMR updates',
    );
    assert.match(
      SOURCE,
      /const handledRuntimeWrapperWatchers = new Map\(\);[\s\S]*?handledRuntimeWrapperWatchers\.delete\(sessionId\);/,
      'overlapping handled-wrapper scouts must retain independent observer state per session',
    );
  });

  it('keeps watching for a framework wrapper when session restore wins the hydration race', () => {
    assert.match(
      SOURCE,
      /const resumed = resumeSession\(\);[\s\S]{0,1200}?if \(!resumed \|\| !document\.querySelector\('\[data-impeccable-variants\],\[data-impeccable-carbonize\]'\)\) \{[\s\S]{0,500}?const scout = new MutationObserver/,
      'restoring durable session state before hydration must still install the deferred-wrapper scout',
    );
    assert.match(
      SOURCE,
      /const deferredResumeRevision = liveInteractionRevision;[\s\S]{0,350}?const scout = new MutationObserver[\s\S]{0,400}?resumeSession\(deferredResumeRevision, \{ reason: 'browser_resumed_deferred_wrapper' \}\)/,
      'the deferred-wrapper scout must retain its originating interaction revision and name itself in the journal',
    );
  });

  it('finishes the cycling transition when the resume is the arrival (#719)', () => {
    // The server's generation preflight runs live-wrap with
    // --defer-source-write, so the wrapper and every variant reach the DOM in
    // one HMR batch. The deferred-wrapper scout is constructed at init, the
    // variant MutationObserver at Go, and observer callbacks run in
    // construction order, so on that batch the scout resumes first and
    // resumeSession IS the transition into CYCLING. It has to finish the same
    // transition the observer would have: leaving the generating shader up
    // paints a frozen capture of the original over a DOM that already holds
    // the variants, which is the stuck loader from issue #719.
    const resumeStart = SOURCE.indexOf('function resumeSession(');
    const resumeEnd = SOURCE.indexOf('\n  //', resumeStart);
    const resume = SOURCE.slice(resumeStart, resumeEnd);
    assert.match(
      resume,
      /if \(state === 'CYCLING'\) \{[\s\S]{0,200}?hideShaderOverlay\(\);/,
      'a resume into CYCLING must take the generating shader down',
    );
    assert.match(
      resume,
      /if \(state === 'CYCLING'\) \{[\s\S]{0,700}?refreshParamsPanel\(\);/,
      'a resume into CYCLING must still rebuild the params panel',
    );
    // Only variants_progress|variants_ready count as publication progress, so
    // a resume that already holds every variant has to report one of them or
    // the server never learns the generation was published.
    assert.match(
      resume,
      /queueCheckpoint\(resumeReason\);[\s\S]{0,500}?sendCheckpoint\('variants_ready'\)/,
      'a complete resume must report variants_ready, not only browser_resumed',
    );
  });

  it('never leaves a shader behind when the teardown races its construction (#719)', () => {
    // showShaderOverlay appends its canvas, then awaits createImageBitmap and
    // the GL setup before it publishes shaderState. A teardown inside that
    // window found shaderState null, returned, and then watched the
    // construction publish itself over a session that had already reached
    // CYCLING, with no teardown left to run. On a slow runner that is the
    // generating loader frozen over a page that already cycles.
    const hideStart = SOURCE.indexOf('function hideShaderOverlay()');
    const hide = SOURCE.slice(hideStart, SOURCE.indexOf('\n  function ', hideStart + 10));
    assert.match(
      hide,
      /shaderEpoch \+= 1;[\s\S]{0,120}?if \(!shaderState\) \{/,
      'the epoch must be bumped before the no-state early return, or an in-flight construction never hears about the teardown',
    );
    assert.match(hide, /removeStrayShaderNode\(\);/, 'a teardown must also drop a shader node no state owns');

    const showStart = SOURCE.indexOf('async function showShaderOverlay(');
    const show = SOURCE.slice(showStart, SOURCE.indexOf('\n  async function handleAccept', showStart));
    assert.match(show, /const epoch = shaderEpoch;/, 'the construction must pin the epoch it owns');
    assert.match(
      show,
      /const abandoned = \(node, gl\) => \{[\s\S]{0,80}?if \(epoch === shaderEpoch\) return false;[\s\S]{0,200}?return true;/,
      'abandoning must remove the canvas and release the GL context',
    );
    assert.match(
      show,
      /if \(abandoned\(canvas, gl\)\) return;\n    shaderState = \{ canvas, gl, program, texture,/,
      'the publish must be guarded by the epoch it pinned',
    );
    const awaitIdx = show.indexOf('await createImageBitmap(blob)');
    assert.ok(awaitIdx > 0, 'createImageBitmap is the await this guards');
    assert.ok(
      show.indexOf('if (abandoned(canvas, gl))', awaitIdx) > awaitIdx,
      'the bitmap await must be followed by an abandonment check',
    );
    for (const call of ['showShaderBitmapFallback(canvas, blob);']) {
      let at = show.indexOf(call);
      assert.ok(at > 0, call);
      while (at > 0) {
        const before = show.slice(Math.max(0, at - 220), at);
        assert.match(before, /abandoned\(canvas, (?:gl|null)\)/, 'every fallback publish must be epoch guarded');
        at = show.indexOf(call, at + 1);
      }
    }
  });

  it('lowers the shader on every route that sets CYCLING (#719)', () => {
    // resumeSession reaches CYCLING through setLiveState(resumedState), which
    // its own block covers; every literal site has to lower the loader too.
    const sites = [...SOURCE.matchAll(/setLiveState\('CYCLING'\);/g)].map((m) => m.index);
    assert.ok(sites.length >= 8, `expected the known CYCLING sites, saw ${sites.length}`);
    for (const at of sites) {
      const after = SOURCE.slice(at, at + 260);
      assert.match(
        after,
        /hideShaderOverlay\(\);/,
        `a setLiveState('CYCLING') at offset ${at} does not lower the generating shader`,
      );
    }
  });

  it('prefers the wrapper that actually holds variants over the first match (#719)', () => {
    // A target inside a `.map()` renders one wrapper per item, and an agent
    // that relocates the wrapper out of the shared primitive live-wrap
    // scaffolded leaves an empty one behind. First match can then pin a
    // scaffold with no variants and strand the session at 0/N.
    const start = SOURCE.indexOf('function findVariantsWrapper(sessionId)');
    assert.ok(start > 0, 'findVariantsWrapper must exist');
    const helper = SOURCE.slice(start, SOURCE.indexOf('\n  function startVariantObserver(', start));
    assert.match(helper, /if \(matches\.length < 2\) return matches\[0\] \|\| null;/);
    assert.match(
      helper,
      /candidate\.querySelector\('\[data-impeccable-variant\]:not\(\[data-impeccable-variant="original"\]\)'\)[\s\S]{0,80}?return candidate;/,
      'the preferred wrapper is the one holding non-original variants',
    );
    assert.match(helper, /return matches\[0\];/, 'with no populated wrapper the old first match still wins');
    for (const caller of [
      'const wrapper = findVariantsWrapper(sessionId);',
      'const wrapper = findVariantsWrapper(null);',
    ]) {
      assert.ok(SOURCE.includes(caller), `${caller} should be how the resolvers look a wrapper up`);
    }
  });

  it('invalidates nullable deferred recovery as soon as a replacement edit starts configuring', () => {
    assert.match(
      SOURCE,
      /function beginNewLiveConfiguration\(\) \{[\s\S]{0,100}?liveInteractionRevision \+= 1;[\s\S]{0,80}?setLiveState\('CONFIGURING'\);/,
    );
    assert.equal(
      SOURCE.match(/beginNewLiveConfiguration\(\);/g)?.length || 0,
      3,
      'mouse replace, mouse insert, and keyboard configuration must all supersede older recovery timers',
    );
    assert.match(
      SOURCE,
      /function deferredRecoverySuperseded\(sessionId, recoveryRevision\) \{[\s\S]{0,160}?liveInteractionRevision !== recoveryRevision[\s\S]{0,100}?currentSessionId !== sessionId/,
      'recovery must be fenced before a replacement configuration has a non-null session id',
    );
    assert.match(
      SOURCE,
      /function scheduleAcceptCleanup\(accepted\) \{[\s\S]{0,100}?const recoveryRevision = liveInteractionRevision;[\s\S]*?watchForHandledRuntimeWrapper\(accepted\?\.id, recoveryRevision\)/,
      'accept and handled-wrapper recovery must share the originating interaction revision',
    );
  });

  it('never DOMParser-injects JSX source (#454)', () => {
    const isJsxStart = SOURCE.indexOf('function isJsxSourceFile(');
    const isJsxEnd = SOURCE.indexOf('function sourceHasSessionWrapper(', isJsxStart);
    const isJsxSourceFile = new Function(
      SOURCE.slice(isJsxStart, isJsxEnd) + '\nreturn isJsxSourceFile;',
    )();

    assert.equal(isJsxSourceFile('src/App.jsx'), true);
    assert.equal(isJsxSourceFile('panel/src/Widget.tsx'), true);
    assert.equal(isJsxSourceFile('index.html'), false);
    assert.equal(isJsxSourceFile('Card.vue'), false);

    const injectStart = SOURCE.indexOf('function injectVariantsFromSource(');
    const injectEnd = SOURCE.indexOf('function buildSvelteExpressionTextMap', injectStart);
    const injectFn = SOURCE.slice(injectStart, injectEnd);
    const jsxGateIdx = injectFn.indexOf('if (isJsxSourceFile(filePath))');
    const htmlFetchIdx = injectFn.indexOf("const url = 'http://localhost:'");
    assert.ok(jsxGateIdx !== -1 && htmlFetchIdx > jsxGateIdx, 'JSX must return before /source fetch');
    const jsxGate = injectFn.slice(jsxGateIdx, htmlFetchIdx);
    assert.doesNotMatch(
      jsxGate,
      /replaceChild/,
      'the JSX gate must not replaceChild a React tree',
    );
    assert.doesNotMatch(
      jsxGate,
      /discardOrphanedSession/,
      'a missing JSX wrap must not discard from the DOM alone; only the source probe may decide',
    );
    assert.match(
      jsxGate,
      /if \(opts\.orphanDiscard && !liveWrapper && sessionId === currentSessionId\) \{\s*probeJsxWrapperForOrphan\(filePath, sessionId, opts\);/,
      'a resumed CYCLING session with no mounted JSX wrapper must run the source orphan probe (#439)',
    );
    assert.match(
      jsxGate,
      /if \(!liveWrapper\) \{[\s\S]*?showToast\([\s\S]*?return;[\s\S]*?if \(liveWrapper\.dataset\.impeccableMode !== 'insert'\) \{[\s\S]*?recoverEmptyCycling\('source-fallback-empty'\)/,
      'missing wrap waits; empty replace wrap recovers after retries; insert scaffolds stay',
    );
    assert.doesNotMatch(SOURCE, /function normalizeSourceFallbackBlock/);
    assert.doesNotMatch(SOURCE, /function jsxStyleObjectToCss/);
    assert.match(
      injectFn,
      /parser\.parseFromString\(block, 'text\/html'\)/,
      'HTML fallback should parse the extracted marker block as HTML',
    );
    assert.match(
      injectFn,
      /const startMark = '<!-- impeccable-variants-start ' \+ sessionId \+ ' -->'/,
      'HTML fallback should still scan HTML comment markers',
    );
    assert.doesNotMatch(
      SOURCE,
      /querySelectorAll\(tag \+ '\\.' \+ cls\.split/,
      'source fallback should not construct unsafe selectors from JSX-ish class strings',
    );
  });

  it('self-discards a JSX session whose wrapper left the source file (#439)', () => {
    const probeStart = SOURCE.indexOf('function probeJsxWrapperForOrphan(');
    assert.ok(probeStart !== -1, 'the JSX orphan probe must exist');
    const probeEnd = SOURCE.indexOf('function completeSourceInjection', probeStart);
    const probe = SOURCE.slice(probeStart, probeEnd);

    // #454 stands: the probe reads the file as text and never builds a DOM
    // from it, so raw JSX can never reach the page through this path.
    for (const forbidden of ['DOMParser', 'parseFromString', 'replaceChild', 'innerHTML']) {
      assert.ok(!probe.includes(forbidden), 'the orphan probe must not ' + forbidden + ' JSX source');
    }
    assert.match(probe, /\.then\(r => \{ if \(!r\.ok\) throw new Error\('source read failed: ' \+ r\.status\); return r\.text\(\); \}\)/);
    assert.match(
      probe,
      /if \(sourceHasSessionWrapper\(text, sessionId\)\) return;/,
      'a wrapper still in source is an unmounted component, not an orphan',
    );
    assert.match(
      probe,
      /const onNoWrapper = \(reason\) => \{[\s\S]*?if \(attempt < COMPLETED_SOURCE_FALLBACK_RETRIES\) \{ retryLater\(\); return; \}\s*discardOrphanedSession\(reason\);/,
      'the probe must exhaust the shared retry budget before discarding',
    );
    assert.match(
      probe,
      /onNoWrapper\('variant wrapper missing from source'\)/,
      'a read without the marker retries on the budget, then discards',
    );
    // A read that cannot answer must not strand the session (no empty catch),
    // and only evidence that the wrapper is gone may discard: a 404 (the file
    // renamed or deleted) counts, a transient failure does not.
    assert.doesNotMatch(probe, /\.catch\(\(\) => \{\}\)/, 'the probe must not swallow source read failures');
    assert.match(
      probe,
      /source read failed: 404\$\/\.test\(detail\)\) \{\s*onNoWrapper\('source file missing \(404\)/,
      'a 404 is evidence the file is gone: retry on the budget, then discard',
    );
    assert.match(
      probe,
      /const onUnreadable = \(detail\) => \{[\s\S]*?retryLater\(\); return; \}[\s\S]*?showToast\(/,
      'a transient failure retries on the budget and then keeps the session, telling the user',
    );
    assert.doesNotMatch(
      probe.slice(probe.indexOf('const onUnreadable')),
      /discardOrphanedSession/,
      'a transient failure must never discard a session',
    );

    const matchStart = SOURCE.indexOf('function sourceHasSessionWrapper(');
    const sourceHasSessionWrapper = new Function(
      SOURCE.slice(matchStart, probeStart) + '\nreturn sourceHasSessionWrapper;',
    )();
    assert.equal(sourceHasSessionWrapper('<div data-impeccable-variants="ab12cd34">', 'ab12cd34'), true);
    assert.equal(sourceHasSessionWrapper("<div data-impeccable-variants='ab12cd34'>", 'ab12cd34'), true);
    assert.equal(sourceHasSessionWrapper('{/* impeccable-variants-start ab12cd34 */}', 'ab12cd34'), true);
    assert.equal(sourceHasSessionWrapper('<div data-impeccable-variants="99887766">', 'ab12cd34'), false);
    assert.equal(sourceHasSessionWrapper('', 'ab12cd34'), false);
  });

  it('does not source-inject per variant_progress checkpoint (HMR owns mid-generation reconciliation)', () => {
    // Isolate the variant_progress handler body.
    const progressCase = SOURCE.match(/case 'variant_progress':[\s\S]*?break;/);
    assert.ok(progressCase, 'variant_progress case should exist');
    assert.doesNotMatch(
      progressCase[0],
      /injectVariantsFromSource\(/,
      'source-mode progress must not source-inject per checkpoint; it races React/Vue ownership and triggers removeChild errors',
    );
    // The svelte-component progressive path stays.
    assert.match(
      progressCase[0],
      /injectSvelteComponentsFromManifest\(msg\.previewFile, msg\.id\)/,
      'component-preview progressive delivery must still stream per checkpoint',
    );
  });

  it('source-injects only on the final done branch, keeping the 750ms settle', () => {
    const doneCase = SOURCE.match(/case 'done':[\s\S]*?break;\n {8}case /);
    assert.ok(doneCase, 'done case should exist');
    assert.match(
      doneCase[0],
      /setTimeout\([\s\S]{0,260}?injectVariantsFromSource\(msg\.file, msg\.id, \{ generationCompleted: true \}\)[\s\S]{0,40}?\}, 750\)/,
      'done should source-inject via the 750ms fallback for harnesses without HMR',
    );
  });
});
