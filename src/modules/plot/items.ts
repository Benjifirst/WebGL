// Graphen reeller Funktionen: Eingabezeilen erkennen, abtasten, besondere Punkte finden.
//
// Zeilentypen:
//   f(x)            bzw.  y = f(x)          explizit (Kurve über der x-Achse)
//   F(x,y) = G(x,y) bzw.  <, >, ≤, ≥        implizite Kurve bzw. Ungleichung (Bereich) – im Shader
//   (x(t), y(t))                            parametrisch, t ∈ [t₀, t₁]
//   r = f(t)                                polar (t = θ)
// Unbekannte einzelne Buchstaben werden zu Parametern mit Schieberegler (a sin(b x) → a, b).
import { FUNCTIONS, parse, ParseError, realOptions } from '../../math/parser';
import type { Node } from '../../math/parser';
import { evaluateReal } from '../../math/real';

export type Relation = '=' | '<' | '>' | '<=' | '>=';

export type PlotItem =
  | { kind: 'explicit'; f: Node; params: string[] }
  | { kind: 'implicit'; F: Node; op: Relation; params: string[] }
  | { kind: 'parametric'; x: Node; y: Node; params: string[] }
  | { kind: 'polar'; r: Node; params: string[] };

const RESERVED = new Set(['x', 'y', 't', 'e', 'i']);

function normalize(text: string): string {
  return text.replace(/θ/g, 't').replace(/≤/g, '<=').replace(/≥/g, '>=');
}

/** Parameter: einzelne Buchstaben in Bezeichnern, die keine Funktion/Konstante sind (auch „ax“ → a). */
export function findParams(text: string): string[] {
  const out = new Set<string>();
  for (const m of normalize(text).matchAll(/[A-Za-z_][A-Za-z_0-9]*/g)) {
    const id = m[0];
    if ((FUNCTIONS as readonly string[]).includes(id) || id === 'pi') continue;
    for (const ch of id) if (/[a-zA-Z]/.test(ch) && !RESERVED.has(ch)) out.add(ch);
  }
  return [...out].sort();
}

/** Stelle des ersten Relationszeichens außerhalb von Klammern */
function findRelation(s: string): { index: number; op: Relation } | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (c === '<' || c === '>' || c === '=')) {
      if ((c === '<' || c === '>') && s[i + 1] === '=') return { index: i, op: (c + '=') as Relation };
      return { index: i, op: c as Relation };
    }
  }
  return null;
}

function parseAt(src: string, offset: number, vars: string[]): Node {
  try {
    return parse(src, realOptions(vars));
  } catch (e) {
    if (e instanceof ParseError) throw new ParseError(e.message, e.pos + offset, e.end + offset);
    throw e;
  }
}

const minus = (a: Node, b: Node): Node => ({ type: 'bin', op: '-', left: a, right: b });

export function parsePlot(input: string): PlotItem {
  const text = normalize(input);
  if (!text.trim()) throw new ParseError('Leere Zeile', 0);
  const params = findParams(text);

  // Parametrisch: (x(t), y(t)) mit Komma auf oberster Klammerebene
  const trimmed = text.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const start = text.indexOf('(');
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 1) {
        const end = text.lastIndexOf(')');
        const vars = ['t', ...params];
        return {
          kind: 'parametric',
          x: parseAt(text.slice(start + 1, i), start + 1, vars),
          y: parseAt(text.slice(i + 1, end), i + 1, vars),
          params,
        };
      }
    }
  }

  // Polar: r = f(t)
  const polar = /^\s*r\s*=/.exec(text);
  if (polar) {
    // „r =“ ist hier keine Variable: Parameter nur aus der rechten Seite
    const rest = text.slice(polar[0].length);
    const ps = findParams(rest);
    return { kind: 'polar', r: parseAt(rest, polar[0].length, ['t', ...ps]), params: ps };
  }

  const rel = findRelation(text);
  if (rel) {
    const lhsText = text.slice(0, rel.index);
    const rhsText = text.slice(rel.index + rel.op.length);
    // y = f(x) ohne y rechts: explizit (schneller und genauer als implizit)
    if (rel.op === '=' && /^\s*y\s*$/.test(lhsText) && !/\by\b|[^a-z]y|^y/.test(rhsText.replace(/\s/g, ' '))) {
      const rhs = parseAt(rhsText, rel.index + 1, ['x', ...params]);
      return { kind: 'explicit', f: rhs, params };
    }
    const vars = ['x', 'y', ...params];
    const lhs = parseAt(lhsText, 0, vars);
    const rhs = parseAt(rhsText, rel.index + rel.op.length, vars);
    return { kind: 'implicit', F: minus(lhs, rhs), op: rel.op, params };
  }

  // Ohne Relation: enthält der Ausdruck y, ist er als F(x,y) = 0 gemeint
  const usesY = /(^|[^A-Za-z])y([^A-Za-z]|$)/.test(text) || findIdsWithY(text);
  if (usesY) return { kind: 'implicit', F: parseAt(text, 0, ['x', 'y', ...params]), op: '=', params };
  return { kind: 'explicit', f: parseAt(text, 0, ['x', ...params]), params };
}

