import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(process.cwd(), 'skill/scripts/live-browser.js'), 'utf-8');

describe('live-browser source contracts', () => {
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
      /fetch\([^)]*\/manual-edit-commit\?token=/,
      'Apply copy edits should call /manual-edit-commit',
    );
    assert.match(
      SOURCE,
      /fetch\([^)]*\/manual-edit-discard\?token=/,
      'Discard copy edits should call /manual-edit-discard',
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
    const applyStart = SOURCE.indexOf('async function onPendingPillClick');
    const applyEnd = SOURCE.indexOf('async function onPendingTrashClick', applyStart);
    const applyFn = SOURCE.slice(applyStart, applyEnd);
    assert.match(applyFn, /if \(count <= 0 \|\| pendingApplyInFlight\) return;/);
    assert.match(applyFn, /setPendingApplyLoading\(true, count\);[\s\S]*?\/manual-edit-commit\?token=/);
    assert.match(applyFn, /finally \{[\s\S]*?setPendingApplyLoading\(false\);[\s\S]*?\}/);
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
      SOURCE,
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
      /if \(container\) for \(const op of ops\) op\.container = container;/,
      'manual copy edits should attach selected/container context to each op',
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
      /function sendEvent\(msg, opts\)[\s\S]*if \(opts && opts\.throwOnError\) throw err;[\s\S]*return null;/,
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
});
