// Knoteninvarianten aus einem Diagramm.
//
//   Writhe w = Σ Vorzeichen, Verschlingungszahl lk(K_i, K_j) = ½ Σ Vorzeichen der Kreuzungen zwischen K_i, K_j
//   Alexander-Polynom Δ(t): Fox-Ableitungen der Wirtinger-Relationen, abelsch gemacht (x ↦ t),
//     ein beliebiger (n−1)-Minor der Alexander-Matrix; Determinante exakt über ℤ[t] (Bareiss).
//     Normiert: kleinster Exponent 0, Δ(1) > 0.
//   Determinante |Δ(−1)|, Färbungen: Lösungen von 2x_über − x_ein − x_aus ≡ 0 (mod p), Anzahl p^(n − Rang)
//   Jones-Polynom über die Kauffman-Klammer: ⟨D⟩ = Σ_Zustände A^(#A − #B) δ^(Kreise − 1), δ = −A² − A⁻²,
//     V(t) = (−A³)^(−w) ⟨D⟩ mit A = t^(−1/4).
//   Knotengruppe (Wirtinger): ein Erzeuger je Bogen, je Kreuzung x_aus = x_über^ε x_ein x_über^(−ε).
import type { Presentation } from '../topology/group';
import type { Diagram } from './diagram';

// ---------------------------------------------------------------------------
// Polynome in t mit ganzzahligen Koeffizienten (dicht, Index = Exponent ab 0)

type Poly = bigint[];

const trim = (p: Poly): Poly => {
  let n = p.length;
  while (n > 0 && p[n - 1] === 0n) n--;
  return p.slice(0, n);
};
const isZero = (p: Poly) => trim(p).length === 0;
function add(a: Poly, b: Poly): Poly {
  const out = Array<bigint>(Math.max(a.length, b.length)).fill(0n);
  a.forEach((v, i) => (out[i]! += v));
  b.forEach((v, i) => (out[i]! += v));
  return trim(out);
}
const neg = (a: Poly): Poly => a.map((v) => -v);
function mul(a: Poly, b: Poly): Poly {
  if (!a.length || !b.length) return [];
  const out = Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) if (a[i]) for (let j = 0; j < b.length; j++) out[i + j]! += a[i]! * b[j]!;
  return trim(out);
}
/** Exakte Division (Divisor teilt den Dividenden in ℤ[t]) */
function divExact(a: Poly, b: Poly): Poly {
  a = trim([...a]);
  b = trim(b);
  if (!b.length) throw new Error('Division durch 0');
  if (!a.length) return [];
  const q = Array<bigint>(Math.max(0, a.length - b.length + 1)).fill(0n);
  const lb = b[b.length - 1]!;
  for (let i = a.length - b.length; i >= 0; i--) {
    const c = a[i + b.length - 1]!;
    if (c === 0n) continue;
    if (c % lb !== 0n) throw new Error('Division nicht exakt');
    const f = c / lb;
    q[i] = f;
    for (let j = 0; j < b.length; j++) a[i + j]! -= f * b[j]!;
  }
  if (!isZero(a)) throw new Error('Division nicht exakt');
  return trim(q);
}

/** Determinante einer Polynommatrix (fraktionsfreie Gauß-Elimination nach Bareiss) */
export function polyDet(M: Poly[][]): Poly {
  const n = M.length;
  if (!n) return [1n];
  const A = M.map((r) => r.map((p) => trim([...p])));
  let sign = 1n;
  let prev: Poly = [1n];
  for (let k = 0; k < n - 1; k++) {
    if (isZero(A[k]![k]!)) {
      const r = A.findIndex((row, i) => i > k && !isZero(row[k]!));
      if (r < 0) return [];
      [A[k], A[r]] = [A[r]!, A[k]!];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        A[i]![j] = divExact(add(mul(A[i]![j]!, A[k]![k]!), neg(mul(A[i]![k]!, A[k]![j]!))), prev);
      }
      A[i]![k] = [];
    }
    prev = A[k]![k]!;
  }
  const d = A[n - 1]![n - 1]!;
  return sign < 0n ? neg(d) : d;
}

