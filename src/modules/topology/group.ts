// Endlich präsentierte Gruppen ⟨Erzeuger | Relationen⟩: Vereinfachen, Erkennen, Ordnung bestimmen.
//
// Wörter sind Listen ±(i+1) für Erzeuger i bzw. sein Inverses.
//   simplify     Tietze-Transformationen: frei/zyklisch kürzen, doppelte Relationen streichen,
//                Erzeuger eliminieren, die in einer Relation genau einmal vorkommen (g = Rest).
//   abelianize   Exponentensummen-Matrix → Smith-Normalform → ℤ^b ⊕ ⊕ ℤ/dᵢ (= H₁ des Präsentationskomplexes)
//   toddCoxeter  Nebenklassenaufzählung (HLT mit Koinzidenzen) für die Gruppenordnung, falls endlich
//   describe     Name der Gruppe, soweit erkennbar: trivial, zyklisch, frei, frei abelsch, abelsch,
//                Flächengruppe, freies Produkt der Faktoren, endliche Gruppe mit Ordnung.
import { ParseError } from '../../math/parser';
import { smithInvariants } from './chain';

export type Word = number[];

export interface Presentation {
  gens: string[];
  rels: Word[];
}

const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!).replace('-', '⁻');
const subDigits = (s: string) => s.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[+d]!);

// ---------------------------------------------------------------------------
// Wörter

export function freeReduce(w: Word): Word {
  const out: Word = [];
  for (const x of w) {
    if (out.length && out[out.length - 1] === -x) out.pop();
    else out.push(x);
  }
  return out;
}

/** Frei und zyklisch reduziert */
export function cyclicReduce(w: Word): Word {
  let r = freeReduce(w);
  while (r.length > 1 && r[0] === -r[r.length - 1]!) r = r.slice(1, -1);
  return r;
}

export const inverse = (w: Word): Word => w.map((x) => -x).reverse();

/** Kanonischer Vertreter bis auf zyklische Vertauschung und Inversion (zum Erkennen doppelter Relationen) */
function canonical(w: Word): string {
  const cands: string[] = [];
  for (const v of [w, inverse(w)]) for (let i = 0; i < v.length; i++) cands.push([...v.slice(i), ...v.slice(0, i)].join(','));
  return cands.sort()[0] ?? '';
}

export function formatWord(w: Word, gens: readonly string[]): string {
  if (!w.length) return '1';
  const parts: string[] = [];
  let i = 0;
  while (i < w.length) {
    let j = i;
    while (j < w.length && w[j] === w[i]) j++;
    const x = w[i]!;
    const n = (j - i) * Math.sign(x);
    const name = gens[Math.abs(x) - 1]!;
    parts.push(n === 1 ? name : `${name}${sup(n)}`);
    i = j;
  }
  return parts.join(gens.some((g) => g.length > 1) ? ' ' : '');
}

export function formatPresentation(p: Presentation): string {
  if (!p.gens.length) return '⟨ | ⟩';
  return `⟨ ${p.gens.join(', ')} | ${p.rels.length ? p.rels.map((r) => formatWord(r, p.gens)).join(', ') : '–'} ⟩`;
}

// ---------------------------------------------------------------------------
// Konstruktionen

export const trivial = (): Presentation => ({ gens: [], rels: [] });
export const cyclic = (n: number, name = 'a'): Presentation => ({ gens: [name], rels: n ? [Array(n).fill(1)] : [] });
export const free = (n: number, prefix = 'x'): Presentation => ({ gens: Array.from({ length: n }, (_, i) => (n === 1 ? prefix : `${prefix}${i + 1}`)), rels: [] });

/** Freies Produkt (Erzeuger umbenannt, falls nötig) */
export function freeProduct(a: Presentation, b: Presentation): Presentation {
  const k = a.gens.length;
  const names = uniqueNames([...a.gens, ...b.gens]);
  return { gens: names, rels: [...a.rels, ...b.rels.map((r) => r.map((x) => (x > 0 ? x + k : x - k)))] };
}

/** Direktes Produkt: freies Produkt plus Kommutatoren aller Erzeugerpaare */
export function directProduct(a: Presentation, b: Presentation): Presentation {
  const p = freeProduct(a, b);
  const k = a.gens.length;
  for (let i = 1; i <= k; i++) for (let j = 1; j <= b.gens.length; j++) p.rels.push([i, j + k, -i, -(j + k)]);
  return p;
}

