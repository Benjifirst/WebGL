import { describe, expect, it } from 'vitest';
import { toString } from '../../math/parser';
import { compileReal } from '../../math/real';
import {
  definitions, evaluator, findExtrema, findZeros, parsePlot, resolveItem, sampleCurve, sampleExplicit, scanDefinitions,
} from './items';
import type { PlotItem } from './items';

/** Mehrere Zeilen wie im Modul parsen und auflösen */
function resolveAll(texts: string[]): PlotItem[] {
  const user = scanDefinitions(texts);
  const raw = texts.map((t) => parsePlot(t, user));
  const defs = definitions(raw);
  return raw.map((r) => resolveItem(r, defs));
}
const fOf = (it: PlotItem) => {
  if (it.kind !== 'explicit') throw new Error(`nicht explizit: ${it.kind}`);
  return it.f;
};
const valueOf = (it: PlotItem, env: Record<string, number> = {}) => {
  if (it.kind !== 'value') throw new Error(`kein Wert: ${it.kind}`);
  return compileReal(it.v, true)({ ...env });
};

describe('Zeilentypen', () => {
  it('explizit, auch mit y =', () => {
    expect(parsePlot('sin(x)').kind).toBe('explicit');
    const p = parsePlot('y = x^2 - 1');
    expect(p.kind).toBe('explicit');
    if (p.kind === 'explicit') expect(toString(p.f)).toBe('((x ^ 2) - 1)');
  });
  it('implizit, Ungleichungen und Ketten', () => {
    const c = parsePlot('x^2 + y^2 = 4');
    expect(c.kind).toBe('implicit');
    if (c.kind === 'implicit') {
      expect(c.parts).toHaveLength(1);
      expect(c.parts[0]!.op).toBe('=');
      expect(toString(c.parts[0]!.F)).toBe('(((x ^ 2) + (y ^ 2)) - 4)');
    }
    const u = parsePlot('y ≥ x');
    expect(u.kind === 'implicit' && u.parts[0]!.op).toBe('>=');
    const chain = parsePlot('0 < y <= 1 - x^2');
    expect(chain.kind === 'implicit' && chain.parts.map((p) => p.op)).toEqual(['<', '<=']);
    expect(parsePlot('x = y^2').kind).toBe('implicit');
    expect(parsePlot('y = x y').kind).toBe('implicit'); // y rechts → implizit
    expect(parsePlot('x y - 1').kind).toBe('implicit'); // ohne Relation, aber mit y → F = 0
    expect(() => parsePlot('0 < y = x')).toThrow(/verketten/);
  });
  it('parametrisch, Punkt und polar', () => {
    expect(parsePlot('(cos(3t), sin(2t))').kind).toBe('parametric');
    expect(parsePlot('(1, 2)').kind).toBe('point');
    expect(parsePlot('(a, sin(a))').kind).toBe('point');
    expect(parsePlot('r = 1 + cos(θ)').kind).toBe('polar');
    expect(parsePlot('r = cos(k t)').params).toEqual(['k']); // r selbst ist kein Parameter
  });
  it('Werte ohne x und y', () => {
    const [v] = resolveAll(['int(t = 0, 1, t^2)']);
    expect(valueOf(v!)).toBeCloseTo(1 / 3, 12);
    expect(valueOf(resolveAll(['sum(k = 1, 100000, 1/k^2)'])[0]!)).toBeCloseTo(Math.PI ** 2 / 6, 4);
    expect(valueOf(resolveAll(['5!'])[0]!)).toBe(120);
  });
  it('Parameter werden erkannt (auch t in expliziten Zeilen)', () => {
    expect(parsePlot('a sin(b x) + c').params).toEqual(['a', 'b', 'c']);
    expect(parsePlot('ax^2 + pi e').params).toEqual(['a']);
    expect(resolveAll(['sin(x - t)'])[0]!.params).toEqual(['t']);
    expect(parsePlot('asin(x)').params).toEqual([]); // asin ist eine Funktion, nicht a·s·i·n
  });
  it('Fehlerposition auch rechts vom Gleichheitszeichen', () => {
    try {
      parsePlot('x^2 + y^2 = 4 +');
      expect.unreachable();
    } catch (e) {
      expect((e as { pos: number }).pos).toBe(15);
    }
  });
  it('Einschränkung {…}', () => {
    const p = parsePlot('sin(x) {0 < x < pi}');
    expect(p.kind).toBe('explicit');
    expect(p.domain && toString(p.domain)).toBe('0 < x < pi');
    const f = evaluator(fOf(p), {}, 'x', p.domain);
    expect(f(1)).toBeCloseTo(Math.sin(1), 12);
    expect(f(-1)).toBeNaN();
  });
});