function findIdsWithY(text: string): boolean {
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z_0-9]*/g)) {
    if ((FUNCTIONS as readonly string[]).includes(m[0])) continue;
    if (m[0].includes('y')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Abtasten

export type Pt = [number, number];

/**
 * Explizite Kurve als Polylinien (Weltkoordinaten). Sprünge (Polstellen, Unstetigkeiten)
 * werden erkannt: Ist ein Schritt höher als die Bildhöhe, wird der Mittelpunkt geprüft – liegt er
 * nicht zwischen den Nachbarwerten, wird die Linie unterbrochen.
 */
export function sampleExplicit(f: (x: number) => number, x0: number, x1: number, n: number, viewHeight: number): Pt[][] {
  const segs: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: Pt | null = null;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = f(x);
    if (!Number.isFinite(y)) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
      prev = null;
      continue;
    }
    if (prev && Math.abs(y - prev[1]) > viewHeight) {
      const ym = f((x + prev[0]) / 2);
      const between = Number.isFinite(ym) && ym >= Math.min(y, prev[1]) && ym <= Math.max(y, prev[1]);
      if (!between) {
        if (cur.length > 1) segs.push(cur);
        cur = [];
      }
    }
    cur.push([x, y]);
    prev = [x, y];
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

/** Kurve in t (parametrisch/polar) mit Unterbrechung bei nicht-endlichen Werten und großen Sprüngen */
export function sampleCurve(p: (t: number) => Pt, t0: number, t1: number, n: number, jump: number): Pt[][] {
  const segs: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const q = p(t0 + ((t1 - t0) * i) / n);
    if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
      continue;
    }
    const last = cur[cur.length - 1];
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) > jump) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
    }
    cur.push(q);
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

// ---------------------------------------------------------------------------
// Besondere Punkte

function bisect(g: (x: number) => number, a: number, b: number): number {
  let ga = g(a);
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (gm === 0) return m;
    if ((gm < 0) === (ga < 0)) {
      a = m;
      ga = gm;
    } else b = m;
  }
  return (a + b) / 2;
}

/** Nullstellen von g auf [x0, x1] (Vorzeichenwechsel, Polstellen ausgeschlossen) */
export function findZeros(g: (x: number) => number, x0: number, x1: number, n: number): number[] {
  const out: number[] = [];
  let px = x0;
  let py = g(x0);
  for (let i = 1; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = g(x);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) out.push(px);
      else if ((py < 0) !== (y < 0) && y !== 0) {
        const r = bisect(g, px, x);
        // Polstelle statt Nullstelle? Dann wächst |g| an der Stelle über alle Grenzen
        if (Math.abs(g(r)) < 1e-6 * (1 + Math.abs(py) + Math.abs(y))) out.push(r);
      }
    }
    px = x;
    py = y;
  }
  return out;
}

/** Lokale Extrema (Vorzeichenwechsel der Differenzen, verfeinert per Goldenem Schnitt) */
export function findExtrema(f: (x: number) => number, x0: number, x1: number, n: number): { x: number; y: number; max: boolean }[] {
  const out: { x: number; y: number; max: boolean }[] = [];
  const h = (x1 - x0) / n;
  const ys = Array.from({ length: n + 1 }, (_, i) => f(x0 + i * h));
  for (let i = 1; i < n; i++) {
    const a = ys[i - 1]!, b = ys[i]!, c = ys[i + 1]!;
    if (![a, b, c].every(Number.isFinite)) continue;
    const max = b > a && b >= c;
    const min = b < a && b <= c;
    if (!max && !min) continue;
    // Goldener Schnitt auf [x_{i−1}, x_{i+1}]
    let lo = x0 + (i - 1) * h;
    let hi = x0 + (i + 1) * h;
    const phi = (Math.sqrt(5) - 1) / 2;
    const s = max ? -1 : 1;
    for (let k = 0; k < 60; k++) {
      const m1 = hi - phi * (hi - lo);
      const m2 = lo + phi * (hi - lo);
      if (s * f(m1) < s * f(m2)) hi = m2;
      else lo = m1;
    }
    const x = (lo + hi) / 2;
    const y = f(x);
    // Spitzen an Polstellen ausschließen: Nachbarwerte müssen in derselben Größenordnung liegen
    if (Number.isFinite(y) && Math.abs(y - b) <= Math.abs(a - c) + Math.abs(a - b) + Math.abs(c - b) + 1e-12) out.push({ x, y, max });
  }
  return out;
}

/** Auswertung einer Zeile mit Parameterwerten */
export function evaluator(ast: Node, params: Record<string, number>, variable: string): (v: number) => number {
  const env: Record<string, number> = { ...params };
  return (v) => {
    env[variable] = v;
    return evaluateReal(ast, env);
  };
}
