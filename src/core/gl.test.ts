import { describe, expect, it } from 'vitest';
import { parseShaderLog } from './gl';
import { PRELUDE_LINES } from './renderer';
import prelude from './prelude.glsl?raw';

describe('parseShaderLog', () => {
  it('parses ANGLE-style logs and subtracts the prelude offset', () => {
    const log = "ERROR: 0:25: 'undefinedSymbol' : undeclared identifier\nERROR: 0:25: '' : compilation terminated\n\0";
    expect(parseShaderLog(log, 12)).toEqual([
      { line: 13, message: "'undefinedSymbol' : undeclared identifier" },
      { line: 13, message: "'' : compilation terminated" },
    ]);
  });

  it('parses NVIDIA-style logs', () => {
    expect(parseShaderLog('0(40) : error C1008: undefined variable "x"', 10)).toEqual([
      { line: 30, message: 'error C1008: undefined variable "x"' },
    ]);
  });

  it('keeps unrecognized lines without line number', () => {
    expect(parseShaderLog('2 compilation errors.  No code generated.', 0)).toEqual([
      { line: null, message: '2 compilation errors.  No code generated.' },
    ]);
  });
});

describe('prelude', () => {
  it('starts with #version and PRELUDE_LINES counts its lines', () => {
    const lines = prelude.replace(/\r\n?/g, '\n').trimEnd().split('\n');
    expect(lines[0]).toBe('#version 300 es');
    expect(PRELUDE_LINES).toBe(lines.length);
  });
});
