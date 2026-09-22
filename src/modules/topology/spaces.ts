// Ausdruckssprache für CW-Räume → zellulärer Kettenkomplex (+ 3D-Szene, falls darstellbar).
//
// Bausteine: pt, S0…Sn, D1…Dn, T1…Tn (Tori), RPn, CPn, K (Kleinsche Flasche),
//            F(g) (orientierbare Fläche, Geschlecht g), N(k) (k Kreuzhauben), L(p,q), M(n,k)
// Operationen (schwach → stark bindend):
//   X ⊔ Y  oder  X + Y       disjunkte Vereinigung
//   X ∪ eⁿ(c₁, c₂, …)        n-Zelle mit zellulärem Rand Σ cᵢ·(i-te (n−1)-Zelle) anheften
//   X / sk(k)                Quotient: k-Gerüst zu einem Punkt
//   X ∨ Y  oder  X v Y       Keilprodukt (an einem Punkt verkleben)
//   X # Y                    zusammenhängende Summe
//   X × Y  oder  X x Y       Produkt
//   Σ X, susp(X), cone(X)    Suspension, Kegel
import { ParseError } from '../../math/parser';
import {
  attachCell, connectedSum, cp, disjoint, disk, lens, moore, nonOrientableSurface, orientableSurface, point,
  product, quotientSkeleton, rp, sphere, suspension, wedge,
} from './chain';
import type { ChainComplex } from './chain';

export type Piece =
  | { kind: 'point' | 'circle' | 'sphere' | 'torus' | 'disk' | 'segment' | 'points' }
  | { kind: 'genus'; genus: number };

/** Szene: Zusammenhangskomponenten, jede ein Blumenstrauß von Stücken mit gemeinsamem Punkt */
export type Scene = Piece[][];

export interface Space {
  complex: ChainComplex;
  scene: Scene | null;
}

type Tok =
  | { t: 'id'; v: string; n: number | null; pos: number; end: number }
  | { t: 'num'; v: number; pos: number; end: number }
  | { t: 'op'; v: string; pos: number; end: number }
  | { t: 'eof'; pos: number; end: number };

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

