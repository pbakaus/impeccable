import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStoredPref,
  nextPref,
  setStoredPref,
} from '../site/scripts/utils/theme.js';

test('dark is the first-visit theme and the switcher keeps auto explicit', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(getStoredPref(), 'dark');
  assert.equal(nextPref('dark'), 'light');
  assert.equal(nextPref('light'), 'auto');
  assert.equal(nextPref('auto'), 'dark');

  setStoredPref('auto');
  assert.equal(getStoredPref(), 'auto');

  delete globalThis.localStorage;
});
