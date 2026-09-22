import { describe, expect, it } from 'vitest';
import { bitLength, fromDecimal, fromDouble, toDecimal, toDouble, withBits } from './bigfixed';
import { computeOrbit, computeOrbit64 } from './orbit';
import { iteratePixel } from './perturb';

describe('Festkomma', () => {
  it('double ↔ Festkomma exakt für darstellbare Werte', () => {
    for (const x of [0, 1, -1, 0.1, -0.743643887037158, 1e-100, -3.5e-250, 1.5]) {
      expect(toDouble(fromDouble(x, 1100), 1100)).toBe(x);
    }
  });
  it('Dezimal ↔ Festkomma', () => {
    const v = fromDecimal('-0.743643887037158704752191506114774', 256);
    expect(toDecimal(v, 256, 33)).toBe('-0.743643887037158704752191506114774');
    expect(toDecimal(fromDouble(-0.6, 64), 64, 5)).toBe('-0.60000'); // gerundet, nicht -0.59999
    expect(toDecimal(fromDecimal('0.99996', 64), 64, 4)).toBe('1.0000'); // Übertrag
    expect(toDouble(fromDecimal('0.5', 64), 64)).toBe(0.5);
    expect(toDecimal(fromDecimal('2', 64), 64, 3)).toBe('2.000');
  });
  it('Präzisionswechsel und Bitlänge', () => {
    expect(withBits(3n, 2, 10)).toBe(3n << 8n);
    expect(bitLength(1n)).toBe(1);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(-256n)).toBe(9);
  });
});

describe('Referenzorbit', () => {
  it('stimmt mit double-Iteration überein', () => {
    const cx = -0.75, cy = 0.1;
    const r = computeOrbit(fromDouble(cx, 128), fromDouble(cy, 128), 128, 40);
    let x = 0, y = 0;
    for (let n = 0; n < Math.min(r.length, 30); n++) {
      expect(r.data[2 * n]).toBeCloseTo(x, 5);
      expect(r.data[2 * n + 1]).toBeCloseTo(y, 5);
      [x, y] = [x * x - y * y + cx, 2 * x * y + cy];
    }
  });
  it('endet beim ersten |Z| > 2', () => {
    const r = computeOrbit(fromDouble(1, 64), 0n, 64, 100); // 0, 1, 2, 5
    expect(r.escaped).toBe(true);
    expect(r.length).toBe(4);
    expect(r.data[6]).toBe(5);
  });
});

/**
 * Pixelraster um die Referenz C mit Abstand h. Wahrheit: exakte BigInt-Iteration je Pixel
 * (Bailout |z| > 2, damit sie mit computeOrbit vergleichbar ist).
 */
function compare(C: [number, number], h: number, maxIter: number, rebase: boolean, f64 = true, grid = 10) {
  const bits = 200;
  const Cx = fromDouble(C[0], bits), Cy = fromDouble(C[1], bits);
  const orbit = f64 ? computeOrbit64(Cx, Cy, bits, maxIter) : computeOrbit(Cx, Cy, bits, maxIter);
  const e = Math.floor(Math.log2(h));
  const m = h / 2 ** e;
  const H = fromDouble(h, bits);
  let exact = 0, close = 0, total = 0, unflaggedBad = 0, flagged = 0, wrongInterior = 0;
  for (let j = -grid; j <= grid; j++) {
    for (let i = -grid; i <= grid; i++) {
      const truth = computeOrbit(Cx + BigInt(i) * H, Cy + BigInt(j) * H, bits, maxIter);
      const t = truth.escaped ? truth.length - 1 : maxIter;
      const p = iteratePixel(orbit.data, orbit.length, [i * m, j * m], e, { maxIter, rebase, bailout2: 4 });
      total++;
      if (p.glitch) flagged++;
      if (p.interior) {
        // Innen erkannt: richtig, wenn der Punkt tatsächlich nicht entkommt
        if (truth.escaped) wrongInterior++;
        else {
          exact++;
          close++;
        }
        continue;
      }
      if (p.iterations === t) exact++;
      if (Math.abs(p.iterations - t) <= 2) close++;
      else if (!p.glitch) unflaggedBad++;
    }
  }
  expect(wrongInterior).toBe(0); // nie einen entkommenden Punkt als innen markieren
  return { exact: exact / total, close: close / total, unflaggedBad, flagged, total };
}

