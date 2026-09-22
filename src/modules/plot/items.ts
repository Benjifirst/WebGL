// Graphen reeller Funktionen: Eingabezeilen erkennen, abtasten, besondere Punkte finden.
//
// Zeilentypen:
//   f(x)  bzw.  y = f(x)                   explizit (Kurve über der x-Achse)
//   f(x) = x^2 − 1   (auch g(t) = …)       Definition: wird gezeichnet und ist in anderen Zeilen
//                                          als f(…), f'(…), f''(…) verwendbar (symbolisch abgeleitet)
//   F(x,y) = G(x,y)                        implizite Kurve
//   F < G,  a ≤ F ≤ b  (Ketten)            Bereich (Ungleichungen, Schnitt aller Bedingungen)
//   (x(t), y(t))                           parametrisch, t ∈ [t₀, t₁]
//   (a, b)  ohne t                         Punkt
//   r = f(t)  bzw.  r = f(θ)               polar
//   Ausdruck ohne x, y                     Wert (z. B. int(t = 0, 1, t^2) oder f'(2))
// Jede Zeile kann mit {Bedingung} eingeschränkt werden, z. B. sin(x) {0 < x < pi}.
// Unbekannte einzelne Buchstaben werden zu Parametern mit Schieberegler (a sin(b x) → a, b).
import { freeVars, FUNCTIONS, parse, parseCondition, ParseError, plotOptions, usesVar } from '../../math/parser';
import type { CmpOp, Node } from '../../math/parser';
import { DiffError, inlineUser, substitute } from '../../math/diff';
import type { UserFunction } from '../../math/diff';
import { compileReal } from '../../math/real';

export type Relation = CmpOp;

export interface Condition {
  F: Node;
  op: CmpOp;
}

export type PlotShape =
  | { kind: 'explicit'; f: Node }
  | { kind: 'implicit'; parts: Condition[] }
  | { kind: 'parametric'; x: Node; y: Node }
  | { kind: 'point'; x: Node; y: Node }
  | { kind: 'polar'; r: Node }
  | { kind: 'value'; v: Node };

export type PlotItem = PlotShape & {
  /** Einschränkung {…} oder null */
  domain: Node | null;
  /** Name und Variable, falls die Zeile eine Funktion definiert */
  def: { name: string; param: string; body: Node } | null;
  /** Parameter (für Schieberegler) */
  params: string[];
};

const RESERVED = ['x', 'y'];
const BUILTIN = new Set<string>([...FUNCTIONS, 'pi', 'e', 'x', 'y', 'r', 't']);
const DEF_HEAD = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([A-Za-z])\s*\)\s*=(?!=)/;

function normalize(text: string): string {
  return text.replace(/θ/g, 't').replace(/≤/g, '<=').replace(/≥/g, '>=');
}

