// SVG-Diagramm der Polygone: Kanten nach Bezeichner gefärbt, Pfeile in Kantenrichtung,
// Randkanten gestrichelt, Ecken nach Eckklasse (gleiche Farbe = gleicher Punkt der Fläche).
import type { Face } from './surface';

const NS = 'http://www.w3.org/2000/svg';

export const EDGE_COLORS = [
  '#e6887d', '#8cc97f', '#80a8ec', '#e2c46a', '#c592e0', '#6fcfc4', '#f0a45c', '#d97aa6', '#a7b86a', '#9aa4b8',
];
const VERTEX_COLORS = ['#f4f6fa', '#1b1d22', '#f0c05a', '#4fb3e0', '#e06a6a', '#8fd18a', '#b58ae6', '#e89a52'];

/** Farbe je Kantenbezeichner in Reihenfolge des ersten Auftretens */
export function edgeColorMap(faces: Face[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of faces.flat()) if (!m.has(e.label)) m.set(e.label, EDGE_COLORS[m.size % EDGE_COLORS.length]!);
  return m;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

type P = [number, number];

/** Kante i eines n-Ecks als Kurve: Punkte für Pfad, Mittelpunkt und Tangente (Umlauf gegen den Uhrzeigersinn) */
function edgeGeometry(n: number, i: number, cx: number, cy: number, r: number) {
  // Ecke k im Winkel so, dass die erste Kante unten waagrecht liegt
  const angle = (k: number) => -Math.PI / 2 - Math.PI / n + (2 * Math.PI * k) / n;
  const pt = (a: number, rr = r): P => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  if (n <= 2) {
    // Kreis bzw. Zweieck: Kanten sind Bögen
    const a0 = angle(i);
    const a1 = a0 + (2 * Math.PI) / n;
    const steps = 24;
    const pts: P[] = Array.from({ length: steps + 1 }, (_, s) => pt(a0 + ((a1 - a0) * s) / steps));
    const am = (a0 + a1) / 2;
    return { pts, mid: pt(am), tangent: [-Math.sin(am), -Math.cos(am)] as P, outward: [Math.cos(am), -Math.sin(am)] as P };
  }
  const p0 = pt(angle(i));
  const p1 = pt(angle(i + 1));
  const mid: P = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const tangent: P = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
  const om = Math.hypot(mid[0] - cx, mid[1] - cy);
  return { pts: [p0, p1], mid, tangent, outward: [(mid[0] - cx) / om, (mid[1] - cy) / om] as P };
}

export function drawDiagram(faces: Face[], vertexClass: number[][], boundaryLabels: Set<string>): SVGSVGElement {
  const colors = edgeColorMap(faces);
  const cols = Math.min(faces.length, 3);
  const rows = Math.ceil(faces.length / cols);
  const cell = faces.length === 1 ? 200 : 118;
  const W = cols * cell;
  const H = rows * cell;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'diagram' });
  svg.setAttribute('aria-label', 'Polygon mit Kantenidentifikationen');

  faces.forEach((face, f) => {
    const cx = (f % cols) * cell + cell / 2;
    const cy = Math.floor(f / cols) * cell + cell / 2;
    const n = face.length;
    const r = cell * (n <= 2 ? 0.3 : 0.33);
    // Fläche
    const outline = face.flatMap((_, i) => edgeGeometry(n, i, cx, cy, r).pts.slice(0, -1));
    svg.append(el('polygon', { points: outline.map((p) => p.join(',')).join(' '), fill: 'rgba(255,255,255,0.04)' }));

    face.forEach((e, i) => {
      const g = edgeGeometry(n, i, cx, cy, r);
      const color = colors.get(e.label)!;
      const boundary = boundaryLabels.has(e.label);
      svg.append(
        el('polyline', {
          points: g.pts.map((p) => p.join(',')).join(' '),
          fill: 'none',
          stroke: color,
          'stroke-width': boundary ? 1.5 : 2.5,
          'stroke-dasharray': boundary ? '4 3' : 'none',
          'stroke-linecap': 'round',
        }),
      );
      // Pfeil in Kantenrichtung (Vorzeichen −1: gegen den Umlauf)
      const [tx, ty] = e.sign > 0 ? g.tangent : ([-g.tangent[0], -g.tangent[1]] as P);
      const s = 6;
      const [mx, my] = g.mid;
      const tip: P = [mx + tx * s, my + ty * s];
      const l: P = [mx - tx * s + -ty * s * 0.7, my - ty * s + tx * s * 0.7];
      const rr: P = [mx - tx * s - -ty * s * 0.7, my - ty * s - tx * s * 0.7];
      svg.append(el('polygon', { points: [tip, l, rr].map((p) => p.join(',')).join(' '), fill: color }));
      const lab = el('text', {
        x: mx + g.outward[0] * 13,
        y: my + g.outward[1] * 13,
        fill: color,
        'font-size': 12,
        'font-style': 'italic',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      lab.textContent = e.label;
      svg.append(lab);
    });

    // Ecken (bei n = 1 gibt es nur die eine Ecke am Kreis)
    face.forEach((_, i) => {
      const g = edgeGeometry(n, i, cx, cy, r);
      const [x, y] = g.pts[0]!;
      svg.append(
        el('circle', {
          cx: x,
          cy: y,
          r: 4,
          fill: VERTEX_COLORS[vertexClass[f]![i]! % VERTEX_COLORS.length]!,
          stroke: 'rgba(0,0,0,0.6)',
          'stroke-width': 1,
        }),
      );
    });
  });
  return svg;
}

/**
 * 1-Gerüst eines Simplizialkomplexes als Graph (Kräfte-Layout nach Fruchterman–Reingold),
 * Dreiecke schwach gefüllt. Nur zur Anschauung – die Einbettung ist nicht geometrisch treu.
 */
export function drawGraph(vertices: string[], edges: [string, string][], triangles: string[][]): SVGSVGElement {
  const W = 300, H = 220;
  const n = vertices.length;
  const idx = new Map(vertices.map((v, i) => [v, i]));
  const pos = vertices.map((_, i) => [W / 2 + 80 * Math.cos((2 * Math.PI * i) / n), H / 2 + 80 * Math.sin((2 * Math.PI * i) / n)]);
  const k = Math.sqrt((W * H) / Math.max(n, 1)) * 0.55;
  for (let it = 0; it < 300; it++) {
    const temp = 12 * (1 - it / 300) + 0.5;
    const disp = pos.map(() => [0, 0]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]![0]! - pos[j]![0]!, dy = pos[i]![1]! - pos[j]![1]!;
        const d = Math.max(Math.hypot(dx, dy), 0.01);
        const f = (k * k) / d;
        disp[i]![0]! += (dx / d) * f; disp[i]![1]! += (dy / d) * f;
        disp[j]![0]! -= (dx / d) * f; disp[j]![1]! -= (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const i = idx.get(a)!, j = idx.get(b)!;
      const dx = pos[i]![0]! - pos[j]![0]!, dy = pos[i]![1]! - pos[j]![1]!;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = (d * d) / k;
      disp[i]![0]! -= (dx / d) * f; disp[i]![1]! -= (dy / d) * f;
      disp[j]![0]! += (dx / d) * f; disp[j]![1]! += (dy / d) * f;
    }
    pos.forEach((p, i) => {
      const [dx, dy] = disp[i]!;
      const d = Math.max(Math.hypot(dx!, dy!), 0.01);
      p[0] = Math.min(W - 14, Math.max(14, p[0]! + (dx! / d) * Math.min(d, temp)));
      p[1] = Math.min(H - 14, Math.max(14, p[1]! + (dy! / d) * Math.min(d, temp)));
    });
  }
  // Layout auf die Zeichenfläche strecken (dichte Graphen wie K₇ ziehen sich sonst eng zusammen)
  const xs = pos.map((p) => p[0]!), ys = pos.map((p) => p[1]!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sc = Math.min((W - 30) / Math.max(x1 - x0, 1), (H - 30) / Math.max(y1 - y0, 1));
  for (const p of pos) {
    p[0] = W / 2 + (p[0]! - (x0 + x1) / 2) * sc;
    p[1] = H / 2 + (p[1]! - (y0 + y1) / 2) * sc;
  }
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'diagram' });
  for (const t of triangles) {
    const pts = t.map((v) => pos[idx.get(v)!]!.join(',')).join(' ');
    svg.append(el('polygon', { points: pts, fill: 'rgba(128, 168, 236, 0.07)', stroke: 'none' }));
  }
  for (const [a, b] of edges) {
    const [x1, y1] = pos[idx.get(a)!]!;
    const [x2, y2] = pos[idx.get(b)!]!;
    svg.append(el('line', { x1: x1!, y1: y1!, x2: x2!, y2: y2!, stroke: 'rgba(200, 206, 218, 0.55)', 'stroke-width': 1.2 }));
  }
  vertices.forEach((v, i) => {
    const [x, y] = pos[i]!;
    svg.append(el('circle', { cx: x!, cy: y!, r: 7, fill: '#1b1d22', stroke: '#9fb2d4', 'stroke-width': 1.2 }));
    const t = el('text', { x: x!, y: y! + 0.5, fill: '#d3d7df', 'font-size': 9, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = v;
    svg.append(t);
  });
  return svg;
}
