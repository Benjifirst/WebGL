// Knotendiagramm auf einem Canvas: Projektion der Kurve, an jeder Kreuzung wird der obere Strang
// mit einem Rand in Hintergrundfarbe nachgezeichnet – so entsteht die Lücke im unteren Strang.
import type { Diagram, P2 } from './diagram';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function drawKnotDiagram(ctx: CanvasRenderingContext2D, d: Diagram, box: Rect, colors: string[], opts: { signs?: boolean; bg?: string } = {}): void {
  const pts = d.comps.flat();
  if (!pts.length) return;
  const minx = Math.min(...pts.map((p) => p[0])), maxx = Math.max(...pts.map((p) => p[0]));
  const miny = Math.min(...pts.map((p) => p[1])), maxy = Math.max(...pts.map((p) => p[1]));
  const s = Math.min((box.w - 30) / Math.max(maxx - minx, 1e-9), (box.h - 30) / Math.max(maxy - miny, 1e-9));
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const T = (p: P2): P2 => [box.x + box.w / 2 + (p[0] - cx) * s, box.y + box.h / 2 - (p[1] - cy) * s];
  const lw = Math.max(2, Math.min(4, box.w / 140));
  const bg = opts.bg ?? '#0e0f12';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // ganze Kurven
  d.comps.forEach((c, ci) => {
    ctx.strokeStyle = colors[ci % colors.length]!;
    ctx.lineWidth = lw;
    ctx.beginPath();
    c.forEach((p, i) => {
      const q = T(p);
      if (i) ctx.lineTo(q[0], q[1]);
      else ctx.moveTo(q[0], q[1]);
    });
    ctx.closePath();
    ctx.stroke();
  });
  // obere Stränge an den Kreuzungen nachzeichnen (mit Rand → Lücke unten)
  const gap = 9 / s; // halbe Länge des nachgezeichneten Stücks in Weltkoordinaten
  for (const c of d.crossings) {
    const comp = d.comps[c.over.comp]!;
    const n = comp.length;
    const piece: P2[] = [];
    // Punkte entlang der Kurve um den Kreuzungsparameter herum sammeln
    const at = (param: number): P2 => {
      const i = Math.floor(((param % n) + n) % n);
      const f = param - Math.floor(param);
      const a = comp[i]!, b = comp[(i + 1) % n]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    // Parameterschritt so wählen, dass ±gap abgedeckt ist
    const seg = comp[Math.floor(c.over.param) % n]!, seg2 = comp[(Math.floor(c.over.param) + 1) % n]!;
    const segLen = Math.hypot(seg2[0] - seg[0], seg2[1] - seg[1]) || 1e-9;
    const span = Math.min(n / 4, gap / segLen + 0.5);
    for (let k = -8; k <= 8; k++) piece.push(at(c.over.param + (span * k) / 8));
    const path = piece.map(T);
    ctx.strokeStyle = bg;
    ctx.lineWidth = lw * 3.2;
    ctx.beginPath();
    path.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
    ctx.strokeStyle = colors[c.over.comp % colors.length]!;
    ctx.lineWidth = lw;
    ctx.stroke();
    if (opts.signs) {
      const [x, y] = T(c.at);
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.fillStyle = c.sign > 0 ? '#9fbaf0' : '#ee9a90';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.sign > 0 ? '+' : '−', x + 11, y - 11);
    }
  }
  ctx.restore();
}
