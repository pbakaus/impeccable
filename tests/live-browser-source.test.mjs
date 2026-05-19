import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(process.cwd(), 'skill/scripts/live-browser.js'), 'utf-8');

describe('live-browser source contracts', () => {
  it('keeps copy-edit apply control outside the global live bar', () => {
    assert.match(
      SOURCE,
      /pendingDockEl\.id = PREFIX \+ '-pending-dock'/,
      'copy edit controls should render in their own dock beside the global bar',
    );
    assert.match(
      SOURCE,
      /pendingDockEl\.appendChild\(pendingPillEl\);[\s\S]{0,120}?pendingDockEl\.appendChild\(pendingTrashBtn\);/,
      'the apply copy edits pill should sit left of the discard icon in the pending dock',
    );
    assert.doesNotMatch(
      SOURCE,
      /inner\.appendChild\(pendingPillEl\)/,
      'the apply copy edits pill must stay outside the global live bar',
    );
    assert.match(
      SOURCE,
      /previousCount <= 0\) playPendingIntroAnimation\(\)/,
      'the apply copy edits pill should animate when pending edits first appear',
    );
    assert.match(
      SOURCE,
      /pendingPillLabelEl\.textContent = currentPageCount === 1 \? 'Apply copy edit' : 'Apply copy edits'/,
      'the pending apply action should use copy-edit language instead of staged-edit language',
    );
    assert.match(
      SOURCE,
      /pendingTrashTooltipEl\.textContent = 'Discard copy edits'/,
      'the discard affordance should show copy-edit language in a tooltip',
    );
    assert.doesNotMatch(
      SOURCE,
      /pendingTrashBtn\.style\.width = '142px'/,
      'the discard affordance should stay icon-sized instead of expanding into a text pill',
    );
  });

  it('keeps sendEvent fire-and-forget by default while accept/discard opt into rejection', () => {
    assert.match(
      SOURCE,
      /function sendEvent\(msg, opts\)[\s\S]*if \(opts && opts\.throwOnError\) throw err;[\s\S]*return null;/,
      'event=live_browser.send_event_contract actor=browser operation=send_event_failure risk=fire_and_forget_callers_get_unhandled_rejections expected=default swallow with opt-in throw actual=missing',
    );
    assert.match(SOURCE, /if \(res\.ok\) return res;[\s\S]*handleFailure\(new Error\('HTTP ' \+ res\.status \+ ' ' \+ res\.statusText\)\)/);
    assert.match(
      SOURCE,
      /\.then\(res => \{[\s\S]*if \(res\.ok\) return res;[\s\S]*\}\)\.catch\(handleFailure\)/,
      'event=live_browser.http_error_contract actor=browser operation=accept_discard_ack risk=http_500_clears_local_state_without_durable_receipt expected=non-ok response handled before then-success actual=missing',
    );
    assert.match(SOURCE, /sendEvent\(acceptPayload, \{ throwOnError: true \}\)/);
    assert.match(SOURCE, /sendEvent\(\{ type: 'discard', id: currentSessionId \}, \{ throwOnError: true \}\)/);
  });
});
