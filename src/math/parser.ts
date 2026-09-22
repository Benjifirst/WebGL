// Ausdrucksparser: Tokenizer → Recursive Descent → AST.
// Konfigurierbar für komplexe (f(z)) und reelle Ausdrücke (F(x,y,z), x(u,v) …).
//
// Grammatik (niedrigste Bindung zuerst):
//   equation := expr ('=' expr)?               // nur falls erlaubt: a = b  ↦  a − b
//   expr     := term (('+' | '-') term)*
//   term     := unary (('*' | '/') unary | ⟨implizit⟩ power)*
//   unary    := ('-' | '+') unary | power
//   power    := postfix ('^' unary)?           // rechtsassoziativ: a^b^c = a^(b^c)
//   postfix  := primary '!'*                   // Fakultät (nur erweitert)
//   primary  := Zahl | Variable | Konstante | Funktion '(' expr ')' | '(' expr ')' | '|' expr '|'
//
// Implizite Multiplikation (2z, 3(z+1), z(z−1), 2 sin(z), xy) bindet wie '*'.
// Daher gilt −z^2 = −(z^2) und 2z^2 = 2·(z^2).
//
// Erweiterter Modus (Graphen): |x|, x!, sin x und sin^2(x), mehrstellige Funktionen (min, max, mod,
// atan2, root, hypot, clamp, binom, if), Vergleiche in if(…) mit Ketten (0 < x < 1),
// sum/prod/int(k = a, b, Rumpf), benutzerdefinierte Funktionen f(…), f'(…), f''(…) und
// automatische Parameter (unbekannte Einzelbuchstaben werden zu Variablen).

/** Funktionen des komplexen Moduls (f(z)) */
export const COMPLEX_FUNCTIONS = [
  'exp', 'log', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'conj', 'abs', 're', 'im',
] as const;
export type ComplexFunction = (typeof COMPLEX_FUNCTIONS)[number];

/** Einstellige reelle Funktionen (Aliasse werden beim Parsen auf den Hauptnamen abgebildet) */
export const REAL_FUNCTIONS = [
  'exp', 'log', 'ln', 'lg', 'log2', 'sqrt', 'cbrt',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'acot',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'abs', 'sign', 'floor', 'ceil', 'round', 'frac', 'gamma', 'erf', 'fact',
] as const;

const ALIASES: Record<string, string> = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', arccot: 'acot', arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh',
  arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh', sgn: 'sign', log10: 'lg',
};

/** Mehrstellige reelle Funktionen mit Stelligkeit [min, max] */
export const MULTI_FUNCTIONS: Record<string, [number, number]> = {
  min: [2, 16], max: [2, 16], mod: [2, 2], atan2: [2, 2], root: [2, 2], hypot: [2, 16], clamp: [3, 3],
  binom: [2, 2], if: [2, 3], log: [2, 2],
};

/** Summe, Produkt, Integral: op(k = a, b, Rumpf) */
export const BIG_OPERATORS = ['sum', 'prod', 'int'] as const;
export type BigOperator = (typeof BIG_OPERATORS)[number];

/** Alle Funktionsnamen (für Parameter-Erkennung u. Ä.) */
export const FUNCTIONS: readonly string[] = [
  ...new Set([...COMPLEX_FUNCTIONS, ...REAL_FUNCTIONS, ...Object.keys(ALIASES), ...Object.keys(MULTI_FUNCTIONS), ...BIG_OPERATORS]),
];

export const CONSTANTS = ['i', 'pi', 'e'] as const;
export type ConstantName = (typeof CONSTANTS)[number];

export type CmpOp = '<' | '>' | '<=' | '>=' | '=';

