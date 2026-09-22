import { describe, expect, it } from 'vitest';
import { panBy, screenToWorld, worldToScreen, zoomAt } from './view';

const size = { width: 800, height: 600 };

describe('view transform', () => {
  it('maps canvas center to c and flips y', () => {
    const v = { cx: 2, cy: -3, scale: 0.5 };
    expect(screenToWorld(v, size, 400, 300)).toEqual([2, -3]);
    expect(screenToWorld(v, size, 410, 290)).toEqual([7, 2]);
  });

  it('worldToScreen inverts screenToWorld', () => {
    const v = { cx: 1.25, cy: 7, scale: 0.013 };
    const [x, y] = screenToWorld(v, size, 123, 456);
    const [px, py] = worldToScreen(v, size, x, y);
    expect(px).toBeCloseTo(123, 9);
    expect(py).toBeCloseTo(456, 9);
  });

  it('zoomAt keeps the point under the cursor invariant', () => {
    let v = { cx: 0.3, cy: -0.1, scale: 0.01 };
    const before = screenToWorld(v, size, 650, 120);
    for (const k of [2, 0.37, 11, 1e3, 1e5]) {
      v = zoomAt(v, size, 650, 120, k);
      const after = screenToWorld(v, size, 650, 120);
      expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-12);
      expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-12);
    }
    expect(v.scale).toBeCloseTo(0.01 / (2 * 0.37 * 11 * 1e3 * 1e5), 20);
  });

  it('panBy moves content with the pointer', () => {
    const v = { cx: 0, cy: 0, scale: 2 };
    const w = screenToWorld(v, size, 100, 100);
    const v2 = panBy(v, 30, -40);
    const w2 = screenToWorld(v2, size, 130, 60);
    expect(w2).toEqual(w);
  });
});
