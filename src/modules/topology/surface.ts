// Flächen aus Polygonen mit Kantenidentifikationen (Quotientenräume) und ihre Klassifikation.
//
// Eingabe: ein oder mehrere Polygone als Kantenwörter, z. B. „a b a⁻¹ b⁻¹“ (Torus).
//   Bezeichner: Buchstabe + optionale Ziffern (a, b, a1, c12); invers durch Großbuchstabe (A = a⁻¹),
//   nachgestelltes ' oder ⁻¹ oder ^-1. Polygone werden durch Komma oder Semikolon getrennt.
//   Kommt eine Kante zweimal vor, werden die beiden Vorkommen verklebt; einmal → Randkante.
//
// Allgemein ist das Ergebnis ein 2-dimensionaler CW-Komplex (Kanten dürfen beliebig oft vorkommen);
// seine Homologie wird immer über den zellulären Kettenkomplex berechnet. Eine Fläche liegt genau
// dann vor, wenn jede Kante höchstens zweimal vorkommt und der Link jeder Ecke ein Kreis (innen)
// bzw. ein Weg (Rand) ist.
//
// Klassifikation (Satz über die Klassifikation kompakter Flächen):
//   χ = V − E + F, orientierbar ⇔ Polygone lassen sich so orientieren, dass jede verklebte Kante
//   in den beiden Vorkommen entgegengesetzt durchlaufen wird.
//   orientierbar:      Geschlecht g = (2 − χ − r)/2,  Σ_g mit r Randkomponenten
//   nicht orientierbar: k = 2 − χ − r Kreuzhauben,    N_k mit r Randkomponenten

