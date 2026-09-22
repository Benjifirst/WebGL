// Ausdruckssprache für CW-Räume → zellulärer Kettenkomplex, Fundamentalgruppe und (falls darstellbar) 3D-Szene.
//
// Bausteine: pt, S0…Sn, D1…Dn, I (= D1), T1…Tn (Tori), RPn, CPn, K (Kleinsche Flasche), Mb (Möbiusband),
//            F(g) (orientierbare Fläche, Geschlecht g), N(k) (k Kreuzhauben), L(p,q), M(n,k) (Moore-Raum),
//            P (Poincaré-Homologiesphäre), ⟨a, b | a^2, (ab)^3⟩ (Präsentationskomplex einer Gruppe)
// Operationen (schwach → stark bindend):
//   X ⊔ Y  oder  X + Y       disjunkte Vereinigung
//   X ∪ eⁿ(c₁, c₂, …)        n-Zelle anheften; Rand Σ cᵢ·(i-te (n−1)-Zelle), bei n = 2 entlang a₁^{c₁}a₂^{c₂}⋯
//   X / sk(k),  X / ∂        Quotient: k-Gerüst bzw. Rand zu einem Punkt
//   X ∨ Y  oder  X v Y       Keilprodukt (an einem Punkt verkleben)
//   X # Y                    zusammenhängende Summe
//   X × Y, X x Y, X ∧ Y      Produkt, Smash-Produkt
//   Σ X, ∂ X, cone(X), join(X, Y), susp(X)   Suspension, Rand, Kegel, Verbund
//
// Neben dem Kettenkomplex wird eine Präsentation von π₁ (Komponente des Basispunkts) mitgeführt,
// solange sie aus den Bausteinen folgt (Seifert–van Kampen: ∨ → freies Produkt, × → direktes Produkt …).
import { ParseError } from '../../math/parser';
import {
  attachCell, connectedSum, cp, dim, disjoint, disk, homology, isSubcomplex, lens, moebius, moore,
  nonOrientableSurface, orientableSurface, point, poincareSphere, presentationComplex, productIndexed,
  quotientSkeleton, quotientSub, rp, smash, sphere, subcomplex, suspension, wedge,
} from './chain';
import type { Cells, ChainComplex } from './chain';
import {
  crosscapGroup, cyclic, directProduct, free, freeProduct, parsePresentation, surfaceGroup, trivial,
} from './group';
import type { Presentation } from './group';

export type Piece =
  | { kind: 'point' | 'circle' | 'sphere' | 'torus' | 'disk' | 'segment' | 'points' }
  | { kind: 'genus'; genus: number };

/** Szene: Zusammenhangskomponenten, jede ein Blumenstrauß von Stücken mit gemeinsamem Punkt */
export type Scene = Piece[][];

export interface Space {
  complex: ChainComplex;
  scene: Scene | null;
  /** π₁ der Basispunkt-Komponente, null = aus der Konstruktion nicht bestimmbar */
  pi1: Presentation | null;
  /** Genau eine 0-Zelle und die Erzeuger von pi1 sind die 1-Zellen in ihrer Reihenfolge */
  cellGens: boolean;
  /** Rand als Teilkomplex (leer = geschlossen), null = unbekannt */
  boundary: Cells | null;
  /** Hinweis, wie π₁ zustande kam bzw. warum es fehlt */
  pi1Note?: string;
}

