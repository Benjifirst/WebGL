import { describe, expect, it } from 'vitest';
import { fromDouble, toDouble } from './bigfixed';
import { findDeeper, findMinibrot, findNucleus, findPeriod, nucleusSize, primitivePeriod } from './nucleus';

const B = 128;
const f = (x: number) => fromDouble(x, B);

describe('Minibrot-Suche', () => {
  it('Periode per Ball-Test', () => {
    expect(findPeriod(f(0.02), f(0.01), B, Math.log2(0.05), 100)).toBe(1); // Hauptkardioide (Nukleus 0 im Radius)
    expect(findPeriod(f(-1.02), f(0.01), B, Math.log2(0.05), 100)).toBe(2); // Periode-2-Kreis
    expect(findPeriod(f(-1.755), f(0.0005), B, Math.log2(0.003), 100)).toBe(3); // Minibrot bei −1.7549
    expect(findPeriod(f(0.5), f(0.5), B, Math.log2(1e-3), 100)).toBe(0); // außerhalb
  });

  it('Newton findet bekannte Nuklei', () => {
    const n1 = findNucleus(f(0.1), f(0.05), B, 1)!;
    expect(toDouble(n1.x, B)).toBeCloseTo(0, 14);
    const n2 = findNucleus(f(-1.02), f(0.01), B, 2)!;
    expect(toDouble(n2.x, B)).toBeCloseTo(-1, 14);
    expect(toDouble(n2.y, B)).toBeCloseTo(0, 14);
    const n3 = findNucleus(f(-1.755), f(0.0005), B, 3)!;
    expect(toDouble(n3.x, B)).toBeCloseTo(-1.7548776662466927, 14);
    expect(toDouble(n3.y, B)).toBeCloseTo(0, 14);
  });

  it('Nukleus ist Nullstelle von z_p (in voller Präzision)', () => {
    const bits = 400;
    const n = findNucleus(fromDouble(-1.755, bits), fromDouble(0.0005, bits), bits, 3)!;
    // z_3(c) nachrechnen: 0 → c → c² + c → (c² + c)² + c
    const c = n.x;
    const Bb = BigInt(bits);
    let z = 0n;
    for (let i = 0; i < 3; i++) z = ((z * z) >> Bb) + c;
    expect(Math.log2(Math.abs(toDouble(z, bits)) || 2 ** -1000)).toBeLessThan(-bits + 20);
  });

  it('Größenabschätzung: Hauptkardioide 1, Periode-3-Minibrot ≈ 0.019', () => {
    expect(nucleusSize(f(0), f(0), B, 1)).toBeCloseTo(1, 12);
    const n3 = findNucleus(f(-1.755), 0n, B, 3)!;
    expect(n3.size).toBeGreaterThan(0.015);
    expect(n3.size).toBeLessThan(0.025);
  });

  it('tiefer Zoom: Minibrot nahe dem Seepferdchental bei 1e-10 gefunden und klein', () => {
    const bits = 256;
    const cx = fromDouble(-0.7436438870371587, bits), cy = fromDouble(0.131825904205312, bits);
    const p = findPeriod(cx, cy, bits, Math.log2(1e-10), 20000);
    expect(p).toBeGreaterThan(10);
    const n = findNucleus(cx, cy, bits, p)!;
    expect(n).not.toBeNull();
    // Nukleus liegt im Suchradius und das Minibrot ist kleiner als der Suchradius
    const dist = Math.hypot(toDouble(n.x - cx, bits), toDouble(n.y - cy, bits));
    expect(dist).toBeLessThan(1e-9);
    expect(n.size).toBeGreaterThan(0);
    expect(n.size).toBeLessThan(1e-10);
  });

  it('findMinibrot bleibt im Suchradius (grober Radius, Seepferdchental)', () => {
    const bits = 160;
    const cx = fromDouble(-0.7436438870371587, bits), cy = fromDouble(0.131825904205312, bits);
    for (const r of [0.0335, 1e-3, 1e-6]) {
      const n = findMinibrot(cx, cy, bits, Math.log2(r), 50000);
      expect(n).not.toBeNull();
      const dist = Math.hypot(toDouble(n!.x - cx, bits), toDouble(n!.y - cy, bits));
      expect(dist).toBeLessThanOrEqual(2 * r);
      expect(n!.size).toBeGreaterThan(0);
      expect(n!.size).toBeLessThan(4 * r);
    }
  });

  it('wiederholte Suche am gefundenen Nukleus führt tiefer (kleinerer Radius)', () => {
    const bits = 256;
    let cx = fromDouble(-0.7436438870371587, bits), cy = fromDouble(0.131825904205312, bits);
    let r = 1e-4, last = Infinity;
    for (let step = 0; step < 2; step++) {
      const n = findMinibrot(cx, cy, bits, Math.log2(r), 20000)!;
      expect(n).not.toBeNull();
      expect(n.size).toBeLessThan(last);
      last = n.size;
      // Nächste Stufe: etwas neben dem Nukleus, Radius deutlich kleiner als das Minibrot
      cx = n.x + fromDouble(n.size * 0.3, bits);
      cy = n.y + fromDouble(n.size * 0.2, bits);
      r = n.size * 0.05;
      const d = findDeeper(n.x, n.y, bits, n.period, n.size, 20000);
      expect(d).not.toBeNull();
      expect(d!.size).toBeLessThan(n.size);
    }
  });

  it('Vielfache einer Periode werden als nicht-primitiv erkannt und übersprungen', () => {
    const bits = 200;
    const n3 = findNucleus(fromDouble(-1.755, bits), 0n, bits, 3)!;
    expect(primitivePeriod(n3.x, n3.y, bits, 6)).toBe(3);
    expect(primitivePeriod(n3.x, n3.y, bits, 3)).toBe(3);
    // Direkt im Nukleus findet der Ball-Test nur Vielfache → findMinibrot liefert nichts Neues
    expect(findMinibrot(n3.x, n3.y, bits, Math.log2(0.01), 5000, 4, 3)).toBeNull();
    // findDeeper sucht neben dem Minibrot und findet ein kleineres mit echter, höherer Periode
    const deeper = findDeeper(n3.x, n3.y, bits, 3, n3.size, 5000)!;
    expect(deeper).not.toBeNull();
    expect(deeper.period).toBeGreaterThan(3);
    expect(primitivePeriod(deeper.x, deeper.y, bits, deeper.period)).toBe(deeper.period);
    expect(deeper.size).toBeLessThan(n3.size);
  });
});
