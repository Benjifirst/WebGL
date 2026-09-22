import { describe, expect, it } from 'vitest';
import {
  analyze, crosscapGroup, cyclic, directProduct, formatAbelian, formatPresentation, freeProduct, parsePresentation,
  simplify, surfaceGroup, toddCoxeter,
} from './group';

const P = (s: string) => parsePresentation(s);
const name = (s: string) => analyze(P(s)).name;

describe('Eingabe', () => {
  it('Potenzen, Klammern, Inverse, Kommutatoren, Gleichungen', () => {
    expect(P('a, b | a^2, (ab)^3').rels).toEqual([[1, 1], [1, 2, 1, 2, 1, 2]]);
    expect(P('a, b | A B a b').rels).toEqual([[-1, -2, 1, 2]]);
    expect(P("a | a'a'").rels).toEqual([[-1, -1]]);
    expect(P('a, b | [a, b]').rels).toEqual([[1, 2, -1, -2]]);
    expect(P('a, b | a^2 = b^3').rels).toEqual([[1, 1, -2, -2, -2]]);
    expect(P('a | a⁻¹a³').rels).toEqual([[1, 1]]);
    expect(() => P('a | b')).toThrow(/kein Erzeuger/);
  });
});

describe('Vereinfachung', () => {
  it('Tetraeder-π₁ ⟨c, e, f | c, e⁻¹, e f⁻¹, f c⁻¹⟩ ist trivial', () => {
    const p = simplify(P('c, e, f | c, E, e F, f C'));
    expect(p.gens).toEqual([]);
    expect(name('c, e, f | c, E, e F, f C')).toBe('1');
  });
  it('Erzeuger mit einfachem Vorkommen wird eliminiert', () => {
    // c = (ab)⁻¹, dann c a² = b⁻¹a ⇒ b = a: frei vom Rang 1
    const p = simplify(P('a, b, c | c a b, c a^2'));
    expect(formatPresentation(p)).toBe('⟨ a | – ⟩');
    expect(name('a, b, c | c a b, c a^2')).toBe('ℤ');
  });
});

describe('Erkennen', () => {
  it('zyklisch, frei, frei abelsch, abelsch', () => {
    expect(name('a | a^5')).toBe('ℤ/5');
    expect(name('a, b | ')).toBe('F₂');
    expect(analyze(directProduct(cyclic(0), cyclic(0))).name).toBe('ℤ²');
    expect(analyze(directProduct(cyclic(2), cyclic(3))).name).toBe('ℤ/6');
  });
  it('freie Produkte', () => {
    expect(analyze(freeProduct(cyclic(2), cyclic(3))).name).toBe('ℤ/2 ∗ ℤ/3');
    expect(analyze(freeProduct(cyclic(2), cyclic(3))).order).toBe(Infinity);
  });
  it('Flächengruppen', () => {
    expect(analyze(surfaceGroup(2)).name).toBe('π₁(Σ₂)');
    expect(analyze(crosscapGroup(2)).name).toBe('π₁(K)');
    expect(name('a, b | a b a B')).toBe('π₁(K)');
    expect(analyze(crosscapGroup(1)).name).toBe('ℤ/2');
  });
  it('Todd–Coxeter: endliche Gruppen', () => {
    expect(toddCoxeter(P('a, b | a^2, b^3, (ab)^2'))).toBe(6); // S₃
    expect(toddCoxeter(P('a, b | a^2, b^3, (ab)^3'))).toBe(12); // A₄
    expect(toddCoxeter(P('a, b | a^2, b^3, (ab)^4'))).toBe(24); // S₄
    expect(toddCoxeter(P('a, b | a^2, b^3, (ab)^5'))).toBe(60); // A₅
    expect(toddCoxeter(P('s, t | (st)^2 = s^3, s^3 = t^5'))).toBe(120); // binäre Ikosaedergruppe
    expect(toddCoxeter(P('i, j | i^4, i^2 = j^2, j i J i'))).toBe(8); // Q₈
  });
  it('Namen endlicher Gruppen', () => {
    expect(name('a, b | a^2, b^3, (ab)^2')).toBe('S₃ (Ordnung 6)');
    expect(name('s, t | (st)^2 = s^3, s^3 = t^5')).toBe('binäre Ikosaedergruppe (Ordnung 120)');
    expect(analyze(P('a, b | a^2, b^3, (ab)^3')).name).toBe('A₄ (Ordnung 12)');
    expect(analyze(P('a, b | a^2, b^3, (ab)^4')).name).toBeNull(); // S₄ nicht in der Liste
    expect(analyze(P('a, b | a^2, b^3, (ab)^3')).order).toBe(12);
    expect(name('a, b, c | ')).toBe('F₃');
    expect(analyze(freeProduct(cyclic(2), { gens: ['x', 'y'], rels: [] })).name).toBe('ℤ/2 ∗ F₂');
  });
  it('Abelisierung', () => {
    expect(formatAbelian(analyze(P('a, b | a^2, b^3, (ab)^3')).abelianization)).toBe('ℤ/3');
    expect(formatAbelian(analyze(surfaceGroup(3)).abelianization)).toBe('ℤ⁶');
  });
});
