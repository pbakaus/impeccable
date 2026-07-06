import { describe, expect, it } from 'vitest';
import { runCheckpoint } from '../src/impeccable/checkpoint.js';

describe('checkpoint bridge', () => {
  it.each(['warning', 'advisory', 'P2'])('treats detector severity %s as actionable after generation', (severity) => {
    const result = runCheckpoint({
      phase: 'after_generation',
      detectorFindings: [{ severity, ruleId: 'side-tab', message: 'Avoid side tabs.' }],
    });
    expect(result.status).toBe('needs_revision');
    expect(result.requiredActions[0]).toContain('side-tab');
  });

  it('keeps acknowledged detector findings excluded after generation', () => {
    const result = runCheckpoint({
      phase: 'after_generation',
      detectorFindings: [{ severity: 'warning', ruleId: 'side-tab', message: 'Avoid side tabs.' }],
      acknowledgedFindings: ['side-tab'],
    });
    expect(result.status).toBe('ready');
  });

  it.each(['warning', 'advisory', 'P2', 'medium'])('does not block final response on %s findings', (severity) => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity, ruleId: 'low-contrast', message: 'Contrast is too low.' }],
    });
    expect(result.status).toBe('ready');
  });

  it.each(['P0', 'P1', 'critical', 'major', 'high'])('blocks final response on unacknowledged %s findings', (severity) => {
    const result = runCheckpoint({
      phase: 'before_final',
      detectorFindings: [{ severity, ruleId: 'low-contrast', message: 'Contrast is too low.' }],
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
