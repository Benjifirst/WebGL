import { describe, expect, it } from 'vitest';
import { analyze } from '../topology/group';
import { braidClosure, CATALOG, parseBraid, torusKnot } from './curves';
import type { Link } from './curves';
import { computeDiagram } from './diagram';
import { formatJones, formatPoly, invariants, mirrorJones, sameLaurent } from './invariants';

const inv = (link: Link) => invariants(computeDiagram(link), link.length);
const cat = (id: string) => inv(CATALOG.find((c) => c.id === id)!.build());
const alex = (i: ReturnType<typeof inv>) => formatPoly(i.alexander!);

describe('Alexander-Polynom', () => {
  it.each([
    ['0_1', '1'],
    ['3_1', 't² − t + 1'],
    ['4_1', 't² − 3t + 1'],
    ['5_1', 't⁴ − t³ + t² − t + 1'],
    ['5_2', '2t² − 3t + 2'],
    ['6_1', '2t² − 5t + 2'],
    ['6_2', 't⁴ − 3t³ + 3t² − 3t + 1'],
    ['6_3', 't⁴ − 3t³ + 5t² − 3t + 1'],
    ['7_1', 't⁶ − t⁵ + t⁴ − t³ + t² − t + 1'],
    ['8_19', 't⁶ − t⁵ + t³ − t + 1'],
    ['granny', 't⁴ − 2t³ + 3t² − 2t + 1'],
  ])('%s: %s', (id, poly) => {
    expect(alex(cat(id))).toBe(poly);
  });
});

describe('Jones-Polynom und Chiralität', () => {
  it('Kleeblatt: positive Kreuzungen ⇒ t + t³ − t⁴', () => {
    const k = inv(torusKnot(2, 3));
    const expected = Math.sign(k.writhe) > 0 ? '−t⁴ + t³ + t' : '−t⁻⁴ + t⁻³ + t⁻¹';
    expect(formatJones(k.jones!)).toBe(expected);
  });
  it('Achterknoten ist amphichiral', () => {
    const k = cat('4_1');
    expect(formatJones(k.jones!)).toBe('t² − t + 1 − t⁻¹ + t⁻²');
    expect(sameLaurent(k.jones!, mirrorJones(k.jones!))).toBe(true);
  });
  it('Kreuzknoten amphichiral, Altweiberknoten nicht', () => {
    const sq = cat('square');
    expect(sameLaurent(sq.jones!, mirrorJones(sq.jones!))).toBe(true);
    const gr = cat('granny');
    expect(sameLaurent(gr.jones!, mirrorJones(gr.jones!))).toBe(false);
  });
  it('Unknoten und Hopf', () => {
    expect(formatJones(cat('0_1').jones!)).toBe('1');
    const h = cat('hopf');
    expect(['−t⁵ᐟ² − t¹ᐟ²', '−t⁻¹ᐟ² − t⁻⁵ᐟ²']).toContain(formatJones(h.jones!));
  });
});

describe('Weitere Invarianten', () => {
  it('Verschlingungszahlen', () => {
    expect(Math.abs(cat('hopf').linking[0]!.lk)).toBe(1);
    expect(Math.abs(cat('solomon').linking[0]!.lk)).toBe(2);
    const b = cat('borromean');
    expect(b.components).toBe(3);
    expect(b.linking.map((l) => l.lk)).toEqual([0, 0, 0]);
    expect(formatJones(b.jones!)).not.toBe(formatJones(inv([
      ...CATALOG.find((c) => c.id === '0_1')!.build(),
    ]).jones!));
  });
  it('Whitehead: lk = 0, Jones von L5a1 (bis auf Spiegelung)', () => {
    const w = cat('whitehead');
    expect(w.components).toBe(2);
    expect(w.linking[0]!.lk).toBe(0);
    const target = new Map([[-14, 1], [-10, -2], [-6, 1], [-2, -2], [2, 1], [6, -1]]);
    expect(sameLaurent(w.jones!, target) || sameLaurent(w.jones!, mirrorJones(target))).toBe(true);
  });
  it('Färbungen und Determinante', () => {
    expect(cat('3_1').colorings3).toBe(9); // 3-färbbar
    expect(cat('4_1').colorings3).toBe(3); // nicht 3-färbbar
    expect(cat('4_1').colorings5).toBe(25); // aber 5-färbbar
    expect(cat('3_1').determinant).toBe(3);
    expect(cat('4_1').determinant).toBe(5);
    expect(cat('5_2').determinant).toBe(7);
  });
  it('Knotengruppe: Abelisierung ℤ, Kleeblattgruppe nicht abelsch', () => {
    const g = analyze(cat('3_1').group);
    expect(g.abelianization.rank).toBe(1);
    expect(g.abelianization.torsion).toEqual([]);
    expect(g.presentation.gens.length).toBe(2);
    expect(analyze(cat('0_1').group).name).toBe('ℤ');
  });
  it('Zopfwörter lesen', () => {
    expect(parseBraid('s1 s2^-1 s1')).toEqual([1, -2, 1]);
    expect(parseBraid('σ₁³σ₂⁻¹')).toEqual([1, 1, 1, -2]);
    expect(parseBraid('aBa')).toEqual([1, -2, 1]);
    expect(parseBraid('1 -2 1')).toEqual([1, -2, 1]);
    expect(braidClosure([1, 1, 1])).toHaveLength(1);
    expect(braidClosure([1, 1])).toHaveLength(2);
    expect(braidClosure([1, -2, 1, -2, 1, -2])).toHaveLength(3);
  });
});