function uniqueNames(names: string[]): string[] {
  if (new Set(names).size === names.length) return names;
  // Doppelte Namen: durchnummerieren a, b, … → a1, a2, …
  const count = new Map<string, number>();
  return names.map((n) => {
    const c = (count.get(n) ?? 0) + 1;
    count.set(n, c);
    return names.filter((m) => m === n).length > 1 ? `${n}${subDigits(String(c))}` : n;
  });
}

/** Orientierbare Flächengruppe ⟨a₁, b₁, … | [a₁,b₁]⋯[a_g,b_g]⟩ */
export function surfaceGroup(g: number): Presentation {
  if (g === 0) return trivial();
  const gens: string[] = [];
  const rel: Word = [];
  for (let i = 0; i < g; i++) {
    gens.push(g === 1 ? 'a' : `a${subDigits(String(i + 1))}`, g === 1 ? 'b' : `b${subDigits(String(i + 1))}`);
    const a = 2 * i + 1, b = 2 * i + 2;
    rel.push(a, b, -a, -b);
  }
  return { gens, rels: [rel] };
}

/** Nicht orientierbare Flächengruppe ⟨c₁, … | c₁²⋯c_k²⟩ */
export function crosscapGroup(k: number): Presentation {
  return {
    gens: Array.from({ length: k }, (_, i) => (k === 1 ? 'c' : `c${subDigits(String(i + 1))}`)),
    rels: [Array.from({ length: k }, (_, i) => [i + 1, i + 1]).flat()],
  };
}

// ---------------------------------------------------------------------------
// Tietze-Vereinfachung

function substitute(w: Word, g: number, by: Word): Word {
  const out: Word = [];
  for (const x of w) {
    if (x === g) out.push(...by);
    else if (x === -g) out.push(...inverse(by));
    else out.push(x);
  }
  return out;
}

/** Erzeuger g (1-basiert) entfernen und Indizes dahinter nachrücken */
function dropGenerator(p: Presentation, g: number): Presentation {
  const shift = (x: number) => (Math.abs(x) > g ? x - Math.sign(x) : x);
  return { gens: p.gens.filter((_, i) => i !== g - 1), rels: p.rels.map((r) => r.map(shift)) };
}

const MAX_LEN = 400;

