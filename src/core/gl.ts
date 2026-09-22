// WebGL2-Grundlagen: Kontext, Compile/Link, Fehlerlog → Zeilennummern.

export interface ShaderDiagnostic {
  /** Zeile im Modul-Quelltext (1-basiert), null wenn nicht zuordenbar, ≤ 0 = Präambel */
  line: number | null;
  message: string;
}

export class ShaderCompileError extends Error {
  constructor(
    readonly stage: 'vertex' | 'fragment' | 'link',
    readonly diagnostics: ShaderDiagnostic[],
    readonly log: string,
  ) {
    super(`${stage} shader error:\n${log}`);
    this.name = 'ShaderCompileError';
  }
}

// Gängige Logformate:
//   ANGLE / Mesa / Chrome:  "ERROR: 0:12: 'x' : undeclared identifier"
//   NVIDIA-artig:           "0(12) : error C1008: undefined variable"
const LOG_PATTERNS: RegExp[] = [
  /^\s*(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i,
  /^\s*\d+\((\d+)\)\s*:\s*(.*)$/,
];

/**
 * Zerlegt ein Info-Log in Einzelmeldungen. `lineOffset` = Anzahl der Zeilen,
 * die vor dem Modul-Quelltext eingefügt wurden (Präambel).
 */
export function parseShaderLog(log: string, lineOffset: number): ShaderDiagnostic[] {
  const out: ShaderDiagnostic[] = [];
  for (const raw of log.split(/\r?\n/)) {
    const text = raw.replace(/\0/g, '').trim();
    if (!text) continue;
    let matched = false;
    for (const re of LOG_PATTERNS) {
      const m = re.exec(text);
      if (m) {
        out.push({ line: Number(m[1]) - lineOffset, message: (m[2] ?? '').trim() });
        matched = true;
        break;
      }
    }
    if (!matched) out.push({ line: null, message: text });
  }
  return out;
}

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true, // für Mesh-Module (parametrische Flächen)
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 wird von diesem Browser nicht unterstützt.');
  return gl;
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  lineOffset = 0,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader fehlgeschlagen');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new ShaderCompileError(stage, parseShaderLog(log, lineOffset), log);
  }
  return shader;
}

export interface UniformInfo {
  location: WebGLUniformLocation;
  type: GLenum;
  size: number;
}

export interface ProgramInfo {
  program: WebGLProgram;
  uniforms: Map<string, UniformInfo>;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  fragmentLineOffset = 0,
): ProgramInfo {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fs: WebGLShader;
  try {
    fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, fragmentLineOffset);
  } catch (e) {
    gl.deleteShader(vs);
    throw e;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new ShaderCompileError('link', parseShaderLog(log, fragmentLineOffset), log);
  }

  // Aktive Uniforms mit Typ erfassen, damit das Setzen typgerecht erfolgt.
  const uniforms = new Map<string, UniformInfo>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (!location) continue;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms.set(name, { location, type: info.type, size: info.size });
  }
  return { program, uniforms };
}

export type UniformValue = number | boolean | ArrayLike<number>;

/** Setzt ein Uniform anhand des per getActiveUniform ermittelten Typs. */
export function setUniform(gl: WebGL2RenderingContext, u: UniformInfo, value: UniformValue): void {
  const data: ArrayLike<number> =
    typeof value === 'number' ? [value] : typeof value === 'boolean' ? [value ? 1 : 0] : value;
  const f = data instanceof Float32Array ? data : Float32Array.from(data);
  const loc = u.location;
  switch (u.type) {
    case gl.FLOAT: gl.uniform1fv(loc, f); break;
    case gl.FLOAT_VEC2: gl.uniform2fv(loc, f); break;
    case gl.FLOAT_VEC3: gl.uniform3fv(loc, f); break;
    case gl.FLOAT_VEC4: gl.uniform4fv(loc, f); break;
    case gl.FLOAT_MAT2: gl.uniformMatrix2fv(loc, false, f); break;
    case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, f); break;
    case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, f); break;
    case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(loc, Int32Array.from(data)); break;
    case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv(loc, Int32Array.from(data)); break;
    case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv(loc, Int32Array.from(data)); break;
    case gl.UNSIGNED_INT: gl.uniform1uiv(loc, Uint32Array.from(data)); break;
    default: gl.uniform1iv(loc, Int32Array.from(data)); // INT, BOOL, Sampler
  }
}
