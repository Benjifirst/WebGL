// Reelle Ausdrücke: GLSL-Codegen (float) und TS-Auswertung mit identischer Semantik.
//
// Zwei Modi:
//   nachsichtig (Standard, 3D-Flächen): jede Funktion ist überall definiert, damit Distanzschätzer
//     und Raymarching robust bleiben –
//       x^n (n ganz, |n| ≤ 64) → pown(x, n) exakt;  x^y sonst → sign(x)·|x|^y (ungerade Fortsetzung)
//       log/ln x → ln|x|;  sqrt x → √max(x, 0);  asin/acos → Argument auf [−1, 1] begrenzt
//   streng (Graphen): mathematische Definitionsbereiche, außerhalb NaN (die Kurve setzt dort aus) –
//       sqrt(x < 0), ln(x ≤ 0), asin(|x| > 1) … = NaN;
//       x^(p/q) für x < 0 nur bei ungeradem Nenner q (dann (−1)^p·|x|^(p/q)), sonst NaN.
//
// Sonderfunktionen: gamma (TS: Stirling-Reihe, GLSL: Lanczos), fact(x) = Γ(x+1) (ganze x ≤ 170 exakt), erf,
// binom(n, k), sum/prod (ganzzahlige Grenzen, höchstens 10⁵ Glieder), int (Tanh-Sinh-Quadratur).
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
float nan_() { return intBitsToFloat(0x7fc00000); }
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
// streng: negative Basis nur bei Exponent p/q mit ungeradem q
float spow(float a, float b) {
  if (a > 0.0) return pow(a, b);
  if (a == 0.0) return b > 0.0 ? 0.0 : b == 0.0 ? 1.0 : nan_();
  for (int q = 1; q < 64; q += 2) {
    float p = b * float(q);
    if (abs(p - round(p)) < 1e-4 * float(q)) return (mod(round(p), 2.0) == 0.0 ? 1.0 : -1.0) * pow(-a, b);
  }
  return nan_();
}
float ssqrt(float a) { return a < 0.0 ? nan_() : sqrt(a); }
float slog(float a) { return a < 0.0 ? nan_() : log(a); }
float sq_(float a) { return a * a; }
float fmod_(float a, float b) { return a - b * floor(a / b); }
float frac_(float a) { return a - floor(a); }
float rootn(float a, float n, bool strict) {
  if (a >= 0.0) return pow(a, 1.0 / n);
  bool odd = mod(n, 2.0) == 1.0;
  return odd || !strict ? -pow(-a, 1.0 / n) : nan_();
}
float gamma_(float x) {
  // Lanczos (g = 7, n = 9) mit Spiegelung Γ(x)Γ(1−x) = π / sin(πx)
  float s = 1.0;
  if (x < 0.5) {
    if (x == floor(x)) return nan_();
    s = 3.14159265 / sin(3.14159265 * x);
    x = 1.0 - x;
  }
  x -= 1.0;
  float a = 0.99999999999980993;
  a += 676.5203681218851 / (x + 1.0);
  a += -1259.1392167224028 / (x + 2.0);
  a += 771.32342877765313 / (x + 3.0);
  a += -176.61503916999185 / (x + 4.0);
  a += 12.507343278686905 / (x + 5.0);
  a += -0.13857109526572012 / (x + 6.0);
  a += 9.9843695780195716e-6 / (x + 7.0);
  a += 1.5056327351493116e-7 / (x + 8.0);
  float t = x + 7.5;
  float g = 2.5066282746310002 * pow(t, x + 0.5) * exp(-t) * a;
  return s == 1.0 ? g : s / g;
}
float erf_(float x) {
  // Abramowitz–Stegun 7.1.26 (Fehler < 1.5e-7)
  float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return sign(x) * y;
}
`;

// ---------------------------------------------------------------------------
// GLSL-Codegen

type Gen = (a: string) => string;
const LENIENT: Record<string, Gen> = {
  exp: (a) => `exp(${a})`,
  log: (a) => `log(abs(${a}))`,
  ln: (a) => `log(abs(${a}))`,
  lg: (a) => `(log(abs(${a})) * 0.4342944819)`,
  log2: (a) => `log2(abs(${a}))`,
  sqrt: (a) => `sqrt(max(${a}, 0.0))`,
  cbrt: (a) => `rpow(${a}, 0.3333333333)`,
  sin: (a) => `sin(${a})`,
  cos: (a) => `cos(${a})`,
  tan: (a) => `tan(${a})`,
  cot: (a) => `(1.0 / tan(${a}))`,
  sec: (a) => `(1.0 / cos(${a}))`,
  csc: (a) => `(1.0 / sin(${a}))`,
  asin: (a) => `asin(clamp(${a}, -1.0, 1.0))`,
  acos: (a) => `acos(clamp(${a}, -1.0, 1.0))`,
  atan: (a) => `atan(${a})`,
  acot: (a) => `(1.5707963268 - atan(${a}))`,
  sinh: (a) => `sinh(${a})`,
  cosh: (a) => `cosh(${a})`,
  tanh: (a) => `tanh(${a})`,
  asinh: (a) => `asinh(${a})`,
  acosh: (a) => `acosh(max(${a}, 1.0))`,
  atanh: (a) => `atanh(clamp(${a}, -0.9999999, 0.9999999))`,
  abs: (a) => `abs(${a})`,
  sign: (a) => `sign(${a})`,
  floor: (a) => `floor(${a})`,
  ceil: (a) => `ceil(${a})`,
  round: (a) => `floor(${a} + 0.5)`,
  frac: (a) => `frac_(${a})`,
  gamma: (a) => `gamma_(${a})`,
  fact: (a) => `gamma_(${a} + 1.0)`,
  erf: (a) => `erf_(${a})`,
};
const STRICT: Record<string, Gen> = {
  ...LENIENT,
  log: (a) => `slog(${a})`,
  ln: (a) => `slog(${a})`,
  lg: (a) => `(slog(${a}) * 0.4342944819)`,
  log2: (a) => `(slog(${a}) * 1.4426950409)`,
  sqrt: (a) => `ssqrt(${a})`,
  asin: (a) => `asin(${a})`,
  acos: (a) => `acos(${a})`,
  acosh: (a) => `acosh(${a})`,
  atanh: (a) => `atanh(${a})`,
  cbrt: (a) => `rootn(${a}, 3.0, true)`,
};

/** AST → GLSL-float-Ausdruck; `vars` bildet Variablennamen auf GLSL-Ausdrücke ab. */
export function codegenReal(n: Node, vars: Record<string, string>, strict = false): string {
  const g = (m: Node) => codegenReal(m, vars, strict);
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
      return `(-${g(n.arg)})`;
    case 'call': {
      const f = (strict ? STRICT : LENIENT)[n.fn];
      if (!f) throw new Error(`${n.fn} ist nicht reell`);
      return f(g(n.arg));
    }
    case 'fn': {
      const a = n.args.map(g);
      switch (n.fn) {
        case 'min': case 'max': return a.reduce((l, r) => `${n.fn}(${l}, ${r})`);
        case 'mod': return `fmod_(${a[0]}, ${a[1]})`;
        case 'atan2': return `atan(${a[0]}, ${a[1]})`;
        case 'root': return `rootn(${a[0]}, ${a[1]}, ${strict})`;
        case 'hypot': return `sqrt(${a.map((x) => `sq_(${x})`).join(' + ')})`;
        case 'clamp': return `clamp(${a[0]}, ${a[1]}, ${a[2]})`;
        case 'binom': return `floor(gamma_(${a[0]} + 1.0) / (gamma_(${a[1]} + 1.0) * gamma_(${a[0]} - ${a[1]} + 1.0)) + 0.5)`;
        case 'log': return strict ? `(slog(${a[1]}) / slog(${a[0]}))` : `(log(abs(${a[1]})) / log(abs(${a[0]})))`;
        case 'if': return `(${a[0]} ? ${a[1]} : ${a[2] ?? 'nan_()'})`;
      }
      throw new Error(`${n.fn} ist nicht reell`);
    }
    case 'cmp': {
      const glslOp = (op: string) => (op === '=' ? '==' : op);
      const parts = n.ops.map((op, i) => `(${g(n.args[i]!)} ${glslOp(op)} ${g(n.args[i + 1]!)})`);
      return `(${parts.join(' && ')})`;
    }
    case 'user':
      throw new Error(`${n.name}(…) muss vor dem Codegen eingesetzt werden`);
    case 'big':
      throw new Error(`${n.op}(…) ist nur für Kurven y = f(x), nicht für implizite Gleichungen möglich`);
    case 'bin': {
      if (n.op === '^') {
        const k = integerExponent(n.right);
        if (k !== null) return `pown(${g(n.left)}, ${k})`;
        if (n.left.type === 'const' && n.left.name === 'e') return `exp(${g(n.right)})`;
        return `${strict ? 'spow' : 'rpow'}(${g(n.left)}, ${g(n.right)})`;
      }
      return `(${g(n.left)} ${n.op} ${g(n.right)})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Auswertung in double (als Closure-Baum kompiliert – schnell genug für tausende Abtastpunkte)

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