export function simplify(input: Presentation): Presentation {
  let p: Presentation = { gens: [...input.gens], rels: input.rels.map((r) => [...r]) };
  for (let guard = 0; guard < 500; guard++) {
    // kürzen, leere und doppelte Relationen streichen
    const seen = new Set<string>();
    p.rels = p.rels
      .map(cyclicReduce)
      .filter((r) => {
        if (!r.length) return false;
        const c = canonical(r);
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      })
      .sort((a, b) => a.length - b.length);

    // Erzeuger, der in einer Relation genau einmal vorkommt: g = (Rest)⁻¹ einsetzen
    let best: { rel: number; g: number; cost: number } | null = null;
    p.rels.forEach((r, ri) => {
      const counts = new Map<number, number>();
      for (const x of r) counts.set(Math.abs(x), (counts.get(Math.abs(x)) ?? 0) + 1);
      for (const [g, c] of counts) {
        if (c !== 1) continue;
        // Kosten: wie oft g sonst vorkommt × Länge des Ersatzes
        const others = p.rels.reduce((s, o, oi) => s + (oi === ri ? 0 : o.filter((x) => Math.abs(x) === g).length), 0);
        const cost = others * (r.length - 1);
        if (!best || cost < best.cost) best = { rel: ri, g, cost };
      }
    });
    if (!best) break;
    const { rel, g } = best as { rel: number; g: number; cost: number };
    const r = p.rels[rel]!;
    // r zyklisch so drehen, dass g^±1 vorn steht: r = g^ε · w  ⇒  g = (w)^{−ε}
    const i = r.findIndex((x) => Math.abs(x) === g);
    const rot = [...r.slice(i), ...r.slice(0, i)];
    const eps = Math.sign(rot[0]!);
    const w = rot.slice(1);
    const by = eps > 0 ? inverse(w) : w;
    const rels = p.rels.filter((_, k) => k !== rel).map((o) => freeReduce(substitute(o, g, by)));
    if (rels.some((o) => o.length > MAX_LEN)) break; // würde explodieren
    p = dropGenerator({ gens: p.gens, rels }, g);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Abelsch machen

export interface AbelianGroup {
  rank: number;
  torsion: bigint[];
}

export function abelianize(p: Presentation): AbelianGroup {
  const n = p.gens.length;
  if (!n) return { rank: 0, torsion: [] };
  // Spalten = Relationen, Zeilen = Erzeuger (wie ∂₂ des Präsentationskomplexes)
  const M = Array.from({ length: n }, () => Array<bigint>(p.rels.length).fill(0n));
  p.rels.forEach((r, j) => {
    for (const x of r) M[Math.abs(x) - 1]![j]! += x > 0 ? 1n : -1n;
  });
  const inv = p.rels.length ? smithInvariants(M) : [];
  return { rank: n - inv.length, torsion: inv.filter((d) => d > 1n) };
}

export function formatAbelian(a: AbelianGroup): string {
  const parts = [...(a.rank ? [a.rank === 1 ? 'ℤ' : `ℤ${sup(a.rank)}`] : []), ...a.torsion.map((t) => `ℤ/${t}`)];
  return parts.join(' ⊕ ') || '0';
}

// ---------------------------------------------------------------------------
// Todd–Coxeter (HLT-Strategie nach Holt, Handbook of Computational Group Theory, 5.1)

/** Ordnung der Gruppe, falls die Aufzählung mit höchstens maxCosets Nebenklassen endet; sonst null */
export function toddCoxeter(p: Presentation, maxCosets = 60000): number | null {
  const ng = p.gens.length;
  if (!ng) return 1;
  const cols = 2 * ng;
  const col = (x: number) => (x > 0 ? 2 * (x - 1) : 2 * (-x - 1) + 1);
  const invCol = (c: number) => c ^ 1;
  const rels = p.rels.map((r) => r.map(col)).filter((r) => r.length);
  const table: Int32Array[] = [];
  const parent: number[] = [];
  const newRow = () => {
    const row = new Int32Array(cols).fill(-1);
    table.push(row);
    parent.push(parent.length);
    return parent.length - 1;
  };
  newRow();
  let overflow = false;
  const rep = (k: number): number => {
    let r = k;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[k] !== r) {
      const next = parent[k]!;
      parent[k] = r;
      k = next;
    }
    return r;
  };
  const define = (a: number, x: number) => {
    if (table.length >= maxCosets) {
      overflow = true;
      return;
    }
    const d = newRow();
    table[a]![x] = d;
    table[d]![invCol(x)] = a;
  };
  const queue: number[] = [];
  const merge = (k: number, l: number) => {
    k = rep(k);
    l = rep(l);
    if (k === l) return;
    const [mu, nu] = k < l ? [k, l] : [l, k];
    parent[nu] = mu;
    queue.push(nu);
  };
  const coincidence = (a: number, b: number) => {
    queue.length = 0;
    merge(a, b);
    for (let qi = 0; qi < queue.length; qi++) {
      const g = queue[qi]!;
      for (let x = 0; x < cols; x++) {
        const d = table[g]![x]!;
        if (d < 0) continue;
        table[d]![invCol(x)] = -1;
        const mu = rep(g);
        const nu = rep(d);
        if (table[mu]![x]! >= 0) merge(nu, table[mu]![x]!);
        else if (table[nu]![invCol(x)]! >= 0) merge(mu, table[nu]![invCol(x)]!);
        else {
          table[mu]![x] = nu;
          table[nu]![invCol(x)] = mu;
        }
      }
    }
  };
  const scanAndFill = (a: number, w: number[]) => {
    let f = a, b = a;
    let i = 0, j = w.length - 1;
    for (;;) {
      while (i <= j && table[f]![w[i]!]! >= 0) f = table[f]![w[i++]!]!;
      if (i > j) {
        if (f !== a) coincidence(f, a);
        return;
      }
      while (j >= i && table[b]![invCol(w[j]!)]! >= 0) b = table[b]![invCol(w[j--]!)]!;
      if (j < i) {
        coincidence(f, b);
        return;
      }
      if (i === j) {
        table[f]![w[i]!] = b;
        table[b]![invCol(w[i]!)] = f;
        return;
      }
      define(f, w[i]!);
      if (overflow) return;
    }
  };
  for (let a = 0; a < table.length; a++) {
    if (parent[a] !== a) continue;
    for (const w of rels) {
      scanAndFill(a, w);
      if (overflow) return null;
      if (parent[a] !== a) break;
    }
    if (parent[a] !== a) continue;
    for (let x = 0; x < cols; x++) {
      if (table[a]![x]! < 0) define(a, x);
      if (overflow) return null;
    }
  }
  let live = 0;
  for (let a = 0; a < parent.length; a++) if (parent[a] === a) live++;
  return live;
}

// ---------------------------------------------------------------------------
// Erkennen

/** Komponenten der Erzeuger, die über Relationen zusammenhängen (→ freies Produkt) */
function freeFactors(p: Presentation): Presentation[] {
  const n = p.gens.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
  for (const r of p.rels) for (const x of r) parent[find(Math.abs(x) - 1)] = find(Math.abs(r[0]!) - 1);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()].map((idx) => {
    const map = new Map(idx.map((g, k) => [g + 1, k + 1]));
    return {
      gens: idx.map((g) => p.gens[g]!),
      rels: p.rels.filter((r) => map.has(Math.abs(r[0]!))).map((r) => r.map((x) => Math.sign(x) * map.get(Math.abs(x))!)),
    };
  });
}

