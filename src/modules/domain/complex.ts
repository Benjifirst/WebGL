// Komplexe Arithmetik in TS (double) – Spiegel der GLSL-Funktionen in domain.frag.
// Dient als Referenz für Tests und für die f(z)-Anzeige unter dem Cursor.
import type { Node } from '../../math/parser';
import { integerExponent } from '../../math/real';

export type C = readonly [number, number];

export const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export function div(a: C, b: C): C {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}
export const abs = (a: C) => Math.hypot(a[0], a[1]);
export const arg = (a: C) => Math.atan2(a[1], a[0]);
// exp(x+iy) = eˣ(cos y + i sin y)
export const exp = (a: C): C => [Math.exp(a[0]) * Math.cos(a[1]), Math.exp(a[0]) * Math.sin(a[1])];
// Hauptzweig: log z = ln|z| + i·arg z, arg ∈ (−π, π]
export const log = (a: C): C => [Math.log(abs(a)), arg(a)];
// a^b = exp(b·log a), 0^b = 0
export const pow = (a: C, b: C): C => (a[0] === 0 && a[1] === 0 ? [0, 0] : exp(mul(b, log(a))));
// Hauptzweig der Wurzel: √z = √|z| · e^{i·arg(z)/2}
export function sqrt(a: C): C {
  const r = Math.sqrt(abs(a));
  const t = arg(a) / 2;
  return [r * Math.cos(t), r * Math.sin(t)];
}
// sin(x+iy) = sin x cosh y + i cos x sinh y
export const sin = (a: C): C => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
// cos(x+iy) = cos x cosh y − i sin x sinh y
export const cos = (a: C): C => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
// sinh z = −i sin(iz), cosh z = cos(iz)
export const sinh = (a: C): C => [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])];
export const cosh = (a: C): C => [Math.cosh(a[0]) * Math.cos(a[1]), Math.sinh(a[0]) * Math.sin(a[1])];

/** Ganzzahlige Potenz durch wiederholtes Quadrieren (genauer als exp·log). */
export function powi(a: C, n: number): C {
  let base: C = n < 0 ? div([1, 0], a) : a;
  let m = Math.abs(n);
  let r: C = [1, 0];
  while (m > 0) {
    if (m & 1) r = mul(r, base);
    base = mul(base, base);
    m >>= 1;
  }
  return r;
}

/** Wertet den AST an der Stelle z aus – exakt dieselbe Semantik wie der GLSL-Codegen. */
export function evaluate(n: Node, z: C): C {
  switch (n.type) {
    case 'num': return [n.value, 0];
    case 'var': return z;
    case 'const': return n.name === 'i' ? [0, 1] : n.name === 'pi' ? [Math.PI, 0] : [Math.E, 0];
    case 'neg': { const a = evaluate(n.arg, z); return [-a[0], -a[1]]; }
    case 'bin': {
      if (n.op === '^') {
        const k = integerExponent(n.right);
        if (k !== null) return powi(evaluate(n.left, z), k);
        if (n.left.type === 'const' && n.left.name === 'e') return exp(evaluate(n.right, z));
      }
      const a = evaluate(n.left, z);
      const b = evaluate(n.right, z);
      switch (n.op) {
        case '+': return add(a, b);
        case '-': return sub(a, b);
        case '*': return mul(a, b);
        case '/': return div(a, b);
        case '^': return pow(a, b);
      }
    }
    case 'call': {
      const a = evaluate(n.arg, z);
      switch (n.fn) {
        case 'exp': return exp(a);
        case 'log': case 'ln': return log(a);
        case 'sqrt': return sqrt(a);
        case 'sin': return sin(a);
        case 'cos': return cos(a);
        case 'tan': return div(sin(a), cos(a));
        case 'sinh': return sinh(a);
        case 'cosh': return cosh(a);
        case 'tanh': return div(sinh(a), cosh(a));
        case 'conj': return [a[0], -a[1]];
        case 'abs': return [abs(a), 0];
        case 're': return [a[0], 0];
        case 'im': return [a[1], 0];
      }
    }
  }
}
