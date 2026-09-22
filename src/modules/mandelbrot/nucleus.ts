// Mini-Mandelbrot-Suche in beliebiger Präzision (Festkomma, Wert = v / 2^bits).
//
// 1. Periode p: kleinstes n, für das die Kreisscheibe |c − c0| < r unter z ↦ z² + c eine
//    Nullstelle von z_n enthalten kann: |z_n(c0)| < |∂z_n/∂c| · r   (Ball-Periodenerkennung).
// 2. Nukleus: Newton auf z_p(c) = 0:  c ← c − z_p(c) / (∂z_p/∂c)(c),
//    mit z_{n+1} = z_n² + c,  ∂z_{n+1} = 2·z_n·∂z_n + 1.
// 3. Größe (Abschätzung nach Heiland-Allen): λ = Π 2z_k, β = Σ 1/λ_k, Größe = 1 / (β·λ²).

import { fromDouble, toDouble } from './bigfixed';

export interface Nucleus {
  x: bigint;
  y: bigint;
  bits: number;
  period: number;
  /** Abschätzung des Durchmessers des Mini-Mandelbrots */
  size: number;
  /** Newton-Schritte bis zur Konvergenz */
  steps: number;
}

interface CX {
  x: bigint;
  y: bigint;
}

/** |Re z| oder |Im z| > 16: Orbit entkommt (billiger Test ohne Betragsberechnung) */
function escaped(z: CX, limit: bigint): boolean {
  return z.x > limit || z.x < -limit || z.y > limit || z.y < -limit;
}

/** Zahl als Mantisse·2^e (für sehr große bzw. kleine Beträge jenseits des double-Bereichs) */
interface FE {
  re: number;
  im: number;
  e: number;
}

function feNorm(a: FE): FE {
  const m = Math.max(Math.abs(a.re), Math.abs(a.im));
  if (m === 0 || !Number.isFinite(m)) return a;
  const k = Math.floor(Math.log2(m));
  return { re: a.re * 2 ** -k, im: a.im * 2 ** -k, e: a.e + k };
}
const feMul = (a: FE, b: FE): FE =>
  feNorm({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re, e: a.e + b.e });
function feInv(a: FE): FE {
  const d = a.re * a.re + a.im * a.im;
  return feNorm({ re: a.re / d, im: -a.im / d, e: -a.e });
}
function feAdd(a: FE, b: FE): FE {
  if (a.re === 0 && a.im === 0) return b;
  if (b.re === 0 && b.im === 0) return a;
  const e = Math.max(a.e, b.e);
  const sa = 2 ** (a.e - e), sb = 2 ** (b.e - e);
  return feNorm({ re: a.re * sa + b.re * sb, im: a.im * sa + b.im * sb, e });
}
const feAbsLog2 = (a: FE) => Math.log2(Math.hypot(a.re, a.im)) + a.e;

/** log2 |v / 2^bits| für bigint-Komplexzahlen (auch außerhalb des double-Bereichs) */
function log2Abs(z: CX, bits: number): number {
  const ax = z.x < 0n ? -z.x : z.x;
  const ay = z.y < 0n ? -z.y : z.y;
  const m = ax > ay ? ax : ay;
  if (m === 0n) return -Infinity;
  const len = m.toString(16).length * 4;
  const shift = Math.max(0, len - 60);
  const fx = Number(ax >> BigInt(shift));
  const fy = Number(ay >> BigInt(shift));
  return Math.log2(Math.hypot(fx, fy)) + shift - bits;
}

/**
 * Periode des nächsten Mini-Mandelbrots im Umkreis r (als log2 r) um c.
 * Liefert 0, wenn bis maxPeriod keine gefunden wird.
 */
