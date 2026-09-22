// Simplizialkomplexe aus Facettenlisten → Kettenkomplex, f-Vektor, Pseudomannigfaltigkeit, Orientierbarkeit.
//
// Eingabe: „123 134 234“ (einstellige Ecken) oder „[1,2,3], [1,3,4]“ bzw. „1 2 3; 1 3 4“.
// Orientierung eines Simplex = aufsteigende Eckenordnung; ∂[v₀…v_k] = Σ (−1)^i [v₀…v̂_i…v_k].
import { ParseError } from '../../math/parser';
import { complex } from './chain';
import type { ChainComplex } from './chain';

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

/** Bekannte Triangulierungen */
export const SIMPLICIAL_PRESETS: readonly { label: string; facets: string; title: string }[] = [
  { label: 'S² (Tetraeder)', facets: '123 124 134 234', title: 'Rand des 3-Simplex' },
  { label: 'S³ (Rand des 4-Simplex)', facets: '1234 1235 1245 1345 2345', title: '5 Tetraeder' },
  {
    label: 'Torus (7 Ecken)',
    // Möbius–Császár: {i, i+1, i+3} und {i, i+2, i+3} mod 7
    facets: Array.from({ length: 7 }, (_, i) =>
      [[i, i + 1, i + 3], [i, i + 2, i + 3]].map((t) => t.map((v) => (v % 7) + 1).join('')).join(' '),
    ).join(' '),
    title: 'Minimale Triangulierung (Möbius–Császár)',
  },
  { label: 'ℝP² (6 Ecken)', facets: '123 134 145 156 162 235 346 452 563 624', title: 'Halb-Ikosaeder' },
  { label: 'Möbiusband (5 Ecken)', facets: '123 234 345 451 512', title: '{i, i+1, i+2} mod 5' },
  { label: 'Zwei Dreiecke, ein Punkt', facets: '123 145', title: 'Keilprodukt zweier Scheiben – keine Pseudomannigfaltigkeit' },
];
