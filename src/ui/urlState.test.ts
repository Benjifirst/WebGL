import { describe, expect, it } from 'vitest';
import { interactiveQuality, tileClipTransform, tiles } from '../core/tiles';
import { decodeHash, encodeHash, read } from './urlState';

describe('URL-Hash', () => {
  it('Rundreise mit Ansicht und Modulzustand', () => {
    const view = { cx: -0.7436438870371587, cy: 0.131825904205312, scale: 1.234e-13 };
    const hash = encodeHash('domain', view, { f: '(z^2 - 1)/(z + i)', c: true, n: 12 });
    const d = decodeHash(hash)!;
    expect(d.moduleId).toBe('domain');
    expect(d.view).toEqual(view); // exakte Rundreise der doubles
    expect(d.params.get('f')).toBe('(z^2 - 1)/(z + i)');
    expect(read.bool(d.params, 'c', false)).toBe(true);
    expect(read.num(d.params, 'n', 0)).toBe(12);
  });

  it('ungültige oder fehlende Werte fallen auf Vorgaben zurück', () => {
    const d = decodeHash('#m=hyperbolic&x=abc&s=-1&p=99&kind=foo')!;
    expect(d.view).toEqual({});
    expect(read.num(d.params, 'p', 7, 3, 12)).toBe(12);
    expect(read.oneOf(d.params, 'kind', ['regular', 'dual'] as const, 'regular')).toBe('regular');
    expect(decodeHash('#nichts')).toBeNull();
    expect(decodeHash('')).toBeNull();
  });
});

describe('Kacheln', () => {
  it('überdecken das Bild lückenlos und überlappungsfrei', () => {
    const W = 5000, H = 2100, T = 1024;
    const list = tiles(W, H, T);
    expect(list.length).toBe(Math.ceil(W / T) * Math.ceil(H / T));
    expect(list.reduce((a, t) => a + t.width * t.height, 0)).toBe(W * H);
    for (const t of list) {
      expect(t.width).toBeLessThanOrEqual(T);
      expect(t.height).toBeLessThanOrEqual(T);
    }
  });

  it('Clip-Transformation bildet den Kachelrand auf ±1 ab', () => {
    const W = 3000, H = 2000;
    const t = { x: 1024, y: 1024, width: 1024, height: 976 };
    const [sx, sy, tx, ty] = tileClipTransform(W, H, t);
    // Pixel x → NDC im Gesamtbild: 2x/W − 1; nach Transformation muss der Kachelrand ±1 ergeben
    const ndc = (px: number, full: number) => (2 * px) / full - 1;
    expect(ndc(t.x, W) * sx + tx).toBeCloseTo(-1, 12);
    expect(ndc(t.x + t.width, W) * sx + tx).toBeCloseTo(1, 12);
    expect(ndc(t.y, H) * sy + ty).toBeCloseTo(-1, 12);
    expect(ndc(t.y + t.height, H) * sy + ty).toBeCloseTo(1, 12);
  });

  it('Interaktionsauflösung: Kosten ∝ Pixel', () => {
    expect(interactiveQuality(5)).toBe(1);
    expect(interactiveQuality(56)).toBeCloseTo(0.5, 12);
    expect(interactiveQuality(10000)).toBe(0.25);
  });
});