/** Namen aller in den Zeilen definierten Funktionen (f(x) = …) */
export function scanDefinitions(texts: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    const m = DEF_HEAD.exec(normalize(t));
    if (m && !BUILTIN.has(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** Stellen der Vergleichszeichen außerhalb von Klammern */
function findRelations(s: string): { index: number; op: CmpOp }[] {
  const out: { index: number; op: CmpOp }[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') depth--;
    else if (depth === 0 && (c === '<' || c === '>' || c === '=')) {
      if ((c === '<' || c === '>') && s[i + 1] === '=') {
        out.push({ index: i, op: (c + '=') as CmpOp });
        i++;
      } else out.push({ index: i, op: c as CmpOp });
    }
  }
  return out;
}

interface Ctx {
  user: readonly string[];
  params: Set<string>;
}

function parseAt(src: string, offset: number, vars: string[], ctx: Ctx, reserved = RESERVED): Node {
  try {
    return parse(src, plotOptions(vars, { user: ctx.user, autoParams: ctx.params, reserved: [...reserved, ...vars] }));
  } catch (e) {
    if (e instanceof ParseError) throw new ParseError(e.message, e.pos + offset, e.end + offset);
    throw e;
  }
}

const minus = (a: Node, b: Node): Node => ({ type: 'bin', op: '-', left: a, right: b });

/** Rohes Parsen einer Zeile (benutzerdefinierte Funktionen bleiben als Knoten stehen) */
export function parsePlot(input: string, user: readonly string[] = scanDefinitions([input])): PlotItem {
  let text = normalize(input);
  if (!text.trim()) throw new ParseError('Leere Zeile', 0);
  const ctx: Ctx = { user, params: new Set() };

  // Einschränkung {…} am Ende
  let domain: Node | null = null;
  const brace = text.lastIndexOf('{');
  if (brace >= 0 && text.trimEnd().endsWith('}')) {
    const inner = text.slice(brace + 1, text.trimEnd().length - 1);
    try {
      domain = parseCondition(inner, plotOptions(['x', 'y', 't'], { user, autoParams: ctx.params, reserved: ['x', 'y', 't'] }));
    } catch (e) {
      if (e instanceof ParseError) {
        // parseCondition parst „if(…, 1)“: Positionen um „if(“ korrigieren
        const pos = Math.max(0, Math.min(inner.length, e.pos - 3));
        throw new ParseError(e.message, brace + 1 + pos, brace + 1 + Math.min(inner.length, Math.max(pos + 1, e.end - 3)));
      }
      throw e;
    }
    text = text.slice(0, brace);
    if (!text.trim()) throw new ParseError('Ausdruck vor {…} fehlt', 0);
  }
  const done = (shape: PlotShape, def: PlotItem['def'] = null): PlotItem => ({
    ...shape,
    domain,
    def,
    params: [...ctx.params].sort(),
  });

  // Definition f(x) = …
  const head = DEF_HEAD.exec(text);
  if (head && user.includes(head[1]!)) {
    const [all, name, param] = head as unknown as [string, string, string];
    const body = parseAt(text.slice(all.length), all.length, [param], ctx, ['x', 'y', 't']);
    const f = param === 'x' ? body : substitute(body, param, { type: 'var', name: 'x' });
    return done({ kind: 'explicit', f }, { name, param, body });
  }

  // Tupel: (x(t), y(t)) oder Punkt (a, b)
  const trimmed = text.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    let depth = 0;
    for (let i = start; i <= end; i++) {
      const c = text[i]!;
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0 && i < end) break; // (a)(b) ist kein Tupel
      } else if (c === ',' && depth === 1) {
        const x = parseAt(text.slice(start + 1, i), start + 1, ['t'], ctx, ['x', 'y', 't']);
        const y = parseAt(text.slice(i + 1, end), i + 1, ['t'], ctx, ['x', 'y', 't']);
        return done(usesVar(x, 't') || usesVar(y, 't') ? { kind: 'parametric', x, y } : { kind: 'point', x, y });
      }
    }
  }

  // Polar: r = f(t)
  const polar = /^\s*r\s*=(?!=)/.exec(text);
  if (polar) {
    const rest = text.slice(polar[0].length);
    return done({ kind: 'polar', r: parseAt(rest, polar[0].length, ['t'], ctx, ['x', 'y', 't', 'r']) });
  }

  const rels = findRelations(text);
  if (rels.length) {
    const sides: Node[] = [];
    let from = 0;
    for (const r of [...rels, { index: text.length, op: '=' as CmpOp }]) {
      const piece = text.slice(from, r.index);
      if (!piece.trim()) throw new ParseError('Ausdruck fehlt', Math.min(r.index, text.length - 1));
      sides.push(parseAt(piece, from, ['x', 'y'], ctx));
      from = r.index + (r.op.length);
    }
    const ops = rels.map((r) => r.op);
    if (ops.includes('=') && ops.length > 1) {
      const eq = rels.find((r) => r.op === '=')!;
      throw new ParseError('„=“ lässt sich nicht mit Ungleichungen verketten', eq.index);
    }
    // y = f(x) ohne y rechts: explizit (schneller und genauer als implizit)
    const [l, r] = sides as [Node, Node];
    if (ops.length === 1 && ops[0] === '=' && l.type === 'var' && l.name === 'y' && !usesVar(r, 'y')) {
      return done({ kind: 'explicit', f: r });
    }
    const parts = ops.map((op, i) => ({ F: minus(sides[i]!, sides[i + 1]!), op }));
    return done({ kind: 'implicit', parts });
  }

  const ast = parseAt(text, 0, ['x', 'y'], ctx);
  if (usesVar(ast, 'y')) return done({ kind: 'implicit', parts: [{ F: ast, op: '=' }] });
  if (usesVar(ast, 'x')) return done({ kind: 'explicit', f: ast });
  return done({ kind: 'value', v: ast });
}

