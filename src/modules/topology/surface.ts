// Flächen aus Polygonen mit Kantenidentifikationen (Quotientenräume) und ihre Klassifikation.
//
// Eingabe: ein oder mehrere Polygone als Kantenwörter, z. B. „a b a⁻¹ b⁻¹“ (Torus).
//   Bezeichner: Buchstabe + optionale Ziffern (a, b, a1, c12); invers durch Großbuchstabe (A = a⁻¹),
//   nachgestelltes ' oder ⁻¹ oder ^-1. Polygone werden durch Komma oder Semikolon getrennt.
//   Kommt eine Kante zweimal vor, werden die beiden Vorkommen verklebt; einmal → Randkante.
//
// Klassifikation (Satz über die Klassifikation kompakter Flächen):
//   χ = V − E + F, orientierbar ⇔ Polygone lassen sich so orientieren, dass jede verklebte Kante
//   in den beiden Vorkommen entgegengesetzt durchlaufen wird.
//   orientierbar:      Geschlecht g = (2 − χ − r)/2,  Σ_g mit r Randkomponenten
//   nicht orientierbar: k = 2 − χ − r Kreuzhauben,    N_k mit r Randkomponenten

import { ParseError } from '../../math/parser';

export interface EdgeUse {
  label: string;
  /** +1: in Umlaufrichtung, −1: entgegen (invers) */
  sign: 1 | -1;
}

export type Face = EdgeUse[];

/** Fehler im Kantenwort (als ParseError, damit das Formelfeld die Position markiert) */
export class WordError extends ParseError {
  constructor(message: string, pos: number, end = pos + 1) {
    super(message, pos, end);
    this.name = 'WordError';
  }
}

const TOKEN = /([A-Za-z])(\d*)\s*(⁻¹|\^\s*-\s*1|'|’|-1)?/y;

/** Liest Kantenwörter; wirft WordError mit Position bei ungültiger Eingabe. */
export function parseWord(src: string): Face[] {
  const faces: Face[] = [];
  let face: Face = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ',' || c === ';') {
      if (!face.length) throw new WordError('Leeres Polygon', i);
      faces.push(face);
      face = [];
      i++;
      continue;
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) throw new WordError(`Unerwartetes Zeichen „${c}“`, i);
    const upper = m[1] !== m[1]!.toLowerCase();
    const inverse = upper !== !!m[3]; // Großbuchstabe und Invers-Zeichen heben sich auf
    face.push({ label: m[1]!.toLowerCase() + m[2], sign: inverse ? -1 : 1 });
    i += m[0].length;
  }
  if (face.length) faces.push(face);
  if (!faces.length) throw new WordError('Kein Polygon', 0);
  return faces;
}