export type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: ConstantName }
  | { type: 'neg'; arg: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { type: 'call'; fn: string; arg: Node }
  /** mehrstellige Funktion (min, max, mod, if, …) */
  | { type: 'fn'; fn: string; args: Node[] }
  /** Vergleichskette a < b ≤ c … (nur als Bedingung) */
  | { type: 'cmp'; ops: CmpOp[]; args: Node[] }
  /** benutzerdefinierte Funktion, `order`-fach abgeleitet */
  | { type: 'user'; name: string; order: number; arg: Node }
  | { type: 'big'; op: BigOperator; index: string; from: Node; to: Node; body: Node };

export interface ParseOptions {
  variables: readonly string[];
  constants: readonly ConstantName[];
  functions: readonly string[];
  /** „links = rechts“ erlauben (ergibt links − rechts) */
  equation?: boolean;
  /** erweiterter Modus (siehe oben) */
  extended?: boolean;
  /** Namen benutzerdefinierter Funktionen (nur erweitert) */
  user?: readonly string[];
  /** Unbekannte Einzelbuchstaben werden Variablen und hier gesammelt (nur erweitert) */
  autoParams?: Set<string>;
  /** Buchstaben, die nie automatische Parameter werden */
  reserved?: readonly string[];
}

/** Komplexer Ausdruck in z (Domain Coloring) */
export const COMPLEX_OPTIONS: ParseOptions = { variables: ['z'], constants: CONSTANTS, functions: COMPLEX_FUNCTIONS };

export function realOptions(variables: readonly string[], equation = false): ParseOptions {
  return { variables, constants: ['pi', 'e'], functions: REAL_FUNCTIONS, equation };
}

/** Erweiterte reelle Optionen für die Graphen */
export function plotOptions(variables: readonly string[], opts: { user?: readonly string[]; autoParams?: Set<string>; reserved?: readonly string[] } = {}): ParseOptions {
  return { variables, constants: ['pi', 'e'], functions: REAL_FUNCTIONS, extended: true, ...opts };
}

export class ParseError extends Error {
  constructor(message: string, readonly pos: number, readonly end = pos + 1) {
    super(message);
    this.name = 'ParseError';
  }
}

type Token =
  | { kind: 'num'; value: number; pos: number; end: number }
  | { kind: 'ident'; name: string; primes: number; pos: number; end: number }
  | { kind: 'op'; op: string; pos: number; end: number }
  | { kind: 'eof'; pos: number; end: number };

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_][A-Za-z_0-9]*/y;

function isKnown(name: string, o: ParseOptions): boolean {
  return (
    o.variables.includes(name) ||
    (o.constants as readonly string[]).includes(name) ||
    o.functions.includes(name) ||
    (!!o.extended && (name in ALIASES || name in MULTI_FUNCTIONS || (BIG_OPERATORS as readonly string[]).includes(name) || !!o.user?.includes(name)))
  );
}

/** Zerlegt z. B. „piz“ in [pi, z] oder „xy“ in [x, y]; null, wenn nicht vollständig möglich. */
function splitSymbols(name: string, o: ParseOptions): string[] | null {
  const symbols = [...o.variables, ...o.constants].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let rest = name;
  while (rest) {
    const sym = symbols.find((s) => rest.startsWith(s));
    if (!sym) return null;
    out.push(sym);
    rest = rest.slice(sym.length);
  }
  return out;
}

/**
 * Erweitert: längste bekannte Namen zuerst (Funktionen, Konstanten, Variablen), sonst ein einzelner
 * Buchstabe (wird ggf. automatischer Parameter). „asin“ bleibt asin, „ax“ wird a·x, „xsin“ x·sin.
 */
function splitExtended(name: string, o: ParseOptions): string[] {
  const names = [
    ...o.variables, ...o.constants, ...o.functions, ...Object.keys(ALIASES), ...Object.keys(MULTI_FUNCTIONS), ...BIG_OPERATORS, ...(o.user ?? []),
  ].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let rest = name;
  while (rest) {
    const sym = names.find((s) => rest.startsWith(s)) ?? rest[0]!;
    out.push(sym);
    rest = rest.slice(sym.length);
  }
  return out;
}

const OPS = '+-*/^()=,|!<>';