// ---------------------------------------------------------------------------
// Laurent-Polynome (Exponent → Koeffizient) für Jones

export type Laurent = Map<number, number>;

function lAdd(a: Laurent, b: Laurent, f = 1): Laurent {
  const out = new Map(a);
  for (const [e, c] of b) {
    const v = (out.get(e) ?? 0) + f * c;
    if (v) out.set(e, v);
    else out.delete(e);
  }
  return out;
}
function lMul(a: Laurent, b: Laurent): Laurent {
  const out: Laurent = new Map();
  for (const [e1, c1] of a) for (const [e2, c2] of b) {
    const v = (out.get(e1 + e2) ?? 0) + c1 * c2;
    if (v) out.set(e1 + e2, v);
    else out.delete(e1 + e2);
  }
  return out;
}

// ---------------------------------------------------------------------------

export interface KnotInvariants {
  components: number;
  crossings: number;
  writhe: number;
  /** Verschlingungszahlen je Komponentenpaar */
  linking: { i: number; j: number; lk: number }[];
  /** Alexander-Polynom (Koeffizienten ab t⁰), null wenn zu groß */
  alexander: bigint[] | null;
  determinant: number | null;
  /** Anzahl Färbungen mod 3 und 5 */
  colorings3: number;
  colorings5: number;
  /** Jones-Polynom als Exponent (in Vierteln, d. h. t^(e/4)) → Koeffizient; null bei zu vielen Kreuzungen */
  jones: Laurent | null;
  group: Presentation;
}

export const MAX_JONES_CROSSINGS = 22;

export function invariants(d: Diagram, components: number): KnotInvariants {
  const n = d.crossings.length;
  const writhe = d.crossings.reduce((s, c) => s + c.sign, 0);
  const linking: KnotInvariants['linking'] = [];
  for (let i = 0; i < components; i++) {
    for (let j = i + 1; j < components; j++) {
      let s = 0;
      d.crossings.forEach((c, k) => {
        const [a, b] = d.compPairs[k]!;
        if ((a === i && b === j) || (a === j && b === i)) s += c.sign;
      });
      linking.push({ i, j, lk: s / 2 });
    }
  }
  const alexander = n <= 60 ? alexanderPoly(d) : null;
  const determinant = alexander ? Math.abs(Number(alexander.reduce((s, c, i) => s + (i % 2 ? -c : c), 0n))) : null;
  return {
    components,
    crossings: n,
    writhe,
    linking,
    alexander,
    determinant,
    colorings3: colorings(d, 3),
    colorings5: colorings(d, 5),
    jones: n <= MAX_JONES_CROSSINGS ? jonesPoly(d, writhe) : null,
    group: wirtinger(d),
  };
}

/** Alexander-Polynom über den (n−1)-Minor der Alexander-Matrix */
export function alexanderPoly(d: Diagram): bigint[] {
  const n = d.crossings.length;
  const m = d.arcs;
  if (n === 0 || m <= 1) return [1n];
  // Zeile je Kreuzung (Fox-Ableitungen der Relation, ggf. mit t multipliziert)
  const rows: Poly[][] = d.crossings.map((c, i) => {
    const row: Poly[] = Array.from({ length: m }, () => []);
    const { over, inU, outU } = d.arcIncidence[i]!;
    const put = (a: number, p: Poly) => (row[a] = add(row[a]!, p));
    if (c.sign > 0) {
      // x_out = x_o x_in x_o⁻¹:  ∂/∂x_o → 1 − t, ∂/∂x_in → t, ∂/∂x_out → −1
      put(over, [1n, -1n]);
      put(inU, [0n, 1n]);
      put(outU, [-1n]);
    } else {
      // x_out = x_o⁻¹ x_in x_o, mit t multipliziert: ∂/∂x_o → t − 1, ∂/∂x_in → 1, ∂/∂x_out → −t
      put(over, [-1n, 1n]);
      put(inU, [1n]);
      put(outU, [0n, -1n]);
    }
    return row;
  });
  // Minor: letzte Zeile und letzte Spalte streichen (bei Verschlingungen: quadratisch genug?)
  const size = Math.min(n, m - 1);
  const M = rows.slice(0, size).map((r) => r.slice(0, size));
  let p = polyDet(M);
  if (!p.length) return [0n];
  // normieren: führende Nullen (Potenzen von t) entfernen, Vorzeichen so, dass Δ(1) > 0 bzw. Leitkoeffizient > 0
  let k = 0;
  while (k < p.length && p[k] === 0n) k++;
  p = p.slice(k);
  // Tabellenkonvention: Leitkoeffizient positiv
  if (p[p.length - 1]! < 0n) p = neg(p);
  return p;
}

