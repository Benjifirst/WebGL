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