/** Streng: a^b für a < 0 nur bei b = p/q mit ungeradem q */
export function strictPow(a: number, b: number): number {
  if (a > 0) return a ** b;
  if (a === 0) return b > 0 ? 0 : b === 0 ? 1 : Infinity;
  if (Number.isInteger(b)) return a ** b;
  for (let q = 1; q < 64; q += 2) {
    const p = b * q;
    if (Math.abs(p - Math.round(p)) < 1e-9 * q) return (Math.round(p) % 2 === 0 ? 1 : -1) * (-a) ** b;
  }
  return NaN;
}

/** Γ(x): ganze Zahlen exakt, sonst Stirling-Reihe (nach Verschieben auf x ≥ 15) mit Spiegelung */
export function gamma(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN; // Polstellen
    if (x <= 171) {
      let r = 1;
      for (let k = 2; k < x; k++) r *= k;
      return r;
    }
    return Infinity;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (x > 171.7) return Infinity;
  // Γ(x) = Γ(x + n) / (x (x+1) … (x+n−1))
  let shift = 1;
  while (x < 15) shift *= x++;
  const inv = 1 / x;
  const inv2 = inv * inv;
  // ln Γ(x) = (x − ½) ln x − x + ½ ln 2π + Σ B₂ₖ / (2k(2k−1) x^{2k−1})
  const series = inv * (1 / 12 + inv2 * (-1 / 360 + inv2 * (1 / 1260 + inv2 * (-1 / 1680 + inv2 * (1 / 1188 + inv2 * (-691 / 360360 + inv2 / 156))))));
  const lg = (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + series;
  return Math.exp(lg) / shift;
}

/** Fehlerfunktion: Taylorreihe für |x| < 3, Kettenbruch für erfc sonst (≈ 1e-14) */
export function erf(x: number): number {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? NaN : Math.sign(x);
  const ax = Math.abs(x);
  if (ax < 3) {
    let term = x;
    let sum = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  // erfc(x) = e^{−x²}/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + …)))))
  let f = ax;
  for (let n = 60; n >= 1; n--) f = ax + n / 2 / f;
  const erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / f;
  return Math.sign(x) * (1 - erfc);
}

export function binom(n: number, k: number): number {
  if (Number.isInteger(n) && Number.isInteger(k)) {
    if (k < 0 || (n >= 0 && k > n)) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }
  return gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1));
}

