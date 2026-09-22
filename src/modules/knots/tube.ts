// Schlauch um geschlossene Raumkurven als Dreiecksnetz (Position, Normale, Farbe) samt Zeichnen.
// Rahmen per Paralleltransport (verdrehungsarm); die Restverdrehung beim Schließen wird gleichmäßig
// auf die Kurve verteilt, damit sich der Schlauch nahtlos schließt.
import { setUniform } from '../../core/gl';
import type { ProgramInfo } from '../../core/gl';
import type { Uniforms } from '../../core/renderer';
import type { Link, P3 } from './curves';

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: P3, s: number): P3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): P3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Rodrigues-Drehung von v um die Einheitsachse k um den Winkel θ */
function rotate(v: P3, k: P3, th: number): P3 {
  const c = Math.cos(th), s = Math.sin(th);
  return addv(addv(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export interface TubeGeometry {
  data: Float32Array; // je Ecke: Position (3), Normale (3), Farbe (3)
  index: Uint32Array;
}

/** Mathematische Koordinaten (z oben) → Grafik (y oben) */
const toGl = (p: P3): P3 => [p[0], p[2], -p[1]];

export function buildTube(link: Link, colors: P3[], radius = 0.12, sides = 14): TubeGeometry {
  const verts: number[] = [];
  const idx: number[] = [];
  link.forEach((compIn, ci) => {
    const comp = compIn.map(toGl);
    const n = comp.length;
    if (n < 3) return;
    const color = colors[ci % colors.length]!;
    const T = comp.map((_, i) => norm(sub(comp[(i + 1) % n]!, comp[(i - 1 + n) % n]!)));
    // Startnormale senkrecht zur ersten Tangente
    const a: P3 = Math.abs(T[0]![1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const N: P3[] = [norm(cross(cross(T[0]!, a), T[0]!))];
    for (let i = 1; i <= n; i++) {
      const t0 = T[i - 1]!, t1 = T[i % n]!;
      const axis = cross(t0, t1);
      const s = Math.hypot(...axis);
      const prev = N[i - 1]!;
      N.push(s < 1e-12 ? prev : norm(rotate(prev, scale(axis, 1 / s), Math.atan2(s, dot(t0, t1)))));
    }
    // Restverdrehung zwischen N[n] (nach einem Umlauf) und N[0]
    const nEnd = N[n]!;
    const twist = Math.atan2(dot(cross(nEnd, N[0]!), T[0]!), dot(nEnd, N[0]!));
    const base = verts.length / 9;
    for (let i = 0; i < n; i++) {
      const t = T[i]!;
      const nn = rotate(N[i]!, t, (twist * i) / n);
      const b = cross(t, nn);
      for (let j = 0; j < sides; j++) {
        const ang = (2 * Math.PI * j) / sides;
        const dir = addv(scale(nn, Math.cos(ang)), scale(b, Math.sin(ang)));
        const p = addv(comp[i]!, scale(dir, radius));
        verts.push(...p, ...dir, ...color);
      }
    }
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        const a0 = base + i * sides + j, a1 = base + i * sides + j1;
        const b0 = base + i1 * sides + j, b1 = base + i1 * sides + j1;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
  });
  return { data: new Float32Array(verts), index: new Uint32Array(idx) };
}

/** Hält ein Netz auf der GPU und zeichnet es mit einem Programm */
export class MeshBuffer {
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private count = 0;
  private gl: WebGL2RenderingContext | null = null;
  private pending: TubeGeometry | null = null;
  private geom: TubeGeometry | null = null;

  set(geom: TubeGeometry): void {
    this.pending = geom;
    this.geom = geom;
  }

  draw(gl: WebGL2RenderingContext, program: ProgramInfo, uniforms: Uniforms): void {
    if (this.gl !== gl) {
      // neuer Kontext (z. B. nach Kontextverlust): Netz neu hochladen
      this.vao = null;
      this.buffers = [];
      this.gl = gl;
      this.pending = this.geom;
    }
    if (this.pending) this.upload(gl, this.pending);
    if (!this.vao || !this.count) return;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program.program);
    for (const [name, value] of Object.entries(uniforms)) {
      const u = program.uniforms.get(name);
      if (u) setUniform(gl, u, value);
    }
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  private upload(gl: WebGL2RenderingContext, g: TubeGeometry): void {
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW);
    const stride = 9 * 4;
    for (let loc = 0; loc < 3; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, stride, loc * 12);
    }
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.buffers = [vb, ib];
    this.count = g.index.length;
    this.pending = null;
  }
}
