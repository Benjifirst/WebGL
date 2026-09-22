import { describe, expect, it } from 'vitest';
import type { C } from '../../math/complex';
import {
  apply,
  compose,
  drag,
  fold,
  IDENTITY,
  isHyperbolic,
  params,
  perpendicular,
  recenter,
  reflect,
  side,
  sinhDistance,
  translationAlongReal,
  translationFromOrigin,
  triangle,
  wythoff,
  wythoffPoint,
} from './geometry';
import type { Geodesic, WythoffKind } from './geometry';

const CASES: [number, number][] = [[7, 3], [3, 7], [5, 4], [4, 5], [6, 4], [8, 3], [4, 8], [5, 5], [12, 12]];

/** Tangentialrichtung einer Geodäte im Punkt w */
function tangent(g: Geodesic, w: C): C {
  if (g.kind === 'line') return [-g.n[1], g.n[0]];
  return [-(w[1] - g.c[1]), w[0] - g.c[0]];
}

/** Winkel zwischen zwei Geodäten im Schnittpunkt w, in [0, π/2] */
function angleAt(g: Geodesic, h: Geodesic, w: C): number {
  const a = tangent(g, w);
  const b = tangent(h, w);
  const c = Math.abs(a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.min(1, c));
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('Hyperbolizität', () => {
  it('(p−2)(q−2) > 4', () => {
    expect(isHyperbolic(7, 3)).toBe(true);
    expect(isHyperbolic(5, 4)).toBe(true);
    expect(isHyperbolic(6, 3)).toBe(false); // euklidisch
    expect(isHyperbolic(4, 4)).toBe(false); // euklidisch
    expect(isHyperbolic(5, 3)).toBe(false); // sphärisch
    expect(() => triangle(4, 4)).toThrow();
  });
});

describe('Fundamentaldreieck', () => {
  it.each(CASES)('{%i,%i}: Spiegelkreis orthogonal zum Einheitskreis (d² = r² + 1)', (p, q) => {
    const t = triangle(p, q);
    expect(t.d * t.d).toBeCloseTo(t.r * t.r + 1, 12);
  });

  it.each(CASES)('{%i,%i}: Winkel π/q zwischen Spiegelkreis und Spiegel 2', (p, q) => {
    const t = triangle(p, q);
    const [, m2, m3] = t.mirrors;
    expect(side(m2, t.B)).toBeCloseTo(0, 12);
    expect(side(m3, t.B)).toBeCloseTo(0, 12);
    expect(angleAt(m2, m3, t.B)).toBeCloseTo(Math.PI / q, 12);
  });

  it.each(CASES)('{%i,%i}: Winkel π/2 bei C und π/p bei A', (p, q) => {
    const t = triangle(p, q);
    const [m1, m2, m3] = t.mirrors;
    expect(angleAt(m1, m3, t.C)).toBeCloseTo(Math.PI / 2, 12);
    expect(angleAt(m1, m2, t.A)).toBeCloseTo(Math.PI / p, 12);
  });

  it('Abstandsformel: sinh d(0, Kreisgeodäte) = 1/R', () => {
    const t = triangle(7, 3);
    expect(sinhDistance(t.mirrors[2], [0, 0])).toBeCloseTo(1 / t.r, 12);
  });
});

describe('Faltung', () => {
  it.each(CASES)('{%i,%i}: landet im Fundamentaldreieck, Parität = Spiegelanzahl mod 2', (p, q) => {
    const t = triangle(p, q);
    const rand = rng(p * 31 + q);
    for (let i = 0; i < 300; i++) {
      const rad = 0.97 * Math.sqrt(rand());
      const ang = 2 * Math.PI * rand();
      const z: C = [rad * Math.cos(ang), rad * Math.sin(ang)];
      const f = fold(t, z);
      expect(f.converged).toBe(true);
      const a = Math.atan2(f.w[1], f.w[0]);
      expect(a).toBeGreaterThanOrEqual(-1e-12);
      expect(a).toBeLessThanOrEqual(Math.PI / p + 1e-12);
      expect(side(t.mirrors[2], f.w)).toBeGreaterThanOrEqual(-1e-9);
      // Isometrie-Invariante: gleicher Punkt nach nochmaligem Falten
      const g = fold(t, f.w);
      expect(g.w[0]).toBeCloseTo(f.w[0], 9);
      expect(g.w[1]).toBeCloseTo(f.w[1], 9);
    }
  });

  it('Spiegelbild eines Punkts hat andere Parität', () => {
    const t = triangle(5, 4);
    const z: C = [0.1, 0.05];
    const mirrored = reflect(t.mirrors[0], z);
    expect((fold(t, z).parity + fold(t, mirrored).parity) % 2).toBe(1);
  });
});

describe('Scheibenautomorphismen', () => {
  it('Ziehen: der Punkt unter dem Cursor folgt (M′(z1) = M(z0))', () => {
    let M = compose(translationFromOrigin([0.3, -0.2]), IDENTITY);
    const rand = rng(7);
    for (let i = 0; i < 15; i++) {
      const z0: C = [rand() * 1.2 - 0.6, rand() * 1.2 - 0.6];
      const z1: C = [rand() * 1.2 - 0.6, rand() * 1.2 - 0.6];
      const target = apply(M, z0);
      M = drag(M, z0, z1);
      const got = apply(M, z1);
      expect(got[0]).toBeCloseTo(target[0], 10);
      expect(got[1]).toBeCloseTo(target[1], 10);
    }
  });

  it.each(CASES)('{%i,%i}: Rückführung ändert das Bild nicht und hält |a| klein', (p, q) => {
    const t = triangle(p, q);
    const rand = rng(p * 7 + q);
    let M = IDENTITY;
    for (let step = 0; step < 400; step++) {
      // Langer Weg: ohne Rückführung liefe |α| über (Abstand ≫ 40)
      M = compose(M, translationAlongReal(0.37));
      M = drag(M, [rand() * 0.4 - 0.2, rand() * 0.4 - 0.2], [rand() * 0.4 - 0.2, rand() * 0.4 - 0.2]);
      const R = recenter(t, M);
      // M(0) liegt nach der Rückführung im Fundamentaldreieck: |a| = |M(0)| ≤ max(|B|, |C|)
      expect(Math.hypot(...params(R).a)).toBeLessThanOrEqual(Math.max(Math.hypot(...t.B), t.C[0]) + 1e-9);
      for (let i = 0; i < 3; i++) {
        const z: C = [rand() * 1.4 - 0.7, rand() * 1.4 - 0.7];
        const f1 = fold(t, apply(M, z));
        const f2 = fold(t, apply(R, z));
        expect(f2.w[0]).toBeCloseTo(f1.w[0], 6);
        expect(f2.w[1]).toBeCloseTo(f1.w[1], 6);
        expect(f2.parity % 2).toBe(f1.parity % 2);
      }
      M = R;
    }
  });

  it('Parameterform e^{iφ}(z − a)/(1 − āz) stimmt mit der Matrixform überein und erhält die Scheibe', () => {
    const M = drag(drag(IDENTITY, [0.2, 0.1], [-0.4, 0.3]), [0.5, -0.5], [0.1, 0.6]);
    const { a, rot } = params(M);
    expect(Math.hypot(...rot)).toBeCloseTo(1, 12);
    for (const z of [[0.1, 0.2], [-0.7, 0.3], [0.0, -0.9]] as C[]) {
      const w = apply(M, z);
      const num: C = [z[0] - a[0], z[1] - a[1]];
      const den: C = [1 - (a[0] * z[0] + a[1] * z[1]), -(a[0] * z[1] - a[1] * z[0])];
      const q = [(num[0] * den[0] + num[1] * den[1]) / (den[0] ** 2 + den[1] ** 2), (num[1] * den[0] - num[0] * den[1]) / (den[0] ** 2 + den[1] ** 2)];
      expect(w[0]).toBeCloseTo(rot[0] * q[0]! - rot[1] * q[1]!, 10);
      expect(w[1]).toBeCloseTo(rot[0] * q[1]! + rot[1] * q[0]!, 10);
      expect(Math.hypot(...w)).toBeLessThan(1);
    }
  });
});

describe('Wythoff', () => {
  const KINDS: WythoffKind[] = [
    'regular', 'dual', 'rectified', 'truncated', 'truncatedDual', 'cantellated', 'omnitruncated',
  ];

  it.each(CASES)('{%i,%i}: Lote gehen durch v, sind Geodäten und stehen senkrecht auf dem Spiegel', (p, q) => {
    const t = triangle(p, q);
    for (const kind of KINDS) {
      const { v, geodesics } = wythoff(t, kind);
      geodesics.forEach((g, i) => {
        expect(side(g, v)).toBeCloseTo(0, 9);
        if (g.kind === 'circle') expect(g.c[0] ** 2 + g.c[1] ** 2).toBeCloseTo(g.r2 + 1, 9);
        // Schnittpunkt mit dem Spiegel: Fußpunkt; Winkel dort π/2 (per Spiegelung von v: liegt auf g)
        const m = t.mirrors[i]!;
        const vm = reflect(m, v);
        expect(side(g, vm)).toBeCloseTo(0, 7);
      });
    }
  });

  it.each(CASES)('{%i,%i}: uniforme Punkte sind gleich weit von den geforderten Spiegeln', (p, q) => {
    const t = triangle(p, q);
    const [m1, m2, m3] = t.mirrors;
    const dist = (m: Geodesic, v: C) => sinhDistance(m, v);
    const tr = wythoffPoint(t, 'truncated');
    expect(side(m3, tr)).toBeCloseTo(0, 9);
    expect(dist(m1, tr)).toBeCloseTo(dist(m2, tr), 9);
    const td = wythoffPoint(t, 'truncatedDual');
    expect(td[1]).toBe(0);
    expect(dist(m2, td)).toBeCloseTo(dist(m3, td), 9);
    const ca = wythoffPoint(t, 'cantellated');
    expect(side(m2, ca)).toBeCloseTo(0, 9);
    expect(dist(m1, ca)).toBeCloseTo(dist(m3, ca), 9);
    const om = wythoffPoint(t, 'omnitruncated');
    expect(dist(m1, om)).toBeCloseTo(dist(m2, om), 9);
    expect(dist(m1, om)).toBeCloseTo(dist(m3, om), 9);
  });

  it('reguläre Parkettierung: einzige Kante ist der Spiegelkreis', () => {
    const t = triangle(7, 3);
    const w = wythoff(t, 'regular');
    expect(w.active).toEqual([true, false, false]);
    const g1 = w.geodesics[0];
    expect(g1.kind).toBe('circle');
    if (g1.kind === 'circle') {
      expect(g1.c[0]).toBeCloseTo(t.d, 9);
      expect(Math.sqrt(g1.r2)).toBeCloseTo(t.r, 9);
    }
  });

  it('perpendicular: Gerade durch 0, wenn v parallel zur Spiegelnormalen', () => {
    const t = triangle(5, 4);
    const g = perpendicular([0.2, 0], t.mirrors[2]);
    expect(g.kind).toBe('line');
  });
});
