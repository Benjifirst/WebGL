import { describe, expect, it } from 'vitest';
import { parse, ParseError, realOptions, toString } from './parser';
import { codegenReal, evaluateReal } from './real';

const XYZ = realOptions(['x', 'y', 'z'], true);
const UV = realOptions(['u', 'v']);

describe('Parser: reelle Optionen', () => {
  it('Gleichung links = rechts ergibt links − rechts', () => {
    expect(toString(parse('x^2 + y^2 = 1', XYZ))).toBe('(((x ^ 2) + (y ^ 2)) - 1)');
  });
  it('= ohne Gleichungsmodus ist ein Fehler', () => {
    expect(() => parse('u = 1', UV)).toThrow(ParseError);
  });
  it('zusammengeschriebene Variablen: xy, 2xz, vcos(u)', () => {
    expect(toString(parse('xy', XYZ))).toBe('(x * y)');
    expect(toString(parse('2xz', XYZ))).toBe('((2 * x) * z)');
    expect(toString(parse('v cos(u)', UV))).toBe('(v * cos(u))');
  });
  it('i und komplexe Funktionen sind im reellen Modus unbekannt', () => {
    expect(() => parse('x + i', XYZ)).toThrow(/Unbekannter Name „i“/);
    expect(() => parse('re(x)', XYZ)).toThrow(ParseError);
    expect(() => parse('w', XYZ)).toThrow(/erlaubt: x, y, z/);
  });
  it('x² als Kurzschreibweise', () => {
    expect(toString(parse('x² + y²', XYZ))).toBe('((x ^ 2) + (y ^ 2))');
  });
});

describe('evaluateReal', () => {
  const ev = (s: string, env: Record<string, number>, o = XYZ) => evaluateReal(parse(s, o), env);
  it('Kugelgleichung', () => {
    expect(ev('x^2 + y^2 + z^2 = 1', { x: 1, y: 0, z: 0 })).toBe(0);
    expect(ev('x^2 + y^2 + z^2 = 1', { x: 0, y: 0, z: 0 })).toBe(-1);
  });
  it('ganzzahlige Potenzen negativer Basen exakt', () => {
    expect(ev('x^3', { x: -2 })).toBe(-8);
    expect(ev('x^-2', { x: -2 })).toBe(0.25);
  });
  it('ungerade Fortsetzung für gebrochene Exponenten', () => {
    expect(ev('x^(1/3)', { x: -8 })).toBeCloseTo(-2, 12);
  });
  it('log = ln|x|, sqrt = √max(x,0), e^x = exp', () => {
    expect(ev('log(x)', { x: -Math.E })).toBeCloseTo(1, 12);
    expect(ev('sqrt(x)', { x: -4 })).toBe(0);
    expect(ev('e^x', { x: 2 })).toBeCloseTo(Math.exp(2), 12);
  });
  it('Möbiusband: Mittellinie ist der Einheitskreis', () => {
    const x = parse('(1 + v cos(u/2)) cos(u)', UV);
    const y = parse('(1 + v cos(u/2)) sin(u)', UV);
    for (const u of [0, 1, 2.5, 4]) {
      expect(Math.hypot(evaluateReal(x, { u, v: 0 }), evaluateReal(y, { u, v: 0 }))).toBeCloseTo(1, 12);
    }
  });
});

describe('codegenReal', () => {
  const g = (s: string) => codegenReal(parse(s, XYZ), { x: 'p.x', y: 'p.y', z: 'p.z' });
  it('Variablenzuordnung und Operatoren', () => {
    expect(g('x + 2y')).toBe('(p.x + (2.0 * p.y))');
  });
  it('Potenzen', () => {
    expect(g('x^2')).toBe('pown(p.x, 2)');
    expect(g('x^0.5')).toBe('rpow(p.x, 0.5)');
    expect(g('e^z')).toBe('exp(p.z)');
  });
  it('Funktionen mit sicherem Definitionsbereich', () => {
    expect(g('ln(x)')).toBe('log(abs(p.x))');
    expect(g('sqrt(y)')).toBe('sqrt(max(p.y, 0.0))');
  });
  it('Gleichung', () => {
    expect(g('x = 1')).toBe('(p.x - 1.0)');
  });
});