// ---------------------------------------------------------------------------
// Auflösen: benutzerdefinierte Funktionen einsetzen

export function definitions(items: readonly (PlotItem | null)[]): Map<string, UserFunction> {
  const defs = new Map<string, UserFunction>();
  for (const it of items) if (it?.def && !defs.has(it.def.name)) defs.set(it.def.name, { param: it.def.param, body: it.def.body });
  return defs;
}

/** Setzt f, f', … ein; Parameter werden danach neu bestimmt. Wirft DiffError. */
export function resolveItem(it: PlotItem, defs: ReadonlyMap<string, UserFunction>): PlotItem {
  const r = (n: Node) => inlineUser(n, defs);
  let shape: PlotShape;
  switch (it.kind) {
    case 'explicit': shape = { kind: 'explicit', f: r(it.f) }; break;
    case 'implicit': shape = { kind: 'implicit', parts: it.parts.map((p) => ({ F: r(p.F), op: p.op })) }; break;
    case 'parametric': shape = { kind: 'parametric', x: r(it.x), y: r(it.y) }; break;
    case 'point': shape = { kind: 'point', x: r(it.x), y: r(it.y) }; break;
    case 'polar': shape = { kind: 'polar', r: r(it.r) }; break;
    case 'value': shape = { kind: 'value', v: r(it.v) }; break;
  }
  const domain = it.domain ? r(it.domain) : null;
  const vars = new Set<string>();
  const add = (n: Node) => freeVars(n, vars);
  for (const n of shapeNodes(shape)) add(n);
  if (domain) add(domain);
  for (const v of ['x', 'y', 't']) vars.delete(v);
  if (shape.kind === 'explicit' || shape.kind === 'implicit' || shape.kind === 'value') {
    // t ist dort ein gewöhnlicher Parameter
    for (const n of shapeNodes(shape)) if (usesVar(n, 't')) vars.add('t');
  }
  return { ...shape, domain, def: it.def, params: [...vars].sort() };
}

export function shapeNodes(s: PlotShape): Node[] {
  switch (s.kind) {
    case 'explicit': return [s.f];
    case 'implicit': return s.parts.map((p) => p.F);
    case 'parametric': case 'point': return [s.x, s.y];
    case 'polar': return [s.r];
    case 'value': return [s.v];
  }
}

export { DiffError };

// ---------------------------------------------------------------------------
// Abtasten

export type Pt = [number, number];

/**
 * Explizite Kurve als Polylinien (Weltkoordinaten). Sprünge (Polstellen, Unstetigkeiten)
 * werden erkannt: Ist ein Schritt höher als die Bildhöhe, wird der Mittelpunkt geprüft – liegt er
 * nicht zwischen den Nachbarwerten, wird die Linie unterbrochen. Steile Stellen werden
 * adaptiv verfeinert, damit z. B. sin(1/x) oder √x am Rand sauber aussehen.
 */
