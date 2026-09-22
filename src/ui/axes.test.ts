import { describe, expect, it } from 'vitest';
import { formatTick, niceStep } from './axes';

describe('Achsenskala', () => {
  it('Schrittweiten im 1-2-5-Raster', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(0.3)).toBe(0.2);
    expect(niceStep(4.2)).toBe(5);
    expect(niceStep(80)).toBe(100);
    expect(niceStep(1.3e-20)).toBeCloseTo(1e-20, 30);
  });
  it('Beschriftung mit passender Stellenzahl', () => {
    expect(formatTick(0.5, 0.5)).toBe('0.5');
    expect(formatTick(2, 1)).toBe('2');
    expect(formatTick(1e-17, 1e-12)).toBe('0'); // Rundungsrest an der Null
    expect(formatTick(3e-9, 1e-9)).toBe('3e-9');
    // benachbarte Striche bleiben unterscheidbar
    expect(formatTick(1.0000002, 1e-7)).not.toBe(formatTick(1.0000003, 1e-7));
  });
});
