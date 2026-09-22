// Symbolisches Ableiten, Einsetzen und Vereinfachen reeller Ausdrücke.
//
// derivative(n, v) wendet die üblichen Regeln an (Summen-, Produkt-, Quotienten-, Kettenregel,
// allgemeine Potenz u^w = e^{w ln u}); stückweise Funktionen werden stückweise abgeleitet
// (|u|' = sign(u)·u', floor' = 0, if(c, a, b)' = if(c, a', b')). Integrale mit variablen Grenzen
// nach Leibniz: d/dx ∫_a^b f(t, x) dt = f(b)·b' − f(a)·a' + ∫_a^b ∂f/∂x dt.
import type { Node } from './parser';
import { usesVar } from './parser';

export class DiffError extends Error {}

const num = (value: number): Node => ({ type: 'num', value });
const ZERO = num(0);
const ONE = num(1);
const isNum = (n: Node, v?: number) => n.type === 'num' && (v === undefined || n.value === v);

// ---- Konstruktoren mit Vereinfachung ----

export function add(a: Node, b: Node): Node {
  if (isNum(a, 0)) return b;
  if (isNum(b, 0)) return a;
  if (a.type === 'num' && b.type === 'num') return num(a.value + b.value);
  if (b.type === 'neg') return sub(a, b.arg);
  return { type: 'bin', op: '+', left: a, right: b };
}
export function sub(a: Node, b: Node): Node {
  if (isNum(b, 0)) return a;
  if (isNum(a, 0)) return neg(b);
  if (a.type === 'num' && b.type === 'num') return num(a.value - b.value);
  if (b.type === 'neg') return add(a, b.arg);
  return { type: 'bin', op: '-', left: a, right: b };
}
export function neg(a: Node): Node {
  if (a.type === 'num') return num(-a.value);
  if (a.type === 'neg') return a.arg;
  return { type: 'neg', arg: a };
}
export function mul(a: Node, b: Node): Node {
  if (isNum(a, 0) || isNum(b, 0)) return ZERO;
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  if (isNum(a, -1)) return neg(b);
  if (isNum(b, -1)) return neg(a);
  if (a.type === 'num' && b.type === 'num') return num(a.value * b.value);
  if (a.type === 'neg') return neg(mul(a.arg, b));
  if (b.type === 'neg') return neg(mul(a, b.arg));
  // Zahlen nach vorn: x·3 → 3x, 2·(3x) → 6x
  if (b.type === 'num') return mul(b, a);
  if (a.type === 'num' && b.type === 'bin' && b.op === '*' && b.left.type === 'num') return mul(num(a.value * b.left.value), b.right);
  return { type: 'bin', op: '*', left: a, right: b };
}
export function div(a: Node, b: Node): Node {
  if (isNum(a, 0)) return ZERO;
  if (isNum(b, 1)) return a;
  if (a.type === 'num' && b.type === 'num' && b.value !== 0 && Number.isInteger(a.value / b.value)) return num(a.value / b.value);
  if (a.type === 'neg') return neg(div(a.arg, b));
  return { type: 'bin', op: '/', left: a, right: b };
}
export function pow(a: Node, b: Node): Node {
  if (isNum(b, 0)) return ONE;
  if (isNum(b, 1)) return a;
  if (a.type === 'num' && b.type === 'num' && Number.isInteger(b.value) && Math.abs(b.value) <= 8) return num(a.value ** b.value);
  return { type: 'bin', op: '^', left: a, right: b };
}
const call = (fn: string, arg: Node): Node => ({ type: 'call', fn, arg });
const fn = (name: string, ...args: Node[]): Node => ({ type: 'fn', fn: name, args });

// ---- Einsetzen ----