export function formatWord(faces: Face[]): string {
  return faces.map((f) => f.map((e) => e.label + (e.sign < 0 ? '⁻¹' : '')).join(' ')).join(', ');
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    while (this.parent[a] !== a) a = this.parent[a] = this.parent[this.parent[a]!]!;
    return a;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

export interface SurfaceInfo {
  faces: Face[];
  V: number;
  E: number;
  F: number;
  chi: number;
  orientable: boolean;
  boundary: number;
  connected: boolean;
  /** orientierbar: Geschlecht; nicht orientierbar: Anzahl Kreuzhauben */
  genus: number;
  name: string;
  symbol: string;
  normalForm: string;
  homology: string;
  /** Präsentation der Fundamentalgruppe des 2-Komplexes */
  pi1: string;
  /** Eckklasse jeder Polygonecke: vertexClass[f][i] = Klasse der Ecke vor Kante i */
  vertexClass: number[][];
  /** Standardpolygon für die Verklebe-Animation (falls vorhanden) */
  standard: StandardShape | null;
}

export type StandardShape = 'sphere' | 'torus' | 'klein' | 'rp2' | 'moebius' | 'cylinder' | 'disk' | 'genus';

/** Zerlegt, prüft und klassifiziert eine Fläche aus Polygonen mit Kantenidentifikationen. */
export function classify(faces: Face[]): SurfaceInfo {
  // Vorkommen je Kante
  const uses = new Map<string, { f: number; i: number; sign: 1 | -1 }[]>();
  faces.forEach((face, f) =>
    face.forEach((e, i) => {
      const list = uses.get(e.label) ?? [];
      list.push({ f, i, sign: e.sign });
      uses.set(e.label, list);
    }),
  );
  for (const [label, list] of uses) {
    if (list.length > 2) throw new WordError(`Kante ${label} kommt ${list.length}× vor (höchstens 2)`, 0);
  }

  // Ecken: Ecke i von Polygon f liegt vor Kante i. Kante i läuft (in Umlaufrichtung) von Ecke i
  // nach Ecke i+1; Anfang/Ende im Sinn der Kantenrichtung hängen vom Vorzeichen ab.
  const offset: number[] = [];
  let n = 0;
  for (const face of faces) {
    offset.push(n);
    n += face.length;
  }
  const corner = (f: number, i: number) => offset[f]! + (i % faces[f]!.length);
  const tail = (u: { f: number; i: number; sign: number }) => (u.sign > 0 ? corner(u.f, u.i) : corner(u.f, u.i + 1));
  const head = (u: { f: number; i: number; sign: number }) => (u.sign > 0 ? corner(u.f, u.i + 1) : corner(u.f, u.i));
  const uf = new UnionFind(n);
  const faceUF = new UnionFind(faces.length);
  for (const list of uses.values()) {
    if (list.length === 2) {
      const [a, b] = list as [(typeof list)[0], (typeof list)[0]];
      uf.union(tail(a), tail(b));
      uf.union(head(a), head(b));
      faceUF.union(a.f, b.f);
    }
  }
  const classOf = new Map<number, number>();
  const vertexClass = faces.map((face, f) =>
    face.map((_, i) => {
      const r = uf.find(corner(f, i));
      if (!classOf.has(r)) classOf.set(r, classOf.size);
      return classOf.get(r)!;
    }),
  );
  const V = classOf.size;
  const E = uses.size;
  const F = faces.length;
  const chi = V - E + F;
  const connected = new Set(faces.map((_, f) => faceUF.find(f))).size === 1;

  // Orientierbarkeit: Orientierung ε_f ∈ {±1} je Polygon mit ε_f·s = −ε_g·t für jede verklebte Kante
  const eps: number[] = faces.map(() => 0);
  let orientable = true;
  for (let start = 0; start < F; start++) {
    if (eps[start]) continue;
    eps[start] = 1;
    const queue = [start];
    while (queue.length) {
      const f = queue.shift()!;
      for (const list of uses.values()) {
        if (list.length !== 2) continue;
        const [a, b] = list as [(typeof list)[0], (typeof list)[0]];
        for (const [x, y] of [[a, b], [b, a]] as const) {
          if (x.f !== f) continue;
          const want = -eps[f]! * x.sign * y.sign; // ε_y = −ε_x · s_x · s_y
          if (!eps[y.f]) {
            eps[y.f] = want;
            queue.push(y.f);
          } else if (eps[y.f] !== want) orientable = false;
        }
      }
    }
  }

  // Randkomponenten: Randkanten verbinden Eckklassen; jede Komponente dieses Graphen ist ein Kreis
  const boundaryUF = new UnionFind(V);
  const boundaryVertices = new Set<number>();
  for (const list of uses.values()) {
    if (list.length !== 1) continue;
    const u = list[0]!;
    const a = classOf.get(uf.find(tail(u)))!;
    const b = classOf.get(uf.find(head(u)))!;
    boundaryUF.union(a, b);
    boundaryVertices.add(a).add(b);
  }
  const boundary = new Set([...boundaryVertices].map((v) => boundaryUF.find(v))).size;

  const genus = orientable ? (2 - chi - boundary) / 2 : 2 - chi - boundary;
  const { name, symbol, normalForm, homology } = describe(orientable, genus, boundary, chi, connected);
  const pi1 = presentation(faces, uses, uf, classOf, V);

  return {
    faces, V, E, F, chi, orientable, boundary, connected, genus, name, symbol, normalForm, homology, pi1,
    vertexClass,
    standard: connected ? standardShape(orientable, genus, boundary) : null,
  };
}

function standardShape(orientable: boolean, g: number, r: number): StandardShape | null {
  if (orientable && r === 0) return g === 0 ? 'sphere' : g === 1 ? 'torus' : 'genus';
  if (orientable && g === 0 && r === 1) return 'disk';
  if (orientable && g === 0 && r === 2) return 'cylinder';
  if (!orientable && r === 0) return g === 1 ? 'rp2' : g === 2 ? 'klein' : null;
  if (!orientable && g === 1 && r === 1) return 'moebius';
  return null;
}

const sub = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[+d]!);
const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!);