function rootN(a: number, n: number, strict: boolean): number {
  if (a >= 0) return a ** (1 / n);
  const odd = Number.isInteger(n) && Math.abs(n % 2) === 1;
  return odd || !strict ? -((-a) ** (1 / n)) : NaN;
}

/**
 * Tanh-Sinh-Quadratur (doppelt exponentielle Substitution t = tanh(π/2·sinh u)):
 * konvergiert sehr schnell für glatte Integranden und verträgt Singularitäten an den Rändern
 * (z. B. 1/√t bei 0), weil die Knoten dort nie ausgewertet werden. Die Schrittweite wird halbiert,
 * bis sich der Wert kaum noch ändert.
 */
export function integrate(f: (t: number) => number, a: number, b: number, tol = 1e-12): number {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const r = (b - a) / 2;
  const term = (u: number): number => {
    const s = (Math.PI / 2) * Math.sinh(u);
    const ch = Math.cosh(s);
    const w = ((Math.PI / 2) * Math.cosh(u)) / (ch * ch);
    // 1 − tanh(s) ohne Auslöschung
    const e = Math.exp(-2 * Math.abs(s));
    const off = (2 * e) / (1 + e); // = 1 − |tanh s|
    if (off === 0 || w < 1e-300) return 0;
    const x = u < 0 ? a + r * off : b - r * off;
    const v = f(x);
    return Number.isFinite(v) ? v * w : NaN;
  };
  const U = 4.5; // genügt auch für integrierbare Randsingularitäten wie 1/√t
  let h = 0.5;
  let sum = term(0);
  for (let u = h; u <= U; u += h) sum += term(u) + term(-u);
  let prev = sum * h;
  for (let level = 0; level < 8; level++) {
    h /= 2;
    // nur die neuen (ungeraden) Knoten auswerten
    for (let u = h; u <= U; u += 2 * h) sum += term(u) + term(-u);
    const cur = sum * h;
    if (Number.isNaN(cur)) return NaN;
    if (Math.abs(cur - prev) <= tol * Math.max(1, Math.abs(cur))) return cur * r;
    prev = cur;
  }
  return prev * r;
}

