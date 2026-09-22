import { describe, expect, it } from 'vitest';
import { parse, ParseError, plotOptions, realOptions, toString } from './parser';
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

describe('Erweiterter Parser (Graphen)', () => {
  const P = (s: string, vars = ['x']) => toString(parse(s, plotOptions(vars, { autoParams: new Set(), reserved: ['x', 'y'] })));
  it('Betragsstriche, auch verschachtelt und hintereinander', () => {
    expect(P('|x|')).toBe('abs(x)');
    expect(P('||x| - 2|')).toBe('abs((abs(x) - 2))');
    expect(P('|x||x - 1|')).toBe('(abs(x) * abs((x - 1)))');
    expect(P('2|x|')).toBe('(2 * abs(x))');
  });
  it('Fakultät, sin x, sin^2(x), Aliasse', () => {
    expect(P('x!')).toBe('fact(x)');
    expect(P('(2k+1)!', ['x', 'k'])).toBe('fact(((2 * k) + 1))');
    expect(P('sin x')).toBe('sin(x)');
    expect(P('sin^2(x)')).toBe('(sin(x) ^ 2)');
    expect(P('arctan(x)')).toBe('atan(x)');
  });
  it('mehrstellige Funktionen, if mit Vergleichskette, log zur Basis', () => {
    expect(P('max(x, 1, 2)')).toBe('max(x, 1, 2)');
    expect(P('if(0 < x <= 1, x, 0)')).toBe('if(0 < x <= 1, x, 0)');
    expect(P('log(2, x)')).toBe('log(2, x)');
    expect(P('log(x)')).toBe('log(x)');
    expect(() => P('mod(x)')).toThrow(/2 Argumente/);
  });
  it('Summen binden die Laufvariable lokal', () => {
    const params = new Set<string>();
    parse('sum(k = 1, n, x^k)', plotOptions(['x'], { autoParams: params, reserved: ['x'] }));
    expect([...params]).toEqual(['n']);
  });
  it('Vergleich außerhalb einer Bedingung ist ein Fehler mit Hinweis', () => {
    expect(() => P('x < 1')).toThrow(/Bedingungen/);
  });
});

describe('Strenge Auswertung', () => {
  const ev = (s: string, x: number) => evaluateReal(parse(s, plotOptions(['x'])), { x }, true);
  it('Definitionsbereiche', () => {
    expect(ev('sqrt(x)', -4)).toBeNaN();
    expect(ev('ln(x)', -1)).toBeNaN();
    expect(ev('asin(x)', 2)).toBeNaN();
    expect(ev('x^0.5', -4)).toBeNaN();
  });
  it('negative Basis mit ungeradem Nenner', () => {
    expect(ev('x^(1/3)', -8)).toBeCloseTo(-2, 12);
    expect(ev('x^(2/3)', -8)).toBeCloseTo(4, 12);
    expect(ev('root(x, 3)', -27)).toBeCloseTo(-3, 12);
    expect(ev('root(x, 2)', -4)).toBeNaN();
  });
  it('Sonderfunktionen', () => {
    expect(ev('gamma(x)', 5)).toBe(24);
    expect(ev('gamma(x)', 0.5)).toBeCloseTo(Math.sqrt(Math.PI), 13);
    expect(ev('gamma(x)', -0.5)).toBeCloseTo(-2 * Math.sqrt(Math.PI), 12);
    expect(ev('gamma(x)', -2)).toBeNaN();
    expect(ev('erf(x)', 1)).toBeCloseTo(0.8427007929497149, 14);
    expect(ev('erf(x)', 3.5)).toBeCloseTo(0.9999992569016276, 14);
    expect(ev('binom(x, 2)', 10)).toBe(45);
    expect(ev('mod(x, 3)', -1)).toBe(2);
    expect(ev('int(t = 0, x, 1/sqrt(t))', 1)).toBeCloseTo(2, 8);
    expect(ev('int(t = 0, x, sin(t))', Math.PI)).toBeCloseTo(2, 12);
    expect(ev('int(t = -1, 1, sqrt(1 - t^2))', 0)).toBeCloseTo(Math.PI / 2, 10);
    expect(ev('prod(k = 1, x, k)', 6)).toBe(720);
  });
});