export function tokenize(src: string, o: ParseOptions = COMPLEX_OPTIONS): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(src);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) throw new ParseError('Zahl zu groß', i, i + num[0].length);
      out.push({ kind: 'num', value, pos: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    IDENT.lastIndex = i;
    const id = IDENT.exec(src);
    if (id) {
      // Unbekannte Namen wie „iz“ oder „xy“ als implizites Produkt bekannter Symbole lesen.
      const parts = isKnown(id[0], o)
        ? [id[0]]
        : o.extended
          ? splitExtended(id[0], o)
          : splitSymbols(id[0], o) ?? [id[0]];
      for (const name of parts) {
        out.push({ kind: 'ident', name, primes: 0, pos: i, end: i + name.length });
        i += name.length;
      }
      // Ableitungsstriche f', f''
      if (o.extended) {
        const last = out[out.length - 1] as Extract<Token, { kind: 'ident' }>;
        while (src[i] === "'" || src[i] === '′' || src[i] === '’') {
          last.primes++;
          last.end = ++i;
        }
      }
      continue;
    }
    // Typografische Varianten tolerieren (Einfügen aus Texten)
    let op = c === '−' ? '-' : c === '·' || c === '×' ? '*' : c === '÷' ? '/' : c;
    if (op === '²' || op === '³') {
      // x² ≙ x^2, x³ ≙ x^3
      out.push({ kind: 'op', op: '^', pos: i, end: i + 1 }, { kind: 'num', value: op === '²' ? 2 : 3, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if (op === '≤') op = '<=';
    else if (op === '≥') op = '>=';
    else if ((op === '<' || op === '>') && src[i + 1] === '=') op += '=';
    if (op === 'π') {
      out.push({ kind: 'ident', name: 'pi', primes: 0, pos: i, end: i + 1 });
      i++;
      continue;
    }
    const allowed = o.extended ? OPS.includes(op[0]!) || op.length === 2 : '+-*/^()='.includes(op);
    if (allowed) {
      const len = op.length === 2 && c !== '≤' && c !== '≥' ? 2 : 1;
      out.push({ kind: 'op', op, pos: i, end: i + len });
      i += len;
      continue;
    }
    throw new ParseError(`Unerwartetes Zeichen „${c}“`, i);
  }
  out.push({ kind: 'eof', pos: src.length, end: src.length });
  return out;
}

const CMP_OPS: readonly string[] = ['<', '>', '<=', '>=', '='];

export function parse(src: string, o: ParseOptions = COMPLEX_OPTIONS): Node {
  const tokens = tokenize(src, o);
  let k = 0;
  const peek = () => tokens[k]!;
  const next = () => tokens[k++]!;
  const isOp = (t: Token, op: string) => t.kind === 'op' && t.op === op;
  /** lokal gebundene Variablen (Summationsindex) */
  const scope: string[] = [];
  let absDepth = 0;
  const expectClose = (open: Token) => {
    const t = peek();
    if (!isOp(t, ')')) {
      throw t.kind === 'eof'
        ? new ParseError('Schließende Klammer fehlt', open.pos, t.pos)
        : new ParseError('„)“ erwartet', t.pos, t.end);
    }
    k++;
  };
  const expectOp = (op: string, what = `„${op}“ erwartet`) => {
    const t = next();
    if (!isOp(t, op)) throw new ParseError(what, t.pos, t.end);
    return t;
  };

  function expr(): Node {
    let left = term();
    for (;;) {
      const t = peek();
      if (isOp(t, '+') || isOp(t, '-')) {
        k++;
        left = { type: 'bin', op: (t as { op: '+' | '-' }).op, left, right: term() };
      } else return left;
    }
  }

  // Beginnt t einen Faktor, der ohne '*' angehängt werden darf? (Ein „|“ innerhalb von |…| schließt.)
  const startsImplicit = (t: Token) =>
    t.kind === 'num' || t.kind === 'ident' || isOp(t, '(') || (isOp(t, '|') && absDepth === 0);

  function term(): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (isOp(t, '*') || isOp(t, '/')) {
        k++;
        left = { type: 'bin', op: (t as { op: '*' | '/' }).op, left, right: unary() };
      } else if (startsImplicit(t)) {
        left = { type: 'bin', op: '*', left, right: power() };
      } else return left;
    }
  }

  function unary(): Node {
    const t = peek();
    if (isOp(t, '-')) {
      k++;
      return { type: 'neg', arg: unary() };
    }
    if (isOp(t, '+')) {
      k++;
      return unary();
    }
    return power();
  }

  function power(): Node {
    let base = primary();
    while (o.extended && isOp(peek(), '!')) {
      k++;
      base = { type: 'call', fn: 'fact', arg: base };
    }
    if (isOp(peek(), '^')) {
      k++;
      return { type: 'bin', op: '^', left: base, right: unary() };
    }
    return base;
  }

  /** Bedingung: Ausdruck mit mindestens einem Vergleich (Ketten erlaubt) */
  function condition(): Node {
    const args = [expr()];
    const ops: CmpOp[] = [];
    for (;;) {
      const t = peek();
      if (t.kind === 'op' && CMP_OPS.includes(t.op)) {
        k++;
        ops.push(t.op as CmpOp);
        args.push(expr());
      } else break;
    }
    if (!ops.length) {
      const t = peek();
      throw new ParseError('Vergleich erwartet, z. B. x < 0', t.pos, t.end);
    }
    return { type: 'cmp', ops, args };
  }

  function argList(open: Token, name: string, first?: () => Node): Node[] {
    const args: Node[] = [];
    if (isOp(peek(), ')')) throw new ParseError(`${name}: Argumente fehlen`, open.pos, peek().end);
    args.push(first ? first() : expr());
    while (isOp(peek(), ',')) {
      k++;
      args.push(expr());
    }
    expectClose(open);
    return args;
  }

  function isVariable(name: string): boolean {
    return scope.includes(name) || o.variables.includes(name);
  }

  function primary(): Node {
    const t = next();
    switch (t.kind) {
      case 'num':
        return { type: 'num', value: t.value };
      case 'ident': {
        const name = ALIASES[t.name] ?? t.name;
        if (o.extended && o.user?.includes(name)) {
          const open = expectOp('(', `„(“ nach ${name} erwartet`);
          const arg = expr();
          expectClose(open);
          return { type: 'user', name, order: t.primes, arg };
        }
        if (t.primes) throw new ParseError(`${name}′: Ableitungen nur für eigene Funktionen wie f(x) = …`, t.pos, t.end);
        if (isVariable(name)) return { type: 'var', name };
        if ((o.constants as readonly string[]).includes(name)) return { type: 'const', name: name as ConstantName };
        if (o.extended && (BIG_OPERATORS as readonly string[]).includes(name)) return big(t, name as BigOperator);
        if (o.extended && name in MULTI_FUNCTIONS && isOp(peek(), '(') && (name !== 'log' || hasComma())) {
          const open = next();
          const args = argList(open, name, name === 'if' ? condition : undefined);
          const [lo, hi] = MULTI_FUNCTIONS[name]!;
          if (args.length < lo || args.length > hi) {
            throw new ParseError(`${name} erwartet ${lo === hi ? lo : `${lo}–${hi}`} Argumente`, t.pos, tokens[k - 1]!.end);
          }
          return { type: 'fn', fn: name, args };
        }
        if (o.functions.includes(name)) {
          const open = peek();
          if (!isOp(open, '(')) {
            if (!o.extended) throw new ParseError(`„(“ nach ${name} erwartet`, open.pos, open.end);
            // sin^2(x) = (sin x)², sin x = sin(x)
            if (isOp(open, '^')) {
              k++;
              const exponent = primary();
              return { type: 'bin', op: '^', left: { type: 'call', fn: name, arg: power() }, right: exponent };
            }
            if (open.kind === 'eof' || (open.kind === 'op' && !['(', '|', '-'].includes(open.op))) {
              throw new ParseError(`Argument von ${name} fehlt`, open.pos, open.end);
            }
            return { type: 'call', fn: name, arg: isOp(open, '-') ? unary() : power() };
          }
          k++;
          const arg = expr();
          expectClose(open);
          return { type: 'call', fn: name, arg };
        }
        if (o.extended && o.autoParams && /^[A-Za-z]$/.test(name) && !o.reserved?.includes(name)) {
          o.autoParams.add(name);
          return { type: 'var', name };
        }
        const hint = o.variables.length ? ` – erlaubt: ${o.variables.join(', ')}` : '';
        throw new ParseError(`Unbekannter Name „${name}“${hint}`, t.pos, t.end);
      }
      case 'op':
        if (t.op === '(') {
          const inner = expr();
          expectClose(t);
          return inner;
        }
        if (t.op === '|' && o.extended) {
          absDepth++;
          const inner = expr();
          absDepth--;
          const close = next();
          if (!isOp(close, '|')) throw new ParseError('Schließendes „|“ fehlt', t.pos, close.end);
          return { type: 'call', fn: 'abs', arg: inner };
        }
        throw new ParseError(t.op === ')' ? 'Unerwartete „)“' : `Operand vor „${t.op}“ fehlt`, t.pos, t.end);
      case 'eof':
        throw new ParseError('Ausdruck unvollständig', t.pos, t.end);
    }
  }

  /** Hat die Klammer ab der aktuellen Position ein Komma auf oberster Ebene? (log(b, x) vs. log(x)) */
  function hasComma(): boolean {
    let depth = 0;
    for (let j = k; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')') && --depth === 0) return false;
      else if (isOp(t, ',') && depth === 1) return true;
    }
    return false;
  }

  /** sum(k = 1, n, Rumpf), prod(…), int(t = a, b, Rumpf) */
  function big(t: Token, op: BigOperator): Node {
    const open = expectOp('(', `„(“ nach ${op} erwartet`);
    const idx = next();
    const example = op === 'int' ? 'int(t = 0, x, e^(-t^2))' : `${op}(k = 1, 10, 1/k^2)`;
    if (idx.kind !== 'ident' || !/^[A-Za-z]$/.test(idx.name)) throw new ParseError(`Laufvariable erwartet, z. B. ${example}`, idx.pos, idx.end);
    expectOp('=', `„=“ nach der Laufvariablen erwartet, z. B. ${example}`);
    const from = expr();
    expectOp(',', `„,“ erwartet, z. B. ${example}`);
    const to = expr();
    expectOp(',', `„,“ erwartet, z. B. ${example}`);
    scope.push(idx.name);
    const body = expr();
    scope.pop();
    expectClose(open);
    void t;
    return { type: 'big', op, index: idx.name, from, to, body };
  }

  let root = expr();
  if (o.equation && isOp(peek(), '=')) {
    k++;
    root = { type: 'bin', op: '-', left: root, right: expr() };
  }
  const rest = peek();
  if (rest.kind !== 'eof') {
    const msg = isOp(rest, ')')
      ? 'Unerwartete „)“'
      : isOp(rest, '=')
        ? '„=“ hier nicht erlaubt'
        : isOp(rest, '|')
          ? '„|“ ohne öffnendes „|“'
          : rest.kind === 'op' && CMP_OPS.includes(rest.op)
            ? `„${rest.op}“ nur in Bedingungen, z. B. if(x < 0, −x, x)`
            : isOp(rest, ',')
              ? '„,“ nur in Funktionsargumenten'
              : 'Unerwartetes Zeichen';
    throw new ParseError(msg, rest.pos, rest.end);
  }
  return root;
}