export type Env = Record<string, number>;
export type Compiled = (env: Env) => number;

const UNARY_STRICT: Record<string, (a: number) => number> = {
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  lg: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (a) => 1 / Math.tan(a),
  sec: (a) => 1 / Math.cos(a),
  csc: (a) => 1 / Math.sin(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  acot: (a) => Math.PI / 2 - Math.atan(a),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (a) => Math.floor(a + 0.5),
  frac: (a) => a - Math.floor(a),
  gamma,
  fact: (a) => gamma(a + 1),
  erf,
};
const UNARY_LENIENT: Record<string, (a: number) => number> = {
  ...UNARY_STRICT,
  log: (a) => Math.log(Math.abs(a)),
  ln: (a) => Math.log(Math.abs(a)),
  lg: (a) => Math.log10(Math.abs(a)),
  log2: (a) => Math.log2(Math.abs(a)),
  sqrt: (a) => Math.sqrt(Math.max(a, 0)),
  asin: (a) => Math.asin(Math.max(-1, Math.min(1, a))),
  acos: (a) => Math.acos(Math.max(-1, Math.min(1, a))),
  acosh: (a) => Math.acosh(Math.max(a, 1)),
  atanh: (a) => Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, a))),
};

const MAX_TERMS = 100000;

/** Kompiliert einen Ausdruck zu einer schnellen Funktion der Umgebung. */
export function compileReal(n: Node, strict = false): Compiled {
  const c = (m: Node) => compileReal(m, strict);
  switch (n.type) {
    case 'num': {
      const v = n.value;
      return () => v;
    }
    case 'var': {
      const name = n.name;
      return (env) => env[name] ?? NaN;
    }
    case 'const': {
      const v = n.name === 'pi' ? Math.PI : n.name === 'e' ? Math.E : NaN;
      return () => v;
    }
    case 'neg': {
      const a = c(n.arg);
      return (env) => -a(env);
    }
    case 'call': {
      const f = (strict ? UNARY_STRICT : UNARY_LENIENT)[n.fn];
      const a = c(n.arg);
      if (!f) return () => NaN;
      return (env) => f(a(env));
    }
    case 'fn': {
      const a = n.args.map(c);
      const [p, q, r] = a;
      switch (n.fn) {
        case 'min': return (env) => Math.min(...a.map((f) => f(env)));
        case 'max': return (env) => Math.max(...a.map((f) => f(env)));
        case 'mod': return (env) => {
          const x = p!(env), m = q!(env);
          return x - m * Math.floor(x / m);
        };
        case 'atan2': return (env) => Math.atan2(p!(env), q!(env));
        case 'root': return (env) => rootN(p!(env), q!(env), strict);
        case 'hypot': return (env) => Math.hypot(...a.map((f) => f(env)));
        case 'clamp': return (env) => Math.min(Math.max(p!(env), q!(env)), r!(env));
        case 'binom': return (env) => binom(p!(env), q!(env));
        case 'log': return strict
          ? (env) => Math.log(q!(env)) / Math.log(p!(env))
          : (env) => Math.log(Math.abs(q!(env))) / Math.log(Math.abs(p!(env)));
        case 'if': return r ? (env) => (p!(env) ? q!(env) : r(env)) : (env) => (p!(env) ? q!(env) : NaN);
      }
      return () => NaN;
    }
    case 'cmp': {
      const a = n.args.map(c);
      const ops = n.ops;
      return (env) => {
        let prev = a[0]!(env);
        for (let i = 0; i < ops.length; i++) {
          const cur = a[i + 1]!(env);
          const ok = ops[i] === '<' ? prev < cur : ops[i] === '>' ? prev > cur : ops[i] === '<=' ? prev <= cur : ops[i] === '>=' ? prev >= cur : prev === cur;
          if (!ok) return 0;
          prev = cur;
        }
        return 1;
      };
    }
    case 'user':
      return () => NaN;
    case 'big': {
      const from = c(n.from);
      const to = c(n.to);
      const body = c(n.body);
      const idx = n.index;
      if (n.op === 'int') {
        return (env) => {
          const a = from(env), b = to(env);
          const saved = env[idx];
          const local = { ...env };
          const v = integrate((t) => ((local[idx] = t), body(local)), a, b);
          if (saved !== undefined) env[idx] = saved;
          return v;
        };
      }
      const isSum = n.op === 'sum';
      return (env) => {
        const a = Math.ceil(from(env) - 1e-9), b = Math.floor(to(env) + 1e-9);
        if (!Number.isFinite(a) || !Number.isFinite(b) || b - a > MAX_TERMS) return NaN;
        const saved = env[idx];
        let acc = isSum ? 0 : 1;
        for (let k = a; k <= b; k++) {
          env[idx] = k;
          const v = body(env);
          acc = isSum ? acc + v : acc * v;
        }
        if (saved === undefined) delete env[idx];
        else env[idx] = saved;
        return acc;
      };
    }
    case 'bin': {
      if (n.op === '^') {
        const k = integerExponent(n.right);
        const base = c(n.left);
        if (k !== null) return (env) => pown(base(env), k);
        const ex = c(n.right);
        if (n.left.type === 'const' && n.left.name === 'e') return (env) => Math.exp(ex(env));
        return strict
          ? (env) => strictPow(base(env), ex(env))
          : (env) => {
              const a = base(env);
              return Math.sign(a) * Math.abs(a) ** ex(env);
            };
      }
      const a = c(n.left);
      const b = c(n.right);
      switch (n.op) {
        case '+': return (env) => a(env) + b(env);
        case '-': return (env) => a(env) - b(env);
        case '*': return (env) => a(env) * b(env);
        case '/': return (env) => a(env) / b(env);
      }
    }
  }
}

/** Einmalige Auswertung (für viele Auswertungen compileReal verwenden) */
export function evaluateReal(n: Node, env: Env, strict = false): number {
  return compileReal(n, strict)({ ...env });
}
