import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EVENT_LEASE_MS,
  buildAcceptScriptArgs,
  buildPollReplyPayload,
  isEventPending,
  manualApplyPollBanner,
  parseReplyArgs,
  requiresAgentReply,
} from '../skill/scripts/live-poll.mjs';
import { completionTypeForAcceptResult } from '../skill/scripts/live-completion.mjs';

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

describe('live-poll accept handling', () => {
  it('forwards pageUrl to live-accept so staged manual edits are scrubbed by page', () => {
    assert.deepEqual(
      buildAcceptScriptArgs({
        type: 'accept',
        id: 'abc12345',
        variantId: 2,
        pageUrl: '/pricing',
      }),
      ['--id', 'abc12345', '--variant', '2', '--page-url', '/pricing'],
    );
  });

  it('ignores legacy defer-source-write requests so accepts write source immediately', () => {
    assert.deepEqual(
      buildAcceptScriptArgs({
        type: 'accept',
        id: 'abc12345',
        variantId: 1,
        pageUrl: '/',
        deferSourceWrite: true,
      }),
      ['--id', 'abc12345', '--variant', '1', '--page-url', '/'],
    );
  });

  it('maps failed accept promotion to error instead of agent_done', () => {
    assert.equal(
      completionTypeForAcceptResult('accept', {
        handled: false,
        previewMode: 'svelte-component',
        file: 'src/routes/+page.svelte',
        componentDir: 'node_modules/.impeccable-live/abc12345',
        error: 'Variant 3 not found',
      }),
      'error',
    );
  });

  it('maps successful immediate accept promotion to complete', () => {
    assert.equal(
      completionTypeForAcceptResult('accept', {
        handled: true,
        previewMode: 'svelte-component',
        file: 'src/routes/+page.svelte',
      }),
      'complete',
    );
  });
});

describe('live-poll manual Apply guidance', () => {
  it('prints a bounded stderr banner that keeps stdout JSON parseable', () => {
    const banner = manualApplyPollBanner({ id: 'b79a4167' });
    assert.match(banner, /Manual Apply action required/);
    assert.match(banner, /--reply b79a4167 done --data '<json>'/);
    assert.match(banner, /status, appliedEntryIds, failed, files, and notes/);
    assert.match(banner, /summary counters are only a recovery fallback/);
    assert.match(banner, /Do not run live-commit-manual-edits\.mjs/);
    assert.match(banner, /Do not poll again before replying/);
    assert.doesNotMatch(banner, /\{/);
  });
});

describe('live-poll --reply arg parsing', () => {
  it('returns null when --reply is absent', () => {
    assert.equal(parseReplyArgs(['--timeout=600000']), null);
  });

  it('parses id, status, and a --data JSON payload for manual_edit_apply', () => {
    const dataJson = JSON.stringify({
      status: 'done',
      appliedEntryIds: ['8hexid'],
      failed: [],
      files: ['src/page.html'],
      notes: [],
    });
    const reply = parseReplyArgs(['--reply', '8hexid', 'done', '--data', dataJson]);
    assert.equal(reply.id, '8hexid');
    assert.equal(reply.type, 'done');
    assert.deepEqual(reply.data, {
      status: 'done',
      appliedEntryIds: ['8hexid'],
      failed: [],
      files: ['src/page.html'],
      notes: [],
    });
    // The --data value must not be misread as the trailing message positional.
    assert.equal(reply.message, undefined);
  });

  it('parses a steer_done reply with a source file', () => {
    const reply = parseReplyArgs(['--reply', 'abc12345', 'steer_done', '--file', 'src/routes/+page.svelte', 'Title updated']);
    assert.equal(reply.id, 'abc12345');
    assert.equal(reply.type, 'steer_done');
    assert.equal(reply.file, 'src/routes/+page.svelte');
    assert.equal(reply.message, 'Title updated');
  });

  it('reaches the POST body unchanged through buildPollReplyPayload', () => {
    const reply = parseReplyArgs(['--reply', 'abc12345', 'done', '--data', '{"status":"partial","appliedEntryIds":["abc12345"]}']);
    const payload = buildPollReplyPayload('tok', reply);
    assert.equal(payload.id, 'abc12345');
    assert.deepEqual(payload.data, { status: 'partial', appliedEntryIds: ['abc12345'] });
  });

  it('keeps a trailing error message distinct from flag values', () => {
    const reply = parseReplyArgs(['--reply', 'abc12345', 'error', 'could not resolve sources']);
    assert.equal(reply.type, 'error');
    assert.equal(reply.message, 'could not resolve sources');
    assert.equal(reply.data, undefined);
  });

  it('throws INVALID_DATA_JSON when --data is not valid JSON', () => {
    assert.throws(
      () => parseReplyArgs(['--reply', 'abc12345', 'done', '--data', '{not json}']),
      (err) => err.code === 'INVALID_DATA_JSON' && /must be valid JSON/.test(err.message),
    );
  });

  it('rejects the common malformed manual-apply ack that omits the event id', () => {
    assert.throws(
      () => parseReplyArgs(['--reply', 'done', '--file', 'site/pages/index.astro']),
      (err) =>
        err.code === 'INVALID_REPLY_ARGS'
        && /must be the event id/.test(err.message)
        && /--reply EVENT_ID done/.test(err.message),
    );
  });

  it('requires an explicit reply status after the event id', () => {
    assert.throws(
      () => parseReplyArgs(['--reply', 'abc12345', '--file', 'src/App.tsx']),
      (err) =>
        err.code === 'INVALID_REPLY_ARGS'
        && /Missing reply status/.test(err.message),
    );
  });

  it('coexists with --file without cross-contaminating values', () => {
    const reply = parseReplyArgs(['--reply', 'abc12345', 'done', '--file', 'src/App.tsx', '--data', '{"status":"done"}']);
    assert.equal(reply.file, 'src/App.tsx');
    assert.deepEqual(reply.data, { status: 'done' });
    assert.equal(reply.message, undefined);
  });
});

describe('live-poll stream helpers', () => {
  it('uses a long event lease for human-paced Codex live handling', () => {
    assert.equal(DEFAULT_EVENT_LEASE_MS, 600_000);
  });

  it('requiresAgentReply is true for work items that need agent acknowledgement', () => {
    assert.equal(requiresAgentReply({ type: 'generate' }), true);
    assert.equal(requiresAgentReply({ type: 'steer' }), true);
    assert.equal(requiresAgentReply({ type: 'manual_edit_apply' }), true);
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