/** Parst eine Bedingung (Vergleichskette), z. B. für Definitionsbereiche {0 < x < 1} */
export function parseCondition(src: string, o: ParseOptions): Node {
  // Bedingung als Argument von if(…) parsen, damit Vergleiche erlaubt sind
  const wrapped = parse(`if(${src}, 1)`, o);
  if (wrapped.type !== 'fn') throw new ParseError('Bedingung erwartet', 0, src.length);
  return wrapped.args[0]!;
}

/** Kanonische Darstellung mit voller Klammerung (für Tests und Debugging). */
export function toString(n: Node): string {
  switch (n.type) {
    case 'num': return String(n.value);
    case 'var': return n.name;
    case 'const': return n.name;
    case 'neg': return `(-${toString(n.arg)})`;
    case 'bin': return `(${toString(n.left)} ${n.op} ${toString(n.right)})`;
    case 'call': return `${n.fn}(${toString(n.arg)})`;
    case 'fn': return `${n.fn}(${n.args.map(toString).join(', ')})`;
    case 'cmp': return n.args.map((a, i) => (i ? ` ${n.ops[i - 1]} ` : '') + toString(a)).join('');
    case 'user': return `${n.name}${"'".repeat(n.order)}(${toString(n.arg)})`;
    case 'big': return `${n.op}(${n.index} = ${toString(n.from)}, ${toString(n.to)}, ${toString(n.body)})`;
  }
}

