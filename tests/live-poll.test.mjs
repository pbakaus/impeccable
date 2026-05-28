import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPollReplyPayload,
  isEventPending,
  requiresAgentReply,
} from '../skill/scripts/live-poll.mjs';

describe('live-poll reply payloads', () => {
  it('preserves structured data for durable carbonize recovery acknowledgements', () => {
    const payload = buildPollReplyPayload('token-1', {
      id: 'carbonize-reply-1',
      type: 'agent_done',
      file: 'src/App.jsx',
      data: { carbonize: true },
    });

    assert.deepEqual(
      payload.data,
      { carbonize: true },
      'event=live_poll.reply_data actor=agent operation=completion_ack risk=carbonize_flag_dropped_before_server_journal expected={"carbonize":true} actual=' + JSON.stringify(payload.data),
    );
  });
});

describe('live-poll stream helpers', () => {
  it('requiresAgentReply is true only for generate and steer', () => {
    assert.equal(requiresAgentReply({ type: 'generate' }), true);
    assert.equal(requiresAgentReply({ type: 'steer' }), true);
    assert.equal(requiresAgentReply({ type: 'prefetch' }), false);
    assert.equal(requiresAgentReply({ type: 'accept' }), false);
    assert.equal(requiresAgentReply({ type: 'timeout' }), false);
  });

  it('isEventPending matches pendingEvents by id', () => {
    const status = {
      pendingEvents: [
        { id: 'abc12345', type: 'steer', leased: true },
        { id: 'deadbeef', type: 'generate', leased: false },
      ],
    };
    assert.equal(isEventPending(status, 'abc12345'), true);
    assert.equal(isEventPending(status, '00000000'), false);
  });
});
