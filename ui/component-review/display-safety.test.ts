import { describe, expect, test } from 'bun:test';
import { assertDisplaySafePacket, displayDimension, safeObjectPosition } from './display-safety';

describe('component review display safety', () => {
  test('accepts positive pixel dimensions and valid rounds', () => {
    expect(displayDimension(1440)).toBe(1440);
    expect(() => assertDisplaySafePacket({ round: 2, comp: { width: 1440, height: 900 } })).not.toThrow();
  });

  test('rejects malformed dimensions and rounds before they reach markup', () => {
    expect(() => displayDimension('900"><img src=x onerror=alert(1)>')).toThrow('dimension');
    expect(() => assertDisplaySafePacket({ round: 1, comp: { width: 1440, height: NaN } })).toThrow('dimension');
    expect(() => assertDisplaySafePacket({ round: '<img src=x>', comp: { width: 1440, height: 900 } })).toThrow('round');
  });

  test('allows standard object positions and rejects CSS injection', () => {
    expect(safeObjectPosition('25% 80%')).toBe('25% 80%');
    expect(safeObjectPosition('left top')).toBe('left top');
    expect(safeObjectPosition('center; background-image: url(https://attacker.test)')).toBe('center');
    expect(safeObjectPosition('101%')).toBe('center');
  });
});