/** Anzahl der Fox-Färbungen mod p (Primzahl): p^(Bögen − Rang) */
export function colorings(d: Diagram, p: number): number {
  const m = d.arcs;
  if (!d.crossings.length) return p ** m;
  const M = d.crossings.map((_, i) => {
    const row = Array<number>(m).fill(0);
    const { over, inU, outU } = d.arcIncidence[i]!;
    row[over] = (row[over]! + 2) % p;
    row[inU] = (row[inU]! + p - 1) % p;
    row[outU] = (row[outU]! + p - 1) % p;
    return row;
  });
  // Rang mod p
  let rank = 0;
  const inv = (a: number) => {
    for (let x = 1; x < p; x++) if ((a * x) % p === 1) return x;
    return 1;
  };
  for (let col = 0; col < m && rank < M.length; col++) {
    const piv = M.findIndex((r, i) => i >= rank && r[col]! % p !== 0);
    if (piv < 0) continue;
    [M[rank], M[piv]] = [M[piv]!, M[rank]!];
    const f = inv(M[rank]![col]!);
    M[rank] = M[rank]!.map((v) => (v * f) % p);
    for (let i = 0; i < M.length; i++) {
      if (i === rank || !M[i]![col]) continue;
      const g = M[i]![col]!;
      M[i] = M[i]!.map((v, j) => (((v - g * M[rank]![j]!) % p) + p) % p);
    }
    rank++;
  }
  return p ** (m - rank);
}

/** Jones-Polynom (Exponenten in Vierteln von t) */
export function jonesPoly(d: Diagram, writhe: number): Laurent {
  const n = d.crossings.length;
  const E = d.edges;
  // δ = −A² − A⁻²
  const delta: Laurent = new Map([[2, -1], [-2, -1]]);
  // Kreise je Zustand zählen (Union-Find über Kantenenden)
  const loopsHist = new Map<number, Map<number, number>>(); // (#A − #B) → Kreise → Anzahl
  const parent = new Int32Array(E);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!;
    return a;
  };
  for (let state = 0; state < 1 << n; state++) {
    for (let e = 0; e < E; e++) parent[e] = e;
    let comps = E;
    let aCount = 0;
    const join = (x: number, y: number) => {
      const rx = find(x), ry = find(y);
      if (rx !== ry) {
        parent[rx] = ry;
        comps--;
      }
    };
    for (let i = 0; i < n; i++) {
      const [a, b, c, dd] = d.pd[i]!;
      if (state & (1 << i)) {
        // A-Glättung: (a, b)(c, d)
        aCount++;
        join(a, b);
        join(c, dd);
      } else {
        // B-Glättung: (a, d)(b, c)
        join(a, dd);
        join(b, c);
      }
    }
    const loops = comps + d.freeLoops;
    const e = aCount - (n - aCount);
    const h = loopsHist.get(e) ?? new Map<number, number>();
    h.set(loops, (h.get(loops) ?? 0) + 1);
    loopsHist.set(e, h);
  }
  // ⟨D⟩ = Σ A^e δ^(Kreise − 1)
  const deltaPow: Laurent[] = [new Map([[0, 1]])];
  let bracket: Laurent = new Map();
  for (const [e, h] of loopsHist) {
    for (const [loops, count] of h) {
      while (deltaPow.length < loops) deltaPow.push(lMul(deltaPow[deltaPow.length - 1]!, delta));
      const term = lMul(new Map([[e, count]]), deltaPow[loops - 1]!);
      bracket = lAdd(bracket, term);
    }
  }
  if (n === 0 && d.freeLoops === 0) bracket = new Map([[0, 1]]);
  // (−A³)^(−w)
  const factor: Laurent = new Map([[-3 * writhe, writhe % 2 === 0 ? 1 : -1]]);
  const inA = lMul(factor, bracket);
  // A = t^(−1/4): A^k = t^(−k/4) → Exponent in Vierteln: −k
  const out: Laurent = new Map();
  for (const [k, c] of inA) out.set(-k, c);
  return out;
}