export function findPeriod(
  cx: bigint,
  cy: bigint,
  bits: number,
  log2r: number,
  maxPeriod: number,
  minPeriod = 1,
): number {
  const B = BigInt(bits);
  const one = 1n << B;
  const limit = 16n << B;
  let z: CX = { x: 0n, y: 0n };
  let dz: CX = { x: 0n, y: 0n };
  for (let n = 1; n <= maxPeriod; n++) {
    // dz ← 2·z·dz + 1, z ← z² + c
    const ndx = ((z.x * dz.x - z.y * dz.y) >> (B - 1n)) + one;
    const ndy = (z.x * dz.y + z.y * dz.x) >> (B - 1n);
    const nzx = ((z.x * z.x - z.y * z.y) >> B) + cx;
    const nzy = ((z.x * z.y) >> (B - 1n)) + cy;
    z = { x: nzx, y: nzy };
    dz = { x: ndx, y: ndy };
    if (escaped(z, limit)) return 0; // entkommen: keine weitere Periode in der Nähe
    if (n >= minPeriod && log2Abs(z, bits) < log2Abs(dz, bits) + log2r) return n;
  }
  return 0;
}

/** Newton-Verfahren für den Nukleus der Periode p, Startwert c. */
export function findNucleus(
  cx: bigint,
  cy: bigint,
  bits: number,
  period: number,
  maxSteps = 64,
): Nucleus | null {
  const B = BigInt(bits);
  const one = 1n << B;
  const limit = 16n << B;
  let c: CX = { x: cx, y: cy };
  let steps = 0;
  let converged = false;
  for (; steps < maxSteps; steps++) {
    let z: CX = { x: 0n, y: 0n };
    let dz: CX = { x: 0n, y: 0n };
    for (let n = 0; n < period; n++) {
      const ndx = ((z.x * dz.x - z.y * dz.y) >> (B - 1n)) + one;
      const ndy = (z.x * dz.y + z.y * dz.x) >> (B - 1n);
      const nzx = ((z.x * z.x - z.y * z.y) >> B) + c.x;
      const nzy = ((z.x * z.y) >> (B - 1n)) + c.y;
      z = { x: nzx, y: nzy };
      dz = { x: ndx, y: ndy };
      if (escaped(z, limit)) return null; // Startwert außerhalb des Einzugsgebiets
    }
    // Schritt Δ = z / dz (komplexe Division im Festkomma)
    const den = dz.x * dz.x + dz.y * dz.y;
    if (den === 0n) return null;
    const dx = ((z.x * dz.x + z.y * dz.y) << B) / den;
    const dy = ((z.y * dz.x - z.x * dz.y) << B) / den;
    c = { x: c.x - dx, y: c.y - dy };
    // Konvergenz: Schritt unterhalb der Präzision (mit etwas Reserve)
    const l = log2Abs({ x: dx, y: dy }, bits);
    if (!Number.isFinite(l) || l < -bits + 8) {
      steps++;
      converged = true;
      break;
    }
    if (log2Abs(c, bits) > 2) return null; // divergiert
  }
  if (!converged) return null;
  return { ...c, bits, period, size: nucleusSize(c.x, c.y, bits, period), steps };
}

/**
 * Nächstes Mini-Mandelbrot im Umkreis r um c: Kandidatenperioden aufsteigend (Ball-Test),
 * Newton je Kandidat; akzeptiert wird nur ein konvergierter Nukleus innerhalb von 2r.
 * (Newton kann sonst in das Einzugsgebiet eines entfernten Nukleus derselben Periode springen.)
 */
export function findMinibrot(
  cx: bigint,
  cy: bigint,
  bits: number,
  log2r: number,
  maxPeriod: number,
  minPeriod = 1,
  /** Periode des aktuellen Minibrots: dessen Vielfache sind keine neuen Ziele */
  avoidPeriod = 0,
  maxCandidates = 24,
): Nucleus | null {
  let p = minPeriod - 1;
  let tried = 0;
  while (tried < maxCandidates) {
    p = findPeriod(cx, cy, bits, log2r, maxPeriod, p + 1);
    if (!p) return null;
    if (avoidPeriod && p % avoidPeriod === 0) continue; // billig übersprungen, zählt nicht
    tried++;
    const n = findNucleus(cx, cy, bits, p);
    if (!n || !(n.size > 0 && Number.isFinite(n.size))) continue;
    if (primitivePeriod(n.x, n.y, bits, p) !== p) continue; // Vielfaches einer kleineren Periode
    const dist = log2Abs({ x: n.x - cx, y: n.y - cy }, bits);
    if (dist <= log2r + 1) return n;
  }
  return null;
}

