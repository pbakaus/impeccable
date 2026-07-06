import { describe, expect, it } from 'vitest';
import { runCheckpoint } from '../src/impeccable/checkpoint.js';

describe('checkpoint bridge', () => {
  it.each(['warning', 'advisory', 'P2'])('treats detector severity %s as actionable', (severity) => {
    const result = runCheckpoint({
      phase: 'after_generation',
      detectorFindings: [{ severity, ruleId: 'side-tab', message: 'Avoid side tabs.' }],
    });
    expect(result.status).toBe('needs_revision');
    expect(result.requiredActions[0]).toContain('side-tab');
  });

  it('blocks final response on unacknowledged detector findings', () => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity: 'advisory', ruleId: 'low-contrast', message: 'Contrast is too low.' }],
    });
    expect(result.status).toBe('blocked');
  });

  it('keeps acknowledged detector findings excluded', () => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity: 'warning', ruleId: 'side-tab', message: 'Avoid side tabs.' }],
      acknowledgedFindings: ['side-tab'],
    });
    expect(result.status).toBe('ready');
  });
});
