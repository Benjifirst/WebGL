// Knotendiagramm aus einer Raumkurve: Projektion, Kreuzungen, Bögen, PD-Code.
//
// Projektion entlang einer Richtung d (unter mehreren Kandidaten die mit den wenigsten Kreuzungen).
// Jede Kreuzung kennt den oberen und unteren Strang (Parameter entlang der Komponente), die
// Richtungen in der Ebene und ihr Vorzeichen: positiv (rechtshändig), wenn o × u > 0 (o, u =
// Richtungen des oberen bzw. unteren Strangs, Blick von oben).
//   Kanten (für den PD-Code / Jones): die Kurve zwischen zwei aufeinanderfolgenden Durchgängen.
//   Bögen (für Wirtinger, Alexander, Färbungen): die Kurve zwischen zwei Unterführungen.
import type { Link, P3 } from './curves';

export type P2 = [number, number];

export interface Crossing {
  /** Punkt in der Ebene */
  at: P2;
  over: { comp: number; param: number };
  under: { comp: number; param: number };
  /** Richtungen des oberen bzw. unteren Strangs in der Ebene */
  o: P2;
  u: P2;
  sign: 1 | -1;
}

export interface Diagram {
  /** projizierte Komponenten (2D) und ihre Höhen */
  comps: P2[][];
  heights: number[][];
  crossings: Crossing[];
  /** Projektionsrichtung (Einheitsvektor) */
  direction: P3;
  /** Bögen: arcOf(over-Durchgang), Anfang/Ende an Unterführungen */
  arcs: number;
  /** je Kreuzung: oberer Bogen, ankommender und abgehender unterer Bogen */
  arcIncidence: { over: number; inU: number; outU: number }[];
  /** PD-Code X[a, b, c, d] (a = ankommend unten, gegen den Uhrzeigersinn) und Anzahl Kanten */
  pd: [number, number, number, number][];
  edges: number;
  /** Komponenten ohne jede Kreuzung (freie Kreise) */
  freeLoops: number;
  /** Komponente jeder Kreuzung (oben, unten) für Verschlingungszahlen */
  compPairs: [number, number][];
}

const dot3 = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: P3): P3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Orthonormalbasis (e1, e2) senkrecht zu d; Blick entlang −d („von oben“ = aus Richtung d) */
function basis(d: P3): [P3, P3] {
  const a: P3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm3(cross3(a, d));
  const e2 = cross3(d, e1);
  return [e1, e2];
}

function project(link: Link, d: P3) {
  const [e1, e2] = basis(d);
  return {
    comps: link.map((c) => c.map((p) => [dot3(p, e1), dot3(p, e2)] as P2)),
    heights: link.map((c) => c.map((p) => dot3(p, d))),
  };
}

interface RawCrossing {
  a: { comp: number; seg: number; s: number };
  b: { comp: number; seg: number; s: number };
  at: P2;
}

/** Alle Schnitte von Segmenten der projizierten Kurven (Nachbarsegmente ausgenommen) */
function intersections(comps: P2[][]): RawCrossing[] {
  const segs: { comp: number; seg: number; p: P2; q: P2; minx: number; maxx: number; miny: number; maxy: number }[] = [];
  comps.forEach((c, ci) =>
    c.forEach((p, i) => {
      const q = c[(i + 1) % c.length]!;
      segs.push({ comp: ci, seg: i, p, q, minx: Math.min(p[0], q[0]), maxx: Math.max(p[0], q[0]), miny: Math.min(p[1], q[1]), maxy: Math.max(p[1], q[1]) });
    }),
  );
  // nach x sortieren (Sweep), dann paarweise prüfen
  const order = segs.map((_, i) => i).sort((i, j) => segs[i]!.minx - segs[j]!.minx);
  const out: RawCrossing[] = [];
  for (let oi = 0; oi < order.length; oi++) {
    const A = segs[order[oi]!]!;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const B = segs[order[oj]!]!;
      if (B.minx > A.maxx) break;
      if (B.miny > A.maxy || B.maxy < A.miny) continue;
      if (A.comp === B.comp) {
        const n = comps[A.comp]!.length;
        const dd = Math.abs(A.seg - B.seg);
        if (dd <= 1 || dd >= n - 1) continue;
      }
      const r: P2 = [A.q[0] - A.p[0], A.q[1] - A.p[1]];
      const s: P2 = [B.q[0] - B.p[0], B.q[1] - B.p[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-14) continue;
      const w: P2 = [B.p[0] - A.p[0], B.p[1] - A.p[1]];
      const t = (w[0] * s[1] - w[1] * s[0]) / den;
      const u = (w[0] * r[1] - w[1] * r[0]) / den;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      out.push({ a: { comp: A.comp, seg: A.seg, s: t }, b: { comp: B.comp, seg: B.seg, s: u }, at: [A.p[0] + t * r[0], A.p[1] + t * r[1]] });
    }
  }
  return out;
}

