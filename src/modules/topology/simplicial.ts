// Simplizialkomplexe aus Facettenlisten → Kettenkomplex, f-Vektor, Pseudomannigfaltigkeit, Orientierbarkeit.
//
// Eingabe: „123 134 234“ (einstellige Ecken) oder „[1,2,3], [1,3,4]“ bzw. „1 2 3; 1 3 4“.
// Orientierung eines Simplex = aufsteigende Eckenordnung; ∂[v₀…v_k] = Σ (−1)^i [v₀…v̂_i…v_k].
import { ParseError } from '../../math/parser';
import { complex } from './chain';
import type { ChainComplex } from './chain';
import type { Presentation } from './group';

export interface SimplicialInfo {
  complex: ChainComplex;
  /** Anzahl Simplizes je Dimension */
  f: number[];
  vertices: string[];
  facets: string[][];
  /** alle 1-Simplizes (für das Diagramm) */
  edges: [string, string][];
  /** Dimension, falls alle Facetten gleich groß sind */
  pure: number | null;
  /** rein, jede (n−1)-Seite in höchstens 2 Facetten und über (n−1)-Seiten zusammenhängend */
  pseudomanifold: boolean;
  boundaryFaces: number;
  orientable: boolean | null;
  /** Kantenweg-Gruppe (π₁ der Komponente der ersten Ecke) */
  pi1: Presentation;
}

const key = (s: string[]) => s.join('\u0001');

export function parseFacets(src: string): string[][] {
  const text = src.trim();
  if (!text) throw new ParseError('Keine Facetten', 0);
  let groups: string[][];
  if (/[[\];,]/.test(text)) {
    groups = text
      .split(/\]\s*,?\s*\[|;|\]\s*,|,\s*\[/)
      .map((g) => g.replace(/[[\]]/g, '').trim())
      .filter(Boolean)
      .map((g) => g.split(/[\s,]+/).filter(Boolean));
  } else {
    // „123 134“: jedes Zeichen ist eine Ecke
    groups = text.split(/\s+/).map((g) => [...g]);
  }
  for (const g of groups) {
    for (const v of g) if (!/^[A-Za-z0-9]+$/.test(v)) throw new ParseError(`Ungültige Ecke „${v}“`, Math.max(0, src.indexOf(v)));
    if (new Set(g).size !== g.length) throw new ParseError(`Facette ${g.join('')} enthält eine Ecke doppelt`, Math.max(0, src.indexOf(g[0]!)));
  }
  return groups;
}

