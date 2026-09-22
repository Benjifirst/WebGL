// Ausdrucksparser: Tokenizer → Recursive Descent → AST.
// Konfigurierbar für komplexe (f(z)) und reelle Ausdrücke (F(x,y,z), x(u,v) …).
//
// Grammatik (niedrigste Bindung zuerst):
//   equation := expr ('=' expr)?               // nur falls erlaubt: a = b  ↦  a − b
//   expr     := term (('+' | '-') term)*
//   term     := unary (('*' | '/') unary | ⟨implizit⟩ power)*
//   unary    := ('-' | '+') unary | power
//   power    := primary ('^' unary)?           // rechtsassoziativ: a^b^c = a^(b^c)
//   primary  := Zahl | Variable | Konstante | Funktion '(' expr ')' | '(' expr ')'
//
// Implizite Multiplikation (2z, 3(z+1), z(z−1), 2 sin(z), xy) bindet wie '*'.
// Daher gilt −z^2 = −(z^2) und 2z^2 = 2·(z^2).

export const FUNCTIONS = [
  'exp', 'log', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'conj', 'abs', 're', 'im',
] as const;
export type FunctionName = (typeof FUNCTIONS)[number];

export const REAL_FUNCTIONS: readonly FunctionName[] = [
  'exp', 'log', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'abs',
];

export const CONSTANTS = ['i', 'pi', 'e'] as const;
export type ConstantName = (typeof CONSTANTS)[number];

export type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: ConstantName }
  | { type: 'neg'; arg: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { type: 'call'; fn: FunctionName; arg: Node };

export interface ParseOptions {
  variables: readonly string[];
  constants: readonly ConstantName[];
  functions: readonly FunctionName[];
  /** „links = rechts“ erlauben (ergibt links − rechts) */
  equation?: boolean;
}

/** Komplexer Ausdruck in z (Domain Coloring) */
export const COMPLEX_OPTIONS: ParseOptions = { variables: ['z'], constants: CONSTANTS, functions: FUNCTIONS };

export function realOptions(variables: readonly string[], equation = false): ParseOptions {
  return { variables, constants: ['pi', 'e'], functions: REAL_FUNCTIONS, equation };
}

export class ParseError extends Error {
  constructor(message: string, readonly pos: number, readonly end = pos + 1) {
    super(message);
    this.name = 'ParseError';
  }
}

type Token =
  | { kind: 'num'; value: number; pos: number; end: number }
  | { kind: 'ident'; name: string; pos: number; end: number }
  | { kind: 'op'; op: string; pos: number; end: number }
  | { kind: 'eof'; pos: number; end: number };

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_][A-Za-z_0-9]*/y;

function isKnown(name: string, o: ParseOptions): boolean {
  return (
    o.variables.includes(name) ||
    (o.constants as readonly string[]).includes(name) ||
    (o.functions as readonly string[]).includes(name)
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
      const parts = isKnown(id[0], o) ? [id[0]] : splitSymbols(id[0], o) ?? [id[0]];
      for (const name of parts) {
        out.push({ kind: 'ident', name, pos: i, end: i + name.length });
        i += name.length;
      }
      continue;
    }
    // Typografische Varianten tolerieren (Einfügen aus Texten)
    const op = c === '−' ? '-' : c === '·' || c === '×' ? '*' : c === '÷' ? '/' : c === '²' ? '²' : c;
    if (op === '²') {
      // x² ≙ x^2
      out.push({ kind: 'op', op: '^', pos: i, end: i + 1 }, { kind: 'num', value: 2, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if ('+-*/^()='.includes(op)) {
      out.push({ kind: 'op', op, pos: i, end: i + 1 });
      i++;
      continue;
    }
    throw new ParseError(`Unerwartetes Zeichen „${c}“`, i);
  }
  out.push({ kind: 'eof', pos: src.length, end: src.length });
  return out;
}

export function parse(src: string, o: ParseOptions = COMPLEX_OPTIONS): Node {
  const tokens = tokenize(src, o);
  let k = 0;
  const peek = () => tokens[k]!;
  const next = () => tokens[k++]!;
  const isOp = (t: Token, op: string) => t.kind === 'op' && t.op === op;
  const expectClose = (open: Token) => {
    const t = peek();
    if (!isOp(t, ')')) {
      throw t.kind === 'eof'
        ? new ParseError('Schließende Klammer fehlt', open.pos, t.pos)
        : new ParseError('„)“ erwartet', t.pos, t.end);
    }
    k++;
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

  // Beginnt t einen Faktor, der ohne '*' angehängt werden darf?
  const startsImplicit = (t: Token) => t.kind === 'num' || t.kind === 'ident' || isOp(t, '(');

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
    const base = primary();
    if (isOp(peek(), '^')) {
      k++;
      return { type: 'bin', op: '^', left: base, right: unary() };
    }
    return base;
  }

  function primary(): Node {
    const t = next();
    switch (t.kind) {
      case 'num':
        return { type: 'num', value: t.value };
      case 'ident': {
        const name = t.name;
        if (o.variables.includes(name)) return { type: 'var', name };
        if ((o.constants as readonly string[]).includes(name)) return { type: 'const', name: name as ConstantName };
        if ((o.functions as readonly string[]).includes(name)) {
          const open = peek();
          if (!isOp(open, '(')) throw new ParseError(`„(“ nach ${name} erwartet`, open.pos, open.end);
          k++;
          const arg = expr();
          expectClose(open);
          return { type: 'call', fn: name as FunctionName, arg };
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
        throw new ParseError(t.op === ')' ? 'Unerwartete „)“' : `Operand vor „${t.op}“ fehlt`, t.pos, t.end);
      case 'eof':
        throw new ParseError('Ausdruck unvollständig', t.pos, t.end);
    }
  }

  let root = expr();
  if (o.equation && isOp(peek(), '=')) {
    k++;
    root = { type: 'bin', op: '-', left: root, right: expr() };
  }
  const rest = peek();
  if (rest.kind !== 'eof') {
    const msg = isOp(rest, ')') ? 'Unerwartete „)“' : isOp(rest, '=') ? '„=“ hier nicht erlaubt' : 'Unerwartetes Zeichen';
    throw new ParseError(msg, rest.pos, rest.end);
  }
  return root;
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
  }
}