/** Ersetzt freie Vorkommen von Variable `v` durch `by` */
export function substitute(n: Node, v: string, by: Node): Node {
  const s = (m: Node) => substitute(m, v, by);
  switch (n.type) {
    case 'var': return n.name === v ? by : n;
    case 'num': case 'const': return n;
    case 'neg': return { type: 'neg', arg: s(n.arg) };
    case 'bin': return { ...n, left: s(n.left), right: s(n.right) };
    case 'call': return { ...n, arg: s(n.arg) };
    case 'user': return { ...n, arg: s(n.arg) };
    case 'fn': return { ...n, args: n.args.map(s) };
    case 'cmp': return { ...n, args: n.args.map(s) };
    case 'big':
      if (n.index === v) return { ...n, from: s(n.from), to: s(n.to) };
      if (usesVar(by, n.index)) {
        // Laufvariable umbenennen, damit sie nicht eingefangen wird
        const fresh = ['k', 'j', 'm', 'n', 's', 'u', 'w'].find((c) => !usesVar(by, c) && !usesVar(n.body, c)) ?? '_k';
        const body = substitute(n.body, n.index, { type: 'var', name: fresh });
        return { ...n, index: fresh, from: s(n.from), to: s(n.to), body: s(body) };
      }
      return { ...n, from: s(n.from), to: s(n.to), body: s(n.body) };
  }
}

// ---- Ableiten ----

/** Ableitung nach v (vereinfacht) */
export function derivative(n: Node, v: string): Node {
  if (!usesVar(n, v)) return ZERO;
  const d = (m: Node) => derivative(m, v);
  switch (n.type) {
    case 'num': case 'const': return ZERO;
    case 'var': return n.name === v ? ONE : ZERO;
    case 'neg': return neg(d(n.arg));
    case 'bin': {
      const { left: a, right: b } = n;
      switch (n.op) {
        case '+': return add(d(a), d(b));
        case '-': return sub(d(a), d(b));
        case '*': return add(mul(d(a), b), mul(a, d(b)));
        case '/':
          if (!usesVar(b, v)) return div(d(a), b);
          return div(sub(mul(d(a), b), mul(a, d(b))), pow(b, num(2)));
        case '^': {
          if (!usesVar(b, v)) {
            // (u^c)' = c·u^(c−1)·u'
            const c1 = b.type === 'num' ? num(b.value - 1) : sub(b, ONE);
            return mul(mul(b, pow(a, c1)), d(a));
          }
          if (a.type === 'const' && a.name === 'e') return mul(n, d(b));
          if (!usesVar(a, v)) return mul(mul(n, call('ln', a)), d(b));
          // u^w = e^{w ln u} → u^w · (w' ln u + w u'/u)
          return mul(n, add(mul(d(b), call('ln', a)), div(mul(b, d(a)), a)));
        }
      }
      break;
    }
    case 'call': {
      const u = n.arg;
      const du = d(u);
      const outer = callDerivative(n.fn, u, n);
      return mul(outer, du);
    }
    case 'fn': {
      const [a, b, c] = n.args as [Node, Node, Node | undefined];
      switch (n.fn) {
        case 'min': case 'max': {
          // stückweise: min(a, b)' = if(a < b, a', b')
          return n.args.reduce((acc, cur, i) => {
            if (i === 0) return acc;
            const prev = n.args.slice(0, i).reduce((l, r) => fn(n.fn, l, r));
            const cmp: Node = { type: 'cmp', ops: [n.fn === 'min' ? '<=' : '>='], args: [prev, cur] };
            return fn('if', cmp, acc, d(cur));
          }, d(n.args[0]!));
        }
        case 'mod': return sub(d(a), mul(d(b), call('floor', div(a, b))));
        case 'atan2': return div(sub(mul(b, d(a)), mul(a, d(b))), add(pow(a, num(2)), pow(b, num(2))));
        case 'root': return derivative(pow(a, div(ONE, b)), v);
        case 'hypot': return div(n.args.reduce<Node>((s, x) => add(s, mul(x, d(x))), ZERO), n);
        case 'clamp': {
          const inside: Node = { type: 'cmp', ops: ['<', '<'], args: [b, a, c!] };
          return fn('if', inside, d(a), fn('if', { type: 'cmp', ops: ['<='], args: [a, b] }, d(b), d(c!)));
        }
        case 'log': return derivative(div(call('ln', b), call('ln', a)), v);
        case 'if': return c ? fn('if', a, d(b), d(c)) : fn('if', a, d(b));
        case 'binom':
          throw new DiffError('binom lässt sich nicht symbolisch ableiten');
      }
      break;
    }
    case 'big': {
      if (n.op === 'sum') return { ...n, body: d(n.body) };
      if (n.op === 'int') {
        // Leibniz-Regel
        const at = (lim: Node) => substitute(n.body, n.index, lim);
        const inner: Node = usesVar(n.body, v) && n.index !== v ? { ...n, body: d(n.body) } : ZERO;
        return add(sub(mul(at(n.to), d(n.to)), mul(at(n.from), d(n.from))), inner);
      }
      // Produkt: (Π f_k)' = Π f_k · Σ f_k'/f_k
      return mul(n, { type: 'big', op: 'sum', index: n.index, from: n.from, to: n.to, body: div(d(n.body), n.body) });
    }
    case 'cmp':
      return ZERO;
    case 'user':
      throw new DiffError(`${n.name} muss vor dem Ableiten eingesetzt werden`);
  }
  throw new DiffError('Ableitung nicht möglich');
}

