// AST → GLSL-Ausdruck vom Typ vec2 (komplexe Zahl als (Re, Im)).
// Semantik identisch zu evaluate() in complex.ts.
import type { FunctionName, Node } from '../../math/parser';
import { glslFloat, integerExponent } from '../../math/real';

export { glslFloat };

const CALLS: Record<FunctionName, string> = {
  exp: 'cexp', log: 'clog', ln: 'clog', sqrt: 'csqrt', sin: 'csin', cos: 'ccos', tan: 'ctan',
  sinh: 'csinh', cosh: 'ccosh', tanh: 'ctanh', conj: 'cconj', abs: 'cabs', re: 'cre', im: 'cim',
};

/** Rein reeller Literalwert des Knotens (für Skalar-Optimierung), sonst null. */
function realLiteral(n: Node): number | null {
  if (n.type === 'num') return n.value;
  if (n.type === 'const' && n.name !== 'i') return n.name === 'pi' ? Math.PI : Math.E;
  if (n.type === 'neg') {
    const v = realLiteral(n.arg);
    return v === null ? null : -v;
  }
  return null;
}

export function codegen(n: Node): string {
  const lit = realLiteral(n);
  if (lit !== null) return `vec2(${glslFloat(lit)}, 0.0)`;
  switch (n.type) {
    case 'num':
      return `vec2(${glslFloat(n.value)}, 0.0)`;
    case 'const':
      return n.name === 'i' ? 'vec2(0.0, 1.0)' : `vec2(${glslFloat(realLiteral(n)!)}, 0.0)`;
    case 'var':
      return 'z';
    case 'neg':
      return `(-${codegen(n.arg)})`;
    case 'call':
      return `${CALLS[n.fn]}(${codegen(n.arg)})`;
    case 'bin': {
      const a = () => codegen(n.left);
      const b = () => codegen(n.right);
      switch (n.op) {
        case '+': return `(${a()} + ${b()})`;
        case '-': return `(${a()} - ${b()})`;
        case '*': {
          // Reeller Faktor → Skalarmultiplikation statt cmul
          const l = realLiteral(n.left);
          if (l !== null) return `(${glslFloat(l)} * ${b()})`;
          const r = realLiteral(n.right);
          if (r !== null) return `(${a()} * ${glslFloat(r)})`;
          return `cmul(${a()}, ${b()})`;
        }
        case '/': {
          const r = realLiteral(n.right);
          if (r !== null) return `(${a()} / ${glslFloat(r)})`;
          return `cdiv(${a()}, ${b()})`;
        }
        case '^': {
          const k = integerExponent(n.right);
          if (k !== null) return `cpowi(${a()}, ${k})`;
          if (n.left.type === 'const' && n.left.name === 'e') return `cexp(${b()})`;
          return `cpow(${a()}, ${b()})`;
        }
      }
    }
  }
}