export function simplicial(facetsIn: string[][]): SimplicialInfo {
  const order = (v: string) => (/^\d+$/.test(v) ? v.padStart(12, '0') : v);
  const sortS = (s: string[]) => [...s].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  const facets = facetsIn.map(sortS);

  // Alle Seiten (Teilmengen) der Facetten, nach Dimension
  const byDim: Map<string, string[]>[] = [];
  for (const f of facets) {
    const n = f.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const s = f.filter((_, i) => mask & (1 << i));
      const d = s.length - 1;
      (byDim[d] ??= new Map()).set(key(s), s);
    }
  }
  const dims = byDim.length;
  const lists: string[][][] = Array.from({ length: dims }, (_, d) => [...(byDim[d] ?? new Map<string, string[]>()).values()]);
  const index = lists.map((l) => new Map(l.map((s, i) => [key(s), i])));
  const cells = lists.map((l) => l.length);
  const d: Record<number, number[][]> = {};
  for (let k = 1; k < dims; k++) {
    const M = Array.from({ length: cells[k - 1]! }, () => Array<number>(cells[k]!).fill(0));
    lists[k]!.forEach((s, j) => {
      for (let i = 0; i < s.length; i++) {
        const face = s.filter((_, m) => m !== i);
        M[index[k - 1]!.get(key(face))!]![j] = i % 2 ? -1 : 1;
      }
    });
    d[k] = M;
  }

  const sizes = new Set(facets.map((f) => f.length));
  const pure = sizes.size === 1 ? facets[0]!.length - 1 : null;
  // Pseudomannigfaltigkeit: jede (n−1)-Seite in 1 (Rand) oder 2 Facetten
  let pseudomanifold = pure !== null && pure >= 1;
  let boundaryFaces = 0;
  let orientable: boolean | null = null;
  if (pseudomanifold && pure !== null) {
    const incidences = new Map<string, { facet: number; sign: number }[]>();
    facets.forEach((f, fi) =>
      f.forEach((_, i) => {
        const face = key(f.filter((__, m) => m !== i));
        const list = incidences.get(face) ?? [];
        list.push({ facet: fi, sign: i % 2 ? -1 : 1 });
        incidences.set(face, list);
      }),
    );
    // stark zusammenhängend: Facetten über gemeinsame (n−1)-Seiten verbunden
    const parent = facets.map((_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
    for (const list of incidences.values()) {
      if (list.length > 2) pseudomanifold = false;
      if (list.length === 1) boundaryFaces++;
      for (const x of list.slice(1)) parent[find(x.facet)] = find(list[0]!.facet);
    }
    if (new Set(facets.map((_, i) => find(i))).size > 1) pseudomanifold = false;
    if (pseudomanifold) {
      // Orientierung ε je Facette: benachbarte Facetten induzieren entgegengesetzte Vorzeichen
      const eps = facets.map(() => 0);
      orientable = true;
      for (let s = 0; s < facets.length; s++) {
        if (eps[s]) continue;
        eps[s] = 1;
        const queue = [s];
        while (queue.length) {
          const f = queue.shift()!;
          for (const list of incidences.values()) {
            if (list.length !== 2) continue;
            const [a, b] = list as [{ facet: number; sign: number }, { facet: number; sign: number }];
            for (const [x, y] of [[a, b], [b, a]] as const) {
              if (x.facet !== f) continue;
              const want = -eps[f]! * x.sign * y.sign;
              if (!eps[y.facet]) {
                eps[y.facet] = want;
                queue.push(y.facet);
              } else if (eps[y.facet] !== want) orientable = false;
            }
          }
        }
      }
    }
  }
  return {
    pi1: edgePathGroup(lists[0] ?? [], lists[1] ?? [], lists[2] ?? []),
    complex: complex(cells, d),
    f: cells,
    vertices: (lists[0] ?? []).map((s) => s[0]!),
    facets,
    edges: (lists[1] ?? []).map((s) => [s[0]!, s[1]!] as [string, string]),
    pure,
    pseudomanifold,
    boundaryFaces,
    orientable,
  };
}

/**
 * Kantenweg-Gruppe: Spannbaum des 1-Gerüsts, Erzeuger = übrige Kanten (von kleiner zu großer Ecke),
 * Relation je Dreieck [a, b, c]: (ab)(bc)(ac)⁻¹ mit Baumkanten = 1.
 */
function edgePathGroup(verts: string[][], edges: string[][], triangles: string[][]): Presentation {
  const vIndex = new Map(verts.map((v, i) => [v[0]!, i]));
  const parent = verts.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
  const tree = new Set<string>();
  for (const e of edges) {
    const a = find(vIndex.get(e[0]!)!), b = find(vIndex.get(e[1]!)!);
    if (a !== b) {
      parent[a] = b;
      tree.add(key(e));
    }
  }
  if (!verts.length) return { gens: [], rels: [] };
  const base = find(0);
  const gensE = edges.filter((e) => !tree.has(key(e)) && find(vIndex.get(e[0]!)!) === base);
  const index = new Map(gensE.map((e, i) => [key(e), i + 1]));
  const letter = (a: string, b: string, sign: number) => {
    const g = index.get(key([a, b]));
    return g ? [sign * g] : [];
  };
  const rels = triangles
    .filter((t) => find(vIndex.get(t[0]!)!) === base)
    .map((t) => [...letter(t[0]!, t[1]!, 1), ...letter(t[1]!, t[2]!, 1), ...letter(t[0]!, t[2]!, -1)]);
  return { gens: gensE.map((e) => `${e[0]}${e[1]}`), rels };
}

export type V3 = [number, number, number];

export interface SimplicialPreset {
  label: string;
  facets: string;
  title: string;
  /** Ecke → Raumkoordinaten (überschneidungsfreie Einbettung, falls es eine gibt) */
  coords?: Record<string, V3>;
}

const TAU = 2 * Math.PI;

/** Ikosaeder: Ecken (0, ±1, ±φ) zyklisch, Dreiecke = Tripel mit paarweisem Abstand 2 */
function icosahedron(): SimplicialPreset {
  const phi = (1 + Math.sqrt(5)) / 2;
  const pts: V3[] = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) pts.push([0, a, b], [a, b, 0], [b, 0, a]);
  const d = (i: number, j: number) => Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1], pts[i]![2] - pts[j]![2]);
  const faces: number[][] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
    if ([d(i, j), d(j, k), d(i, k)].every((x) => Math.abs(x - 2) < 1e-9)) faces.push([i + 1, j + 1, k + 1]);
  }
  return {
    label: 'S² (Ikosaeder, 12 Ecken)',
    facets: faces.map((f) => f.join(' ')).join('; '),
    title: '20 Dreiecke, jede Ecke hat 5 Nachbarn',
    coords: Object.fromEntries(pts.map((p, i) => [String(i + 1), p])),
  };
}

