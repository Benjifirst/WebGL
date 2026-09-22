import { createContext, createProgram, setUniform, ShaderCompileError } from './gl';
import type { ProgramInfo, UniformValue } from './gl';
import { interactiveQuality, tiles } from './tiles';
import type { Tile } from './tiles';
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

/** Beschreibung des gerade gezeichneten Bildes (virtuell; beim Export größer als der Canvas). */
export interface RenderFrame {
  /** Gesamtbild in Pixeln */
  width: number;
  height: number;
  /** Pixel pro CSS-Pixel des Gesamtbildes */
  pixelRatio: number;
  /** Aktuell gezeichneter Ausschnitt (Viewport) */
  tile: Tile;
}

export interface RendererHooks {
  /** Liefert alle Uniforms für den nächsten Frame. */
  uniforms(frame: RenderFrame): Uniforms;
  /** Ergebnis jeder Kompilierung: null = erfolgreich. */
  onCompile(error: ShaderCompileError | null, source: string): void;
  /** Größe der Zeichenfläche hat sich geändert. */
  onResize?(): void;
  /** Vor dem Fullscreen-Pass, z. B. um Texturen zu binden. */
  beforeDraw?(gl: WebGL2RenderingContext, frame: RenderFrame): void;
  /** Nach dem Fullscreen-Pass, z. B. für Geometrie mit Tiefentest. */
  afterDraw?(gl: WebGL2RenderingContext, frame: RenderFrame): void;
  /** Ein Bild auf dem Canvas ist fertig (nicht bei Export-Kacheln) – z. B. für die Beschriftungsebene. */
  onFrame?(): void;
}

interface Target {
  fbo: WebGLFramebuffer;
  color: WebGLTexture;
  depth: WebGLRenderbuffer;
  width: number;
  height: number;
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
  /** Während Interaktion reduzierte Auflösung erlauben (progressives Rendern) */
  interacting = false;
  /** Zuletzt gemessene GPU-Dauer eines Frames in voller Auflösung */
  lastFullMs = 0;

  private program: ProgramInfo | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private source = '';
  private dirty = false;
  private frameRequested = false;
  private lowRes: Target | null = null;
  private measuring = false;

  constructor(readonly canvas: HTMLCanvasElement, private readonly hooks: RendererHooks) {
    this.gl = createContext(canvas);
    this.initResources();
    this.observeSize();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.program = null;
      this.lowRes = null;
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
      this.lastFullMs = 0; // neuer Shader → Kosten neu messen
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

  /**
   * Zeichnet auf den Canvas. Während Interaktion ggf. in reduzierter Auflösung in einen
   * Zwischenpuffer und anschließend linear hochskaliert (blitFramebuffer).
   */
  render(): void {
    this.dirty = false;
    const gl = this.gl;
    if (!this.program || gl.isContextLost()) return;
    const q = this.interacting ? interactiveQuality(this.lastFullMs) : 1;
    if (q < 1) {
      const w = Math.max(1, Math.round(this.width * q));
      const h = Math.max(1, Math.round(this.height * q));
      const t = this.ensureTarget(this.lowRes, w, h);
      this.lowRes = t;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      this.drawFrame({
        width: w,
        height: h,
        pixelRatio: this.pixelRatio * (w / this.width),
        tile: { x: 0, y: 0, width: w, height: h },
      });
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.drawFrame({
        width: this.width,
        height: this.height,
        pixelRatio: this.pixelRatio,
        tile: { x: 0, y: 0, width: this.width, height: this.height },
      });
      this.measureFullFrame();
    }
    this.hooks.onFrame?.();
  }

  private drawFrame(frame: RenderFrame): void {
    const gl = this.gl;
    const p = this.program;
    if (!p) return;
    gl.viewport(0, 0, frame.tile.width, frame.tile.height);
    this.hooks.beforeDraw?.(gl, frame);
    gl.useProgram(p.program);
    const values = this.hooks.uniforms(frame);
    values.u_resolution = [frame.width, frame.height];
    values.u_tileOffset = [frame.tile.x, frame.tile.y];
    for (const [name, value] of Object.entries(values)) {
      const u = p.uniforms.get(name);
      if (u) setUniform(gl, u, value);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.hooks.afterDraw?.(gl, frame);
  }

  /** GPU-Dauer eines vollen Frames per Fence messen (Grundlage für die Interaktionsauflösung). */
  private measureFullFrame(): void {
    if (this.measuring) return;
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    gl.flush();
    this.measuring = true;
    const t0 = performance.now();
    const poll = () => {
      if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
        setTimeout(poll, 1);
        return;
      }
      gl.deleteSync(sync);
      this.measuring = false;
      this.lastFullMs = performance.now() - t0;
    };
    setTimeout(poll, 0);
  }

  private ensureTarget(t: Target | null, width: number, height: number): Target {
    const gl = this.gl;
    if (t && t.width === width && t.height === height) return t;
    if (t) this.deleteTarget(t);
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, color, depth, width, height };
  }

  private deleteTarget(t: Target): void {
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.color);
    this.gl.deleteRenderbuffer(t.depth);
  }

  /** Größte sichere Kachelgröße (MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE, Viewport, GPU-Laufzeit). */
  maxTileSize(): number {
    const gl = this.gl;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      dims[0] ?? 4096,
      dims[1] ?? 4096,
      1024, // kleine Kacheln halten jeden Draw-Call kurz (GPU-Watchdog)
    );
  }

  /**
   * Rendert ein Bild der Größe width × height kachelweise und liefert es als 2D-Canvas.
   * `pixelRatio` (Bildpixel pro CSS-Pixel) skaliert Maßstab und Linienbreiten passend zum Bild.
   */
  async renderImage(
    width: number,
    height: number,
    pixelRatio: number,
    onProgress?: (fraction: number) => void,
  ): Promise<HTMLCanvasElement> {
    const gl = this.gl;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('2D-Canvas nicht verfügbar');
    const size = this.maxTileSize();
    const list = tiles(width, height, size);
    const target = this.ensureTarget(null, size, size);
    const pixels = new Uint8Array(size * size * 4);
    try {
      for (let i = 0; i < list.length; i++) {
        const tile = list[i]!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        this.drawFrame({ width, height, pixelRatio, tile });
        gl.readPixels(0, 0, tile.width, tile.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // GL-Zeilen laufen von unten nach oben → beim Kopieren spiegeln
        const img = ctx.createImageData(tile.width, tile.height);
        const row = tile.width * 4;
        for (let y = 0; y < tile.height; y++) {
          img.data.set(pixels.subarray(y * row, (y + 1) * row), (tile.height - 1 - y) * row);
        }
        ctx.putImageData(img, tile.x, height - tile.y - tile.height);
        onProgress?.((i + 1) / list.length);
        await new Promise((r) => setTimeout(r, 0)); // Oberfläche zwischendurch reagieren lassen
      }
    } finally {
      this.deleteTarget(target);
      this.requestRender();
    }
    return out;
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