function describe(orientable: boolean, g: number, r: number, chi: number, connected: boolean) {
  if (!connected) {
    return {
      name: 'Nicht zusammenhängend – jede Komponente ist eine eigene Fläche',
      symbol: '—',
      normalForm: '—',
      homology: '—',
    };
  }
  const rand = r ? ` mit ${r} Randkomponente${r > 1 ? 'n' : ''}` : '';
  let name: string;
  let symbol: string;
  let normalForm: string;
  if (orientable) {
    const special = r === 0
      ? ['Sphäre', 'Torus'][g]
      : g === 0
        ? ['', 'Kreisscheibe', 'Zylinder (Kreisring)', 'Hose (Pair of Pants)'][r]
        : undefined;
    name = special ?? `Orientierbare Fläche vom Geschlecht ${g}${rand}`;
    if (special && r === 0) name = special;
    symbol = g === 0 ? 'S²' : g === 1 ? 'T²' : `T² # … # T²  (${g}×)`;
    if (r) symbol = `Σ${sub(g)},${sub(r)}`;
    normalForm = g === 0 ? 'a a⁻¹' : Array.from({ length: g }, (_, i) => `a${i + 1} b${i + 1} a${i + 1}⁻¹ b${i + 1}⁻¹`).join(' ');
  } else {
    const special = r === 0 ? ['', 'Projektive Ebene', 'Kleinsche Flasche'][g] : g === 1 && r === 1 ? 'Möbiusband' : undefined;
    name = special || `Nicht orientierbare Fläche mit ${g} Kreuzhauben${rand}`;
    symbol = g === 1 ? 'ℝP²' : g === 2 ? 'ℝP² # ℝP²  (≅ K)' : `ℝP² # … # ℝP²  (${g}×)`;
    if (r) symbol = `N${sub(g)},${sub(r)}`;
    normalForm = Array.from({ length: g }, (_, i) => `c${i + 1} c${i + 1}`).join(' ');
  }
  if (r) normalForm += ` (+ ${r} Randkreis${r > 1 ? 'e' : ''})`;
  // Erste Homologie: geschlossen orientierbar ℤ^{2g}; geschlossen nicht orientierbar ℤ^{k−1} ⊕ ℤ/2;
  // mit Rand homotopieäquivalent zu einem Bukett von 1 − χ Kreisen → ℤ^{1−χ}
  const Z = (k: number) => (k === 0 ? '0' : k === 1 ? 'ℤ' : `ℤ${sup(k)}`);
  let homology: string;
  if (r) homology = Z(1 - chi);
  else if (orientable) homology = Z(2 * g);
  else homology = g === 1 ? 'ℤ/2' : `${Z(g - 1)} ⊕ ℤ/2`;
  return { name, symbol, normalForm, homology };
}

/**
 * π₁ des 2-Komplexes: Erzeuger = Kanten außerhalb eines Spannbaums des 1-Skeletts
 * (Ecken = Eckklassen), Relationen = Randwörter der Polygone ohne Baumkanten.
 */
function presentation(
  faces: Face[],
  uses: Map<string, { f: number; i: number; sign: 1 | -1 }[]>,
  uf: UnionFind,
  classOf: Map<number, number>,
  V: number,
): string {
  const offset: number[] = [];
  let n = 0;
  for (const face of faces) {
    offset.push(n);
    n += face.length;
  }
  const cls = (f: number, i: number) => classOf.get(uf.find(offset[f]! + (i % faces[f]!.length)))!;
  // Kante als Verbindung zweier Eckklassen (erstes Vorkommen genügt)
  const tree = new Set<string>();
  const treeUF = new UnionFind(V);
  for (const [label, list] of uses) {
    const u = list[0]!;
    const a = cls(u.f, u.i);
    const b = cls(u.f, u.i + 1);
    if (treeUF.find(a) !== treeUF.find(b)) {
      treeUF.union(a, b);
      tree.add(label);
    }
  }
  const gens = [...uses.keys()].filter((l) => !tree.has(l));
  const rels = faces
    .map((face) => face.filter((e) => !tree.has(e.label)).map((e) => e.label + (e.sign < 0 ? '⁻¹' : '')).join(''))
    .map((w) => w || '1');
  const nontrivial = rels.filter((w) => w !== '1');
  if (!gens.length) return '1 (trivial)';
  return `⟨ ${gens.join(', ')} | ${nontrivial.length ? nontrivial.join(', ') : '–'} ⟩`;
}

/** Zusammenhängende Summe: Normalform eines Summanden mit frischen Bezeichnern anhängen */
export function connectedSum(faces: Face[], summand: 'torus' | 'rp2'): Face[] {
  const used = new Set(faces.flat().map((e) => e.label));
  const fresh = () => {
    for (let i = 1; ; i++) {
      for (const l of 'abcdefghjkmnpqrstuvwxyz') {
        const name = `${l}${i}`;
        if (!used.has(name)) {
          used.add(name);
          return name;
        }
      }
    }
  };
  const add: Face =
    summand === 'torus'
      ? (() => {
          const a = fresh();
          const b = fresh();
          return [
            { label: a, sign: 1 }, { label: b, sign: 1 }, { label: a, sign: -1 }, { label: b, sign: -1 },
          ] as Face;
        })()
      : (() => {
          const c = fresh();
          return [{ label: c, sign: 1 }, { label: c, sign: 1 }] as Face;
        })();
  // Sphäre (a a⁻¹) ist das neutrale Element: ersetzen statt anhängen
  const info = classify(faces);
  if (info.connected && info.orientable && info.genus === 0 && info.boundary === 0 && faces.length === 1) return [add];
  // Summe von Ein-Polygon-Flächen: Wörter hintereinander (Standardkonstruktion)
  if (faces.length === 1) return [[...faces[0]!, ...add]];
  return [...faces.slice(0, -1), [...faces[faces.length - 1]!, ...add]];
}
