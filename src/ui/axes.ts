// Achsen mit Beschriftung auf einer 2D-Ebene über der WebGL-Zeichenfläche (Einheiten: CSS-Pixel).
import type { ViewState } from '../core/view';

export type V3 = [number, number, number];

const LINE = 'rgba(235, 238, 245, 0.55)';
const TEXT = 'rgba(235, 238, 245, 0.9)';
const HALO = 'rgba(8, 9, 12, 0.85)';
const FONT = '11px ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace';

/** Schöne Schrittweite 1·10^k, 2·10^k oder 5·10^k nahe `raw` */
export function niceStep(raw: number): number {
  const e = Math.floor(Math.log10(raw));
  const f = raw / 10 ** e;
  const m = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return m * 10 ** e;
}

/** Beschriftung eines Skalenwerts passend zur Schrittweite */
export function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-3) return '0'; // Skalenwerte sind Vielfache von step
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  if (step >= 1e-5 && Math.abs(v) < 1e7 && decimals <= 8) return v.toFixed(decimals);
  // Exponentialdarstellung mit so vielen signifikanten Stellen, dass benachbarte Striche
  // unterscheidbar bleiben: ⌈log₁₀(|v|/step)⌉ Stellen, also eine weniger nach dem Komma
  const digits = Math.min(15, Math.max(0, Math.ceil(Math.log10(Math.abs(v) / step) - 1e-9) - 1));
  return v.toExponential(digits);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number): void {
  ctx.strokeText(s, x, y);
  ctx.fillText(s, x, y);
}

function setup(ctx: CanvasRenderingContext2D): void {
  ctx.font = FONT;
  ctx.lineWidth = 3;
  ctx.strokeStyle = HALO;
  ctx.fillStyle = TEXT;
  ctx.lineJoin = 'round';
}

export interface Axes2DOptions {
  xName: string;
  yName: string;
  /** Beschriftungswert = Weltkoordinate + shift (z. B. Mandelbrot-Anker) */
  shift?: [number, number];
  /** Relativ zur Bildmitte beschriften (Δ), statt Achsen durch den Ursprung */
  relative?: boolean;
}

/**
 * 2D-Achsen: Linien durch den Ursprung; liegt er außerhalb, werden die Achsen an den unteren
 * bzw. rechten Rand geheftet (links oben liegt das Panel), damit die Beschriftung sichtbar bleibt.
 */
export function drawAxes2D(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  w: number,
  h: number,
  o: Axes2DOptions,
): void {
  const s = view.scale;
  const step = niceStep(s * 110);
  // Bräuchten absolute Beschriftungen mehr als ~5 signifikante Stellen (tief gezoomt, weit weg vom
  // Ursprung), wird relativ zur Bildmitte (Δ) beschriftet – sonst überlappen lange Zahlen.
  const [ax0, ay0] = o.shift ?? [0, 0];
  const far = Math.max(Math.abs(view.cx + ax0), Math.abs(view.cy + ay0)) + (Math.max(w, h) / 2) * s;
  const relative = o.relative || far / step > 1e5;
  o = { ...o, relative };
  const [shx, shy] = relative ? [-view.cx, -view.cy] : [ax0, ay0];
  const toX = (x: number) => (x - view.cx) / s + w / 2;
  const toY = (y: number) => h / 2 - (y - view.cy) / s;
  const margin = 28;

  // Ursprung (Beschriftung 0) in Weltkoordinaten
  const ox = -shx;
  const oy = -shy;
  let ax = toX(ox);
  let ay = toY(oy);
  const pinnedY = o.relative || ax < margin || ax > w - margin;
  const pinnedX = o.relative || ay < margin || ay > h - margin;
  if (pinnedY) ax = w - 8;
  if (pinnedX) ay = h - 8;

  setup(ctx);
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(ay) + 0.5);
  ctx.lineTo(w, Math.round(ay) + 0.5);
  ctx.moveTo(Math.round(ax) + 0.5, 0);
  ctx.lineTo(Math.round(ax) + 0.5, h);
  ctx.stroke();
  ctx.restore();
  setup(ctx);

  // x-Skala
  const x0 = view.cx - (w / 2) * s + shx;
  const x1 = view.cx + (w / 2) * s + shx;
  ctx.textAlign = 'center';
  ctx.textBaseline = pinnedX ? 'bottom' : 'top';
  for (let k = Math.ceil(x0 / step); k * step <= x1; k++) {
    const v = k * step;
    const px = toX(v - shx);
    if (px < 12 || px > w - 40) continue;
    ctx.fillRect(Math.round(px), Math.round(ay) - 3, 1, 7);
    if (!pinnedY && Math.abs(px - ax) < 4) continue; // Schnittpunkt freihalten
    text(ctx, formatTick(v, step), px, pinnedX ? ay - 6 : ay + 6);
  }
  // y-Skala
  const y0 = view.cy - (h / 2) * s + shy;
  const y1 = view.cy + (h / 2) * s + shy;
  ctx.textAlign = pinnedY ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  for (let k = Math.ceil(y0 / step); k * step <= y1; k++) {
    const v = k * step;
    const py = toY(v - shy);
    if (py < 12 || py > h - 24) continue;
    ctx.fillRect(Math.round(ax) - 3, Math.round(py), 7, 1);
    if (!pinnedX && Math.abs(py - ay) < 4) continue;
    text(ctx, formatTick(v, step), pinnedY ? ax - 7 : ax + 7, py);
  }

  // Achsennamen
  ctx.font = 'italic 12px system-ui, sans-serif';
  const dx = o.relative ? 'Δ' : '';
  ctx.textAlign = 'right';
  ctx.textBaseline = pinnedX ? 'bottom' : 'top';
  text(ctx, dx + o.xName, w - 12, pinnedX ? ay - 20 : ay + 20);
  ctx.textAlign = pinnedY ? 'right' : 'left';
  ctx.textBaseline = 'top';
  text(ctx, dx + o.yName, pinnedY ? ax - 7 : ax + 7, 10);
}

