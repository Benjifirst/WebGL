// Zeichnungen auf der Beschriftungsebene (Canvas 2D):
//   drawCellDiagram  Zellaufbau eines CW-Komplexes: Zeilen = Dimensionen (unten Punkte), Linien = Einträge
//                    der Randabbildungen ∂ₖ (blau +, rot −, Zahl bei |Koeffizient| > 1), rechts Hₖ.
//   describeCells    derselbe Aufbau in Worten.
//   layout3d         räumliche Anordnung eines Simplizialkomplexes (Stress-Majorisierung mit
//                    Graphabständen, deterministisch initialisiert)
//   drawComplex3D    Dreiecke halbtransparent nach Tiefe sortiert (Maleralgorithmus), Kanten, Ecken.
import { formatGroup } from './chain';
import type { ChainComplex, HomologyGroup } from './chain';

const sub = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[+d]!);
const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!);

const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const MAX_NODES = 14;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DIM_NAMES = ['Punkte', 'Kanten', 'Flächen', 'Körper'];
export const dimName = (k: number) => DIM_NAMES[k] ?? `${k}-Zellen`;
export const cellName = (k: number, i: number) => `e${sup(k)}${sub(i + 1)}`;

/**
 * Zellaufbau eines CW-Komplexes von unten nach oben: Zeile k enthält die k-Zellen, jede Zelle ist
 * durch Linien mit den (k−1)-Zellen verbunden, über die ihr Rand läuft (Zahl = Umlaufzahl mit
 * Vorzeichen, ohne Zahl = 1). Schleifen (Rand 0 an einer einzigen Ecke) werden als Öse gezeichnet.
 */
