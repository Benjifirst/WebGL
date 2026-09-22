import { describe, expect, it } from 'vitest';
import { classify, connectedSum, formatWord, parseWord, WordError } from './surface';

const c = (w: string) => classify(parseWord(w));

describe('Kantenwörter', () => {
  it('Schreibweisen für Inverse', () => {
    const f = parseWord("a b a' B, c1 C1^-1 d⁻¹");
    expect(formatWord(f)).toBe('a b a⁻¹ b⁻¹, c1 c1 d⁻¹');
  });
  it('Fehler mit Position', () => {
    expect(() => parseWord('a b $')).toThrow(WordError);
    try {
      parseWord('a b $');
    } catch (e) {
      expect((e as WordError).pos).toBe(4);
    }
    expect(() => parseWord('a , b')).not.toThrow();
  });
});

describe('Klassifikation geschlossener Flächen', () => {
  it.each([
    ['a A', 2, true, 0, 'Sphäre', '0'],
    ['a b A B', 0, true, 1, 'Torus', 'ℤ²'],
    ['a b a B', 0, false, 2, 'Kleinsche Flasche', 'ℤ ⊕ ℤ/2'],
    ['a b a b', 1, false, 1, 'Projektive Ebene', 'ℤ/2'],
    ['a a', 1, false, 1, 'Projektive Ebene', 'ℤ/2'],
    ['a b A B c d C D', -2, true, 2, 'Orientierbare Fläche vom Geschlecht 2', 'ℤ⁴'],
    ['a a b b', 0, false, 2, 'Kleinsche Flasche', 'ℤ ⊕ ℤ/2'],
    ['a a b b c c', -1, false, 3, 'Nicht orientierbare Fläche mit 3 Kreuzhauben', 'ℤ² ⊕ ℤ/2'],
  ])('%s → χ = %i', (w, chi, orientable, genus, name, h1) => {
    const s = c(w);
    expect(s.chi).toBe(chi);
    expect(s.orientable).toBe(orientable);
    expect(s.genus).toBe(genus);
    expect(s.boundary).toBe(0);
    expect(s.name).toBe(name);
    expect(s.homology).toBe(h1);
  });

  it('Torus # ℝP² ≅ drei Kreuzhauben (Dyck)', () => {
    const s = c('a b A B c c');
    expect(s.orientable).toBe(false);
    expect(s.genus).toBe(3);
  });

  it('Mehrere Polygone: zwei Dreiecke und Tetraederoberfläche ≅ Sphäre', () => {
    expect(c('a b c, C B A').name).toBe('Sphäre');
    // Tetraeder: Ecken 1–4, a=12, b=23, c=31, d=14, e=24, f=34, Dreiecke außen orientiert
    const t = c('a b c, d E A, e F B, f D C');
    expect([t.V, t.E, t.F, t.chi]).toEqual([4, 6, 4, 2]);
    expect(t.orientable).toBe(true);
    expect(t.name).toBe('Sphäre');
  });

  it('Fundamentalgruppe über Spannbaum', () => {
    expect(c('a b A B').pi1).toBe('⟨ a, b | aba⁻¹b⁻¹ ⟩');
    expect(c('a A').pi1).toBe('1 (trivial)'); // Sphäre: zwei Ecken, a ist Baumkante
    expect(c('a a').pi1).toBe('⟨ a | aa ⟩');
  });
});

describe('Flächen mit Rand', () => {
  it('Möbiusband, Zylinder, Scheibe', () => {
    const m = c('c a d a');
    expect([m.orientable, m.boundary, m.chi, m.name]).toEqual([false, 1, 0, 'Möbiusband']);
    const z = c('c a d A');
    expect([z.orientable, z.boundary, z.chi, z.name]).toEqual([true, 2, 0, 'Zylinder (Kreisring)']);
    const d = c('a');
    expect([d.orientable, d.boundary, d.chi, d.name]).toEqual([true, 1, 1, 'Kreisscheibe']);
    expect(m.homology).toBe('ℤ');
  });
});

describe('Zusammenhängende Summe', () => {
  it('Sphäre # T² = T², T² # T² = Σ₂, T² # ℝP² nicht orientierbar', () => {
    let f = parseWord('a A');
    f = connectedSum(f, 'torus');
    expect(classify(f).name).toBe('Torus');
    f = connectedSum(f, 'torus');
    expect(classify(f).genus).toBe(2);
    f = connectedSum(f, 'rp2');
    const s = classify(f);
    expect(s.orientable).toBe(false);
    expect(s.genus).toBe(5); // Σ₂ # ℝP² ≅ N₅
  });
});

describe('Allgemeine 2-Komplexe', () => {
  it('a a a: Pseudo-Projektivraum, H₁ = ℤ/3, π₁ = ⟨a | aaa⟩', () => {
    const s = c('a a a');
    expect(s.surface).toBe(false);
    expect(s.reasons[0]).toMatch(/3 Polygonseiten/);
    expect(s.homology).toBe('ℤ/3');
    expect(s.pi1).toBe('⟨ a | aaa ⟩');
  });
  it('Eingeschnürter Torus: Meridian a mit einer Scheibe zugeklebt ≃ S² ∨ S¹', () => {
    const s = c('a b a⁻¹ b⁻¹, a');
    expect(s.surface).toBe(false);
    expect(s.groups.map((g) => g.betti)).toEqual([1, 1, 1]);
    expect(s.pi1).toBe('⟨ a, b | aba⁻¹b⁻¹, a ⟩'); // ≅ ℤ (erzeugt von b)
  });
  it('Ein einzelnes Polygon mit paarweise verklebten Kanten ist immer eine Fläche', () => {
    for (const w of ['a a⁻¹ b b⁻¹', 'a b c a⁻¹ b⁻¹ c⁻¹', 'a b a c b c', 'a a b c b c']) expect(c(w).surface).toBe(true);
  });
  it('Homologie über den Kettenkomplex stimmt mit der Klassifikation überein', () => {
    for (const w of ['a b A B', 'a b a B', 'a b a b', 'a b A B c d C D', 'c a d a']) {
      const s = c(w);
      expect(s.surface).toBe(true);
      expect(s.groups[0]!.betti).toBe(1);
    }
    expect(c('a b a b').groups.map((g) => g.torsion.map(String))).toEqual([[], ['2'], []]);
  });
  it('nicht zusammenhängend: zwei Tori', () => {
    const s = c('a b A B, c d C D');
    expect(s.connected).toBe(false);
    expect(s.groups.map((g) => g.betti)).toEqual([2, 4, 2]);
  });
});
