import { describe, expect, it } from 'vitest';
import { runCheckpoint } from '../src/impeccable/checkpoint.js';

describe('checkpoint bridge', () => {
  it.each(['P0', 'P1', 'critical', 'major', 'high'])('treats detector severity %s as blocking', (severity) => {
    const result = runCheckpoint({
      phase: 'after_generation',
      detectorFindings: [{ severity, ruleId: 'side-tab', message: 'Avoid side tabs.' }],
    });
    expect(result.status).toBe('needs_revision');
    expect(result.requiredActions[0]).toContain('side-tab');
  });

  it.each(['warning', 'advisory', 'P2', 'medium'])('does not block final response on %s findings', (severity) => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity, ruleId: 'low-contrast', message: 'Contrast is too low.' }],
    });
    expect(result.status).toBe('ready');
  });

  it('blocks final response on unacknowledged P0/P1 findings', () => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity: 'P1', ruleId: 'low-contrast', message: 'Contrast is too low.' }],
    });
    expect(result.status).toBe('blocked');
  });

  it('keeps acknowledged detector findings excluded', () => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity: 'P1', ruleId: 'side-tab', message: 'Avoid side tabs.' }],
      acknowledgedFindings: ['side-tab'],
    });
    expect(result.status).toBe('ready');
  });
});