/** Wirtinger-Präsentation der Knotengruppe (π₁ des Komplements) */
export function wirtinger(d: Diagram): Presentation {
  const m = d.arcs;
  const gens = Array.from({ length: m }, (_, i) => `x${i + 1}`);
  const rels = d.crossings.map((c, i) => {
    const { over, inU, outU } = d.arcIncidence[i]!;
    const o = over + 1, a = inU + 1, b = outU + 1;
    // ε = +1: x_b = x_o x_a x_o⁻¹  →  x_o x_a x_o⁻¹ x_b⁻¹;  ε = −1: x_o⁻¹ x_a x_o x_b⁻¹
    return c.sign > 0 ? [o, a, -o, -b] : [-o, a, o, -b];
  });
  // freie Komponenten (ohne Kreuzung) liefern je einen freien Erzeuger – über arcs bereits gezählt
  return { gens, rels };
}

// ---------------------------------------------------------------------------
// Formatierung

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const supNum = (n: number) => (n < 0 ? '⁻' : '') + String(Math.abs(n)).replace(/\d/g, (d) => SUP[+d]!);

/** Polynom in t (Koeffizienten ab Exponent `shift`) lesbar: „t² − t + 1“ */
export function formatPoly(coeffs: (number | bigint)[], shift = 0, variable = 't'): string {
  const terms: string[] = [];
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = Number(coeffs[i]!);
    if (!c) continue;
    const e = i + shift;
    const abs = Math.abs(c);
    const mono = e === 0 ? '' : e === 1 ? variable : `${variable}${supNum(e)}`;
    const coef = abs === 1 && mono ? '' : String(abs);
    terms.push(`${c < 0 ? '−' : '+'} ${coef}${mono}`);
  }
  if (!terms.length) return '0';
  const s = terms.join(' ');
  return s.startsWith('+ ') ? s.slice(2) : '−' + s.slice(2);
}

/** Jones: Exponenten in Vierteln; ganze Potenzen von t, bei gerader Komponentenzahl halbe (t^(k/2)) */
export function formatJones(j: Laurent): string {
  const entries = [...j].filter(([, c]) => c !== 0).sort((a, b) => b[0] - a[0]);
  if (!entries.length) return '0';
  const terms = entries.map(([e, c]) => {
    const abs = Math.abs(c);
    let mono: string;
    if (e % 4 === 0) {
      const k = e / 4;
      mono = k === 0 ? '' : k === 1 ? 't' : `t${supNum(k)}`;
    } else {
      mono = `t${supNum(e / 2)}ᐟ²`;
    }
    const coef = abs === 1 && mono ? '' : String(abs);
    return `${c < 0 ? '−' : '+'} ${coef}${mono}`;
  });
  const s = terms.join(' ');
  return s.startsWith('+ ') ? s.slice(2) : '−' + s.slice(2);
}

/** Jones des Spiegelbilds: t ↦ t⁻¹ */
export function mirrorJones(j: Laurent): Laurent {
  return new Map([...j].map(([e, c]) => [-e, c]));
}

export function sameLaurent(a: Laurent, b: Laurent): boolean {
  if (a.size !== b.size) return false;
  for (const [e, c] of a) if (b.get(e) !== c) return false;
  return true;
}
