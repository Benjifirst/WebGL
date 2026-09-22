// Web Worker: Mini-Mandelbrot suchen (Periode + Newton in voller Präzision).
import { findDeeper, findMinibrot } from './nucleus';

export interface NucleusRequest {
  cx: bigint;
  cy: bigint;
  bits: number;
  log2r: number;
  maxPeriod: number;
  /** Ansicht steht auf einem gefundenen Minibrot: daneben ein kleineres suchen */
  deeper?: { period: number; size: number };
}

export type NucleusResponse =
  | { ok: true; x: bigint; y: bigint; bits: number; period: number; size: number }
  | { ok: false; reason: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<NucleusRequest>) => void) | null;
  postMessage(msg: NucleusResponse): void;
};

ctx.onmessage = (e) => {
  const { cx, cy, bits, log2r, maxPeriod, deeper } = e.data;
  const n = deeper
    ? findDeeper(cx, cy, bits, deeper.period, deeper.size, maxPeriod)
    : findMinibrot(cx, cy, bits, log2r, maxPeriod);
  if (!n) {
    ctx.postMessage({
      ok: false,
      reason: deeper
        ? `Kein kleineres Minibrot bis Periode ${maxPeriod} – tiefer wäre ohne Bilinear-Approximation zu rechenintensiv`
        : `Kein Minibrot bis Periode ${maxPeriod} im Bild – näher heranzoomen`,
    });
    return;
  }
  ctx.postMessage({ ok: true, x: n.x, y: n.y, bits: n.bits, period: n.period, size: n.size });
};