const isCommutator = (r: Word, a: number, b: number) => {
  const c = canonical(r);
  return c === canonical([a, b, -a, -b]);
};

/** Jede Relation ein Kommutator und alle Paare kommutieren? */
function isFreeAbelian(p: Presentation): boolean {
  const n = p.gens.length;
  if (p.rels.length !== (n * (n - 1)) / 2) return false;
  for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) if (!p.rels.some((r) => isCommutator(r, i, j))) return false;
  return true;
}

/** Alle Erzeugerpaare kommutieren (Relationen enthalten die Kommutatoren) → Gruppe abelsch */
function hasAllCommutators(p: Presentation): boolean {
  const n = p.gens.length;
  for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) if (!p.rels.some((r) => isCommutator(r, i, j))) return false;
  return true;
}

/** Eine Relation, jeder Erzeuger genau zweimal → Fundamentalgruppe einer geschlossenen Fläche */
function oneRelatorSurface(p: Presentation): { orientable: boolean; genus: number } | null {
  if (p.rels.length !== 1 || !p.gens.length) return null;
  const r = p.rels[0]!;
  const counts = new Map<number, number[]>();
  for (const x of r) counts.set(Math.abs(x), [...(counts.get(Math.abs(x)) ?? []), Math.sign(x)]);
  if (counts.size !== p.gens.length || [...counts.values()].some((s) => s.length !== 2)) return null;
  // Euler-Charakteristik des Präsentationskomplexes und Link-Test über das Polygonwort
  const orientable = [...counts.values()].every(([a, b]) => a !== b);
  // Ecken des Polygons nach Verklebung zählen (eine Ecke ⇔ Präsentationskomplex = Fläche)
  const n = r.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
  const uses = new Map<number, number[]>();
  r.forEach((x, i) => uses.set(Math.abs(x), [...(uses.get(Math.abs(x)) ?? []), i]));
  for (const [, [i, j]] of uses as Map<number, [number, number]>) {
    const tail = (k: number) => (r[k]! > 0 ? k : (k + 1) % n);
    const head = (k: number) => (r[k]! > 0 ? (k + 1) % n : k);
    parent[find(tail(i))] = find(tail(j));
    parent[find(head(i))] = find(head(j));
  }
  const V = new Set(parent.map((_, i) => find(i))).size;
  if (V !== 1) return null;
  const chi = 1 - p.gens.length + 1;
  return orientable ? { orientable, genus: (2 - chi) / 2 } : { orientable, genus: 2 - chi };
}

export interface GroupInfo {
  /** vereinfachte Präsentation */
  presentation: Presentation;
  /** Name, falls erkannt, sonst null */
  name: string | null;
  abelianization: AbelianGroup;
  /** Ordnung (Todd–Coxeter) oder Infinity (freier Anteil in der Abelisierung) oder null (unbekannt) */
  order: number | null;
}