describe('Störungsrechnung (gegen exakte BigInt-Iteration)', () => {
  const SEAHORSE: [number, number] = [-0.7436438870371587, 0.131825904205312];

  it('Algorithmus (double-Orbit): Referenz entkommt früh, Rebasing rettet das Bild', () => {
    expect(compare([0.3, 0.02], 1e-3, 500, true).close).toBeGreaterThan(0.99);
  });

  it('Algorithmus (double-Orbit): Seepferdchental bei 1e-9', () => {
    expect(compare(SEAHORSE, 1e-9, 2000, true).close).toBeGreaterThan(0.99);
  });

  it('float-Orbit wie auf der GPU: nur chaotische Randpixel weichen ab', () => {
    // Relativer Fehler ~6e-8 je Schritt wird am Rand chaotisch verstärkt (gemessen: ~94 % exakt ±2)
    expect(compare(SEAHORSE, 1e-9, 2000, true, false).close).toBeGreaterThan(0.9);
  });

  it('skaliert (Mantisse/Exponent) liefert dasselbe wie unskaliert', () => {
    const orbit = computeOrbit64(fromDouble(SEAHORSE[0], 200), fromDouble(SEAHORSE[1], 200), 200, 3000);
    let same = 0, total = 0;
    for (let j = -8; j <= 8; j++) {
      for (let i = -8; i <= 8; i++) {
        const plain = iteratePixel(orbit.data, orbit.length, [i, j], -38, { maxIter: 3000, rebase: true });
        // Schwelle −20: die ersten Iterationen laufen skaliert (δ < 2^−20)
        const scaled = iteratePixel(orbit.data, orbit.length, [i, j], -38, { maxIter: 3000, rebase: true, plainExponent: -20 });
        total++;
        if (Math.abs(plain.iterations - scaled.iterations) <= 1) same++;
      }
    }
    expect(same / total).toBeGreaterThan(0.99);
  });

  it('tiefer Zoom 1e-60 (nur skaliert darstellbar): läuft ohne NaN durch', () => {
    const orbit = computeOrbit(fromDouble(SEAHORSE[0], 300), fromDouble(SEAHORSE[1], 300), 300, 2000);
    const e = Math.floor(Math.log2(1e-60));
    for (const d of [[1, 0], [0, 3], [-5, 2]] as [number, number][]) {
      const r = iteratePixel(orbit.data, orbit.length, d, e, { maxIter: 2000, rebase: true });
      expect(Number.isFinite(r.iterations)).toBe(true);
      expect(r.iterations).toBeGreaterThan(0);
    }
  });

  it('ohne Rebasing markiert das Pauldelbrot-Kriterium Glitch-Kandidaten, mit Rebasing keine', () => {
    // Raster bis c = 0: dort bleibt z bei 0, während die Referenz (−0.5 + 0.5i) weiterläuft
    const without = compare([-0.5, 0.5], 0.05, 300, false);
    const withR = compare([-0.5, 0.5], 0.05, 300, true);
    expect(without.flagged).toBeGreaterThan(0);
    expect(withR.flagged).toBe(0);
    expect(withR.close).toBeGreaterThan(0.99);
  });

  it('Innen-Erkennung: bricht im Minibrot früh ab, ohne Außenpunkte falsch zu markieren', () => {
    // Periode-3-Minibrot bei −1.7549: Raster über Minibrot und Umgebung, Wahrheit per BigInt
    const bits = 200;
    const C: [number, number] = [-1.7548776662466927, 0];
    const orbit = computeOrbit64(fromDouble(C[0], bits), 0n, bits, 5000);
    const h = 1e-3;
    const e = Math.floor(Math.log2(h));
    const m = h / 2 ** e;
    let interior = 0, wrongInterior = 0, savedIter = 0;
    for (let j = -12; j <= 12; j++) {
      for (let i = -12; i <= 12; i++) {
        const p = iteratePixel(orbit.data, orbit.length, [i * m, j * m], e, { maxIter: 5000, rebase: true, bailout2: 4 });
        if (!p.interior) continue;
        interior++;
        savedIter += 5000 - p.iterations;
        const truth = computeOrbit(fromDouble(C[0] + i * h, bits), fromDouble(C[1] + j * h, bits), bits, 5000);
        if (truth.escaped) wrongInterior++;
      }
    }
    expect(interior).toBeGreaterThan(50); // ein guter Teil des Rasters liegt im Minibrot
    expect(wrongInterior).toBe(0);
    expect(savedIter / interior).toBeGreaterThan(4000); // im Mittel weit vor maxIter beendet
  });
});
