import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { completionTypeForAcceptResult } from '../source/skills/impeccable/scripts/live-completion.mjs';

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

  it('classifies handled accept/discard and real failures explicitly', () => {
    assert.equal(completionTypeForAcceptResult('accept', { handled: true }), 'complete');
    assert.equal(completionTypeForAcceptResult('discard', { handled: true }), 'discarded');
    assert.equal(completionTypeForAcceptResult('accept', { handled: false, mode: 'error', error: 'boom' }), 'error');
  });
});