function describeFactor(p: Presentation): string | null {
  const n = p.gens.length;
  if (n === 0) return '1';
  if (!p.rels.length) return n === 1 ? 'ℤ' : `F${subDigits(String(n))}`;
  const ab = abelianize(p);
  if (n === 1) return formatAbelian(ab).replace(/^0$/, '1');
  if (isFreeAbelian(p)) return `ℤ${sup(n)}`;
  if (hasAllCommutators(p)) return formatAbelian(ab).replace(/ ⊕ /g, ' × ').replace(/^0$/, '1');
  const s = oneRelatorSurface(p);
  if (s) {
    if (s.orientable) return s.genus === 1 ? 'ℤ²' : `π₁(Σ${subDigits(String(s.genus))})`;
    return s.genus === 1 ? 'ℤ/2' : s.genus === 2 ? 'π₁(K)' : `π₁(N${subDigits(String(s.genus))})`;
  }
  return null;
}

export function analyze(input: Presentation): GroupInfo {
  const presentation = simplify(input);
  const abelianization = abelianize(presentation);
  const factors = freeFactors(presentation);
  // freie Erzeuger (ohne Relation) zu F_k zusammenfassen
  const freeCount = factors.filter((f) => f.gens.length === 1 && !f.rels.length).length;
  const names = factors.filter((f) => !(f.gens.length === 1 && !f.rels.length)).map(describeFactor);
  if (freeCount) names.push(freeCount === 1 ? 'ℤ' : `F${subDigits(String(freeCount))}`);
  let name: string | null = names.every((x) => x !== null) ? names.filter((x) => x !== '1').join(' ∗ ') || '1' : null;
  let order: number | null = null;
  if (abelianization.rank > 0) order = Infinity;
  else if (factors.length > 1 && factors.filter((f) => f.gens.length).length > 1) order = Infinity; // freies Produkt nichttrivialer Gruppen
  else order = toddCoxeter(presentation);
  if (order !== null && Number.isFinite(order) && name === null) {
    // endliche Gruppe: abelsch ⇔ Ordnung = Ordnung der Abelisierung
    const abOrder = abelianization.torsion.reduce((s, t) => s * Number(t), 1);
    if (abOrder === order) name = formatAbelian(abelianization).replace(/ ⊕ /g, ' × ');
    else name = knownFinite(order, abelianization) ?? null;
  }
  if (order === 1) name = '1';
  // Faktoren, die sich bei der Vereinfachung als trivial erweisen (z. B. ⟨a | a⟩)
  if (name === '') name = '1';
  return { presentation, name, abelianization, order };
}

/** Einige bekannte nicht abelsche endliche Gruppen nach Ordnung und Abelisierung */
function knownFinite(order: number, ab: AbelianGroup): string | null {
  const abOrder = ab.torsion.reduce((s, t) => s * Number(t), 1);
  if (order === 120 && abOrder === 1) return 'binäre Ikosaedergruppe (Ordnung 120)';
  if (order === 60 && abOrder === 1) return 'A₅ (Ordnung 60)';
  if (order === 6 && abOrder === 2) return 'S₃ (Ordnung 6)';
  if (order === 8 && abOrder === 4 && ab.torsion.length === 2) return 'Q₈ oder D₄ (Ordnung 8)';
  if (order === 24 && abOrder === 3) return 'binäre Tetraedergruppe (Ordnung 24)';
  if (order === 12 && abOrder === 3) return 'A₄ (Ordnung 12)';
  return null;
}

export function formatGroupInfo(g: GroupInfo): { name: string; presentation: string; detail: string } {
  const order = g.order === null ? 'Ordnung unbekannt' : g.order === Infinity ? 'unendlich' : `Ordnung ${g.order}`;
  return {
    name: g.name ?? (g.order !== null && Number.isFinite(g.order) ? `endliche Gruppe der Ordnung ${g.order}` : 'nicht erkannt'),
    presentation: formatPresentation(g.presentation),
    detail: `${order} · abelsch gemacht: ${formatAbelian(g.abelianization)}`,
  };
}

// ---------------------------------------------------------------------------
// Eingabe von Präsentationen: ⟨a, b | a^2, b^3, (ab)^5⟩ bzw. <a,b | …>

