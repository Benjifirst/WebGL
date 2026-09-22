import { describe, expect, it } from 'vitest';
import {
  attachCell, cohomology, connectedSum, cp, disjoint, disk, euler, formatGroup, homology, isValid, lens,
  moore, nonOrientableSurface, orientableSurface, point, product, quotientSkeleton, rp, smithInvariants,
  sphere, suspension, wedge,
} from './chain';
import type { ChainComplex } from './chain';

const H = (c: ChainComplex) => homology(c).map(formatGroup);

describe('Smith-Normalform', () => {
  it('Invariantenteiler', () => {
    expect(smithInvariants([[2n, 4n], [6n, 8n]])).toEqual([2n, 4n]);
    expect(smithInvariants([[2n, 0n], [0n, 3n]])).toEqual([1n, 6n]); // ℤ/2 ⊕ ℤ/3 ≅ ℤ/6
    expect(smithInvariants([[0n, 0n], [0n, 0n]])).toEqual([]);
    expect(smithInvariants([[4n, 6n, 8n]])).toEqual([2n]);
  });
});

describe('Homologie der Standardräume', () => {
  it.each([
    ['S⁰', sphere(0), ['ℤ²']],
    ['S³', sphere(3), ['ℤ', '0', '0', 'ℤ']],
    ['D²', disk(2), ['ℤ', '0', '0']],
    ['D¹', disk(1), ['ℤ', '0']],
    ['ℝP²', rp(2), ['ℤ', 'ℤ/2', '0']],
    ['ℝP³', rp(3), ['ℤ', 'ℤ/2', '0', 'ℤ']],
    ['ℝP⁴', rp(4), ['ℤ', 'ℤ/2', '0', 'ℤ/2', '0']],
    ['ℂP²', cp(2), ['ℤ', '0', 'ℤ', '0', 'ℤ']],
    ['L(5,2)', lens(5), ['ℤ', 'ℤ/5', '0', 'ℤ']],
    ['M(ℤ/3,2)', moore(3, 2), ['ℤ', '0', 'ℤ/3', '0']],
    ['Σ₂', orientableSurface(2), ['ℤ', 'ℤ⁴', 'ℤ']],
    ['N₃', nonOrientableSurface(3), ['ℤ', 'ℤ² ⊕ ℤ/2', '0']],
  ])('%s', (_, c, h) => {
    expect(isValid(c)).toBe(true);
    expect(H(c)).toEqual(h);
  });
});

describe('Operationen', () => {
  it('Keilprodukt: S² ∨ S¹ ∨ S¹', () => {
    const w = wedge(wedge(sphere(2), sphere(1)), sphere(1));
    expect(H(w)).toEqual(['ℤ', 'ℤ²', 'ℤ']);
    expect(euler(w)).toBe(0); // χ(X ∨ Y) = χ(X) + χ(Y) − 1
  });
  it('Produkt mit Künneth: S¹ × S¹ = T², ℝP² × S¹, T³', () => {
    expect(H(product(sphere(1), sphere(1)))).toEqual(['ℤ', 'ℤ²', 'ℤ']);
    expect(H(product(rp(2), sphere(1)))).toEqual(['ℤ', 'ℤ ⊕ ℤ/2', 'ℤ/2', '0']);
    const t3 = product(product(sphere(1), sphere(1)), sphere(1));
    expect(isValid(t3)).toBe(true);
    expect(H(t3)).toEqual(['ℤ', 'ℤ³', 'ℤ³', 'ℤ']);
    // Tor-Term: ℝP² × ℝP²: H₃ = Tor(ℤ/2, ℤ/2) = ℤ/2
    expect(H(product(rp(2), rp(2)))).toEqual(['ℤ', 'ℤ/2 ⊕ ℤ/2', 'ℤ/2', 'ℤ/2', '0']);
  });
  it('Suspension verschiebt die reduzierte Homologie', () => {
    expect(H(suspension(sphere(1)))).toEqual(['ℤ', '0', 'ℤ']);
    expect(H(suspension(rp(2)))).toEqual(['ℤ', '0', 'ℤ/2', '0']);
    expect(H(suspension(sphere(0)))).toEqual(['ℤ', 'ℤ']);
  });
  it('Zusammenhängende Summe', () => {
    expect(H(connectedSum(orientableSurface(1), orientableSurface(1)))).toEqual(['ℤ', 'ℤ⁴', 'ℤ']);
    expect(H(connectedSum(rp(2), rp(2)))).toEqual(['ℤ', 'ℤ ⊕ ℤ/2', '0']); // Kleinsche Flasche
    expect(H(connectedSum(lens(3), lens(5)))).toEqual(['ℤ', 'ℤ/15', '0', 'ℤ']);
    expect(() => connectedSum(sphere(2), rp(3))).toThrow();
  });
  it('Quotient nach dem Gerüst und Zellen anheften', () => {
    expect(H(quotientSkeleton(orientableSurface(1), 1))).toEqual(['ℤ', '0', 'ℤ']); // T²/T¹ = S²
    expect(H(quotientSkeleton(rp(3), 1))).toEqual(['ℤ', '0', 'ℤ', 'ℤ']);
    expect(H(attachCell(sphere(1), 2, [2]))).toEqual(['ℤ', 'ℤ/2', '0']); // ℝP²
    expect(H(attachCell(wedge(sphere(1), sphere(1)), 2, [2, 0]))).toEqual(['ℤ', 'ℤ ⊕ ℤ/2', '0']); // Klein
    expect(() => attachCell(disk(2), 2, [1, 1])).toThrow(); // zu viele Koeffizienten
  });
  it('Disjunkte Vereinigung, Kohomologie (UKT)', () => {
    expect(H(disjoint(point(), sphere(2)))).toEqual(['ℤ²', '0', 'ℤ']);
    expect(cohomology(homology(rp(2))).map(formatGroup)).toEqual(['ℤ', '0', 'ℤ/2']);
  });
});
