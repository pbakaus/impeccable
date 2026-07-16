/**
 * Unit tests for live-event-validation.mjs
 * Run with: node --test tests/live-event-validation.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent } from '../skill/scripts/live/event-validation.mjs';

const VALID_ID = 'a1b2c3d4';

describe('validateEvent — insert generate', () => {
  const baseInsert = {
    type: 'generate',
    id: VALID_ID,
    mode: 'insert',
    count: 3,
    pageUrl: '/',
    insert: {
      position: 'after',
      anchor: { tagName: 'section', classes: ['hero'] },
    },
    placeholder: { width: 320, height: 80 },
    freeformPrompt: 'Add a testimonial strip',
  };

  it('accepts a valid insert generate event', () => {
    assert.equal(validateEvent(baseInsert), null);
  });

  it('accepts insert with annotations only (no prompt)', () => {
    assert.equal(validateEvent({
      ...baseInsert,
      freeformPrompt: undefined,
      comments: [{ x: 1, y: 2, text: 'headline' }],
    }), null);
  });

  it('rejects insert without prompt or annotations', () => {
    const err = validateEvent({ ...baseInsert, freeformPrompt: '  ' });
    assert.match(err, /freeformPrompt or annotations/i);
  });

  it('rejects insert without placeholder dimensions', () => {
    assert.match(validateEvent({ ...baseInsert, placeholder: null }), /placeholder/i);
    assert.match(validateEvent({ ...baseInsert, placeholder: { width: 100 } }), /placeholder/i);
  });

  it('rejects invalid insert position', () => {
    assert.match(
      validateEvent({ ...baseInsert, insert: { ...baseInsert.insert, position: 'inside' } }),
      /before or after/i,
    );
  });

  it('rejects insert without anchor context', () => {
    assert.match(
      validateEvent({ ...baseInsert, insert: { position: 'after', anchor: {} } }),
      /insert\.anchor/i,
    );
  });

  it('does not require action for insert mode', () => {
    assert.equal(validateEvent({ ...baseInsert, action: undefined }), null);
  });
});

describe('validateEvent — replace generate (regression)', () => {
  it('still requires action and element for replace mode', () => {
    assert.match(
      validateEvent({
        type: 'generate',
        id: VALID_ID,
        count: 2,
        action: 'polish',
      }),
      /element context/i,
    );
    assert.match(
      validateEvent({
        type: 'generate',
        id: VALID_ID,
        count: 2,
        element: { outerHTML: '<div/>' },
      }),
      /invalid action/i,
    );
    assert.equal(
      validateEvent({
        type: 'generate',
        id: VALID_ID,
        count: 2,
        action: 'polish',
        element: { outerHTML: '<div/>' },
      }),
      null,
    );
  });
});
