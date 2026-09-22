// Gesamter Zustand im URL-Hash:  #m=<modul>&x=<cx>&y=<cy>&s=<scale>&<modulspezifische Schlüssel>
// Zahlen in kürzester verlustfreier Darstellung (String(x) ist in JS rundungsstabil).
import type { ViewState } from '../core/view';

export type StateRecord = Record<string, string | number | boolean>;

export interface DecodedHash {
  moduleId: string;
  view: Partial<ViewState>;
  params: URLSearchParams;
}

export function encodeHash(moduleId: string, view: ViewState, state: StateRecord = {}): string {
  const p = new URLSearchParams();
  p.set('m', moduleId);
  p.set('x', String(view.cx));
  p.set('y', String(view.cy));
  p.set('s', String(view.scale));
  for (const [k, v] of Object.entries(state)) p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  return '#' + p.toString();
}

export function decodeHash(hash: string): DecodedHash | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const moduleId = p.get('m');
  if (!moduleId) return null;
  const view: Partial<ViewState> = {};
  const num = (k: string) => {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? v : undefined;
  };
  const cx = num('x');
  const cy = num('y');
  const scale = num('s');
  if (cx !== undefined) view.cx = cx;
  if (cy !== undefined) view.cy = cy;
  if (scale !== undefined && scale > 0) view.scale = scale;
  return { moduleId, view, params: p };
}

/** Hilfen für Module beim Lesen */
export const read = {
  num(p: URLSearchParams, k: string, fallback: number, min = -Infinity, max = Infinity): number {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  },
  bool(p: URLSearchParams, k: string, fallback: boolean): boolean {
    return p.has(k) ? p.get(k) === '1' : fallback;
  },
  str(p: URLSearchParams, k: string, fallback: string): string {
    return p.get(k) ?? fallback;
  },
  oneOf<T extends string>(p: URLSearchParams, k: string, options: readonly T[], fallback: T): T {
    const v = p.get(k);
    return (options as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
  },
};
