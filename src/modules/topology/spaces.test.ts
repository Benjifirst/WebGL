import { describe, expect, it } from 'vitest';
import { euler, formatGroup, homology } from './chain';
import { analyze } from './group';
import { layout, parseSpace } from './spaces';
import { parseFacets, SIMPLICIAL_PRESETS, simplicial } from './simplicial';

const H = (src: string) => homology(parseSpace(src).complex).map(formatGroup);

describe('Ausdruckssprache für Räume', () => {
  it.each([
    ['S2 v S1 v S1', ['ℤ', 'ℤ²', 'ℤ']],
    ['S^2 ∨ S²', ['ℤ', '0', 'ℤ²']],
    ['S1 x S1', ['ℤ', 'ℤ²', 'ℤ']],
    ['T3', ['ℤ', 'ℤ³', 'ℤ³', 'ℤ']],
    ['RP2 # RP2', ['ℤ', 'ℤ ⊕ ℤ/2', '0']],
    ['F(2) # N(1)', ['ℤ', 'ℤ⁴ ⊕ ℤ/2', '0']],
    ['Σ RP2', ['ℤ', '0', 'ℤ/2', '0']],
    ['susp(S1 v S1)', ['ℤ', '0', 'ℤ²']],
    ['S1 ∪ e2(3)', ['ℤ', 'ℤ/3', '0']],
    ['S1 v S1 ∪ e2(0, 0)', ['ℤ', 'ℤ²', 'ℤ']],
    ['T2 / sk(1)', ['ℤ', '0', 'ℤ']],
    ['L(7,2) # L(3,1)', ['ℤ', 'ℤ/21', '0', 'ℤ']],
    // Künneth: H₁ = ℤ/4 ⊕ ℤ/6 ≅ ℤ/2 ⊕ ℤ/12 (Invariantenteiler), H₂ = ℤ/4 ⊗ ℤ/6, H₃ = Tor(ℤ/4, ℤ/6)
    ['M(4,1) x M(6,1)', ['ℤ', 'ℤ/2 ⊕ ℤ/12', 'ℤ/2', 'ℤ/2', '0']],
    ['S2 + pt', ['ℤ²', '0', 'ℤ']],
    ['CP2 v S2', ['ℤ', '0', 'ℤ²', '0', 'ℤ']],
    ['cone(RP2)', ['ℤ', '0', '0', '0']],
    // neue Bausteine und Operationen
    ['Mb', ['ℤ', 'ℤ', '0']],
    ['Mb / ∂', ['ℤ', 'ℤ/2', '0']], // Möbiusband / Rand = ℝP²
    ['∂Mb', ['ℤ', 'ℤ']],
    ['D2 / ∂', ['ℤ', '0', 'ℤ']],
    ['D3 / ∂', ['ℤ', '0', '0', 'ℤ']],
    ['∂(D2 x D2)', ['ℤ', '0', '0', 'ℤ']], // ∂D⁴ = S³
    ['(D2 x S1) / ∂', ['ℤ', '0', 'ℤ', 'ℤ']], // Volltorus / Randtorus: H_k(X, ∂X) ≅ H^{3−k}(X) (Lefschetz)
    ['bd(D2 x S1)', ['ℤ', 'ℤ²', 'ℤ']],
    ['cone(S1) / ∂', ['ℤ', '0', 'ℤ']], // CX / X = ΣX
    ['S1 ∧ S1', ['ℤ', '0', 'ℤ']],
    ['S2 ∧ S3', ['ℤ', '0', '0', '0', '0', 'ℤ']],
    ['RP2 ∧ RP2', ['ℤ', '0', 'ℤ/2', 'ℤ/2', '0']],
    ['join(S0, S0)', ['ℤ', 'ℤ']],
    ['join(S1, S1)', ['ℤ', '0', '0', 'ℤ']],
    ['P', ['ℤ', '0', '0', 'ℤ']],
    ['⟨a, b | a^2, b^3⟩', ['ℤ', 'ℤ/6', '0']],
    ['<a, b | [a, b]>', ['ℤ', 'ℤ²', 'ℤ']],
    // Präzedenz: Postfix nach Keil, und danach geht es weiter
    ['T2 / sk(1) v S1', ['ℤ', 'ℤ', 'ℤ']],
    ['S2vS1', ['ℤ', 'ℤ', 'ℤ']],
    ['RP2xRP2', ['ℤ', 'ℤ/2 ⊕ ℤ/2', 'ℤ/2', 'ℤ/2', '0']],
  ])('%s', (src, h) => {
    expect(H(src)).toEqual(h);
  });

  const pi1 = (src: string) => {
    const p = parseSpace(src).pi1;
    return p ? analyze(p).name : null;
  };
  it.each([
    ['S2 v S1 v S1', 'F₂'],
    ['T3', 'ℤ³'],
    ['RP2 v RP2', 'ℤ/2 ∗ ℤ/2'],
    ['RP3 x S1', 'ℤ × ℤ/2'],
    ['F(2)', 'π₁(Σ₂)'],
    ['K', 'π₁(K)'],
    ['RP2 # RP2', 'π₁(K)'],
    ['T2 # RP2', 'π₁(N₃)'],
    ['L(5,2) # L(3,1)', 'ℤ/5 ∗ ℤ/3'],
    ['S1 ∪ e2(3)', 'ℤ/3'],
    ['S1 v S1 ∪ e2(2, 2)', 'π₁(K)'],
    ['Mb', 'ℤ'],
    ['P', 'binäre Ikosaedergruppe (Ordnung 120)'],
    ['Σ RP2', '1'],
    ['susp(S0 + pt)', 'F₂'],
    ['CP2 v S2', '1'],
    ['T2 / sk(1)', '1'],
    ['Mb / ∂', 'ℤ/2'],
    ['D2 / ∂', '1'],
    ['⟨a, b | a^2, b^3, (ab)^5⟩', 'A₅ (Ordnung 60)'],
  ])('π₁(%s) = %s', (src, name) => {
    expect(pi1(src)).toBe(name);
  });

  it('Fehler mit Position', () => {
    expect(() => parseSpace('S2 v Q3')).toThrow(/Unbekannter Raum/);
    expect(() => parseSpace('S2 # RP3')).toThrow(/#/);
    expect(() => parseSpace('S1 ∪ e2(1, 1)')).toThrow(/Randkoeffizienten/);
    expect(() => parseSpace('S2 v')).toThrow(/unvollständig/);
    expect(() => parseSpace('S2 / ∂')).toThrow(/keinen Rand/);
    expect(() => parseSpace('L(4,2)')).toThrow(/teilerfremd/);
  });

  it('Szenen: Blumensträuße aus Sphären und Kreisen', () => {
    expect(parseSpace('S2 v S1 v S1').scene).toEqual([[{ kind: 'sphere' }, { kind: 'circle' }, { kind: 'circle' }]]);
    expect(parseSpace('T2 # T2').scene).toEqual([[{ kind: 'genus', genus: 2 }]]);
    expect(parseSpace('RP2 v S1').scene).toBeNull();
    const { prims } = layout(parseSpace('S2 v S2').scene!);
    // zwei Kugeln, die sich im Ursprung berühren, plus Klebepunkt
    const spheres = prims.filter((p) => p.type === 1);
    expect(spheres).toHaveLength(2);
    for (const s of spheres) expect(Math.hypot(...s.center)).toBeCloseTo(s.R, 9);
  });

  it.each(['S2 v S1 v S1', 'S1 v S1 v S1 v S1', 'S2 v S2 v S2', 'T2 v S2 v S1', 'S2 v S2 v S2 v S2 v S2 v S2'])(
    'Keilprodukt %s: Teile treffen sich nur im Klebepunkt',
    (src) => {
      const { prims } = layout(parseSpace(src).scene!);
      // Abstand eines Punktes zur Oberfläche eines Primitivs (wie im Shader)
      const sd = (q: number[], p: (typeof prims)[number]) => {
        const v = [q[0]! - p.center[0], q[1]! - p.center[1], q[2]! - p.center[2]];
        if (p.type === 1 || p.type === 0) return Math.hypot(v[0]!, v[1]!, v[2]!) - p.R;
        if (p.type === 2 || p.type === 3) {
          const hh = v[0]! * p.axis[0] + v[1]! * p.axis[1] + v[2]! * p.axis[2];
          const radial = Math.hypot(v[0]! - hh * p.axis[0], v[1]! - hh * p.axis[1], v[2]! - hh * p.axis[2]);
          return Math.hypot(radial - p.R, hh) - p.r;
        }
        if (p.type === 5) {
          const tt = Math.max(0, Math.min(p.len, v[0]! * p.axis[0] + v[1]! * p.axis[1] + v[2]! * p.axis[2]));
          return Math.hypot(v[0]! - tt * p.axis[0], v[1]! - tt * p.axis[1], v[2]! - tt * p.axis[2]) - p.R;
        }
        return Infinity;
      };
      const glue = prims.find((p) => p.group === 15)!.center;
      const pieces = prims.filter((p) => p.group !== 15 && p.type !== 0);
      // Kugeln: Stichproben auf der Oberfläche; weit weg vom Klebepunkt darf kein anderes Teil sein
      for (const a of pieces.filter((p) => p.type === 1)) {
        for (let k = 0; k < 400; k++) {
          const u = Math.random() * 2 - 1, phi = Math.random() * 2 * Math.PI;
          const dir = [Math.sqrt(1 - u * u) * Math.cos(phi), u, Math.sqrt(1 - u * u) * Math.sin(phi)];
          const q = [a.center[0] + dir[0]! * a.R, a.center[1] + dir[1]! * a.R, a.center[2] + dir[2]! * a.R];
          if (Math.hypot(q[0]! - glue[0], q[1]! - glue[1], q[2]! - glue[2]) < 0.4) continue;
          for (const b of pieces) {
            if (b.group === a.group) continue;
            expect(sd(q, b)).toBeGreaterThan(0.02);
          }
        }
      }
      // Kreise: Punkte auf der Mittellinie
      for (const a of pieces.filter((p) => p.type === 2)) {
        const ax = a.axis;
        const e1 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u1 = [ax[1] * e1[2]! - ax[2] * e1[1]!, ax[2] * e1[0]! - ax[0] * e1[2]!, ax[0] * e1[1]! - ax[1] * e1[0]!];
        const n1 = Math.hypot(...u1);
        const u = u1.map((x) => x / n1);
        const w = [ax[1] * u[2]! - ax[2] * u[1]!, ax[2] * u[0]! - ax[0] * u[2]!, ax[0] * u[1]! - ax[1] * u[0]!];
        for (let k = 0; k < 360; k++) {
          const th = (2 * Math.PI * k) / 360;
          const q = [0, 1, 2].map((j) => a.center[j]! + a.R * (Math.cos(th) * u[j]! + Math.sin(th) * w[j]!));
          if (Math.hypot(q[0]! - glue[0], q[1]! - glue[1], q[2]! - glue[2]) < 0.4) continue;
          for (const b of pieces) if (b.group !== a.group) expect(sd(q, b)).toBeGreaterThan(0.02);
        }
      }
    },
  );
});

describe('Simplizialkomplexe', () => {
  const byLabel = (l: string) => simplicial(parseFacets(SIMPLICIAL_PRESETS.find((p) => p.label.startsWith(l))!.facets));

  it('Minimale Triangulierungen', () => {
    const t = byLabel('Torus (7');
    expect(t.f).toEqual([7, 21, 14]);
    expect(homology(t.complex).map(formatGroup)).toEqual(['ℤ', 'ℤ²', 'ℤ']);
    expect(t.orientable).toBe(true);

    const p = byLabel('ℝP²');
    expect(p.f).toEqual([6, 15, 10]);
    expect(homology(p.complex).map(formatGroup)).toEqual(['ℤ', 'ℤ/2', '0']);
    expect(p.orientable).toBe(false);

    const m = byLabel('Möbius');
    expect(homology(m.complex).map(formatGroup)).toEqual(['ℤ', 'ℤ', '0']);
    expect([m.orientable, m.boundaryFaces]).toEqual([false, 5]);

    const s3 = byLabel('S³');
    expect(homology(s3.complex).map(formatGroup)).toEqual(['ℤ', '0', '0', 'ℤ']);
    expect(euler(s3.complex)).toBe(0);
  });

  it('neue Vorlagen: Oktaeder, Ikosaeder, Gittertorus, Kegel', () => {
    expect(homology(byLabel('S² (Ikosaeder').complex).map(formatGroup)).toEqual(['ℤ', '0', 'ℤ']);
    expect(byLabel('S² (Ikosaeder').f).toEqual([12, 30, 20]);
    expect(homology(byLabel('S² (Oktaeder').complex).map(formatGroup)).toEqual(['ℤ', '0', 'ℤ']);
    const t = byLabel('Torus (6');
    expect(t.f).toEqual([36, 108, 72]);
    expect(homology(t.complex).map(formatGroup)).toEqual(['ℤ', 'ℤ²', 'ℤ']);
    expect(t.orientable).toBe(true);
    const d = byLabel('Kreisscheibe');
    expect(homology(d.complex).map(formatGroup)).toEqual(['ℤ', '0', '0']);
    expect(d.boundaryFaces).toBe(5);
  });

  it.each(SIMPLICIAL_PRESETS.filter((p) => p.coords).map((p) => [p.label, p] as const))(
    '%s: Koordinaten ohne Selbstdurchdringung',
    (_, preset) => {
      const info = simplicial(parseFacets(preset.facets));
      const P = (v: string) => preset.coords![v]!;
      // alle 2-Seiten
      const tris = new Map<string, string[]>();
      for (const f of info.facets) for (let a = 0; a < f.length; a++) for (let b = a + 1; b < f.length; b++) for (let c = b + 1; c < f.length; c++) {
        tris.set([f[a], f[b], f[c]].join(','), [f[a]!, f[b]!, f[c]!]);
      }
      const list = [...tris.values()];
      const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
      const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      const pierces = (p: number[], q: number[], a: number[], b: number[], c: number[]) => {
        const n = cross(sub(b, a), sub(c, a));
        const dp = dot(n, sub(p, a)), dq = dot(n, sub(q, a));
        if (dp * dq >= 0) return false;
        const t = dp / (dp - dq);
        const x = p.map((v, i) => v + t * (q[i]! - v));
        const s1 = dot(cross(sub(b, a), sub(x, a)), n), s2 = dot(cross(sub(c, b), sub(x, b)), n), s3 = dot(cross(sub(a, c), sub(x, c)), n);
        return (s1 > 1e-12 && s2 > 1e-12 && s3 > 1e-12) || (s1 < -1e-12 && s2 < -1e-12 && s3 < -1e-12);
      };
      for (const A of list) for (const B of list) {
        if (A === B) continue;
        for (let e = 0; e < 3; e++) {
          const u = A[e]!, v = A[(e + 1) % 3]!;
          if (B.includes(u) || B.includes(v)) continue;
          expect(pierces(P(u), P(v), P(B[0]!), P(B[1]!), P(B[2]!)), `${A} durch ${B}`).toBe(false);
        }
      }
    },
  );

  it('Eingabeformate und Nicht-Pseudomannigfaltigkeit', () => {
    expect(parseFacets('[1,2,3], [1,3,4]')).toEqual([['1', '2', '3'], ['1', '3', '4']]);
    expect(parseFacets('10 11 12; 10 12 13')).toEqual([['10', '11', '12'], ['10', '12', '13']]);
    const w = byLabel('Zwei');
    expect(w.pseudomanifold).toBe(false); // nicht über Kanten zusammenhängend
    expect(homology(w.complex).map(formatGroup)).toEqual(['ℤ', '0', '0']);
    const book = simplicial(parseFacets('123 124 125')); // drei Dreiecke an einer Kante
    expect(book.pseudomanifold).toBe(false);
    expect(() => parseFacets('112')).toThrow(/doppelt/);
  });
});
