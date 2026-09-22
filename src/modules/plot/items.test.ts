import { describe, expect, it } from 'vitest';
import { toString } from '../../math/parser';
import { evaluator, findExtrema, findParams, findZeros, parsePlot, sampleCurve, sampleExplicit } from './items';

describe('Zeilentypen', () => {
  it('explizit, auch mit y =', () => {
    expect(parsePlot('sin(x)').kind).toBe('explicit');
    const p = parsePlot('y = x^2 - 1');
    expect(p.kind).toBe('explicit');
    if (p.kind === 'explicit') expect(toString(p.f)).toBe('((x ^ 2) - 1)');
  });
  it('implizit und Ungleichungen', () => {
    const c = parsePlot('x^2 + y^2 = 4');
    expect(c.kind).toBe('implicit');
    if (c.kind === 'implicit') {
      expect(c.op).toBe('=');
      expect(toString(c.F)).toBe('(((x ^ 2) + (y ^ 2)) - 4)');
    }
    const u = parsePlot('y <= sin(x)');
    expect(u.kind === 'implicit' && u.op).toBe('<=');
    expect(parsePlot('y ≥ x').kind === 'implicit' && (parsePlot('y ≥ x') as { op: string }).op).toBe('>=');
    expect(parsePlot('x = y^2').kind).toBe('implicit');
    expect(parsePlot('y = x y').kind).toBe('implicit'); // y rechts → implizit
    expect(parsePlot('x y - 1').kind).toBe('implicit'); // ohne Relation, aber mit y → F = 0
  });
  it('parametrisch und polar', () => {
    const p = parsePlot('(cos(3t), sin(2t))');
    expect(p.kind).toBe('parametric');
    expect(parsePlot('r = 1 + cos(θ)').kind).toBe('polar');
    expect(parsePlot('r = cos(k t)').params).toEqual(['k']); // r selbst ist kein Parameter
  });
  it('Parameter werden erkannt', () => {
    expect(findParams('a sin(b x) + c')).toEqual(['a', 'b', 'c']);
    expect(findParams('ax^2 + pi e')).toEqual(['a']);
    expect(parsePlot('a sin(b x)').params).toEqual(['a', 'b']);
  });
  it('Fehlerposition auch rechts vom Gleichheitszeichen', () => {
    try {
      parsePlot('x^2 + y^2 = 4 +');
      expect.unreachable();
    } catch (e) {
      expect((e as { pos: number }).pos).toBe(15);
    }
  });
});

describe('Abtasten', () => {
  it('Polstellen von tan werden unterbrochen, steile Stellen nicht', () => {
    const segs = sampleExplicit(Math.tan, -4, 4, 800, 10);
    expect(segs.length).toBe(3); // Pole bei ±π/2 teilen in drei Äste
    const steep = sampleExplicit((x) => 1000 * x, -1, 1, 100, 10);
    expect(steep.length).toBe(1);
  });
  it('Definitionslücken (sqrt, log) trennen Segmente', () => {
    const segs = sampleExplicit((x) => Math.sqrt(x), -1, 1, 200, 10);
    expect(segs.length).toBe(1);
    expect(segs[0]![0]![0]).toBeGreaterThanOrEqual(0);
  });
  it('Parameterkurve: Kreis ist ein Segment', () => {
    expect(sampleCurve((t) => [Math.cos(t), Math.sin(t)], 0, 2 * Math.PI, 400, 0.5)).toHaveLength(1);
  });
});

describe('Besondere Punkte', () => {
  it('Nullstellen von x³ − 3x, keine an Polstellen von tan', () => {
    const z = findZeros((x) => x ** 3 - 3 * x, -3, 3, 600);
    expect(z.map((v) => +v.toFixed(9))).toEqual([-1.732050808, 0, 1.732050808]);
    const zt = findZeros(Math.tan, -2, 2, 800);
    expect(zt.map((v) => +v.toFixed(9))).toEqual([0]);
  });
  it('Extrema von x³ − 3x bei ±1', () => {
    const e = findExtrema((x) => x ** 3 - 3 * x, -3, 3, 600);
    expect(e.map((p) => [+p.x.toFixed(6), +p.y.toFixed(6), p.max])).toEqual([[-1, 2, true], [1, -2, false]]);
  });
  it('Auswertung mit Parametern', () => {
    const p = parsePlot('a sin(b x)');
    if (p.kind !== 'explicit') throw new Error();
    const f = evaluator(p.f, { a: 2, b: 3 }, 'x');
    expect(f(Math.PI / 6)).toBeCloseTo(2, 12);
  });
});
