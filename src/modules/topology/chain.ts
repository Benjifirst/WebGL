// Zelluläre Kettenkomplexe über ℤ und ihre Homologie (Smith-Normalform).
//
// Ein Komplex C hat in Dimension k `cells[k]` Zellen; d[k] ist die Randmatrix ∂_k: C_k → C_{k−1}
// (Zeilen = (k−1)-Zellen, Spalten = k-Zellen), d[0] ist leer. Es gilt ∂_{k−1}∘∂_k = 0.
//   H_k = ker ∂_k / im ∂_{k+1} ≅ ℤ^{b_k} ⊕ ⊕ ℤ/d_i,   b_k = c_k − rang ∂_k − rang ∂_{k+1},
// die Torsionskoeffizienten d_i > 1 sind die Invariantenteiler von ∂_{k+1}.

export type Matrix = bigint[][];

export interface ChainComplex {
  cells: number[];
  d: Matrix[];
}

const zeros = (r: number, c: number): Matrix => Array.from({ length: r }, () => Array<bigint>(c).fill(0n));
const abs = (a: bigint) => (a < 0n ? -a : a);

export function complex(cells: number[], d: Record<number, number[][]> = {}): ChainComplex {
  const out: ChainComplex = { cells: [...cells], d: [] };
  for (let k = 0; k < cells.length; k++) {
    out.d[k] = k === 0 ? [] : d[k] ? d[k]!.map((row) => row.map(BigInt)) : zeros(cells[k - 1]!, cells[k]!);
  }
  return out;
}

export const dim = (c: ChainComplex) => c.cells.length - 1;

/** Invariantenteiler (positiv, aufsteigend teilend) einer ganzzahligen Matrix */
export function smithInvariants(M: Matrix): bigint[] {
  const A = M.map((r) => [...r]);
  const rows = A.length;
  const cols = rows ? A[0]!.length : 0;
  const out: bigint[] = [];
  let t = 0;
  while (t < Math.min(rows, cols)) {
    // Pivot: kleinster Betrag ≠ 0 im Restblock
    let pi = -1, pj = -1;
    let best = 0n;
    for (let i = t; i < rows; i++) {
      for (let j = t; j < cols; j++) {
        const v = abs(A[i]![j]!);
        if (v !== 0n && (best === 0n || v < best)) {
          best = v;
          pi = i;
          pj = j;
        }
      }
    }
    if (pi < 0) break;
    [A[t], A[pi]] = [A[pi]!, A[t]!];
    for (const r of A) [r[t], r[pj]] = [r[pj]!, r[t]!];
    let done = false;
    while (!done) {
      done = true;
      const p = A[t]![t]!;
      // Spalte t unterhalb eliminieren
      for (let i = t + 1; i < rows; i++) {
        const q = A[i]![t]! / p;
        if (q !== 0n) for (let j = t; j < cols; j++) A[i]![j]! -= q * A[t]![j]!;
        if (A[i]![t] !== 0n) {
          // Rest ≠ 0: kleineren Pivot nach oben holen
          [A[t], A[i]] = [A[i]!, A[t]!];
          done = false;
          break;
        }
      }
      if (!done) continue;
      // Zeile t rechts eliminieren
      for (let j = t + 1; j < cols; j++) {
        const q = A[t]![j]! / p;
        if (q !== 0n) for (let i = t; i < rows; i++) A[i]![j]! -= q * A[i]![t]!;
        if (A[t]![j] !== 0n) {
          for (const r of A) [r[t], r[j]] = [r[j]!, r[t]!];
          done = false;
          break;
        }
      }
      if (!done) continue;
      // Teilbarkeit: Pivot muss alle Einträge des Restblocks teilen, sonst Zeile addieren
      for (let i = t + 1; i < rows && done; i++) {
        for (let j = t + 1; j < cols; j++) {
          if (A[i]![j]! % p !== 0n) {
            for (let k = t; k < cols; k++) A[t]![k]! += A[i]![k]!;
            done = false;
            break;
          }
        }
      }
    }
    out.push(abs(A[t]![t]!));
    t++;
  }
  return out;
}