type Tok =
  | { t: 'id'; v: string; n: number | null; pos: number; end: number }
  | { t: 'num'; v: number; pos: number; end: number }
  | { t: 'op'; v: string; pos: number; end: number }
  | { t: 'pres'; v: string; pos: number; end: number }
  | { t: 'eof'; pos: number; end: number };

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Bekannte Namen (längste zuerst), damit „S2vS1“ oder „RP2xRP2“ ohne Leerzeichen funktionieren */
const NAMES = ['susp', 'cone', 'join', 'skel', 'pt', 'sk', 'bd', 'RP', 'CP', 'Mb', 'S', 'D', 'I', 'T', 'K', 'F', 'N', 'L', 'M', 'P', 'e', 'v', 'x', 'U'];
const OP_NAMES: Record<string, string> = { v: '∨', x: '×', U: '∪' };

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
    // Präsentation ⟨ … ⟩ bzw. < … >
    if (c === '⟨' || c === '<') {
      const close = s.indexOf(c === '⟨' ? '⟩' : '>', i + 1);
      if (close < 0) throw new ParseError(`„${c === '⟨' ? '⟩' : '>'}“ fehlt`, i);
      out.push({ t: 'pres', v: s.slice(i + 1, close), pos: i, end: close + 1 });
      i = close + 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const rest = s.slice(i);
      const name = NAMES.find((n) => rest.startsWith(n));
      if (!name) {
        const word = /^[A-Za-z]+/.exec(rest)![0];
        throw new ParseError(`Unbekannter Raum „${word}“`, i, i + word.length);
      }
      let len = name.length;
      const num = /^\^?(\d+)/.exec(s.slice(i + len));
      const isOp = name in OP_NAMES && !num;
      if (isOp) out.push({ t: 'op', v: OP_NAMES[name]!, pos: i, end: i + len });
      else {
        if (num) len += num[0].length;
        out.push({ t: 'id', v: name, n: num ? Number(num[1]) : null, pos: i, end: i + len });
      }
      i += len;
      continue;
    }
    const num = /^-?\d+/.exec(s.slice(i));
    if (num && (num[0][0] !== '-' || /[(,]\s*$/.test(s.slice(0, i)))) {
      out.push({ t: 'num', v: Number(num[0]), pos: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const op = c === '*' ? '×' : c === '+' ? '⊔' : c === '∐' ? '⊔' : c === '^' ? '∧' : c;
    if ('∨#×⊔∪/Σ∂∧(),'.includes(op)) {
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
function suspScene(s: Scene | null): Scene | null {
  if (!s || s.length !== 1 || s[0]!.length !== 1) return null;
  const p = s[0]![0]!;
  return p.kind === 'points' ? single({ kind: 'circle' }) : p.kind === 'circle' ? single({ kind: 'sphere' }) : null;
}

// ---- π₁-Hilfen ----

const components = (c: ChainComplex) => homology(c)[0]?.betti ?? 0;

/** Fallback aus dem Kettenkomplex allein: ohne 1-Zellen trivial, ohne 2-Zellen frei */
function fallbackPi1(c: ChainComplex): Presentation | null {
  if (c.cells[0] === 1 && (c.cells[1] ?? 0) === 0) return trivial();
  if (c.cells[0] === 1 && (c.cells[2] ?? 0) === 0) return free(c.cells[1]!, 'x');
  return null;
}

function make(c: ChainComplex, scene: Scene | null, pi1: Presentation | null, cellGens: boolean, boundary: Cells | null, note?: string): Space {
  if (!pi1) {
    const fb = fallbackPi1(c);
    if (fb) return { complex: c, scene, pi1: fb, cellGens: c.cells[0] === 1, boundary, pi1Note: note };
  }
  return { complex: c, scene, pi1, cellGens: cellGens && c.cells[0] === 1, boundary, pi1Note: note };
}

const closed = (c: ChainComplex): Cells => c.cells.map(() => []);

const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];

// ---------------------------------------------------------------------------

export function parseSpace(src: string): Space {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k]!;
  const next = () => toks[k++]!;
  const isOp = (t: Tok, v: string) => t.t === 'op' && t.v === v;
  const expectOp = (v: string) => {
    const t = next();
    if (!isOp(t, v)) throw new ParseError(t.t === 'eof' ? 'Ausdruck unvollständig' : `„${v}“ erwartet`, t.pos, t.end);
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
  const wrap = <T>(t: Tok, f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof ParseError) throw e;
      throw new ParseError((e as Error).message, t.pos, t.end);
    }
  };

  // Präzedenz (Bindungsstärke): ⊔ 1 · Postfix ∪, / 2 · ∨ 3 · # 4 · ×, ∧ 5 · Präfix Σ, ∂ 6
  const BINARY: Record<string, number> = { '⊔': 1, '∨': 3, '#': 4, '×': 5, '∧': 5 };
  const POSTFIX = 2;

  function expr(minBP: number): Space {
    let left = prefix();
    for (;;) {
      const t = peek();
      if (t.t !== 'op') break;
      const bp = BINARY[t.v];
      if (bp !== undefined && bp > minBP) {
        k++;
        const right = expr(bp);
        left = wrap(t, () => binary(t.v, left, right, t));
        continue;
      }
      if ((t.v === '∪' || t.v === '/') && POSTFIX > minBP) {
        k++;
        left = t.v === '∪' ? attach(left) : quotient(left);
        continue;
      }
      break;
    }
    return left;
  }

  function prefix(): Space {
    const t = peek();
    if (isOp(t, 'Σ')) {
      k++;
      return suspend(expr(6));
    }
    if (isOp(t, '∂')) {
      k++;
      return boundaryOf(expr(6), t);
    }
    return atom();
  }

  function suspend(s: Space): Space {
    const m = components(s.complex);
    const c = suspension(s.complex);
    // π₁(ΣX) ist frei vom Rang (Anzahl Komponenten − 1)
    const pi1 = m <= 1 ? trivial() : free(m - 1, 'x');
    return make(c, suspScene(s.scene), pi1, s.complex.cells[0] === m, null);
  }

  function boundaryOf(s: Space, t: Tok): Space {
    if (!s.boundary) throw new ParseError('Rand dieses Raums ist nicht bekannt (∂ geht für Dⁿ, Mb, Produkte, Kegel, …)', t.pos, t.end);
    if (!s.boundary.some((c) => c.length)) throw new ParseError('Der Raum hat keinen Rand (∂X = ∅)', t.pos, t.end);
    const c = subcomplex(s.complex, s.boundary);
    return make(c, null, null, false, closed(c), 'aus dem Kettenkomplex');
  }

  function atom(): Space {
    const t = next();
    if (isOp(t, '(')) {
      const s = expr(0);
      expectOp(')');
      return s;
    }
    if (t.t === 'pres') {
      const p = parsePresentation(t.v, t.pos + 1);
      const c = presentationComplex(p.gens.length, p.rels);
      return make(c, null, p, true, closed(c));
    }
    if (t.t !== 'id') throw new ParseError(t.t === 'eof' ? 'Ausdruck unvollständig' : 'Raum erwartet', t.pos, t.end);
    switch (t.v) {
      case 'pt':
        return make(point(), single({ kind: 'point' }), trivial(), true, [[]]);
      case 'S': {
        const n = needN(t, 0);
        const c = sphere(n);
        const scene = n === 0 ? single({ kind: 'points' }) : n === 1 ? single({ kind: 'circle' }) : n === 2 ? single({ kind: 'sphere' }) : null;
        return make(c, scene, n === 1 ? cyclic(0) : trivial(), n !== 0, closed(c));
      }
      case 'D':
      case 'I': {
        const n = t.v === 'I' ? (t.n === null ? 1 : needN(t, 1, 1)) : needN(t, 1);
        const c = disk(n);
        const scene = n === 1 ? single({ kind: 'segment' }) : n === 2 ? single({ kind: 'disk' }) : null;
        const boundary: Cells = c.cells.map(() => []);
        if (n === 1) boundary[0] = [0, 1];
        else {
          boundary[0] = [0];
          boundary[n - 1] = [0];
        }
        return make(c, scene, trivial(), n === 2 ? false : n > 2, boundary);
      }
      case 'T': {
        const n = needN(t, 1, 6);
        let s = circle();
        for (let i = 1; i < n; i++) s = binary('×', s, circle(), t);
        return { ...s, scene: n === 1 ? single({ kind: 'circle' }) : n === 2 ? single({ kind: 'torus' }) : null };
      }
      case 'RP': {
        const n = needN(t, 1);
        const c = rp(n);
        return make(c, n === 1 ? single({ kind: 'circle' }) : null, n === 1 ? cyclic(0) : cyclic(2), true, closed(c));
      }
      case 'CP': {
        const c = cp(needN(t, 1, 8));
        return make(c, t.n === 1 ? single({ kind: 'sphere' }) : null, trivial(), true, closed(c));
      }
      case 'K': {
        const c = nonOrientableSurface(2);
        return make(c, null, crosscapGroup(2), true, closed(c));
      }
      case 'Mb': {
        const c = moebius();
        return make(c, null, { gens: ['a', 'b'], rels: [[2, -1, -1]] }, true, [[0], [1], []]);
      }
      case 'P': {
        const c = poincareSphere();
        return make(c, null, { gens: ['s', 't'], rels: [[1, 2, 1, 2, -1, -1, -1], [1, 1, 1, -2, -2, -2, -2, -2]] }, true, closed(c));
      }
      case 'F': {
        const [g] = ints();
        if (g === undefined || g < 0 || g > 50) throw new ParseError('F(g): Geschlecht 0…50', t.pos, t.end);
        const c = orientableSurface(g);
        return make(c, g <= 8 ? genusScene(g) : null, surfaceGroup(g), true, closed(c));
      }
      case 'N': {
        const [m] = ints();
        if (m === undefined || m < 1 || m > 50) throw new ParseError('N(k): 1…50 Kreuzhauben', t.pos, t.end);
        const c = nonOrientableSurface(m);
        return make(c, null, crosscapGroup(m), true, closed(c));
      }
      case 'L': {
        const [p, q] = ints();
        if (!p || p < 1 || q === undefined) throw new ParseError('L(p,q) mit p ≥ 1', t.pos, t.end);
        if (gcd(p, q) !== 1) throw new ParseError('L(p,q) braucht teilerfremde p und q', t.pos, t.end);
        const c = lens(p);
        return make(c, null, cyclic(p), true, closed(c));
      }
      case 'M': {
        const [n, m] = ints();
        if (!n || n < 1 || m === undefined || m < 1) throw new ParseError('M(n,k): Moore-Raum M(ℤ/n, k), n, k ≥ 1', t.pos, t.end);
        const c = moore(n, m);
        return make(c, null, m === 1 ? cyclic(n) : trivial(), true, closed(c));
      }
      case 'susp': {
        expectOp('(');
        const s = expr(0);
        expectOp(')');
        return suspend(s);
      }
      case 'bd': {
        expectOp('(');
        const s = expr(0);
        expectOp(')');
        return boundaryOf(s, t);
      }
      case 'cone': {
        expectOp('(');
        const s = expr(0);
        expectOp(')');
        return cone(s);
      }
      case 'join': {
        expectOp('(');
        const a = expr(0);
        expectOp(',');
        const b = expr(0);
        expectOp(')');
        // X ∗ Y ≃ Σ(X ∧ Y); einfach zusammenhängend, sobald ein Faktor zusammenhängend ist
        const c = suspension(smash(a.complex, b.complex));
        const simply = components(a.complex) === 1 || components(b.complex) === 1;
        return make(c, null, simply ? trivial() : null, false, null, simply ? undefined : 'Verbund unzusammenhängender Räume');
      }
      default:
        throw new ParseError(`Unbekannter Raum „${t.v}${t.n ?? ''}“`, t.pos, t.end);
    }
  }

  function circle(): Space {
    const c = sphere(1);
    return make(c, single({ kind: 'circle' }), cyclic(0), true, closed(c));
  }

  function cone(s: Space): Space {
    // CX = X × I / X × {1}: Basis X × {0} ist der Rand
    const I = disk(1);
    const { complex: P, at } = productIndexed(s.complex, I);
    const top: Cells = P.cells.map(() => []);
    const base: Cells = P.cells.map(() => []);
    s.complex.cells.forEach((n, i) => {
      for (let a = 0; a < n; a++) {
        top[i]!.push(at(i, a, 0, 1));
        base[i]!.push(at(i, a, 0, 0));
      }
    });
    const c = quotientSub(P, top);
    // Indizes der Basis im Quotienten (0-Zellen um den neuen Punkt verschoben)
    const reindex = (cells: Cells): Cells =>
      cells.map((list, kk) => {
        const removed = new Set(top[kk]);
        const kept = Array.from({ length: P.cells[kk]! }, (_, i) => i).filter((i) => !removed.has(i));
        return list.map((i) => kept.indexOf(i) + (kk === 0 ? 1 : 0));
      });
    return make(c, null, trivial(), false, reindex(base));
  }

  function binary(op: string, a: Space, b: Space, t: Tok): Space {
    switch (op) {
      case '⊔': {
        const c = disjoint(a.complex, b.complex);
        return make(c, a.scene && b.scene ? [...a.scene, ...b.scene] : null, a.pi1, false, unionCells(a, b, false));
      }
      case '∨': {
        const c = wedge(a.complex, b.complex);
        const pi1 = a.pi1 && b.pi1 ? freeProduct(a.pi1, b.pi1) : null;
        return make(c, sceneWedge(a.scene, b.scene), pi1, a.cellGens && b.cellGens, unionCells(a, b, true));
      }
      case '#': {
        const c = connectedSum(a.complex, b.complex);
        const n = dim(a.complex);
        let pi1: Presentation | null = null;
        let cellGens = false;
        if (n >= 3 && a.pi1 && b.pi1) {
          pi1 = freeProduct(a.pi1, b.pi1);
          cellGens = a.cellGens && b.cellGens;
        } else if (n === 2 && a.pi1 && b.pi1 && a.pi1.rels.length <= 1 && b.pi1.rels.length <= 1 && a.cellGens && b.cellGens) {
          // Flächen: Polygonwörter hintereinander
          const fp = freeProduct(a.pi1, b.pi1);
          const [ra = [], rb = []] = [fp.rels[0] ?? [], fp.rels[1] ?? []];
          const rels = a.pi1.rels.length && b.pi1.rels.length ? [[...ra, ...rb]] : fp.rels;
          pi1 = { gens: fp.gens, rels };
          cellGens = true;
        } else if (n === 1) pi1 = cyclic(0);
        const ga = surfaceGenus(a.scene);
        const gb = surfaceGenus(b.scene);
        return make(c, ga !== null && gb !== null && ga + gb <= 8 ? genusScene(ga + gb) : null, pi1, cellGens, closed(c));
      }
      case '×': {
        const { complex: c } = productIndexed(a.complex, b.complex);
        // 1-Zellen des Produkts: erst pt × Y¹, dann X¹ × pt → Erzeuger von Y vor denen von X
        const pi1 = a.pi1 && b.pi1 ? directProduct(b.pi1, a.pi1) : null;
        const sa = a.scene?.[0]?.[0]?.kind;
        const sb = b.scene?.[0]?.[0]?.kind;
        const simple = a.scene?.length === 1 && b.scene?.length === 1 && a.scene[0]!.length === 1 && b.scene[0]!.length === 1;
        const scene = simple ? (sa === 'circle' && sb === 'circle' ? single({ kind: 'torus' }) : sa === 'point' ? b.scene : sb === 'point' ? a.scene : null) : null;
        return make(c, scene, pi1, a.cellGens && b.cellGens, productBoundary(a, b));
      }
      case '∧': {
        // X ∧ Y für zusammenhängende X, Y: π₁ = (π₁X × π₁Y) / ⟨⟨π₁X, π₁Y⟩⟩ = 1 (van Kampen)
        const c = smash(a.complex, b.complex);
        const simply = components(a.complex) === 1 && components(b.complex) === 1;
        return make(c, null, simply ? trivial() : null, false, null, simply ? undefined : 'Smash-Produkt unzusammenhängender Räume');
      }
    }
    throw new ParseError(`Unbekannter Operator ${op}`, t.pos, t.end);
  }

  function unionCells(a: Space, b: Space, wedged: boolean): Cells | null {
    if (!a.boundary || !b.boundary) return null;
    const n = Math.max(a.complex.cells.length, b.complex.cells.length);
    const out: Cells = [];
    for (let kk = 0; kk < n; kk++) {
      const na = a.complex.cells[kk] ?? 0;
      const fromA = a.boundary[kk] ?? [];
      let fromB = (b.boundary[kk] ?? []).map((i) => i + na);
      if (wedged && kk === 0) {
        // Basispunkt von Y fällt auf den von X; übrige 0-Zellen rücken um eins nach vorn
        fromB = (b.boundary[0] ?? []).map((i) => (i === 0 ? 0 : i + na - 1));
      }
      out.push([...new Set([...fromA, ...fromB])]);
    }
    return out;
  }

  function productBoundary(a: Space, b: Space): Cells | null {
    if (!a.boundary || !b.boundary) return null;
    const { complex: P, at } = productIndexed(a.complex, b.complex);
    const out: Cells = P.cells.map(() => []);
    a.complex.cells.forEach((na, i) =>
      b.complex.cells.forEach((nb, j) => {
        const inA = new Set(a.boundary![i] ?? []);
        const inB = new Set(b.boundary![j] ?? []);
        for (let x = 0; x < na; x++) for (let y = 0; y < nb; y++) if (inA.has(x) || inB.has(y)) out[i + j]!.push(at(i, x, j, y));
      }),
    );
    return out;
  }

  function attach(a: Space): Space {
    const cell = next();
    if (cell.t !== 'id' || cell.v !== 'e' || cell.n === null || cell.n < 1) {
      throw new ParseError('Zelle erwartet, z. B. e2(2)', cell.pos, cell.end);
    }
    const n = cell.n;
    const coeffs = isOp(peek(), '(') ? ints() : [];
    const c = wrap(cell, () => attachCell(a.complex, n, coeffs));
    let pi1: Presentation | null = null;
    let cellGens = false;
    if (n >= 3) {
      pi1 = a.pi1;
      cellGens = a.cellGens;
    } else if (n === 2 && a.pi1 && a.cellGens) {
      // Anheftung entlang a₁^{c₁} a₂^{c₂} ⋯
      const word = coeffs.flatMap((ci, i) => Array<number>(Math.abs(ci)).fill(Math.sign(ci) * (i + 1)));
      pi1 = { gens: a.pi1.gens, rels: [...a.pi1.rels, word] };
      cellGens = true;
    } else if (n === 1 && a.pi1 && a.complex.cells[0] === 1) {
      pi1 = freeProduct(a.pi1, cyclic(0, 'y'));
      cellGens = a.cellGens;
    }
    return make(c, null, pi1, cellGens, null, pi1 ? undefined : 'Anheftung an mehrere Ecken');
  }

  function quotient(a: Space): Space {
    const s = next();
    if (isOp(s, '∂')) {
      if (!a.boundary) throw new ParseError('Rand dieses Raums ist nicht bekannt', s.pos, s.end);
      if (!a.boundary.some((c) => c.length)) throw new ParseError('Der Raum hat keinen Rand', s.pos, s.end);
      if (!isSubcomplex(a.complex, a.boundary)) throw new ParseError('Interner Fehler: Rand ist kein Teilkomplex', s.pos, s.end);
      const c = quotientSub(a.complex, a.boundary);
      const scene = a.scene && a.scene.length === 1 && a.scene[0]!.length === 1 && a.scene[0]![0]!.kind === 'disk' ? single({ kind: 'sphere' }) : null;
      return make(c, scene, null, false, closed(c), 'Quotient nach dem Rand');
    }
    if (s.t !== 'id' || (s.v !== 'sk' && s.v !== 'skel')) throw new ParseError('Nach „/“: sk(k) für das k-Gerüst oder ∂ für den Rand', s.pos, s.end);
    let kk = s.n;
    if (kk === null) {
      const [v] = ints();
      kk = v ?? null;
    }
    if (kk === null || kk < 0) throw new ParseError('sk(k) mit k ≥ 0', s.pos, s.end);
    const c = quotientSkeleton(a.complex, kk);
    const g = surfaceGenus(a.scene);
    const pi1 = kk >= 1 ? trivial() : a.complex.cells[0] === 1 ? a.pi1 : null;
    return make(c, g !== null && kk === 1 ? single({ kind: 'sphere' }) : null, pi1, kk >= 1 || a.cellGens, null, 'Quotient nach dem 0-Gerüst');
  }

  const result = expr(0);
  const rest = peek();
  if (rest.t !== 'eof') throw new ParseError(isOp(rest, ')') ? 'Unerwartete „)“' : 'Unerwartetes Zeichen', rest.pos, rest.end);
  return result;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
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

/**
 * Blumenstrauß ohne falsche Schnittpunkte: Die Stücke zeigen strahlenförmig (waagrecht) vom Klebepunkt weg.
 * Kreise liegen in senkrechten Ebenen durch die gemeinsame y-Achse und berühren sie im Ursprung –
 * zwei solche Kreise treffen sich nur dort. Kugeln, Tori und Scheiben sitzen bei mehr als zwei Stücken
 * auf einem kurzen Stiel (zusammenziehbar, also homotopieäquivalent), weil sich zwei Kugeln durch
 * denselben Punkt sonst zwangsläufig überschneiden.
 */
export function layout(scene: Scene): { prims: Primitive[]; radius: number } {
  const prims: Primitive[] = [];
  let group = 0;
  const comps: { prims: Primitive[]; extent: number }[] = [];
  const Y: [number, number, number] = [0, 1, 0];
  for (const comp of scene) {
    const list: Primitive[] = [];
    const n = comp.length;
    let extent = 0.2;
    // Stiellänge: Nachbarkugeln (Radius 1) dürfen sich nicht berühren
    const fat = (p: Piece) => p.kind === 'sphere' || p.kind === 'torus' || p.kind === 'genus' || p.kind === 'disk';
    const needStalk = n > 2 && comp.some(fat);
    const stalk = needStalk ? Math.max(0.45, 1 / Math.sin(Math.PI / n) - 1 + 0.25) : 0;
    comp.forEach((p, i) => {
      // bei zwei Stücken genau gegenüber (dann berühren sie sich nur im Ursprung)
      const phi = (2 * Math.PI * i) / n + 0.3;
      const d: [number, number, number] = [Math.cos(phi), 0, Math.sin(phi)];
      const side = cross(d, Y); // Normale der senkrechten Ebene durch d und y
      const at = (s: number): [number, number, number] => [d[0] * s, 0, d[2] * s];
      const g = group++;
      const s0 = fat(p) ? stalk : 0;
      if (s0 > 0) list.push({ type: 5, center: [0, 0, 0], axis: d, group: g, R: 0.07, r: 0, len: s0 + 0.05 });
      switch (p.kind) {
        case 'point':
          list.push({ type: 0, center: [0, 0, 0], axis: Y, group: g, R: 0.1, r: 0, len: 0 });
          break;
        case 'points':
          list.push({ type: 0, center: [0, 0, 0], axis: Y, group: g, R: 0.1, r: 0, len: 0 });
          list.push({ type: 0, center: at(1.4), axis: Y, group: g, R: 0.1, r: 0, len: 0 });
          extent = Math.max(extent, 1.5);
          break;
        case 'sphere':
          list.push({ type: 1, center: at(s0 + 1), axis: Y, group: g, R: 1, r: 0, len: 0 });
          extent = Math.max(extent, s0 + 2);
          break;
        case 'circle':
          list.push({ type: 2, center: at(1), axis: side, group: g, R: 1, r: 0.055, len: 0 });
          extent = Math.max(extent, 2);
          break;
        case 'torus':
          list.push({ type: 3, center: at(s0 + 1.03), axis: side, group: g, R: 0.75, r: 0.28, len: 0 });
          extent = Math.max(extent, s0 + 2.1);
          break;
        case 'genus':
          for (let j = 0; j < p.genus; j++) {
            list.push({ type: 3, center: at(s0 + 1.03 + j * 1.6), axis: side, group: g, R: 0.75, r: 0.28, len: 0 });
          }
          extent = Math.max(extent, s0 + 1.03 + (p.genus - 1) * 1.6 + 1.05);
          break;
        case 'disk':
          list.push({ type: 4, center: at(s0 + 1), axis: side, group: g, R: 1, r: 0.03, len: 0 });
          extent = Math.max(extent, s0 + 2);
          break;
        case 'segment':
          list.push({ type: 5, center: [0, 0, 0], axis: d, group: g, R: 0.055, r: 0, len: 1.6 });
          extent = Math.max(extent, 1.6);
          break;
      }
    });
    // Klebepunkt markieren, wenn mehrere Stücke zusammenhängen
    if (n > 1) list.push({ type: 0, center: [0, 0, 0], axis: Y, group: 15, R: 0.12, r: 0, len: 0 });
    comps.push({ prims: list, extent });
  }
  // Komponenten entlang x anordnen
  const widths = comps.map((c) => 2 * c.extent + 0.6);
  let x = -widths.reduce((a, b) => a + b, 0) / 2;
  comps.forEach((c, i) => {
    const off = x + widths[i]! / 2;
    x += widths[i]!;
    for (const p of c.prims) prims.push({ ...p, center: [p.center[0] + off, p.center[1], p.center[2]] });
  });
  // Gesamtszene um die Mitte ihrer Ausdehnung zentrieren (Kamera dreht um den Ursprung)
  const ext = (p: Primitive, kk: number, s: number) =>
    p.center[kk]! + s * (p.type === 5 ? p.len * Math.abs(p.axis[kk]!) * (Math.sign(p.axis[kk]!) === s ? 1 : 0) : p.R + p.r);
  const mid = [0, 1, 2].map((kk) => (Math.min(...prims.map((p) => ext(p, kk, -1))) + Math.max(...prims.map((p) => ext(p, kk, 1)))) / 2);
  for (const p of prims) p.center = [p.center[0] - mid[0]!, p.center[1] - mid[1]!, p.center[2] - mid[2]!];
  const radius = Math.max(...prims.map((p) => Math.hypot(...p.center) + Math.max(p.R + p.r, p.len)), 1);
  return { prims: prims.slice(0, 16), radius };
}