/** Kommt eine Variable im Ausdruck (frei) vor? */
export function usesVar(n: Node, name: string): boolean {
  switch (n.type) {
    case 'var': return n.name === name;
    case 'num': case 'const': return false;
    case 'neg': return usesVar(n.arg, name);
    case 'bin': return usesVar(n.left, name) || usesVar(n.right, name);
    case 'call': return usesVar(n.arg, name);
    case 'fn': case 'cmp': return n.args.some((a) => usesVar(a, name));
    case 'user': return usesVar(n.arg, name);
    case 'big': return usesVar(n.from, name) || usesVar(n.to, name) || (n.index !== name && usesVar(n.body, name));
  }
}

/** Freie Variablen eines Ausdrucks */
export function freeVars(n: Node, out = new Set<string>(), bound: string[] = []): Set<string> {
  switch (n.type) {
    case 'var': if (!bound.includes(n.name)) out.add(n.name); break;
    case 'neg': freeVars(n.arg, out, bound); break;
    case 'bin': freeVars(n.left, out, bound); freeVars(n.right, out, bound); break;
    case 'call': case 'user': freeVars(n.arg, out, bound); break;
    case 'fn': case 'cmp': n.args.forEach((a) => freeVars(a, out, bound)); break;
    case 'big': freeVars(n.from, out, bound); freeVars(n.to, out, bound); freeVars(n.body, out, [...bound, n.index]); break;
    default: break;
  }
  return out;
}