export function drawCellDiagram(ctx: CanvasRenderingContext2D, c: ChainComplex, H: HomologyGroup[], box: Box, title: string): void {
  const n = c.cells.length;
  const top = box.y + 92;
  const bottom = box.y + box.h - 44;
  const rowH = n > 1 ? (bottom - top) / (n - 1) : 0;
  const rowY = (k: number) => (n > 1 ? bottom - k * rowH : (top + bottom) / 2);
  const labelW = 120;
  const x0 = box.x + labelW;
  const x1 = box.x + box.w - 150;
  const pos = c.cells.map((m, k) => {
    if (m > MAX_NODES || m === 0) return [] as [number, number][];
    const gap = Math.min(90, (x1 - x0) / m);
    const cx = (x0 + x1) / 2;
    return Array.from({ length: m }, (_, i) => [cx + (i - (m - 1) / 2) * gap, rowY(k)] as [number, number]);
  });

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = 'rgba(210, 215, 225, 0.92)';
  ctx.fillText(title, box.x, box.y + 12);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(140, 146, 158, 0.95)';
  ctx.fillText('Zellaufbau: Von unten nach oben wird jede Zelle an die Zellen darunter geklebt.', box.x, box.y + 32);
  ctx.fillText('Zahl an einer Linie = wie oft der Rand der oberen Zelle über die untere läuft.', box.x, box.y + 48);

  // Zeilen: Beschriftung links, Homologie rechts
  for (let k = 0; k < n; k++) {
    const y = rowY(k);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, y);
    ctx.lineTo(box.x + box.w, y);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(200, 205, 215, 0.9)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${k}-Zellen`, box.x, y - 8);
    ctx.fillStyle = 'rgba(140, 146, 158, 0.9)';
    ctx.fillText(`${dimName(k)} · ${c.cells[k]}`, box.x, y + 9);
    ctx.textAlign = 'right';
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = 'rgba(210, 215, 225, 0.92)';
    ctx.fillText(`H${sub(k)} = ${formatGroup(H[k]!)}`, box.x + box.w, y);
  }

  // Randlinien
  ctx.textAlign = 'center';
  for (let k = 1; k < n; k++) {
    const D = c.d[k]!;
    const from = pos[k]!;
    const to = pos[k - 1]!;
    if (!from.length || !to.length) continue;
    for (let j = 0; j < from.length; j++) {
      const [xa, ya] = from[j]!;
      let any = false;
      for (let i = 0; i < to.length; i++) {
        const v = D[i]![j]!;
        if (v === 0n) continue;
        any = true;
        const [xb, yb] = to[i]!;
        ctx.strokeStyle = v > 0n ? 'rgba(128, 168, 236, 0.8)' : 'rgba(230, 136, 125, 0.8)';
        ctx.lineWidth = Math.min(4, 1.3 + 0.6 * Math.abs(Number(v)));
        ctx.beginPath();
        ctx.moveTo(xa, ya + 12);
        ctx.bezierCurveTo(xa, (ya + yb) / 2, xb, (ya + yb) / 2, xb, yb - 12);
        ctx.stroke();
        if (v !== 1n) {
          const mx = (xa + xb) / 2, my = (ya + yb) / 2;
          ctx.fillStyle = 'rgba(14, 15, 18, 0.95)';
          ctx.fillRect(mx - 14, my - 9, 28, 18);
          ctx.fillStyle = v > 0n ? '#9fbaf0' : '#ee9a90';
          ctx.font = `12px ${MONO}`;
          ctx.fillText(v > 0n ? `×${v}` : `−${-v}`, mx, my);
        }
      }
      if (!any) {
        // Rand 0: bei 1-Zellen an einer einzigen Ecke eine Schleife, sonst „Rand 0“
        ctx.fillStyle = 'rgba(140, 146, 158, 0.95)';
        ctx.font = '11px system-ui, sans-serif';
        if (k === 1 && to.length === 1) {
          ctx.strokeStyle = 'rgba(200, 205, 215, 0.55)';
          ctx.lineWidth = 1.5;
          const [xb, yb] = to[0]!;
          ctx.beginPath();
          ctx.moveTo(xb - 6, yb - 12);
          ctx.bezierCurveTo(xa - 40, ya + 10, xa - 40, ya - 25, xa, ya - 12);
          ctx.moveTo(xb + 6, yb - 12);
          ctx.bezierCurveTo(xa + 40, ya + 10, xa + 40, ya - 25, xa, ya - 12);
          ctx.stroke();
          ctx.fillText('Schleife', xa, ya - 24);
        } else ctx.fillText('Rand 0', xa, ya - 22);
      }
    }
  }

  // Zellen
  for (let k = 0; k < n; k++) {
    const m = c.cells[k]!;
    if (m === 0) continue;
    if (!pos[k]!.length) {
      const y = rowY(k);
      ctx.fillStyle = 'rgba(40, 44, 54, 0.95)';
      ctx.strokeStyle = 'rgba(200, 205, 215, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect((x0 + x1) / 2 - 50, y - 14, 100, 28, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(225, 229, 236, 0.95)';
      ctx.font = `11px ${MONO}`;
      ctx.fillText(`${m} Zellen`, (x0 + x1) / 2, y);
      continue;
    }
    for (let i = 0; i < m; i++) {
      const [x, y] = pos[k]![i]!;
      ctx.beginPath();
      ctx.roundRect(x - 17, y - 12, 34, 24, 7);
      ctx.fillStyle = 'rgba(30, 33, 40, 1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(210, 215, 225, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(235, 238, 244, 1)';
      ctx.font = `12px ${MONO}`;
      ctx.fillText(cellName(k, i), x, y + 0.5);
    }
  }

  ctx.textAlign = 'left';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(140, 146, 158, 0.85)';
  ctx.fillText('blau: Rand läuft in Pfeilrichtung, rot: entgegen · Hₖ = Zyklen (Rand 0) modulo Ränder der (k+1)-Zellen', box.x, box.y + box.h - 8);
  ctx.restore();
}

/** Zellaufbau in Worten, z. B. „e²₁: 2-Zelle, Rand = 2·e¹₁ (läuft 2-mal um e¹₁)“ */
export function describeCells(c: ChainComplex, limit = 24): string[] {
  const out: string[] = [];
  const term = (v: bigint, name: string) => (v === 1n ? name : v === -1n ? `−${name}` : `${v}·${name}`);
  let shown = 0;
  for (let k = 0; k < c.cells.length; k++) {
    for (let j = 0; j < c.cells[k]!; j++) {
      if (shown >= limit) continue;
      shown++;
      const name = cellName(k, j);
      if (k === 0) {
        out.push(`${name}: Punkt`);
        continue;
      }
      const col = c.d[k]!.map((row) => row[j]!);
      if (k === 1) {
        const tail = col.findIndex((v) => v < 0n);
        const head = col.findIndex((v) => v > 0n);
        out.push(tail >= 0 && head >= 0 ? `${name}: Kante von ${cellName(0, tail)} nach ${cellName(0, head)}` : `${name}: Schleife (Anfang = Ende)`);
        continue;
      }
      const parts = col.map((v, i) => (v ? term(v, cellName(k - 1, i)) : '')).filter(Boolean);
      if (!parts.length) {
        out.push(`${name}: ${k}-Zelle, Rand 0 (Rand auf einen Punkt geklebt oder hebt sich weg)`);
        continue;
      }
      const wraps = col
        .map((v, i) => (v !== 0n && v !== 1n && v !== -1n ? `${v < 0n ? -v : v}-mal über ${cellName(k - 1, i)}` : ''))
        .filter(Boolean);
      const sum = parts.join(' + ').replace(/\+ −/g, '− ');
      out.push(`${name}: ${k}-Zelle, Rand = ${sum}${wraps.length ? ` (läuft ${wraps.join(', ')})` : ''}`);
    }
  }
  const total = c.cells.reduce((a, b) => a + b, 0);
  if (total > shown) out.push(`… und ${total - shown} weitere Zellen`);
  return out;
}

// ---------------------------------------------------------------------------
// 3D-Anordnung und Zeichnung von Simplizialkomplexen

export type V3 = [number, number, number];

/** Stress-Majorisierung (SMACOF) mit Graphabständen; deterministischer Start auf einer Spirale */
export function layout3d(nv: number, edges: [number, number][], iterations = 300): V3[] {
  if (nv === 0) return [];
  const adj: number[][] = Array.from({ length: nv }, () => []);
  for (const [a, b] of edges) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  // Graphabstände per Breitensuche (unzusammenhängend: großer Abstand)
  const D: number[][] = [];
  for (let s = 0; s < nv; s++) {
    const d = Array<number>(nv).fill(Infinity);
    d[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) for (const t of adj[q[h]!]!) if (d[t] === Infinity) (d[t] = d[q[h]!]! + 1), q.push(t);
    D.push(d.map((x) => (x === Infinity ? 3 : x)));
  }
  // Start: Fibonacci-Kugel
  const X: V3[] = Array.from({ length: nv }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / nv;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    return [r * Math.cos(phi), y, r * Math.sin(phi)];
  });
  for (let it = 0; it < iterations; it++) {
    // Guttman-Transformation mit Gewichten 1/d²
    const next: V3[] = X.map(() => [0, 0, 0]);
    for (let i = 0; i < nv; i++) {
      let wsum = 0;
      for (let j = 0; j < nv; j++) {
        if (i === j) continue;
        const dij = D[i]![j]!;
        const w = 1 / (dij * dij);
        const diff = [X[i]![0] - X[j]![0], X[i]![1] - X[j]![1], X[i]![2] - X[j]![2]];
        const dist = Math.hypot(...diff) || 1e-9;
        for (let k = 0; k < 3; k++) next[i]![k]! += w * (X[j]![k]! + (dij * diff[k]!) / dist);
        wsum += w;
      }
      for (let k = 0; k < 3; k++) next[i]![k]! /= wsum;
    }
    for (let i = 0; i < nv; i++) X[i] = next[i]!;
  }
  // zentrieren und auf Radius 1 normieren
  const c = [0, 1, 2].map((k) => X.reduce((s, p) => s + p[k]!, 0) / nv);
  const r = Math.max(1e-9, ...X.map((p) => Math.hypot(p[0] - c[0]!, p[1] - c[1]!, p[2] - c[2]!)));
  return X.map((p) => [(p[0] - c[0]!) / r, (p[1] - c[1]!) / r, (p[2] - c[2]!) / r]);
}

const FACE_COLORS = ['#e6887d', '#80a8ec', '#8cc97f', '#e2c46a', '#c592e0', '#6fcfc4', '#f0a45c', '#d97aa6'];

/** Punkte zentrieren und auf Radius 1 skalieren */
export function normalizePoints(pts: V3[]): V3[] {
  if (!pts.length) return pts;
  const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k]!, 0) / pts.length);
  const r = Math.max(1e-9, ...pts.map((p) => Math.hypot(p[0] - c[0]!, p[1] - c[1]!, p[2] - c[2]!)));
  return pts.map((p) => [(p[0] - c[0]!) / r, (p[1] - c[1]!) / r, (p[2] - c[2]!) / r]);
}

/**
 * Polyeder mit Maleralgorithmus: Dreiecke von hinten nach vorn, schattiert nach ihrer Neigung zum
 * Licht, jede Kante wird mit ihrem Dreieck gezeichnet (verdeckte Kanten verschwinden). Kanten ohne
 * Dreieck (1-Simplizes allein) werden zum Schluss gezeichnet. `transparent` zeigt auch die Rückseite.
 */
export function drawComplex3D(
  ctx: CanvasRenderingContext2D,
  pts: V3[],
  labels: string[],
  edges: [number, number][],
  triangles: [number, number, number][],
  cam: { yaw: number; pitch: number; distance: number },
  box: Box,
  transparent = false,
): void {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const scale = Math.min(box.w, box.h) * 0.36 * (8.5 / cam.distance);
  const rot = ([x, y, z]: V3): V3 => {
    const x1 = cy * x - sy * z;
    const z1 = sy * x + cy * z;
    return [x1, cp * y - sp * z1, sp * y + cp * z1];
  };
  const R = pts.map(rot);
  const proj = R.map(([x, y, z]) => {
    const persp = 3.5 / (3.5 - z);
    return { x: box.x + box.w / 2 + x * scale * persp, y: box.y + box.h / 2 - y * scale * persp, z };
  });
  const light = [0.35, 0.6, 0.72];
  ctx.save();
  ctx.lineJoin = 'round';
  const tris = triangles
    .map((t, i) => ({ t, i, z: (R[t[0]]![2] + R[t[1]]![2] + R[t[2]]![2]) / 3 }))
    .sort((a, b) => a.z - b.z);
  const inTri = new Set<string>();
  for (const { t, i } of tris) {
    const [a, b, c] = t.map((v) => R[v]!) as [V3, V3, V3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const len = Math.hypot(...n) || 1;
    const lum = 0.35 + 0.65 * Math.abs((n[0]! * light[0]! + n[1]! * light[1]! + n[2]! * light[2]!) / len);
    const col = FACE_COLORS[i % FACE_COLORS.length]!;
    const rgb = [1, 3, 5].map((k) => Math.round(parseInt(col.slice(k, k + 2), 16) * (0.35 + 0.5 * lum)));
    const [pa, pb, pc] = t.map((v) => proj[v]!);
    ctx.beginPath();
    ctx.moveTo(pa!.x, pa!.y);
    ctx.lineTo(pb!.x, pb!.y);
    ctx.lineTo(pc!.x, pc!.y);
    ctx.closePath();
    ctx.fillStyle = `rgba(${rgb.join(',')}, ${transparent ? 0.35 : 0.96})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(235, 238, 244, 0.7)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[0], t[2]]] as [number, number][]) inTri.add(`${Math.min(x, y)}|${Math.max(x, y)}`);
  }
  ctx.strokeStyle = 'rgba(235, 238, 244, 0.85)';
  ctx.lineWidth = 2;
  for (const [a, b] of edges) {
    if (inTri.has(`${Math.min(a, b)}|${Math.max(a, b)}`)) continue;
    ctx.beginPath();
    ctx.moveTo(proj[a]!.x, proj[a]!.y);
    ctx.lineTo(proj[b]!.x, proj[b]!.y);
    ctx.stroke();
  }
  // Ecken: vordere deutlich, hintere blass (bei undurchsichtiger Darstellung)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `11px ${MONO}`;
  const small = pts.length > 16; // viele Ecken: nur Punkte statt beschrifteter Kreise
  const zmax = Math.max(...R.map((p) => p[2]));
  const zmin = Math.min(...R.map((p) => p[2]));
  proj
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.z - b.p.z)
    .forEach(({ p, i }) => {
      const front = transparent ? 1 : 0.35 + 0.65 * ((p.z - zmin) / Math.max(1e-9, zmax - zmin));
      ctx.globalAlpha = front;
      ctx.beginPath();
      if (small) {
        ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(235, 238, 244, 0.9)';
        ctx.fill();
        return;
      }
      ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(24, 26, 32, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(230, 234, 240, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(235, 238, 244, 1)';
      ctx.fillText(labels[i]!, p.x, p.y + 0.5);
    });
  ctx.globalAlpha = 1;
  ctx.restore();
}