/**
 * Nächstes, kleineres Minibrot neben einem bekannten (Periode p, Größe s). Direkt im Nukleus –
 * und überall im Inneren des Minibrots – ist der Orbit p-periodisch, der Ball-Test fände nur
 * Vielfache von p. Deshalb wird von Punkten außerhalb (Abstand 1,5·s und 3·s, je 8 Richtungen)
 * gesucht. Bevorzugt wird der größte Fund, der mindestens 10× kleiner ist (echter Tiefenschritt
 * statt Nachbarknospe ähnlicher Größe); sonst der größte kleinere.
 */
export function findDeeper(
  cx: bigint,
  cy: bigint,
  bits: number,
  period: number,
  size: number,
  maxPeriod: number,
  directions = 8,
): Nucleus | null {
  let deep: Nucleus | null = null; // ≤ size/10
  let near: Nucleus | null = null; // < size
  for (const dist of [1.5, 3]) {
    const log2r = Math.log2(size * dist * 0.5);
    for (let k = 0; k < directions; k++) {
      const a = (2 * Math.PI * (k + 0.5)) / directions;
      const ox = cx + fromDouble(dist * size * Math.cos(a), bits);
      const oy = cy + fromDouble(dist * size * Math.sin(a), bits);
      const n = findMinibrot(ox, oy, bits, log2r, maxPeriod, period + 1, period, 6);
      if (!n || !(n.size < size)) continue;
      if (n.size <= size / 10 && (!deep || n.size > deep.size)) deep = n;
      if (!near || n.size > near.size) near = n;
    }
    if (deep) break; // nahe Treffer bevorzugen
  }
  return deep ?? near;
}

/**
 * Echte Periode eines Nukleus: kleinstes k ≤ p mit z_k ≈ 0. Ein Nukleus der Periode k ist
 * auch Nullstelle von z_{2k}, z_{3k}, … – solche Treffer sind keine neuen Minibrots.
 */
export function primitivePeriod(cx: bigint, cy: bigint, bits: number, p: number): number {
  const B = BigInt(bits);
  let zx = 0n;
  let zy = 0n;
  for (let k = 1; k <= p; k++) {
    const nx = ((zx * zx - zy * zy) >> B) + cx;
    zy = ((zx * zy) >> (B - 1n)) + cy;
    zx = nx;
    if (log2Abs({ x: zx, y: zy }, bits) < -bits / 2) return k;
  }
  return p;
}

/**
 * Größenabschätzung des Mini-Mandelbrots am Nukleus (Betrag; 0 bei Unterlauf).
 * Der Orbit z_k läuft exakt im Festkomma (in double würde er bei tiefen Nuklei abdriften);
 * nur z_k selbst (|z| ≤ 2) wird für λ und β nach double gewandelt, λ und β als Mantisse/Exponent.
 */
export function nucleusSize(cx: bigint, cy: bigint, bits: number, period: number): number {
  const B = BigInt(bits);
  let zx = cx;
  let zy = cy; // z_1 = c
  let lambda: FE = { re: 1, im: 0, e: 0 };
  let beta: FE = { re: 1, im: 0, e: 0 };
  for (let j = 1; j < period; j++) {
    lambda = feMul({ re: 2 * toDouble(zx, bits), im: 2 * toDouble(zy, bits), e: 0 }, lambda);
    const nx = ((zx * zx - zy * zy) >> B) + cx;
    zy = ((zx * zy) >> (B - 1n)) + cy;
    zx = nx;
    beta = feAdd(beta, feInv(lambda));
  }
  const s = feInv(feMul(beta, feMul(lambda, lambda)));
  const log2 = feAbsLog2(s);
  return !Number.isFinite(log2) || log2 < -1070 ? 0 : 2 ** log2;
}
