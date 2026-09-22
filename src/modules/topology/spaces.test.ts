import { describe, expect, it } from 'vitest';
import { euler, formatGroup, homology } from './chain';
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
    ['cone(RP2)', ['ℤ']],
  ])('%s', (src, h) => {
    expect(H(src)).toEqual(h);
  });

  it('Fehler mit Position', () => {
    expect(() => parseSpace('S2 v Q3')).toThrow(/Unbekannter Raum/);
    expect(() => parseSpace('S2 # RP3')).toThrow(/#/);
    expect(() => parseSpace('S1 ∪ e2(1, 1)')).toThrow(/Randkoeffizienten/);
    expect(() => parseSpace('S2 v')).toThrow(/unvollständig/);
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
});

describe('Simplizialkomplexe', () => {
  const byLabel = (l: string) => simplicial(parseFacets(SIMPLICIAL_PRESETS.find((p) => p.label.startsWith(l))!.facets));

  it('Minimale Triangulierungen', () => {
    const t = byLabel('Torus');
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
