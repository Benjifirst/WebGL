import { createContext, createProgram, setUniform, ShaderCompileError } from './gl';
import type { ProgramInfo, UniformValue } from './gl';
import preludeRaw from './prelude.glsl?raw';

export type Uniforms = Record<string, UniformValue>;

// Fullscreen-Triangle ohne Vertex-Buffer: drei Ecken aus gl_VertexID,
// (-1,-1), (3,-1), (-1,3) überdecken den Clip-Raum [-1,1]² vollständig.
const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID & 1) << 2), float((gl_VertexID & 2) << 1)) - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const PRELUDE = preludeRaw.replace(/\r\n?/g, '\n').trimEnd() + '\n';
/** Anzahl Präambel-Zeilen; Modul-Zeile n steht im Gesamtquelltext in Zeile n + PRELUDE_LINES. */
export const PRELUDE_LINES = PRELUDE.split('\n').length - 1;

export interface RendererHooks {
  /** Liefert alle Uniforms für den nächsten Frame. */
  uniforms(): Uniforms;
  /** Ergebnis jeder Kompilierung: null = erfolgreich. */
  onCompile(error: ShaderCompileError | null, source: string): void;
  /** Größe der Zeichenfläche hat sich geändert. */
  onResize?(): void;
  /** Vor dem Fullscreen-Pass, z. B. um Texturen zu binden. */
  beforeDraw?(gl: WebGL2RenderingContext): void;
  /** Nach dem Fullscreen-Pass, z. B. für Geometrie mit Tiefentest. */
  afterDraw?(gl: WebGL2RenderingContext): void;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  /** Zeichenfläche in Gerätepixeln */
  width = 1;
  height = 1;
  /** CSS-Größe */
  cssWidth = 1;
  cssHeight = 1;
  /** Gerätepixel pro CSS-Pixel (tatsächlich, nicht gerundet) */
  pixelRatio = 1;

  private program: ProgramInfo | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private source = '';
  private dirty = false;
  private frameRequested = false;

  constructor(readonly canvas: HTMLCanvasElement, private readonly hooks: RendererHooks) {
    this.gl = createContext(canvas);
    this.initResources();
    this.observeSize();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.program = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.initResources();
      this.setFragmentSource(this.source);
    });
  }

  private initResources(): void {
    this.vao = this.gl.createVertexArray();
  }

  /**
   * Kompiliert den Modul-Shader (ohne Präambel). Bei Fehler bleibt das letzte
   * gültige Programm aktiv; der Fehler geht an hooks.onCompile.
   */
  setFragmentSource(source: string): boolean {
    const gl = this.gl;
    this.source = source;
    try {
      const next = createProgram(gl, VERTEX_SOURCE, PRELUDE + source, PRELUDE_LINES);
      if (this.program) gl.deleteProgram(this.program.program);
      this.program = next;
      this.hooks.onCompile(null, source);
      this.requestRender();
      return true;
    } catch (e) {
      if (e instanceof ShaderCompileError) {
        this.hooks.onCompile(e, source);
        return false;
      }
      throw e;
    }
  }

  /** Markiert den Zustand als geändert; gezeichnet wird höchstens einmal pro Frame. */
  requestRender(): void {
    this.dirty = true;
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      if (this.dirty) this.render();
    });
  }

  render(): void {
    this.dirty = false;
    const gl = this.gl;
    const p = this.program;
    if (!p || gl.isContextLost()) return;
    gl.viewport(0, 0, this.width, this.height);
    this.hooks.beforeDraw?.(gl);
    gl.useProgram(p.program);
    const values = this.hooks.uniforms();
    values.u_resolution = [this.width, this.height];
    for (const [name, value] of Object.entries(values)) {
      const u = p.uniforms.get(name);
      if (u) setUniform(gl, u, value);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.hooks.afterDraw?.(gl);
  }

  /**
   * Eigenständiges Programm (ohne Präambel) für Module mit eigener Geometrie.
   * Fehler landen wie beim Modul-Shader im Overlay; Rückgabe null bei Fehler.
   */
  compileProgram(vertexSource: string, fragmentSource: string): ProgramInfo | null {
    try {
      const p = createProgram(this.gl, vertexSource, fragmentSource);
      this.hooks.onCompile(null, fragmentSource);
      return p;
    } catch (e) {
      if (!(e instanceof ShaderCompileError)) throw e;
      this.hooks.onCompile(e, e.stage === 'vertex' ? vertexSource : fragmentSource);
      return null;
    }
  }

  private observeSize(): void {
    const canvas = this.canvas;
    const maxDims = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const apply = (w: number, h: number, cssW: number, cssH: number) => {
      w = Math.max(1, Math.min(w, maxDims[0] ?? w));
      h = Math.max(1, Math.min(h, maxDims[1] ?? h));
      this.cssWidth = Math.max(cssW, 1e-6);
      this.cssHeight = Math.max(cssH, 1e-6);
      this.width = w;
      this.height = h;
      this.pixelRatio = w / this.cssWidth;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      this.hooks.onResize?.();
      // Größenänderung leert den Drawing-Buffer → sofort (vor dem Paint) neu zeichnen.
      this.render();
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const cssBox = entry.contentBoxSize?.[0];
      const cssW = cssBox ? cssBox.inlineSize : entry.contentRect.width;
      const cssH = cssBox ? cssBox.blockSize : entry.contentRect.height;
      const dpBox = entry.devicePixelContentBoxSize?.[0];
      if (dpBox) {
        // Exakte Gerätepixel – keine Rundungsfehler durch fraktionale DPR.
        apply(dpBox.inlineSize, dpBox.blockSize, cssW, cssH);
      } else {
        const dpr = window.devicePixelRatio || 1;
        apply(Math.round(cssW * dpr), Math.round(cssH * dpr), cssW, cssH);
      }
    });

    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      // Fallback (z. B. ältere Safari): DPR-Wechsel ohne CSS-Größenänderung
      // (Fenster auf anderen Monitor) per matchMedia erkennen.
      ro.observe(canvas, { box: 'content-box' });
      const watchDpr = () => {
        const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        mq.addEventListener(
          'change',
          () => {
            const r = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            apply(Math.round(r.width * dpr), Math.round(r.height * dpr), r.width, r.height);
            watchDpr();
          },
          { once: true },
        );
      };
      watchDpr();
    }
  }
}