function tokenize(src: string): Tok[] {
  const s = src.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUP[c]!);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const word = /^([A-Za-z]+)\^?(\d+)?/.exec(s.slice(i));
    if (word) {
      const [all, name, num] = word;
      const len = all.length;
      if ((name === 'v' || name === 'x' || name === 'U') && !num) out.push({ t: 'op', v: name === 'v' ? '∨' : name === 'x' ? '×' : '∪', pos: i, end: i + len });
      else out.push({ t: 'id', v: name!, n: num ? Number(num) : null, pos: i, end: i + len });
      i += len;
      continue;
    }
    const num = /^-?\d+/.exec(s.slice(i));
    if (num && (num[0][0] !== '-' || /[(,]\s*$/.test(s.slice(0, i)))) {
      out.push({ t: 'num', v: Number(num[0]), pos: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const op = c === '*' ? '×' : c === '+' ? '⊔' : c;
    if ('∨#×⊔∪/Σ(),'.includes(op)) {
      out.push({ t: 'op', v: op, pos: i, end: i + 1 });
      i++;
      continue;
    }
    throw new ParseError(`Unerwartetes Zeichen „${c}“`, i);
  }
  out.push({ t: 'eof', pos: s.length, end: s.length });
  return out;
}

// ---- Szenen-Kombinatorik (nur für darstellbare Fälle) ----

const single = (p: Piece): Scene => [[p]];
function sceneWedge(a: Scene | null, b: Scene | null): Scene | null {
  if (!a || !b) return null;
  const ra = a[0]!.filter((p) => p.kind !== 'point');
  const rb = b[0]!.filter((p) => p.kind !== 'point');
  const merged = [...ra, ...rb];
  return [merged.length ? merged : [{ kind: 'point' }], ...a.slice(1), ...b.slice(1)];
}
function surfaceGenus(s: Scene | null): number | null {
  if (!s || s.length !== 1 || s[0]!.length !== 1) return null;
  const p = s[0]![0]!;
  return p.kind === 'sphere' ? 0 : p.kind === 'torus' ? 1 : p.kind === 'genus' ? p.genus : null;
}
function genusScene(g: number): Scene {
  return single(g === 0 ? { kind: 'sphere' } : g === 1 ? { kind: 'torus' } : { kind: 'genus', genus: g });
}

export function parseSpace(src: string): Space {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k]!;
  const next = () => toks[k++]!;
  const isOp = (t: Tok, v: string) => t.t === 'op' && t.v === v;
  const expectOp = (v: string) => {
    const t = next();
    if (!isOp(t, v)) throw new ParseError(`„${v}“ erwartet`, t.pos, t.end);
  };
  const ints = (): number[] => {
    expectOp('(');
    const out: number[] = [];
    if (isOp(peek(), ')')) {
      k++;
      return out;
    }
    for (;;) {
      const t = next();
      if (t.t !== 'num') throw new ParseError('Zahl erwartet', t.pos, t.end);
      out.push(t.v);
      if (isOp(peek(), ',')) k++;
      else break;
    }
    expectOp(')');
    return out;
  };
  const needN = (t: Extract<Tok, { t: 'id' }>, min: number, max = 16) => {
    if (t.n === null || t.n < min || t.n > max) throw new ParseError(`${t.v}: Dimension ${min}…${max} angeben, z. B. ${t.v}${Math.max(min, 2)}`, t.pos, t.end);
    return t.n;
  };

  function atom(): Space {
    const t = next();
    if (isOp(t, '(')) {
      const s = union();
      expectOp(')');
      return s;
    }
    if (isOp(t, 'Σ')) {
      const s = unary();
      return { complex: suspension(s.complex), scene: suspScene(s.scene) };
    }
    if (t.t !== 'id') throw new ParseError(t.t === 'eof' ? 'Ausdruck unvollständig' : 'Raum erwartet', t.pos, t.end);
    const name = t.v;
    switch (name) {
      case 'pt':
        return { complex: point(), scene: single({ kind: 'point' }) };
      case 'S': {
        const n = needN(t, 0);
        return { complex: sphere(n), scene: n === 0 ? single({ kind: 'points' }) : n === 1 ? single({ kind: 'circle' }) : n === 2 ? single({ kind: 'sphere' }) : null };
      }
      case 'D': {
        const n = needN(t, 1);
        return { complex: disk(n), scene: n === 1 ? single({ kind: 'segment' }) : n === 2 ? single({ kind: 'disk' }) : null };
      }
      case 'T': {
        const n = needN(t, 1, 6);
        let c = sphere(1);
        for (let i = 1; i < n; i++) c = product(c, sphere(1));
        return { complex: c, scene: n === 1 ? single({ kind: 'circle' }) : n === 2 ? single({ kind: 'torus' }) : null };
      }
      case 'RP':
        return { complex: rp(needN(t, 1)), scene: t.n === 1 ? single({ kind: 'circle' }) : null };
      case 'CP':
        return { complex: cp(needN(t, 1, 8)), scene: t.n === 1 ? single({ kind: 'sphere' }) : null };
      case 'K':
        return { complex: nonOrientableSurface(2), scene: null };
      case 'F': {
        const [g] = ints();
        if (g === undefined || g < 0 || g > 50) throw new ParseError('F(g): Geschlecht 0…50', t.pos, t.end);
        return { complex: orientableSurface(g), scene: g <= 8 ? genusScene(g) : null };
      }
      case 'N': {
        const [m] = ints();
        if (m === undefined || m < 1 || m > 50) throw new ParseError('N(k): 1…50 Kreuzhauben', t.pos, t.end);
        return { complex: nonOrientableSurface(m), scene: null };
      }
      case 'L': {
        const [p, q] = ints();
        if (!p || p < 1 || q === undefined) throw new ParseError('L(p,q) mit p ≥ 1', t.pos, t.end);
        return { complex: lens(p), scene: null };
      }
      case 'M': {
        const [n, m] = ints();
        if (!n || n < 1 || m === undefined || m < 1) throw new ParseError('M(n,k): Moore-Raum M(ℤ/n, k), n, k ≥ 1', t.pos, t.end);
        return { complex: moore(n, m), scene: null };
      }
      case 'susp': {
        expectOp('(');
        const s = union();
        expectOp(')');
        return { complex: suspension(s.complex), scene: suspScene(s.scene) };
      }
      case 'cone': {
        expectOp('(');
        union();
        expectOp(')');
        return { complex: point(), scene: single({ kind: 'point' }) };
      }
      default:
        throw new ParseError(`Unbekannter Raum „${name}${t.n ?? ''}“`, t.pos, t.end);
    }
  }

  function suspScene(s: Scene | null): Scene | null {
    if (!s || s.length !== 1 || s[0]!.length !== 1) return null;
    const p = s[0]![0]!;
    return p.kind === 'points' ? single({ kind: 'circle' }) : p.kind === 'circle' ? single({ kind: 'sphere' }) : null;
  }

  function unary(): Space {
    return atom();
  }

  function prod(): Space {
    let a = unary();
    while (isOp(peek(), '×')) {
      k++;
      const b = unary();
      const sa = a.scene?.[0]?.[0]?.kind;
      const sb = b.scene?.[0]?.[0]?.kind;
      const scene =
        a.scene?.length === 1 && b.scene?.length === 1 && a.scene[0]!.length === 1 && b.scene[0]!.length === 1
          ? sa === 'circle' && sb === 'circle'
            ? single({ kind: 'torus' })
            : sa === 'point' ? b.scene : sb === 'point' ? a.scene : null
          : null;
      a = { complex: product(a.complex, b.complex), scene };
    }
    return a;
  }

  function sum(): Space {
    let a = prod();
    while (isOp(peek(), '#')) {
      const op = next();
      const b = prod();
      let c: ChainComplex;
      try {
        c = connectedSum(a.complex, b.complex);
      } catch (e) {
        throw new ParseError((e as Error).message, op.pos, op.end);
      }
      const ga = surfaceGenus(a.scene);
      const gb = surfaceGenus(b.scene);
      a = { complex: c, scene: ga !== null && gb !== null && ga + gb <= 8 ? genusScene(ga + gb) : null };
    }
    return a;
  }

  function wedgeExpr(): Space {
    let a = sum();
    while (isOp(peek(), '∨')) {
      k++;
      const b = sum();
      a = { complex: wedge(a.complex, b.complex), scene: sceneWedge(a.scene, b.scene) };
    }
    return a;
  }

  function postfix(): Space {
    let a = wedgeExpr();
    for (;;) {
      const t = peek();
      if (isOp(t, '∪')) {
        k++;
        const cell = next();
        if (cell.t !== 'id' || cell.v !== 'e' || cell.n === null || cell.n < 1) {
          throw new ParseError('Zelle erwartet, z. B. e2(2)', cell.pos, cell.end);
        }
        const coeffs = isOp(peek(), '(') ? ints() : [];
        try {
          a = { complex: attachCell(a.complex, cell.n, coeffs), scene: null };
        } catch (e) {
          throw new ParseError((e as Error).message, cell.pos, cell.end);
        }
      } else if (isOp(t, '/')) {
        k++;
        const s = next();
        if (s.t !== 'id' || (s.v !== 'sk' && s.v !== 'skel')) throw new ParseError('Nach „/“: sk(k) für das k-Gerüst', s.pos, s.end);
        let kk = s.n;
        if (kk === null) {
          const [v] = ints();
          kk = v ?? null;
        }
        if (kk === null || kk < 0) throw new ParseError('sk(k) mit k ≥ 0', s.pos, s.end);
        const g = surfaceGenus(a.scene);
        a = { complex: quotientSkeleton(a.complex, kk), scene: g !== null && kk === 1 ? single({ kind: 'sphere' }) : null };
      } else return a;
    }
  }

  function union(): Space {
    let a = postfix();
    while (isOp(peek(), '⊔')) {
      k++;
      const b = postfix();
      a = { complex: disjoint(a.complex, b.complex), scene: a.scene && b.scene ? [...a.scene, ...b.scene] : null };
    }
    return a;
  }

  const result = union();
  const rest = peek();
  if (rest.t !== 'eof') throw new ParseError('Unerwartetes Zeichen', rest.pos, rest.end);
  return result;
}

// ---------------------------------------------------------------------------
// Szene → Primitive für den Shader

export interface Primitive {
  type: number; // 0 Punkt, 1 Kugel, 2 Kreis (Röhre), 3 Torus, 4 Scheibe, 5 Strecke
  center: [number, number, number];
  axis: [number, number, number];
  group: number;
  R: number;
  r: number;
  len: number;
}

const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];

