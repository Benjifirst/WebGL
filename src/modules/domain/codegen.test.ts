import { describe, expect, it } from 'vitest';
import { codegen, glslFloat } from './codegen';
import { evaluate } from './complex';
import type { C } from './complex';
import { parse } from '../../math/parser';

const g = (s: string) => codegen(parse(s));

describe('codegen', () => {
  it('float-Literale mit Dezimalpunkt', () => {
    expect(glslFloat(2)).toBe('2.0');
    expect(glslFloat(0.5)).toBe('0.5');
    expect(glslFloat(1e-7)).toBe('1e-7');
    expect(glslFloat(1e21)).toBe('1e+21');
  });
  it('Grundoperationen', () => {
    expect(g('z')).toBe('z');
    expect(g('i')).toBe('vec2(0.0, 1.0)');
    expect(g('z + 1')).toBe('(z + vec2(1.0, 0.0))');
    expect(g('z * i')).toBe('cmul(z, vec2(0.0, 1.0))');
    expect(g('1 / z')).toBe('cdiv(vec2(1.0, 0.0), z)');
    expect(g('-z')).toBe('(-z)');
  });
  it('reelle Faktoren als Skalar', () => {
    expect(g('2z')).toBe('(2.0 * z)');
    expect(g('z / 2')).toBe('(z / 2.0)');
    expect(g('-3')).toBe('vec2(-3.0, 0.0)');
  });
  it('Potenzen', () => {
    expect(g('z^3')).toBe('cpowi(z, 3)');
    expect(g('z^-2')).toBe('cpowi(z, -2)');
    expect(g('z^0.5')).toBe('cpow(z, vec2(0.5, 0.0))');
    expect(g('e^z')).toBe('cexp(z)');
    expect(g('z^z')).toBe('cpow(z, z)');
    // Rechtsassoziativität bleibt erhalten: z^(2^3), 2^3 ist kein Literal
    expect(g('z^2^3')).toBe('cpow(z, cpowi(vec2(2.0, 0.0), 3))');
  });
  it('Funktionen', () => {
    expect(g('sin(z)')).toBe('csin(z)');
    expect(g('ln(z)')).toBe('clog(z)');
    expect(g('sqrt(z^2 - 1)')).toBe('csqrt((cpowi(z, 2) - vec2(1.0, 0.0)))');
  });
});

describe('Referenz-Auswertung', () => {
  const close = (a: C, b: C) => {
    expect(a[0]).toBeCloseTo(b[0], 10);
    expect(a[1]).toBeCloseTo(b[1], 10);
  };
  const ev = (s: string, z: C) => evaluate(parse(s), z);

  it('Identitäten', () => {
    const z: C = [0.7, -1.3];
    close(ev('exp(log(z))', z), z);
    close(ev('sqrt(z)^2', z), z);
    close(ev('sin(z)^2 + cos(z)^2', z), [1, 0]);
    close(ev('cosh(z)^2 - sinh(z)^2', z), [1, 0]);
    close(ev('e^(i pi)', z), [-1, 0]);
    close(ev('z^-2 * z^2', z), [1, 0]);
    close(ev('z^0.5', z), ev('sqrt(z)', z));
    close(ev('tan(z)', z), ev('sin(z)/cos(z)', z));
  });
  it('i² = −1 und Präzedenz numerisch', () => {
    close(ev('i^2', [0, 0]), [-1, 0]);
    close(ev('-2^2', [0, 0]), [-4, 0]);
    close(ev('2^3^2', [0, 0]), [512, 0]);
  });
});