import { ParseError } from '../../math/parser';
import { complex, homology } from './chain';
import type { ChainComplex, HomologyGroup } from './chain';
import type { Presentation } from './group';

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
  /** Ist der Komplex eine (berandete) Fläche? Sonst Gründe in `reasons` */
  surface: boolean;
  reasons: string[];
  /** zellulärer Kettenkomplex (Eckklassen, Kanten, Polygone) und seine Homologie H₀, H₁, H₂ */
  complex: ChainComplex;
  groups: HomologyGroup[];
  /** orientierbar: Geschlecht; nicht orientierbar: Anzahl Kreuzhauben */
  genus: number;
  name: string;
  symbol: string;
  normalForm: string;
  homology: string;
  /** Präsentation der Fundamentalgruppe des 2-Komplexes (Komponente der ersten Ecke) */
  pi1: Presentation;
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
  const reasons: string[] = [];
  for (const [label, list] of uses) {
    if (list.length > 2) reasons.push(`Kante ${label} gehört zu ${list.length} Polygonseiten`);
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
    const a = list[0]!;
    for (const b of list.slice(1)) {
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

  // Link jeder Ecke: Knoten = Kantenenden an der Ecke, verbunden über die Polygonecken.
  // Fläche ⇔ je Eckklasse genau ein Link, und der ist ein Kreis oder ein Weg.
  if (!reasons.length) {
    const endId = (label: string, atHead: boolean) => `${label}:${atHead ? 'h' : 't'}`;
    const links = new Map<number, Map<string, Set<string>>>();
    const addLink = (v: number, x: string, y: string) => {
      const g = links.get(v) ?? new Map<string, Set<string>>();
      for (const [p, q] of [[x, y], [y, x]] as const) {
        if (!g.has(p)) g.set(p, new Set());
        g.get(p)!.add(q);
      }
      links.set(v, g);
    };
    faces.forEach((face, f) =>
      face.forEach((e, i) => {
        // Ecke i liegt zwischen Kante i−1 (endet hier) und Kante i (beginnt hier)
        const prev = face[(i - 1 + face.length) % face.length]!;
        const v = classOf.get(uf.find(corner(f, i)))!;
        addLink(v, endId(prev.label, prev.sign > 0), endId(e.label, e.sign < 0));
      }),
    );
    for (const [v, g] of links) {
      // Komponenten zählen (Grad ≤ 2 folgt aus höchstens zwei Kantenvorkommen)
      const seen = new Set<string>();
      let components = 0;
      for (const start of g.keys()) {
        if (seen.has(start)) continue;
        components++;
        const stack = [start];
        while (stack.length) {
          const x = stack.pop()!;
          if (seen.has(x)) continue;
          seen.add(x);
          for (const y of g.get(x)!) stack.push(y);
        }
      }
      if (components > 1) reasons.push(`Ecke ${v + 1} ist ein Quetschpunkt (Link aus ${components} Teilen)`);
    }
  }
  const surface = reasons.length === 0;

  // Zellulärer Kettenkomplex: ∂(Kante) = Endecke − Anfangsecke, ∂(Polygon) = Σ ±Kante
  const labels = [...uses.keys()];
  const d1 = Array.from({ length: V }, () => Array<number>(labels.length).fill(0));
  labels.forEach((l, j) => {
    const u = uses.get(l)![0]!;
    const row = (corner: number) => d1[classOf.get(uf.find(corner))!]!;
    row(head(u))[j]! += 1;
    row(tail(u))[j]! -= 1;
  });
  const d2 = labels.map((l) => faces.map((face) => face.reduce((acc, e) => acc + (e.label === l ? e.sign : 0), 0)));
  const cx = complex([V, labels.length, F], { 1: d1, 2: d2 });
  const groups = homology(cx);

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
  const { name, symbol, normalForm } = surface
    ? describe(orientable, genus, boundary, chi, connected)
    : { name: '2-dimensionaler CW-Komplex (keine Fläche)', symbol: '—', normalForm: '—' };
  const pi1 = presentation(faces, uses, uf, classOf, V);
  const fmt = (g: HomologyGroup) => {
    const parts = [...(g.betti ? [g.betti === 1 ? 'ℤ' : `ℤ${sup(g.betti)}`] : []), ...g.torsion.map((t) => `ℤ/${t}`)];
    return parts.join(' ⊕ ') || '0';
  };

  return {
    faces, V, E, F, chi, orientable: surface && orientable, boundary, connected, surface, reasons, complex: cx, groups,
    genus, name, symbol, normalForm, homology: fmt(groups[1] ?? { betti: 0, torsion: [] }), pi1,
    vertexClass,
    standard: connected && surface ? standardShape(orientable, genus, boundary) : null,
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
    symbol = g === 0 ? 'S²' : g === 1 ? 'T²' : g <= 4 ? Array(g).fill('T²').join(' # ') : `T² # … # T²  (${g}×)`;
    if (r) symbol = `Σ${sub(g)},${sub(r)}`;
    normalForm = g === 0 ? 'a a⁻¹' : Array.from({ length: g }, (_, i) => `a${i + 1} b${i + 1} a${i + 1}⁻¹ b${i + 1}⁻¹`).join(' ');
  } else {
    const special = r === 0 ? ['', 'Projektive Ebene', 'Kleinsche Flasche'][g] : g === 1 && r === 1 ? 'Möbiusband' : undefined;
    name = special || `Nicht orientierbare Fläche mit ${g} Kreuzhauben${rand}`;
    symbol = g === 1 ? 'ℝP²' : g === 2 ? 'ℝP² # ℝP² ≅ K' : g <= 4 ? Array(g).fill('ℝP²').join(' # ') : `ℝP² # … # ℝP²  (${g}×)`;
    if (r) symbol = `N${sub(g)},${sub(r)}`;
    normalForm = Array.from({ length: g }, (_, i) => `c${i + 1} c${i + 1}`).join(' ');
  }
  if (r) normalForm += ` (+ ${r} Randkreis${r > 1 ? 'e' : ''})`;
  void chi;
  return { name, symbol, normalForm };
}

/**
 * π₁ des 2-Komplexes (Komponente der ersten Ecke): Erzeuger = Kanten außerhalb eines Spannbaums
 * des 1-Skeletts (Ecken = Eckklassen), Relationen = Randwörter der Polygone (Baumkanten = 1).
 */
function presentation(
  faces: Face[],
  uses: Map<string, { f: number; i: number; sign: 1 | -1 }[]>,
  uf: UnionFind,
  classOf: Map<number, number>,
  V: number,
): Presentation {
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
  const edgeEnds = new Map<string, [number, number]>();
  for (const [label, list] of uses) {
    const u = list[0]!;
    const a = cls(u.f, u.i);
    const b = cls(u.f, u.i + 1);
    edgeEnds.set(label, [a, b]);
    if (treeUF.find(a) !== treeUF.find(b)) {
      treeUF.union(a, b);
      tree.add(label);
    }
  }
  // nur die Komponente der ersten Ecke
  const base = treeUF.find(cls(0, 0));
  const gens = [...uses.keys()].filter((l) => !tree.has(l) && treeUF.find(edgeEnds.get(l)![0]) === base);
  const index = new Map(gens.map((g, i) => [g, i + 1]));
  const rels = faces
    .filter((_, f) => treeUF.find(cls(f, 0)) === base)
    .map((face) => face.filter((e) => index.has(e.label)).map((e) => e.sign * index.get(e.label)!));
  return { gens, rels };
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