export interface Camera3D {
  pos: V3;
  right: V3;
  up: V3;
  fwd: V3;
  /** Brennweite relativ zur Bildhöhe (wie FOCAL im Shader) */
  focal: number;
}

const AXIS_COLORS = ['rgba(236, 128, 118, 0.9)', 'rgba(140, 206, 128, 0.9)', 'rgba(128, 168, 236, 0.9)'];

/**
 * 3D-Achsen x, y, z (mathematische Koordinaten, z nach oben) perspektivisch projiziert.
 * `toWorld` bildet mathematische auf Grafikkoordinaten ab (wie im jeweiligen Shader).
 */
export function drawAxes3D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera3D,
  toWorld: (m: V3) => V3,
  extent: number,
): void {
  const project = (m: V3): [number, number] | null => {
    const p = toWorld(m);
    const r: V3 = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
    const zc = r[0] * cam.fwd[0] + r[1] * cam.fwd[1] + r[2] * cam.fwd[2];
    if (zc < 0.05) return null;
    const x = ((r[0] * cam.right[0] + r[1] * cam.right[1] + r[2] * cam.right[2]) / zc) * cam.focal;
    const y = ((r[0] * cam.up[0] + r[1] * cam.up[1] + r[2] * cam.up[2]) / zc) * cam.focal;
    return [w / 2 + x * h, h / 2 - y * h];
  };
  const step = niceStep(extent / 2.5);
  const names = ['x', 'y', 'z'];
  for (let a = 0; a < 3; a++) {
    const at = (t: number): V3 => {
      const m: V3 = [0, 0, 0];
      m[a] = t;
      return m;
    };
    // Linie in Stücken, damit Teile hinter der Kamera sauber entfallen
    ctx.strokeStyle = AXIS_COLORS[a]!;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    let pen = false;
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const q = project(at(-extent + (2 * extent * i) / N));
      if (!q) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(q[0], q[1]);
      else ctx.moveTo(q[0], q[1]);
      pen = true;
    }
    ctx.stroke();
    // Skalenpunkte mit Zahlen
    setup(ctx);
    ctx.fillStyle = AXIS_COLORS[a]!;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let k = Math.ceil(-extent / step); k * step <= extent + 1e-12; k++) {
      if (k === 0) continue;
      const q = project(at(k * step));
      if (!q) continue;
      ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
      text(ctx, formatTick(k * step, step), q[0] + 5, q[1] - 7);
    }
    const end = project(at(extent * 1.08));
    if (end) {
      ctx.font = 'italic bold 13px system-ui, sans-serif';
      text(ctx, names[a]!, end[0] + 4, end[1]);
    }
  }
}