export interface HomologyGroup {
  betti: number;
  torsion: bigint[];
}

/** Homologie H_0 … H_n */
export function homology(c: ChainComplex): HomologyGroup[] {
  const n = dim(c);
  const inv = c.d.map((m, k) => (k === 0 ? [] : smithInvariants(m)));
  return c.cells.map((ck, k) => {
    const rankOut = k === 0 ? 0 : inv[k]!.length;
    const next = k < n ? inv[k + 1]! : [];
    return { betti: ck - rankOut - next.length, torsion: next.filter((x) => x > 1n) };
  });
}

/** Kohomologie per universellem Koeffiziententheorem: H^k ≅ ℤ^{b_k} ⊕ T_{k−1} */
export function cohomology(h: HomologyGroup[]): HomologyGroup[] {
  return h.map((g, k) => ({ betti: g.betti, torsion: k > 0 ? h[k - 1]!.torsion : [] }));
}

const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!);

export function formatGroup(g: HomologyGroup): string {
  const parts: string[] = [];
  if (g.betti) parts.push(g.betti === 1 ? 'ℤ' : `ℤ${sup(g.betti)}`);
  for (const t of g.torsion) parts.push(`ℤ/${t}`);
  return parts.length ? parts.join(' ⊕ ') : '0';
}

export function euler(c: ChainComplex): number {
  return c.cells.reduce((s, x, k) => s + (k % 2 ? -x : x), 0);
}