/** Relationswort: Buchstaben, Potenzen, Klammern, Inverse (A = a⁻¹, a', a^-1), Kommutator [a, b] */
export function parseRelator(src: string, gens: readonly string[], offset = 0): Word {
  let i = 0;
  const s = src;
  const skip = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const exponent = (): number => {
    skip();
    if (s[i] === '⁻' && s[i + 1] === '¹') {
      i += 2;
      return -1;
    }
    if (s[i] === "'" || s[i] === '′') {
      i++;
      return -1;
    }
    const supM = /^[⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/.exec(s.slice(i));
    if (supM) {
      i += supM[0].length;
      const v = Number(supM[0].replace('⁻', '-').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c))));
      return v;
    }
    if (s[i] !== '^') return 1;
    i++;
    skip();
    const m = /^[-−]?\s*\d+/.exec(s.slice(i));
    if (!m) throw new ParseError('Exponent erwartet', offset + i);
    i += m[0].length;
    return Number(m[0].replace('−', '-').replace(/\s/g, ''));
  };
  const power = (w: Word, e: number): Word => {
    const base = e < 0 ? inverse(w) : w;
    const out: Word = [];
    for (let k = 0; k < Math.abs(e); k++) out.push(...base);
    if (out.length > 5000) throw new ParseError('Exponent zu groß', offset + i);
    return out;
  };
  const word = (close: string | null): Word => {
    const out: Word = [];
    for (;;) {
      skip();
      if (i >= s.length) {
        if (close) throw new ParseError(`„${close}“ fehlt`, offset + i);
        return out;
      }
      const c = s[i]!;
      if (close && c === close) {
        i++;
        return out;
      }
      if (c === '(') {
        i++;
        const inner = word(')');
        out.push(...power(inner, exponent()));
      } else if (c === '[') {
        i++;
        const a = word(',');
        const b = word(']');
        const comm = [...a, ...b, ...inverse(a), ...inverse(b)];
        out.push(...power(comm, exponent()));
      } else if (c === '1') {
        i++;
      } else {
        const m = /^[A-Za-z][0-9₀-₉]*/.exec(s.slice(i));
        if (!m) throw new ParseError(`Unerwartetes Zeichen „${c}“`, offset + i);
        const raw = m[0];
        const lower = raw[0]!.toLowerCase() + raw.slice(1);
        let idx = gens.indexOf(raw);
        let sign = 1;
        if (idx < 0 && raw[0] !== lower[0]) {
          idx = gens.indexOf(lower);
          sign = -1;
        }
        if (idx < 0) throw new ParseError(`„${raw}“ ist kein Erzeuger (${gens.join(', ')})`, offset + i, offset + i + raw.length);
        i += raw.length;
        out.push(...power([sign * (idx + 1)], exponent()));
      }
    }
  };
  // Relationen der Form u = v zulassen
  const eq = s.indexOf('=');
  if (eq >= 0) {
    const left = parseRelator(s.slice(0, eq), gens, offset);
    const right = parseRelator(s.slice(eq + 1), gens, offset + eq + 1);
    return freeReduce([...left, ...inverse(right)]);
  }
  return freeReduce(word(null));
}

/** „⟨a, b | a^2, b^3⟩“ → Präsentation (Positionen für Fehlermeldungen relativ zu offset) */
export function parsePresentation(src: string, offset = 0): Presentation {
  const bar = src.indexOf('|');
  if (bar < 0) throw new ParseError('„|“ zwischen Erzeugern und Relationen fehlt, z. B. ⟨a, b | a^2, b^3⟩', offset);
  const genText = src.slice(0, bar);
  const gens = genText.split(',').map((g) => g.trim()).filter(Boolean);
  gens.forEach((g) => {
    if (!/^[a-z][0-9]*$/.test(g)) throw new ParseError(`Erzeuger „${g}“: Kleinbuchstabe mit optionalen Ziffern`, offset + Math.max(0, genText.indexOf(g)));
  });
  if (new Set(gens).size !== gens.length) throw new ParseError('Erzeuger doppelt', offset);
  const rels: Word[] = [];
  // Relationen an Kommas oberster Ebene trennen (nicht in [a, b])
  const relText = src.slice(bar + 1);
  let depth = 0;
  let start = 0;
  for (let k = 0; k <= relText.length; k++) {
    const c = relText[k];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    if (k === relText.length || (c === ',' && depth === 0)) {
      const piece = relText.slice(start, k);
      if (piece.trim()) rels.push(parseRelator(piece, gens, offset + bar + 1 + start));
      start = k + 1;
    }
  }
  return { gens, rels };
}
