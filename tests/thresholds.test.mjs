import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANY_FILES_THRESHOLD,
  PORT_PROBE_TIMEOUT_MS,
  FRAMEWORK_HTTP_PROBE_TIMEOUT_MS,
  DEFAULT_LINE_LENGTH_MAX,
} from '../cli/engine/shared/thresholds.mjs';

describe('shared/thresholds', () => {
  it('exposes the documented default values', () => {
    assert.equal(MANY_FILES_THRESHOLD, 50);
    assert.equal(PORT_PROBE_TIMEOUT_MS, 500);
    assert.equal(FRAMEWORK_HTTP_PROBE_TIMEOUT_MS, 2000);
    assert.equal(DEFAULT_LINE_LENGTH_MAX, 80);
  });
});
