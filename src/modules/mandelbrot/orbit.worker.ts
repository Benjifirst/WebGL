// Web Worker: Referenzorbit berechnen, ohne die Oberfläche zu blockieren.
import { computeOrbit } from './orbit';

export interface OrbitRequest {
  id: number;
  cx: bigint;
  cy: bigint;
  bits: number;
  maxIter: number;
}

export type OrbitResponse =
  | { id: number; progress: number }
  | { id: number; data: Float32Array; length: number; escaped: boolean };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<OrbitRequest>) => void) | null;
  postMessage(msg: OrbitResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, cx, cy, bits, maxIter } = e.data;
  const r = computeOrbit(cx, cy, bits, maxIter, (progress) => ctx.postMessage({ id, progress }));
  const data = r.data.slice(0, 2 * r.length);
  ctx.postMessage({ id, data, length: r.length, escaped: r.escaped }, [data.buffer]);
};
