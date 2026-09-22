import { describe, expect, it } from 'vitest';
import { parse, ParseError, toString } from './parser';

const p = (s: string) => toString(parse(s));

function parseError(s: string): ParseError {
  try {
    parse(s);
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  throw new Error(`kein Fehler für "${s}"`);
}

describe('Präzedenz', () => {
  it('* und / binden stärker als + und −', () => {
    expect(p('1 + 2 * z')).toBe('(1 + (2 * z))');
    expect(p('z - 1 / z')).toBe('(z - (1 / z))');
  });
  it('+ − * / sind linksassoziativ', () => {
    expect(p('z - 1 - 2')).toBe('((z - 1) - 2)');
    expect(p('z / 2 / 3')).toBe('((z / 2) / 3)');
  });
  it('^ ist rechtsassoziativ', () => {
    expect(p('z^2^3')).toBe('(z ^ (2 ^ 3))');
  });
  it('^ bindet stärker als unäres −', () => {
    expect(p('-z^2')).toBe('(-(z ^ 2))');
    expect(p('2 * -z')).toBe('(2 * (-z))');
  });
  it('unäres − im Exponenten', () => {
    expect(p('z^-1')).toBe('(z ^ (-1))');
    expect(p('e^-z^2')).toBe('(e ^ (-(z ^ 2)))');
  });
  it('^ bindet stärker als *', () => {
    expect(p('2*z^3')).toBe('(2 * (z ^ 3))');
  });
  it('Klammern', () => {
    expect(p('(1 + z) * 2')).toBe('((1 + z) * 2)');
    expect(p('((z))')).toBe('z');
  });
});

describe('Implizite Multiplikation', () => {
  it('Zahl vor Symbol oder Klammer', () => {
    expect(p('2z')).toBe('(2 * z)');
    expect(p('3(z + 1)')).toBe('(3 * (z + 1))');
    expect(p('(z+1)(z-1)')).toBe('((z + 1) * (z - 1))');
    expect(p('2 sin(z)')).toBe('(2 * sin(z))');
  });
  it('bindet wie *: 2z^2 = 2·(z²)', () => {
    expect(p('2z^2')).toBe('(2 * (z ^ 2))');
    expect(p('1/2z')).toBe('((1 / 2) * z)');
  });
  it('zusammengeschriebene Symbole', () => {
    expect(p('iz')).toBe('(i * z)');
    expect(p('2piz')).toBe('((2 * pi) * z)');
  });
});

describe('Atome', () => {
  it('Zahlen, Konstanten, Funktionen', () => {
    expect(p('1.5e-3')).toBe('0.0015');
    expect(p('.5')).toBe('0.5');
    expect(p('pi + e + i')).toBe('((pi + e) + i)');
    expect(p('exp(log(z))')).toBe('exp(log(z))');
  });
  it('typografische Operatoren', () => {
    expect(p('z − 1')).toBe('(z - 1)');
    expect(p('2·z')).toBe('(2 * z)');
  });
});

describe('Fehler mit Position', () => {
  it('unbekannter Name', () => {
    const e = parseError('z + foo');
    expect(e.pos).toBe(4);
    expect(e.end).toBe(7);
  });
  it('fehlende schließende Klammer', () => {
    expect(parseError('(z + 1').message).toMatch(/Klammer/);
  });
  it('überzählige Klammer', () => {
    expect(parseError('z + 1)').pos).toBe(5);
  });
  it('unvollständiger Ausdruck', () => {
    expect(parseError('z +').pos).toBe(3);
    expect(parseError('').pos).toBe(0);
  });
  it('fehlender Operand', () => {
    expect(parseError('z * * 2').pos).toBe(4);
  });
  it('Funktion ohne Klammer', () => {
    expect(parseError('sin z').pos).toBe(4);
  });
  it('ungültiges Zeichen', () => {
    expect(parseError('z $ 2').pos).toBe(2);
  });
});