/** Blumenstrauß: Stücke radial um den gemeinsamen Punkt; Komponenten nebeneinander */
export function layout(scene: Scene): { prims: Primitive[]; radius: number } {
  const prims: Primitive[] = [];
  let group = 0;
  const comps: { prims: Primitive[]; extent: number }[] = [];
  for (const comp of scene) {
    const list: Primitive[] = [];
    const n = comp.length;
    let extent = 0.2;
    comp.forEach((p, i) => {
      const phi = n === 1 ? 0 : (2 * Math.PI * i) / n;
      const d: [number, number, number] = [Math.cos(phi), 0, Math.sin(phi)];
      const side = cross(d, [0, 1, 0]); // horizontal, senkrecht zu d
      const at = (s: number): [number, number, number] => [d[0] * s, 0, d[2] * s];
      const g = group++;
      switch (p.kind) {
        case 'point':
          list.push({ type: 0, center: [0, 0, 0], axis: [0, 1, 0], group: g, R: 0.1, r: 0, len: 0 });
          break;
        case 'points':
          list.push({ type: 0, center: [0, 0, 0], axis: [0, 1, 0], group: g, R: 0.1, r: 0, len: 0 });
          list.push({ type: 0, center: at(1.4), axis: [0, 1, 0], group: g, R: 0.1, r: 0, len: 0 });
          extent = Math.max(extent, 1.5);
          break;
        case 'sphere':
          list.push({ type: 1, center: at(1), axis: [0, 1, 0], group: g, R: 1, r: 0, len: 0 });
          extent = Math.max(extent, 2);
          break;
        case 'circle':
          list.push({ type: 2, center: at(1), axis: side, group: g, R: 1, r: 0.055, len: 0 });
          extent = Math.max(extent, 2);
          break;
        case 'torus':
          list.push({ type: 3, center: at(1.03), axis: side, group: g, R: 0.75, r: 0.28, len: 0 });
          extent = Math.max(extent, 2.1);
          break;
        case 'genus':
          for (let j = 0; j < p.genus; j++) {
            list.push({ type: 3, center: at(1.03 + j * 1.6), axis: side, group: g, R: 0.75, r: 0.28, len: 0 });
          }
          extent = Math.max(extent, 1.03 + (p.genus - 1) * 1.6 + 1.05);
          break;
        case 'disk':
          list.push({ type: 4, center: at(1), axis: side, group: g, R: 1, r: 0.03, len: 0 });
          extent = Math.max(extent, 2);
          break;
        case 'segment':
          list.push({ type: 5, center: [0, 0, 0], axis: d, group: g, R: 0.055, r: 0, len: 1.6 });
          extent = Math.max(extent, 1.6);
          break;
      }
    });
    // Klebepunkt markieren, wenn mehrere Stücke zusammenhängen
    if (n > 1) list.push({ type: 0, center: [0, 0, 0], axis: [0, 1, 0], group: 15, R: 0.12, r: 0, len: 0 });
    comps.push({ prims: list, extent });
  }
  // Komponenten entlang x anordnen und zentrieren
  const widths = comps.map((c) => 2 * c.extent + 0.6);
  let x = -widths.reduce((a, b) => a + b, 0) / 2;
  comps.forEach((c, i) => {
    const off = x + widths[i]! / 2;
    x += widths[i]!;
    for (const p of c.prims) prims.push({ ...p, center: [p.center[0] + off, p.center[1], p.center[2]] });
  });
  // Gesamtszene um die Mitte ihrer Ausdehnung zentrieren (Kamera dreht um den Ursprung)
  const ext = (p: Primitive, k: number, s: number) => p.center[k]! + s * (p.type === 5 ? p.len * Math.abs(p.axis[k]!) * (s > 0 ? 1 : 0) : p.R + p.r);
  const mid = [0, 1, 2].map((k) => (Math.min(...prims.map((p) => ext(p, k, -1))) + Math.max(...prims.map((p) => ext(p, k, 1)))) / 2);
  for (const p of prims) p.center = [p.center[0] - mid[0]!, p.center[1] - mid[1]!, p.center[2] - mid[2]!];
  const radius = Math.max(...prims.map((p) => Math.hypot(...p.center) + Math.max(p.R + p.r, p.len)), 1);
  return { prims: prims.slice(0, 16), radius };
}
