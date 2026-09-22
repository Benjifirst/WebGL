import { setUniform } from '../../core/gl';
import type { ProgramInfo } from '../../core/gl';
import type { Uniforms } from '../../core/renderer';

/**
 * Reguläres Dreiecksgitter über [0,1]² (a_uv an Location 0). Die eigentliche Fläche
 * entsteht im Vertex-Shader, daher bleibt das Gitter bei Formeländerungen gleich.
 */
export class GridMesh {
  private vao: WebGLVertexArrayObject | null = null;
  private indexCount = 0;
  private program: ProgramInfo | null = null;
  private gl: WebGL2RenderingContext | null = null;

  constructor(private readonly n = 200) {}

  setProgram(p: ProgramInfo): void {
    if (this.program && this.gl) this.gl.deleteProgram(this.program.program);
    this.program = p;
  }

  get hasProgram(): boolean {
    return this.program !== null;
  }

  private build(gl: WebGL2RenderingContext): void {
    const n = this.n;
    const uv = new Float32Array((n + 1) * (n + 1) * 2);
    for (let j = 0, k = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        uv[k++] = i / n;
        uv[k++] = j / n;
      }
    }
    const idx = new Uint32Array(n * n * 6);
    for (let j = 0, k = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx.set([a, b, d, a, d, c], k);
        k += 6;
      }
    }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = idx.length;
    this.gl = gl;
  }

  draw(gl: WebGL2RenderingContext, uniforms: Uniforms): void {
    const p = this.program;
    if (!p) return;
    if (this.gl !== gl || !this.vao) this.build(gl);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(p.program);
    for (const [name, value] of Object.entries(uniforms)) {
      const u = p.uniforms.get(name);
      if (u) setUniform(gl, u, value);
    }
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}