/** f'(u) für die eingebauten Funktionen (ohne innere Ableitung) */
function callDerivative(f: string, u: Node, whole: Node): Node {
  const two = num(2);
  const sq = (x: Node) => pow(x, two);
  switch (f) {
    case 'exp': return whole;
    case 'ln': case 'log': return div(ONE, u);
    case 'lg': return div(ONE, mul(call('ln', num(10)), u));
    case 'log2': return div(ONE, mul(call('ln', two), u));
    case 'sqrt': return div(ONE, mul(two, whole));
    case 'cbrt': return div(ONE, mul(num(3), sq(whole)));
    case 'sin': return call('cos', u);
    case 'cos': return neg(call('sin', u));
    case 'tan': return add(ONE, sq(whole));
    case 'cot': return neg(add(ONE, sq(whole)));
    case 'sec': return mul(whole, call('tan', u));
    case 'csc': return neg(mul(whole, call('cot', u)));
    case 'asin': return div(ONE, call('sqrt', sub(ONE, sq(u))));
    case 'acos': return neg(div(ONE, call('sqrt', sub(ONE, sq(u)))));
    case 'atan': return div(ONE, add(ONE, sq(u)));
    case 'acot': return neg(div(ONE, add(ONE, sq(u))));
    case 'sinh': return call('cosh', u);
    case 'cosh': return call('sinh', u);
    case 'tanh': return sub(ONE, sq(whole));
    case 'asinh': return div(ONE, call('sqrt', add(sq(u), ONE)));
    case 'acosh': return div(ONE, call('sqrt', sub(sq(u), ONE)));
    case 'atanh': return div(ONE, sub(ONE, sq(u)));
    case 'abs': return call('sign', u);
    case 'sign': case 'floor': case 'ceil': case 'round': return ZERO;
    case 'frac': return ONE;
    case 'erf': return mul(div(two, call('sqrt', { type: 'const', name: 'pi' })), { type: 'bin', op: '^', left: { type: 'const', name: 'e' }, right: neg(sq(u)) });
    case 'gamma': case 'fact':
      throw new DiffError(`${f === 'fact' ? 'Fakultät' : 'gamma'} lässt sich nicht symbolisch ableiten (Digamma fehlt)`);
  }
  throw new DiffError(`${f} lässt sich nicht ableiten`);
}

// ---- Benutzerdefinierte Funktionen einsetzen ----

export interface UserFunction {
  param: string;
  body: Node;
}

/**
 * Ersetzt f(u), f'(u), … durch den Rumpf (abgeleitet und mit eingesetztem Argument).
 * Rekursive Definitionen werden erkannt.
 */
