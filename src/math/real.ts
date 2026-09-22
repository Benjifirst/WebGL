// Reelle Ausdrücke: GLSL-Codegen (float) und TS-Referenzauswertung mit identischer Semantik.
//   x^n (n ganz, |n| ≤ 64)  → pown(x, n)          (exakt, auch für x < 0)
//   x^y sonst               → sign(x)·|x|^y        (ungerade Fortsetzung, z. B. x^(1/3) für x < 0)
//   e^y                     → exp(y)
//   log/ln x                → ln|x|                (auf ganz ℝ\{0} definiert)
//   sqrt x                  → √max(x, 0)
import type { Node } from './parser';

/** Float-Literal, das GLSL ES 3.00 sicher als float liest. */
export function glslFloat(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Nicht darstellbare Zahl: ${v}`);
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Kleiner ganzzahliger Exponent (auch negativ) → Potenz per Multiplikation. */
export function integerExponent(n: Node): number | null {
  const v = n.type === 'num' ? n.value : n.type === 'neg' && n.arg.type === 'num' ? -n.arg.value : NaN;
  return Number.isInteger(v) && Math.abs(v) <= 64 ? v : null;
}

/** GLSL-Hilfsfunktionen, die der erzeugte Code voraussetzt. */
export const REAL_GLSL_HELPERS = `
float pown(float a, int n) {
  float b = n < 0 ? 1.0 / a : a;
  int m = abs(n);
  float r = 1.0;
  while (m > 0) {
    if ((m & 1) == 1) r *= b;
    b *= b;
    m >>= 1;
  }
  return r;
}
float rpow(float a, float b) { return sign(a) * pow(abs(a), b); }
`;

const CALLS: Partial<Record<string, (a: string) => string>> = {
  exp: (a) => `exp(${a})`,
  log: (a) => `log(abs(${a}))`,
  ln: (a) => `log(abs(${a}))`,
  sqrt: (a) => `sqrt(max(${a}, 0.0))`,
  sin: (a) => `sin(${a})`,
  cos: (a) => `cos(${a})`,
  tan: (a) => `tan(${a})`,
  sinh: (a) => `sinh(${a})`,
  cosh: (a) => `cosh(${a})`,
  tanh: (a) => `tanh(${a})`,
  abs: (a) => `abs(${a})`,
};

/** AST → GLSL-float-Ausdruck; `vars` bildet Variablennamen auf GLSL-Ausdrücke ab. */
export function codegenReal(n: Node, vars: Record<string, string>): string {
  switch (n.type) {
    case 'num':
      return glslFloat(n.value);
    case 'var': {
      const v = vars[n.name];
      if (v === undefined) throw new Error(`Variable ${n.name} nicht zugeordnet`);
      return v;
    }
    case 'const':
      if (n.name === 'i') throw new Error('i ist nicht reell');
      return glslFloat(n.name === 'pi' ? Math.PI : Math.E);
    case 'neg':
      return `(-${codegenReal(n.arg, vars)})`;
    case 'call': {
      const f = CALLS[n.fn];
      if (!f) throw new Error(`${n.fn} ist nicht reell`);
      return f(codegenReal(n.arg, vars));
    }
    case 'bin': {
      if (n.op === '^') {
        const k = integerExponent(n.right);
        if (k !== null) return `pown(${codegenReal(n.left, vars)}, ${k})`;
        if (n.left.type === 'const' && n.left.name === 'e') return `exp(${codegenReal(n.right, vars)})`;
        return `rpow(${codegenReal(n.left, vars)}, ${codegenReal(n.right, vars)})`;
      }
      return `(${codegenReal(n.left, vars)} ${n.op} ${codegenReal(n.right, vars)})`;
    }
  }
}

function pown(a: number, n: number): number {
  let b = n < 0 ? 1 / a : a;
  let m = Math.abs(n);
  let r = 1;
  while (m > 0) {
    if (m & 1) r *= b;
    b *= b;
    m >>= 1;
  }
  return r;
}

/** Referenzauswertung in double, Semantik wie codegenReal. */
export function evaluateReal(n: Node, env: Record<string, number>): number {
  switch (n.type) {
    case 'num': return n.value;
    case 'var': return env[n.name] ?? NaN;
    case 'const': return n.name === 'pi' ? Math.PI : n.name === 'e' ? Math.E : NaN;
    case 'neg': return -evaluateReal(n.arg, env);
    case 'call': {
      const a = evaluateReal(n.arg, env);
      switch (n.fn) {
        case 'exp': return Math.exp(a);
        case 'log': case 'ln': return Math.log(Math.abs(a));
        case 'sqrt': return Math.sqrt(Math.max(a, 0));
        case 'sin': return Math.sin(a);
        case 'cos': return Math.cos(a);
        case 'tan': return Math.tan(a);
        case 'sinh': return Math.sinh(a);
        case 'cosh': return Math.cosh(a);
        case 'tanh': return Math.tanh(a);
        case 'abs': return Math.abs(a);
        default: return NaN;
      }
    }
    case 'bin': {
      if (n.op === '^') {
        const k = integerExponent(n.right);
        if (k !== null) return pown(evaluateReal(n.left, env), k);
        if (n.left.type === 'const' && n.left.name === 'e') return Math.exp(evaluateReal(n.right, env));
        const a = evaluateReal(n.left, env);
        return Math.sign(a) * Math.abs(a) ** evaluateReal(n.right, env);
      }
      const a = evaluateReal(n.left, env);
      const b = evaluateReal(n.right, env);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
      }
    }
  }
}
