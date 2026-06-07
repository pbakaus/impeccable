import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANY_FILES_THRESHOLD,
  PORT_PROBE_TIMEOUT_MS,
  FRAMEWORK_HTTP_PROBE_TIMEOUT_MS,
  DEFAULT_LINE_LENGTH_MAX,
  BORDER_ACCENT_MIN_WIDTH_PX,
  BORDER_ACCENT_STRONG_WIDTH_PX,
} from '../cli/engine/shared/thresholds.mjs';

describe('shared/thresholds', () => {
  it('exposes the documented default values', () => {
    assert.equal(MANY_FILES_THRESHOLD, 50);
    assert.equal(PORT_PROBE_TIMEOUT_MS, 500);
    assert.equal(FRAMEWORK_HTTP_PROBE_TIMEOUT_MS, 2000);
    assert.equal(DEFAULT_LINE_LENGTH_MAX, 80);
  });

  it('exposes border accent thresholds shared across engines', () => {
    assert.equal(BORDER_ACCENT_MIN_WIDTH_PX, 2);
    assert.equal(BORDER_ACCENT_STRONG_WIDTH_PX, 3);
  });
});