/** Kandidaten für Projektionsrichtungen (deterministisch, leicht schief gegen Entartungen) */
function candidateDirections(): P3[] {
  const out: P3[] = [norm3([0.013, 0.021, 1])];
  const n = 40;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n; // obere Halbkugel genügt (d und −d liefern dieselben Kreuzungen)
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963 + 0.1;
    out.push(norm3([r * Math.cos(phi), r * Math.sin(phi), y]));
  }
  return out;
}

export class DiagramError extends Error {}

/**
 * Lesbarkeit einer Projektion: kleinster Kreuzungswinkel (sin) und kleinstes Seitenverhältnis der
 * projizierten Komponenten (1 = rund, 0 = von der Kante gesehen).
 */
function readability(comps: P2[][], raw: RawCrossing[]): number {
  let minSin = 1;
  for (const c of raw) {
    const a = dirAt(comps, c.a), b = dirAt(comps, c.b);
    minSin = Math.min(minSin, Math.abs(a[0] * b[1] - a[1] * b[0]));
  }
  let minAspect = 1;
  for (const c of comps) {
    // Hauptachsen der Punktwolke (Kovarianz)
    const n = c.length;
    const mx = c.reduce((s, p) => s + p[0], 0) / n, my = c.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of c) {
      sxx += (p[0] - mx) ** 2;
      syy += (p[1] - my) ** 2;
      sxy += (p[0] - mx) * (p[1] - my);
    }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
    minAspect = Math.min(minAspect, Math.sqrt(l2 / Math.max(l1, 1e-12)));
  }
  return Math.min(minSin * 2, minAspect * 3, 1);
}

/** Diagramm mit möglichst wenigen Kreuzungen berechnen (bei Gleichstand: am besten lesbar) */
export function computeDiagram(link: Link, fixed?: P3): Diagram {
  let best: { d: P3; raw: RawCrossing[]; proj: ReturnType<typeof project>; score: number } | null = null;
  for (const d of fixed ? [fixed] : candidateDirections()) {
    const proj = project(link, d);
    const raw = intersections(proj.comps);
    // Höhen müssen an jeder Kreuzung klar verschieden sein
    const ok = raw.every((c) => {
      const ha = heightAt(proj.heights, c.a), hb = heightAt(proj.heights, c.b);
      return Math.abs(ha - hb) > 1e-6;
    });
    if (!ok) continue;
    // Kreuzungen zählen, schlecht lesbare Projektionen (schleifende Kreuzungen, Kanten-Ansicht) bestrafen
    const r = readability(proj.comps, raw);
    const score = raw.length + (r < 0.5 ? 3 * (0.5 - r) * 10 : 0) - 0.01 * r;
    if (!best || score < best.score) best = { d, raw, proj, score };
  }
  if (!best) throw new DiagramError('Die Kurve schneidet sich selbst (an einer Kreuzung sind beide Stränge gleich hoch).');
  return buildDiagram(best.proj.comps, best.proj.heights, best.raw, best.d);
}

function heightAt(heights: number[][], x: { comp: number; seg: number; s: number }): number {
  const h = heights[x.comp]!;
  const a = h[x.seg]!, b = h[(x.seg + 1) % h.length]!;
  return a + (b - a) * x.s;
}

function dirAt(comps: P2[][], x: { comp: number; seg: number }): P2 {
  const c = comps[x.comp]!;
  const p = c[x.seg]!, q = c[(x.seg + 1) % c.length]!;
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
}

