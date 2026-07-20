/**
 * Tests for live/poll-lanes.mjs — which pending event a poll gets next.
 * Run with: node --test tests/live-poll-lanes.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { eventPriority, selectAvailablePendingEvent } from '../skill/scripts/live/poll-lanes.mjs';

const entry = (type, seq, leaseUntil = 0, id = type + seq) => ({ event: { id, type }, leaseUntil, seq });

describe('poll lane priority', () => {
  it('puts terminal user actions ahead of generation', () => {
    for (const type of ['accept', 'discard', 'exit']) {
      assert.ok(
        eventPriority({ type }) < eventPriority({ type: 'generate' }),
        `${type} must outrank generate`,
      );
    }
  });

  it('ranks unknown event types last rather than first', () => {
    assert.ok(eventPriority({ type: 'something-new' }) > eventPriority({ type: 'generate' }));
    assert.ok(eventPriority({}) > eventPriority({ type: 'generate' }));
  });

  // This is what makes the browser's optimistic Accept safe. The browser returns
  // to PICKING as soon as /events durably journals the accept, before the source
  // write happens, so the user can pick and hit Go while the accept is still
  // queued. If that generate were leased first, its preflight would wrap source
  // that still contains the previous session's variant markers.
  it('delivers a queued accept before a generate the user queued afterwards', () => {
    const selected = selectAvailablePendingEvent([
      entry('accept', 1),
      entry('generate', 2),
    ]);
    assert.equal(selected.event.type, 'accept');
  });

  it('delivers the accept first even when the generate was queued earlier', () => {
    const selected = selectAvailablePendingEvent([
      entry('generate', 1),
      entry('accept', 2),
    ]);
    assert.equal(
      selected.event.type,
      'accept',
      'priority must beat arrival order, or a slow poller preflights against stale source',
    );
  });

  it('breaks ties within one lane by arrival order', () => {
    const selected = selectAvailablePendingEvent([
      entry('generate', 7),
      entry('generate', 3),
    ]);
    assert.equal(selected.seq, 3);
  });
});

describe('poll lane availability', () => {
  it('skips an entry whose lease is still held', () => {
    const now = 1_000_000;
    const selected = selectAvailablePendingEvent([
      entry('accept', 1, now + 30_000),
      entry('generate', 2),
    ], { now });
    assert.equal(selected.event.type, 'generate', 'a leased accept must not be handed out twice');
  });

  it('re-offers an entry once its lease has expired', () => {
    const now = 1_000_000;
    const selected = selectAvailablePendingEvent([entry('accept', 1, now - 1)], { now });
    assert.equal(selected.event.type, 'accept');
  });

  it('returns null when everything is leased', () => {
    const now = 1_000_000;
    assert.equal(selectAvailablePendingEvent([entry('accept', 1, now + 5_000)], { now }), null);
  });

  it('returns null for an empty queue', () => {
    assert.equal(selectAvailablePendingEvent([]), null);
  });

  it('restricts delivery to the requested types', () => {
    const entries = [entry('accept', 1), entry('generate', 2)];
    assert.equal(selectAvailablePendingEvent(entries, { types: ['generate'] }).event.type, 'generate');
    assert.equal(selectAvailablePendingEvent(entries, { types: new Set(['generate']) }).event.type, 'generate');
    assert.equal(selectAvailablePendingEvent(entries, { types: ['steer'] }), null);
  });

  it('ignores an empty or absent type filter instead of starving the queue', () => {
    const entries = [entry('generate', 1)];
    assert.equal(selectAvailablePendingEvent(entries, { types: null }).event.type, 'generate');
    assert.equal(selectAvailablePendingEvent(entries, {}).event.type, 'generate');
  });
});
