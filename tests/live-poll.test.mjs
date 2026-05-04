import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPollReplyPayload } from '../skill/scripts/live-poll.mjs';

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
