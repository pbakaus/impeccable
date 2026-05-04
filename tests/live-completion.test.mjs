import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  completionAckForAcceptResult,
  completionTypeForAcceptResult,
} from '../skill/scripts/live-completion.mjs';

describe('live completion type classification', () => {
  it('treats generated-file fallback accept as normal agent handoff, not error', () => {
    assert.equal(
      completionTypeForAcceptResult('accept', { handled: false, mode: 'fallback' }),
      'agent_done',
      'event=live_poll.fallback_completion actor=agent operation=accept_generated_file risk=fallback_handoff_recorded_as_agent_error expected=agent_done actual=error',
    );
  });

  it('treats unhandled non-error accept as normal manual agent handoff', () => {
    assert.equal(
      completionTypeForAcceptResult('accept', { handled: false, error: 'Session markers not found' }),
      'agent_done',
      'event=live_poll.manual_accept_completion actor=agent operation=accept_manual_cleanup risk=manual_handoff_recorded_as_agent_error expected=agent_done actual=error',
    );
  });

  it('keeps carbonize-required accepts recoverable until cleanup is completed', () => {
    assert.equal(
      completionTypeForAcceptResult('accept', { handled: true, carbonize: true }),
      'agent_done',
      'event=live_poll.carbonize_completion actor=agent operation=accept_with_carbonize risk=carbonize_session_marked_completed_before_cleanup expected=agent_done actual=complete',
    );
  });

  it('marks carbonize acknowledgements as non-final and requiring explicit completion', () => {
    assert.deepEqual(
      completionAckForAcceptResult('carbonize-1', 'agent_done', { handled: true, carbonize: true }),
      {
        ok: true,
        type: 'agent_done',
        final: false,
        requiresComplete: true,
        nextCommand: 'live-complete.mjs --id carbonize-1',
        message: 'Carbonize cleanup must be verified, then the session must be completed explicitly before polling again.',
      },
      'event=live_poll.carbonize_ack actor=agent operation=accept_with_carbonize risk=active_session_never_completed expected=explicit_complete_required actual=missing_requires_complete',
    );
  });

  it('keeps normal handled accepts terminal', () => {
    assert.deepEqual(
      completionAckForAcceptResult('done-1', 'complete', { handled: true, carbonize: false }),
      { ok: true, type: 'complete' },
    );
  });

  it('classifies handled accept/discard and real failures explicitly', () => {
    assert.equal(completionTypeForAcceptResult('accept', { handled: true }), 'complete');
    assert.equal(completionTypeForAcceptResult('discard', { handled: true }), 'discarded');
    assert.equal(completionTypeForAcceptResult('accept', { handled: false, mode: 'error', error: 'boom' }), 'error');
  });
});