export function inlineUser(n: Node, defs: ReadonlyMap<string, UserFunction>, stack: string[] = []): Node {
  const r = (m: Node) => inlineUser(m, defs, stack);
  switch (n.type) {
    case 'user': {
      const def = defs.get(n.name);
      if (!def) throw new DiffError(`${n.name} ist nicht definiert – z. B. ${n.name}(x) = x^2 als eigene Zeile`);
      if (stack.includes(n.name)) throw new DiffError(`${n.name} ist rekursiv definiert (${[...stack, n.name].join(' → ')})`);
      let body = inlineUser(def.body, defs, [...stack, n.name]);
      for (let i = 0; i < n.order; i++) body = derivative(body, def.param);
      return substitute(body, def.param, r(n.arg));
    }
    case 'num': case 'const': case 'var': return n;
    case 'neg': return { type: 'neg', arg: r(n.arg) };
    case 'bin': return { ...n, left: r(n.left), right: r(n.right) };
    case 'call': return { ...n, arg: r(n.arg) };
    case 'fn': return { ...n, args: n.args.map(r) };
    case 'cmp': return { ...n, args: n.args.map(r) };
    case 'big': return { ...n, from: r(n.from), to: r(n.to), body: r(n.body) };
  }
}

/** Kommt ein Summen-/Integralknoten vor? (dann nicht im Shader auswertbar) */
export function hasBig(n: Node): boolean {
  switch (n.type) {
    case 'big': return true;
    case 'neg': case 'call': case 'user': return hasBig(n.arg);
    case 'bin': return hasBig(n.left) || hasBig(n.right);
    case 'fn': case 'cmp': return n.args.some(hasBig);
    default: return false;
  }
}

/** Lesbare Formel (minimale Klammern) für Anzeigen wie f'(x) = … */
export function pretty(n: Node): string {
  const prec = (m: Node): number =>
    m.type === 'bin' ? (m.op === '+' || m.op === '-' ? 1 : m.op === '^' ? 4 : 2) : m.type === 'neg' ? 3 : 5;
  const wrap = (m: Node, min: number) => (prec(m) < min ? `(${pretty(m)})` : pretty(m));
  switch (n.type) {
    case 'num': return String(+n.value.toPrecision(12));
    case 'var': return n.name;
    case 'const': return n.name === 'pi' ? 'π' : n.name;
    case 'neg': return `−${wrap(n.arg, 3)}`;
    case 'bin': {
      if (n.op === '+') return `${pretty(n.left)} + ${wrap(n.right, 2)}`;
      if (n.op === '-') return `${pretty(n.left)} − ${wrap(n.right, 2)}`;
      if (n.op === '*') {
        const l = wrap(n.left, 2);
        const r = wrap(n.right, 3);
        const implicit = n.left.type === 'num' && n.right.type !== 'num';
        return implicit ? `${l}${/^[\d.]/.test(r) ? '·' : ''}${r}` : `${l}·${r}`;
      }
      if (n.op === '/') return `${wrap(n.left, 2)}/${wrap(n.right, 3)}`;
      return `${wrap(n.left, 5)}^${wrap(n.right, 5)}`;
    }
    case 'call': return `${n.fn === 'fact' ? '' : n.fn}(${pretty(n.arg)})${n.fn === 'fact' ? '!' : ''}`;
    case 'fn': return `${n.fn}(${n.args.map(pretty).join(', ')})`;
    case 'cmp': return n.args.map((a, i) => (i ? ` ${n.ops[i - 1]!.replace('<=', '≤').replace('>=', '≥')} ` : '') + pretty(a)).join('');
    case 'user': return `${n.name}${'′'.repeat(n.order)}(${pretty(n.arg)})`;
    case 'big': return `${n.op}(${n.index} = ${pretty(n.from)}, ${pretty(n.to)}, ${pretty(n.body)})`;
  }
}