export function sampleExplicit(f: (x: number) => number, x0: number, x1: number, n: number, viewHeight: number): Pt[][] {
  const segs: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: Pt | null = null;
  const h = (x1 - x0) / n;
  const flush = () => {
    if (cur.length > 1) segs.push(cur);
    else if (cur.length === 1) segs.push([cur[0]!, cur[0]!]); // isolierter Punkt
    cur = [];
  };
  const push = (x: number, y: number) => {
    if (!Number.isFinite(y)) {
      // Rand des Definitionsbereichs: per Bisektion bis an die Grenze heran
      if (prev) {
        let a = prev[0], b = x;
        for (let k = 0; k < 30; k++) {
          const m = (a + b) / 2;
          if (Number.isFinite(f(m))) a = m;
          else b = m;
        }
        if (a !== prev[0]) cur.push([a, f(a)]);
      }
      flush();
      prev = null;
      return;
    }
    if (!prev && cur.length === 0 && x > x0) {
      // Beginn des Definitionsbereichs von links genau finden
      let a = x - h, b = x;
      if (!Number.isFinite(f(a))) {
        for (let k = 0; k < 30; k++) {
          const m = (a + b) / 2;
          if (Number.isFinite(f(m))) b = m;
          else a = m;
        }
        if (b !== x) cur.push([b, f(b)]);
      }
    }
    if (prev && Math.abs(y - prev[1]) > viewHeight) {
      const ym = f((x + prev[0]) / 2);
      const between = Number.isFinite(ym) && ym >= Math.min(y, prev[1]) && ym <= Math.max(y, prev[1]);
      if (!between) flush();
    } else if (prev && Math.abs(y - prev[1]) > viewHeight / 40) {
      // steiles Stück: Zwischenpunkte einfügen
      const steps = Math.min(16, Math.ceil(Math.abs(y - prev[1]) / (viewHeight / 40)));
      for (let k = 1; k < steps; k++) {
        const xm = prev[0] + ((x - prev[0]) * k) / steps;
        const ym = f(xm);
        if (Number.isFinite(ym)) cur.push([xm, ym]);
      }
    }
    cur.push([x, y]);
    prev = [x, y];
  };
  for (let i = 0; i <= n; i++) {
    const x = x0 + h * i;
    push(x, f(x));
  }
  flush();
  return segs.filter((s) => s.length > 1);
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

/**
 * Nullstellen von g auf [x0, x1]: Vorzeichenwechsel (Polstellen und Sprünge ausgeschlossen)
 * sowie Berührstellen (doppelte Nullstellen wie bei x², erkannt als lokales Minimum von |g| ≈ 0).
 */
export function findZeros(g: (x: number) => number, x0: number, x1: number, n: number): number[] {
  const out: number[] = [];
  const h = (x1 - x0) / n;
  const ys = Array.from({ length: n + 1 }, (_, i) => g(x0 + i * h));
  const push = (x: number) => {
    if (!out.length || Math.abs(x - out[out.length - 1]!) > h * 0.5) out.push(x);
  };
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * h;
    const y = ys[i]!;
    const yn = ys[i + 1];
    if (!Number.isFinite(y)) continue;
    if (y === 0) {
      push(x);
      continue;
    }
    if (yn !== undefined && Number.isFinite(yn) && yn !== 0 && (y < 0) !== (yn < 0)) {
      const r = bisect(g, x, x + h);
      // Polstelle/Sprung statt Nullstelle? Dann ist |g| dort nicht klein
      if (Math.abs(g(r)) < 1e-6 * (1 + Math.abs(y) + Math.abs(yn))) push(r);
      continue;
    }
    // Berührstelle: |g| hat ein lokales Minimum nahe 0 ohne Vorzeichenwechsel
    const yp = ys[i - 1];
    if (yp !== undefined && yn !== undefined && Number.isFinite(yp) && Number.isFinite(yn) && Math.abs(y) <= Math.abs(yp) && Math.abs(y) < Math.abs(yn) && (y < 0) === (yp < 0) && (y < 0) === (yn < 0)) {
      let lo = x - h, hi = x + h;
      const phi = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 80; k++) {
        const m1 = hi - phi * (hi - lo);
        const m2 = lo + phi * (hi - lo);
        if (Math.abs(g(m1)) < Math.abs(g(m2))) hi = m2;
        else lo = m1;
      }
      const xm = (lo + hi) / 2;
      // Toleranz lokal skaliert: am Minimum muss |g| winzig gegenüber den Nachbarwerten sein
      if (Math.abs(g(xm)) < 1e-7 * (Math.abs(yp) + Math.abs(yn)) + 1e-15) push(xm);
    }
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

/** Auswertung einer Zeile mit Parameterwerten (streng: Definitionsbereiche werden beachtet) */
export function evaluator(ast: Node, params: Record<string, number>, variable: string, domain: Node | null = null): (v: number) => number {
  const f = compileReal(ast, true);
  const d = domain ? compileReal(domain, true) : null;
  const env: Record<string, number> = { ...params };
  return (v) => {
    env[variable] = v;
    if (d && !d(env)) return NaN;
    return f(env);
  };
}

/** Wie evaluator, aber für Kurven in t (Definitionsbereich darf x, y und t verwenden) */
export function curveEvaluator(x: Node, y: Node, params: Record<string, number>, domain: Node | null): (t: number) => Pt {
  const fx = compileReal(x, true);
  const fy = compileReal(y, true);
  const d = domain ? compileReal(domain, true) : null;
  const env: Record<string, number> = { ...params };
  return (t) => {
    env.t = t;
    const px = fx(env);
    const py = fy(env);
    if (d) {
      env.x = px;
      env.y = py;
      if (!d(env)) return [NaN, NaN];
    }
    return [px, py];
  };
}