function buildDiagram(comps: P2[][], heights: number[][], raw: RawCrossing[], direction: P3): Diagram {
  const crossings: Crossing[] = raw.map((c) => {
    const aTop = heightAt(heights, c.a) > heightAt(heights, c.b);
    const top = aTop ? c.a : c.b;
    const bot = aTop ? c.b : c.a;
    const o = dirAt(comps, top);
    const u = dirAt(comps, bot);
    const sign = o[0] * u[1] - o[1] * u[0] > 0 ? 1 : -1;
    return {
      at: c.at,
      over: { comp: top.comp, param: top.seg + top.s },
      under: { comp: bot.comp, param: bot.seg + bot.s },
      o,
      u,
      sign,
    };
  });

  // Durchgänge je Komponente, entlang des Parameters sortiert
  type Pass = { cross: number; over: boolean; param: number };
  const passes: Pass[][] = comps.map(() => []);
  crossings.forEach((c, i) => {
    passes[c.over.comp]!.push({ cross: i, over: true, param: c.over.param });
    passes[c.under.comp]!.push({ cross: i, over: false, param: c.under.param });
  });
  for (const p of passes) p.sort((a, b) => a.param - b.param);

  // Kanten: zwischen aufeinanderfolgenden Durchgängen; Kante k endet an Durchgang k
  let edgeCount = 0;
  const edgeIn = new Map<string, number>(); // Durchgang → ankommende Kante
  const edgeOut = new Map<string, number>(); // Durchgang → abgehende Kante
  const key = (cross: number, over: boolean) => `${cross}:${over ? 'o' : 'u'}`;
  let freeLoops = 0;
  passes.forEach((list) => {
    if (!list.length) {
      freeLoops++;
      return;
    }
    const base = edgeCount;
    list.forEach((p, i) => {
      edgeIn.set(key(p.cross, p.over), base + i);
      edgeOut.set(key(p.cross, p.over), base + ((i + 1) % list.length));
    });
    edgeCount += list.length;
  });

  // Bögen: zwischen Unterführungen
  let arcCount = 0;
  const arcIn = new Map<number, number>(); // Kreuzung → ankommender unterer Bogen
  const arcOut = new Map<number, number>();
  const arcOver = new Map<number, number>();
  passes.forEach((list) => {
    const unders = list.filter((p) => !p.over);
    if (!unders.length) {
      // keine Unterführung: ein Bogen für die ganze Komponente
      const a = arcCount++;
      for (const p of list) if (p.over) arcOver.set(p.cross, a);
      return;
    }
    const base = arcCount;
    arcCount += unders.length;
    // Bogen j beginnt an Unterführung j und endet an Unterführung j+1
    let current = base + unders.length - 1; // vor der ersten Unterführung: letzter Bogen (zyklisch)
    let ui = 0;
    for (const p of list) {
      if (p.over) arcOver.set(p.cross, current);
      else {
        arcIn.set(p.cross, current);
        current = base + ui;
        arcOut.set(p.cross, current);
        ui++;
      }
    }
  });

  const arcIncidence = crossings.map((_, i) => ({ over: arcOver.get(i)!, inU: arcIn.get(i)!, outU: arcOut.get(i)! }));

  // PD: an jeder Kreuzung die vier Kantenenden gegen den Uhrzeigersinn, beginnend mit „unten ankommend“
  const pd = crossings.map((c, i) => {
    const ends: { edge: number; dir: P2 }[] = [
      { edge: edgeIn.get(key(i, false))!, dir: [-c.u[0], -c.u[1]] },
      { edge: edgeOut.get(key(i, false))!, dir: c.u },
      { edge: edgeIn.get(key(i, true))!, dir: [-c.o[0], -c.o[1]] },
      { edge: edgeOut.get(key(i, true))!, dir: c.o },
    ];
    const a0 = Math.atan2(ends[0]!.dir[1], ends[0]!.dir[0]);
    const sorted = ends
      .map((e) => ({ e, ang: (((Math.atan2(e.dir[1], e.dir[0]) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) }))
      .sort((x, y) => x.ang - y.ang)
      .map((x) => x.e.edge);
    return sorted as [number, number, number, number];
  });

  return {
    comps,
    heights,
    crossings,
    direction,
    arcs: arcCount,
    arcIncidence,
    pd,
    edges: edgeCount,
    freeLoops,
    compPairs: crossings.map((c) => [c.over.comp, c.under.comp]),
  };
}