/** ∂∘∂ = 0 prüfen (Konsistenz eines selbst gebauten Komplexes) */
export function isValid(c: ChainComplex): boolean {
  for (let k = 2; k < c.cells.length; k++) {
    const A = c.d[k - 1]!;
    const B = c.d[k]!;
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < c.cells[k]!; j++) {
        let s = 0n;
        for (let m = 0; m < c.cells[k - 1]!; m++) s += A[i]![m]! * B[m]![j]!;
        if (s !== 0n) return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bausteine (Standard-CW-Strukturen)

export const point = (): ChainComplex => complex([1]);

/** Sⁿ = e⁰ ∪ eⁿ (S⁰: zwei Punkte) */
export function sphere(n: number): ChainComplex {
  if (n === 0) return complex([2]);
  const cells = Array(n + 1).fill(0);
  cells[0] = 1;
  cells[n] = 1;
  return complex(cells);
}

/** Dⁿ = Sⁿ⁻¹ ∪ eⁿ mit ∂eⁿ = Fundamentalklasse von Sⁿ⁻¹ */
export function disk(n: number): ChainComplex {
  if (n === 0) return point();
  if (n === 1) return complex([2, 1], { 1: [[-1], [1]] });
  const cells = Array(n + 1).fill(0);
  cells[0] = 1;
  cells[n - 1] = 1;
  cells[n] = 1;
  return complex(cells, { [n]: [[1]] });
}

/** ℝPⁿ: je eine Zelle pro Dimension, ∂e_k = (1 + (−1)^k)·e_{k−1} */
export function rp(n: number): ChainComplex {
  const d: Record<number, number[][]> = {};
  for (let k = 1; k <= n; k++) d[k] = [[k % 2 === 0 ? 2 : 0]];
  return complex(Array(n + 1).fill(1), d);
}

/** ℂPⁿ: Zellen in geraden Dimensionen, alle Ränder 0 */
export function cp(n: number): ChainComplex {
  return complex(Array.from({ length: 2 * n + 1 }, (_, k) => (k % 2 === 0 ? 1 : 0)));
}

/** Linsenraum L(p, q): e⁰ ∪ e¹ ∪ e² ∪ e³ mit ∂e² = p·e¹ (q beeinflusst die Homologie nicht) */
export const lens = (p: number): ChainComplex => complex([1, 1, 1, 1], { 2: [[p]] });

/** Moore-Raum M(ℤ/n, k) = Sᵏ ∪_n e^{k+1} */
export function moore(n: number, k: number): ChainComplex {
  const cells = Array(k + 2).fill(0);
  cells[0] = 1;
  cells[k] += 1;
  cells[k + 1] = 1;
  if (k === 0) return complex([2, 1], { 1: [[-n], [n]] });
  return complex(cells, { [k + 1]: [[n]] });
}

/** Orientierbare Fläche vom Geschlecht g: e⁰ ∪ 2g·e¹ ∪ e², ∂e² = 0 */
export const orientableSurface = (g: number): ChainComplex =>
  g === 0 ? sphere(2) : complex([1, 2 * g, 1]);

/** Nicht orientierbare Fläche mit k Kreuzhauben: ∂e² = 2·(c₁ + … + c_k) */
export const nonOrientableSurface = (k: number): ChainComplex =>
  complex([1, k, 1], { 2: Array.from({ length: k }, () => [2]) });

// ---------------------------------------------------------------------------
// Operationen

function blockDiag(A: Matrix, B: Matrix, ra: number, ca: number, rb: number, cb: number): Matrix {
  const M = zeros(ra + rb, ca + cb);
  for (let i = 0; i < ra; i++) for (let j = 0; j < ca; j++) M[i]![j] = A[i]![j]!;
  for (let i = 0; i < rb; i++) for (let j = 0; j < cb; j++) M[ra + i]![ca + j] = B[i]![j]!;
  return M;
}

function pad(c: ChainComplex, n: number): ChainComplex {
  const cells = [...c.cells];
  while (cells.length < n + 1) cells.push(0);
  const out = complex(cells);
  c.d.forEach((m, k) => (out.d[k] = m));
  return out;
}

/** Disjunkte Vereinigung X ⊔ Y */
export function disjoint(X: ChainComplex, Y: ChainComplex): ChainComplex {
  const n = Math.max(dim(X), dim(Y));
  const a = pad(X, n);
  const b = pad(Y, n);
  const cells = a.cells.map((x, k) => x + b.cells[k]!);
  const out = complex(cells);
  for (let k = 1; k <= n; k++) {
    out.d[k] = blockDiag(a.d[k]!, b.d[k]!, a.cells[k - 1]!, a.cells[k]!, b.cells[k - 1]!, b.cells[k]!);
  }
  return out;
}

/** Keilprodukt X ∨ Y: disjunkt, dann die ersten 0-Zellen (Basispunkte) identifizieren */
export function wedge(X: ChainComplex, Y: ChainComplex): ChainComplex {
  const u = disjoint(X, Y);
  const bx = 0;
  const by = X.cells[0]!;
  // Zeile des Basispunkts von Y auf die von X addieren und entfernen
  if (u.d[1]) {
    const D = u.d[1]!;
    for (let j = 0; j < u.cells[1]!; j++) D[bx]![j]! += D[by]![j]!;
    D.splice(by, 1);
  }
  u.cells[0]! -= 1;
  return u;
}

/** Produkt X × Y (Zellen e×f, ∂(e×f) = ∂e×f + (−1)^{|e|} e×∂f) */
export function product(X: ChainComplex, Y: ChainComplex): ChainComplex {
  const nx = dim(X), ny = dim(Y), n = nx + ny;
  // Index der Produktzelle (i-Zelle a von X, j-Zelle b von Y) in Dimension i + j
  const index: number[][][] = [];
  const cells = Array(n + 1).fill(0);
  for (let i = 0; i <= nx; i++) {
    index[i] = [];
    for (let j = 0; j <= ny; j++) {
      index[i]![j] = [cells[i + j]];
      cells[i + j] += X.cells[i]! * Y.cells[j]!;
    }
  }
  const at = (i: number, a: number, j: number, b: number) => index[i]![j]![0]! + a * Y.cells[j]! + b;
  const out = complex(cells);
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const k = i + j;
      if (k === 0) continue;
      for (let a = 0; a < X.cells[i]!; a++) {
        for (let b = 0; b < Y.cells[j]!; b++) {
          const col = at(i, a, j, b);
          if (i > 0) for (let a2 = 0; a2 < X.cells[i - 1]!; a2++) {
            const v = X.d[i]![a2]![a]!;
            if (v) out.d[k]![at(i - 1, a2, j, b)]![col]! += v;
          }
          if (j > 0) for (let b2 = 0; b2 < Y.cells[j - 1]!; b2++) {
            const v = Y.d[j]![b2]![b]!;
            if (v) out.d[k]![at(i, a, j - 1, b2)]![col]! += (i % 2 ? -1n : 1n) * v;
          }
        }
      }
    }
  }
  return out;
}