/** Torus aus einem n×n-Gitter, jedes Quadrat diagonal geteilt, auf einen Rotationstorus gesetzt */
function gridTorus(n: number): SimplicialPreset {
  const id = (i: number, j: number) => ((i + n) % n) * n + ((j + n) % n) + 1;
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
  }
  const coords: Record<string, V3> = {};
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = (TAU * i) / n, v = (TAU * j) / n + Math.PI / n;
    coords[String(id(i, j))] = [(2 + Math.cos(v)) * Math.cos(u), Math.sin(v), (2 + Math.cos(v)) * Math.sin(u)];
  }
  return {
    label: `Torus (${n}×${n}-Gitter)`,
    facets: faces.map((f) => f.join(' ')).join('; '),
    title: `${n * n} Ecken, ${2 * n * n} Dreiecke – Quadrate eines Gitters, gegenüberliegende Ränder verklebt`,
    coords,
  };
}

// Császár-Polyeder: überschneidungsfreie Einbettung des 7-Ecken-Torus (Zuordnung per Suche geprüft)
const CSASZAR: V3[] = [[3, -3, 0], [-3, 3, 0], [-3, -3, 1], [3, 3, 1], [-1, -2, 3], [1, 2, 3], [0, 0, 15]];
const CSASZAR_LABEL = [0, 1, 4, 3, 6, 2, 5];

/** Bekannte Triangulierungen */
export const SIMPLICIAL_PRESETS: readonly SimplicialPreset[] = [
  {
    label: 'S² (Tetraeder)',
    facets: '123 124 134 234',
    title: 'Rand des 3-Simplex',
    coords: { 1: [1, 1, 1], 2: [1, -1, -1], 3: [-1, 1, -1], 4: [-1, -1, 1] },
  },
  {
    label: 'S² (Oktaeder)',
    facets: '135 145 136 146 235 245 236 246',
    title: '6 Ecken ±x, ±y, ±z',
    coords: { 1: [1, 0, 0], 2: [-1, 0, 0], 3: [0, 1, 0], 4: [0, -1, 0], 5: [0, 0, 1], 6: [0, 0, -1] },
  },
  icosahedron(),
  gridTorus(6),
  {
    label: 'Torus (7 Ecken, Császár)',
    // Möbius–Császár: {i, i+1, i+3} und {i, i+2, i+3} mod 7
    facets: Array.from({ length: 7 }, (_, i) =>
      [[i, i + 1, i + 3], [i, i + 2, i + 3]].map((t) => t.map((v) => (v % 7) + 1).join('')).join(' '),
    ).join(' '),
    title: 'Minimale Triangulierung, als Császár-Polyeder ohne Selbstdurchdringung eingebettet',
    // linear gestaucht (Einbettungen bleiben unter linearen Abbildungen überschneidungsfrei), Spitze nach oben
    coords: Object.fromEntries(CSASZAR_LABEL.map((k, i) => {
      const [x, y, z] = CSASZAR[k]!;
      return [String(i + 1), [x, z * 0.35, y] as V3];
    })),
  },
  {
    label: 'Kreisscheibe (Kegel über Fünfeck)',
    facets: '012 023 034 045 051',
    title: 'Mitte 0, Rand 1–5',
    coords: {
      0: [0, 0.6, 0],
      ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [String(k), [Math.cos((TAU * k) / 5), 0, Math.sin((TAU * k) / 5)] as V3])),
    },
  },
  {
    label: 'Möbiusband (5 Ecken)',
    facets: '123 234 345 451 512',
    title: '{i, i+1, i+2} mod 5 – alle Ecken liegen auf dem Randkreis',
    coords: Object.fromEntries(
      [1, 2, 3, 4, 5].map((k) => {
        // Randkanten sind {i, i+2}: der Rand läuft 1 → 3 → 5 → 2 → 4 und dabei zweimal herum
        const U = (2 * TAU * ((3 * (k - 1)) % 5)) / 5;
        const w = 0.8;
        return [String(k), [(1.6 + w * Math.cos(U / 2)) * Math.cos(U), w * Math.sin(U / 2), (1.6 + w * Math.cos(U / 2)) * Math.sin(U)] as V3];
      }),
    ),
  },
  { label: 'ℝP² (6 Ecken)', facets: '123 134 145 156 162 235 346 452 563 624', title: 'Halb-Ikosaeder – in ℝ³ nicht einbettbar, daher mit Durchdringungen gezeichnet' },
  {
    label: 'S³ (Rand des 4-Simplex)',
    facets: '1234 1235 1245 1345 2345',
    title: '5 Tetraeder; gezeichnet als Schlegel-Diagramm (Ecke 5 in der Mitte)',
    coords: { 1: [1, 1, 1], 2: [1, -1, -1], 3: [-1, 1, -1], 4: [-1, -1, 1], 5: [0, 0, 0] },
  },
  {
    label: 'Zwei Dreiecke, ein Punkt',
    facets: '123 145',
    title: 'Keilprodukt zweier Scheiben – keine Pseudomannigfaltigkeit',
    coords: { 1: [0, 0, 0], 2: [1.5, 1, 0], 3: [1.5, -1, 0], 4: [-1.5, 0, 1], 5: [-1.5, 0, -1] },
  },
];
