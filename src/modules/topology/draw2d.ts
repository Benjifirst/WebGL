// Zeichnungen auf der Beschriftungsebene (Canvas 2D):
//   drawCellDiagram  Zellstruktur eines CW-Komplexes: Spalten = Dimensionen, Linien = Einträge der
//                    Randabbildungen ∂ₖ (blau +, rot −, Zahl bei |Koeffizient| > 1), darunter Hₖ.
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

export function drawCellDiagram(ctx: CanvasRenderingContext2D, c: ChainComplex, H: HomologyGroup[], box: Box, title: string): void {
  const n = c.cells.length;
  const colW = box.w / n;
  const top = box.y + 64;
  const bottom = box.y + box.h - 70;
  const colX = (k: number) => box.x + (k + 0.5) * colW;
  // Positionen der Zellen (zu viele → ein Sammelknoten)
  const pos = c.cells.map((m, k) => {
    if (m > MAX_NODES || m === 0) return [] as [number, number][];
    const gap = Math.min(40, (bottom - top) / m);
    const y0 = (top + bottom) / 2 - (gap * (m - 1)) / 2;
    return Array.from({ length: m }, (_, i) => [colX(k), y0 + i * gap] as [number, number]);
  });

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `12px ${MONO}`;
  ctx.fillStyle = 'rgba(140, 146, 158, 0.9)';
  ctx.fillText(title, box.x + box.w / 2, box.y + 14);

  // Kopfzeile: C_n → … → C_0 (von rechts nach links gelesen: ∂ₖ: C_k → C_{k−1})
  ctx.font = `13px ${MONO}`;
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = 'rgba(210, 215, 225, 0.9)';
    const m = c.cells[k]!;
    ctx.fillText(`C${sub(k)} = ${m === 0 ? '0' : m === 1 ? 'ℤ' : `ℤ${sup(m)}`}`, colX(k), box.y + 40);
    if (k > 0) {
      ctx.fillStyle = 'rgba(140, 146, 158, 0.9)';
      ctx.fillText(`← ∂${sub(k)} ─`, (colX(k) + colX(k - 1)) / 2, box.y + 40);
    }
  }

  // Randlinien
  for (let k = 1; k < n; k++) {
    const D = c.d[k]!;
    const from = pos[k]!;
    const to = pos[k - 1]!;
    if (!from.length || !to.length) {
      // Sammelknoten: nur Rang andeuten
      let nonzero = 0;
      for (const row of D) for (const v of row) if (v !== 0n) nonzero++;
      if (nonzero && c.cells[k]! && c.cells[k - 1]!) {
        ctx.strokeStyle = 'rgba(128, 168, 236, 0.35)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(colX(k) - 16, (top + bottom) / 2);
        ctx.lineTo(colX(k - 1) + 16, (top + bottom) / 2);
        ctx.stroke();
      }
      continue;
    }
    for (let j = 0; j < from.length; j++) {
      for (let i = 0; i < to.length; i++) {
        const v = D[i]![j]!;
        if (v === 0n) continue;
        const [x1, y1] = from[j]!;
        const [x0, y0] = to[i]!;
        ctx.strokeStyle = v > 0n ? 'rgba(128, 168, 236, 0.75)' : 'rgba(230, 136, 125, 0.75)';
        ctx.lineWidth = Math.min(4, 1.2 + 0.6 * Math.abs(Number(v)));
        ctx.beginPath();
        ctx.moveTo(x1 - 9, y1);
        ctx.bezierCurveTo((x1 + x0) / 2, y1, (x1 + x0) / 2, y0, x0 + 9, y0);
        ctx.stroke();
        if (v !== 1n && v !== -1n) {
          const mx = (x1 + x0) / 2, my = (y1 + y0) / 2;
          ctx.fillStyle = 'rgba(14, 15, 18, 0.9)';
          ctx.fillRect(mx - 12, my - 8, 24, 16);
          ctx.fillStyle = v > 0n ? '#9fbaf0' : '#ee9a90';
          ctx.font = `11px ${MONO}`;
          ctx.fillText(String(v), mx, my);
        }
      }
    }
  }

  // Zellen
  for (let k = 0; k < n; k++) {
    const m = c.cells[k]!;
    if (m === 0) continue;
    if (!pos[k]!.length) {
      const y = (top + bottom) / 2;
      ctx.fillStyle = 'rgba(40, 44, 54, 0.95)';
      ctx.strokeStyle = 'rgba(200, 205, 215, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(colX(k) - 34, y - 16, 68, 32, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(225, 229, 236, 0.95)';
      ctx.font = `11px ${MONO}`;
      ctx.fillText(`${m} Zellen`, colX(k), y);
      continue;
    }
    for (let i = 0; i < m; i++) {
      const [x, y] = pos[k]![i]!;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(30, 33, 40, 1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(210, 215, 225, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(225, 229, 236, 0.95)';
      ctx.font = `9px ${MONO}`;
      ctx.fillText(`${k}.${i + 1}`, x, y + 0.5);
    }
  }

  // Homologie
  ctx.font = `13px ${MONO}`;
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = 'rgba(210, 215, 225, 0.9)';
    ctx.fillText(`H${sub(k)} = ${formatGroup(H[k]!)}`, colX(k), box.y + box.h - 34);
  }
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = 'rgba(140, 146, 158, 0.85)';
  ctx.fillText('Linien: Einträge von ∂ (blau +, rot −); Hₖ = ker ∂ₖ / im ∂ₖ₊₁', box.x + box.w / 2, box.y + box.h - 10);
  ctx.restore();
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

export function drawComplex3D(
  ctx: CanvasRenderingContext2D,
  pts: V3[],
  labels: string[],
  edges: [number, number][],
  triangles: [number, number, number][],
  cam: { yaw: number; pitch: number; distance: number },
  box: Box,
): void {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const scale = Math.min(box.w, box.h) * 0.36 * (6 / cam.distance) * 1.2;
  const proj = pts.map(([x, y, z]) => {
    // um y drehen (yaw), dann um x (pitch)
    const x1 = cy * x + sy * z;
    const z1 = -sy * x + cy * z;
    const y2 = cp * y - sp * z1;
    const z2 = sp * y + cp * z1;
    const persp = 3.2 / (3.2 - z2 * 0.9);
    return { x: box.x + box.w / 2 + x1 * scale * persp, y: box.y + box.h / 2 - y2 * scale * persp, z: z2 };
  });
  ctx.save();
  const tris = triangles
    .map((t, i) => ({ t, i, z: (proj[t[0]]!.z + proj[t[1]]!.z + proj[t[2]]!.z) / 3 }))
    .sort((a, b) => a.z - b.z);
  for (const { t, i, z } of tris) {
    const [a, b, c] = t.map((v) => proj[v]!);
    ctx.beginPath();
    ctx.moveTo(a!.x, a!.y);
    ctx.lineTo(b!.x, b!.y);
    ctx.lineTo(c!.x, c!.y);
    ctx.closePath();
    const col = FACE_COLORS[i % FACE_COLORS.length]!;
    const alpha = Math.round(0x30 + 0x28 * (z + 1)).toString(16).padStart(2, '0');
    ctx.fillStyle = col + alpha;
    ctx.fill();
  }
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(220, 225, 235, 0.55)';
  for (const [a, b] of edges) {
    ctx.beginPath();
    ctx.moveTo(proj[a]!.x, proj[a]!.y);
    ctx.lineTo(proj[b]!.x, proj[b]!.y);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `11px ${MONO}`;
  proj.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(24, 26, 32, 0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 234, 240, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(235, 238, 244, 1)';
    ctx.fillText(labels[i]!, p.x, p.y + 0.5);
  });
  ctx.restore();
}