/** Reduzierte Suspension ΣX (Basispunkt = erste 0-Zelle): jede andere k-Zelle wird zur (k+1)-Zelle */
export function suspension(X: ChainComplex): ChainComplex {
  const n = dim(X);
  const cells = [1, X.cells[0]! - 1, ...X.cells.slice(1)];
  const out = complex(cells);
  for (let k = 1; k <= n; k++) {
    // ∂_{k+1}(Σe) = Σ(∂_k e); Zeilen der 0-Zellen ohne Basispunkt
    out.d[k + 1] = (k === 1 ? X.d[1]!.slice(1) : X.d[k]!).map((r) => [...r]);
  }
  return out;
}

/** Zusammenhängende Summe geschlossener n-Mannigfaltigkeiten mit je genau einer n-Zelle */
export function connectedSum(X: ChainComplex, Y: ChainComplex): ChainComplex {
  const n = dim(X);
  if (dim(Y) !== n || X.cells[n] !== 1 || Y.cells[n] !== 1 || n < 1) {
    throw new Error('# braucht zwei n-dimensionale Räume mit je genau einer n-Zelle (geschlossene Mannigfaltigkeiten)');
  }
  const strip = (c: ChainComplex): ChainComplex => {
    const s = complex([...c.cells.slice(0, n), 0]);
    for (let k = 1; k < n; k++) s.d[k] = c.d[k]!;
    s.d[n] = c.d[n]!.map(() => []);
    return s;
  };
  const w = wedge(strip(X), strip(Y));
  // neue n-Zelle mit Rand ∂e_X + ∂e_Y
  const col = [...X.d[n]!.map((r) => r[0]!), ...Y.d[n]!.map((r) => r[0]!)];
  if (n === 1) {
    // Kreise: S¹ # S¹ = S¹ (Randwerte liegen auf den identifizierten 0-Zellen)
    return sphere(1);
  }
  w.cells[n] = 1;
  w.d[n] = col.map((v) => [v]);
  return w;
}

/** Quotient X / X^(k): k-Gerüst zu einem Punkt zusammenschlagen */
export function quotientSkeleton(X: ChainComplex, k: number): ChainComplex {
  const n = dim(X);
  if (k >= n) return point();
  const cells = X.cells.map((c, j) => (j === 0 ? 1 : j <= k ? 0 : c));
  const out = complex(cells);
  for (let j = k + 2; j <= n; j++) out.d[j] = X.d[j]!;
  return out;
}

/** Zelle eⁿ anheften, Rand = Σ coeffs[i]·(i-te (n−1)-Zelle) */
export function attachCell(X: ChainComplex, n: number, coeffs: number[]): ChainComplex {
  const c = pad(X, n);
  const rows = c.cells[n - 1]!;
  if (coeffs.length > rows) throw new Error(`e${n}: ${coeffs.length} Randkoeffizienten, aber nur ${rows} Zellen der Dimension ${n - 1}`);
  const col = Array.from({ length: rows }, (_, i) => BigInt(coeffs[i] ?? 0));
  c.cells[n]! += 1;
  c.d[n] = c.d[n]!.map((r, i) => [...r, col[i]!]);
  if (n + 1 < c.cells.length) c.d[n + 1] = [...c.d[n + 1]!, Array<bigint>(c.cells[n + 1]!).fill(0n)];
  if (!isValid(c)) throw new Error(`Rand von e${n} ist kein Zyklus (∂∂ ≠ 0)`);
  return c;
}