describe('Eigene Funktionen und Ableitungen', () => {
  it('f definieren und ableiten', () => {
    const [f, d1, d2, at] = resolveAll(['f(x) = x^3 - 2x', "f'(x)", "f''(x)", "f'(2)"]);
    expect(f!.def?.name).toBe('f');
    const g = (it: PlotItem) => evaluator(fOf(it), {}, 'x');
    expect(g(d1!)(2)).toBeCloseTo(10, 12); // 3x² − 2
    expect(g(d2!)(2)).toBeCloseTo(12, 12); // 6x
    expect(valueOf(at!)).toBeCloseTo(10, 12);
  });
  it('Definition mit anderer Variable und Verkettung', () => {
    const [, , h] = resolveAll(['g(t) = t^2', 'k(x) = g(x + 1)', 'k(2)']);
    expect(valueOf(h!)).toBe(9);
  });
  it('Ableitungen spezieller Funktionen stimmen numerisch', () => {
    const cases = ['sin(x)^2 cos(x)', 'e^(x^2)', 'x^x', 'ln(x)/x', 'atan(x)', 'sqrt(1 + x^2)', 'asin(x/2)', 'erf(x)', '|x - 1|', 'log(2, x)', 'root(x, 3)', 'tanh(x)', 'int(t = 0, x, e^(-t^2))'];
    for (const c of cases) {
      const [, d] = resolveAll([`f(x) = ${c}`, "f'(x)"]);
      const [f] = resolveAll([`f(x) = ${c}`]);
      const df = evaluator(fOf(d!), {}, 'x');
      const ff = evaluator(fOf(f!), {}, 'x');
      for (const x of [0.3, 0.7, 1.3]) {
        const h = 1e-5;
        const num = (ff(x + h) - ff(x - h)) / (2 * h);
        expect(df(x), `${c} bei ${x}`).toBeCloseTo(num, 5);
      }
    }
  });
  it('Rekursion und fehlende Definition werden gemeldet', () => {
    expect(() => resolveAll(['f(x) = f(x) + 1'])).toThrow(/rekursiv/);
    expect(() => resolveAll(['g(x) = x', "h'(x)"])).toThrow(ParseLike);
  });
});
const ParseLike = /Unbekannter Name|nicht definiert|Ableitungen nur/;

describe('Abtasten', () => {
  it('Polstellen von tan werden unterbrochen, steile Stellen nicht', () => {
    const segs = sampleExplicit(Math.tan, -4, 4, 800, 10);
    expect(segs.length).toBe(3); // Pole bei ±π/2 teilen in drei Äste
    const steep = sampleExplicit((x) => 1000 * x, -1, 1, 100, 10);
    expect(steep.length).toBe(1);
  });
  it('Definitionslücken (sqrt, log) trennen Segmente; Rand wird genau getroffen', () => {
    const f = evaluator(fOf(parsePlot('sqrt(x)')), {}, 'x');
    expect(f(-1)).toBeNaN(); // streng: nicht 0
    const segs = sampleExplicit(f, -1, 1, 7, 10);
    expect(segs.length).toBe(1);
    expect(Math.abs(segs[0]![0]![0])).toBeLessThan(1e-6); // beginnt bei x = 0
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
  it('doppelte Nullstelle (Berührpunkt) von (x − 1)²', () => {
    const z = findZeros((x) => (x - 1) ** 2, -3, 3, 599);
    expect(z).toHaveLength(1);
    expect(z[0]).toBeCloseTo(1, 5);
  });
  it('keine Scheinnullstellen bei großen Werten (Gamma mit Polstellen)', async () => {
    const { gamma } = await import('../../math/real');
    expect(findZeros(gamma, -12.6, 12.6, 756)).toEqual([]);
    expect(findZeros((x) => Math.sin(x) ** 2 + 1e12 * (x > 5 ? 1 : 0), -1, 4, 500).length).toBe(2);
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
