import type { ModuleHost, VizModule } from '../types';
import type { ViewState } from '../../core/view';
import { read } from '../../ui/urlState';
import { chips, h, slider, toggle } from '../../ui/widgets';
import { fromDecimal, fromDouble, toDecimal, toDouble, withBits } from './bigfixed';
import { computeOrbit } from './orbit';
import type { OrbitRequest, OrbitResponse } from './orbit.worker';
import mandelbrotSrc from './mandelbrot.frag?raw';

// Präzision
// Der Bildmittelpunkt ist ein Anker in beliebiger Präzision (bigint) plus ein double-Offset
// (view.cx, view.cy), auf dem Pan und Zoom wie gewohnt arbeiten. Beim Neuberechnen der
// Referenz wird der Offset in den Anker übernommen, sodass er klein und double-genau bleibt.

interface HP {
  x: bigint;
  y: bigint;
  bits: number;
}

interface Reference extends HP {
  data: Float32Array;
  length: number;
  escaped: boolean;
  maxIter: number;
  dirty: boolean;
}

const ORBIT_W = 2048; // wie im Shader
const MIN_SCALE = 1e-290; // double-Grenze für Maßstab und Offsets

const PRESETS: readonly { label: string; re: string; im: string; scale: number }[] = [
  { label: 'Übersicht', re: '-0.6', im: '0', scale: 0 },
  {
    label: 'Seepferdchental',
    re: '-0.743643887037158704752191506114774',
    im: '0.131825904205311970493132056385139',
    scale: 1e-4,
  },
  { label: 'Misiurewicz i', re: '0', im: '1', scale: 1e-3 },
  { label: 'Feigenbaum', re: '-1.401155189092050600527', im: '0', scale: 1e-3 },
  { label: 'Spitze −2', re: '-2', im: '0', scale: 1e-3 },
];

let source = mandelbrotSrc;
let anchor: HP = { x: fromDouble(-0.6, 64), y: 0n, bits: 64 };
let ref: Reference = computeReference(anchor, 2000);
let host: ModuleHost | null = null;

let autoIter = true;
let manualIter = 2000;
let period = 64;
let phase = 0;
let rebase = true;
let showGlitch = false;
let autoZoom = false;

let coordsEl: HTMLElement | null = null;
let referenceOnStart = false;
let lastCoords = '';

/** Benötigte Nachkommabits für einen Maßstab (Welt pro Pixel) plus Reserve */
function needBits(scale: number): number {
  return Math.max(64, Math.ceil(-Math.log2(scale)) + 48);
}

function computeReference(c: HP, maxIter: number): Reference {
  const r = computeOrbit(c.x, c.y, c.bits, maxIter);
  return { ...c, data: r.data.slice(0, 2 * r.length), length: r.length, escaped: r.escaped, maxIter, dirty: true };
}

/** Zoomtiefe relativ zur Übersicht (≈ 3 Einheiten Bildhöhe) */
function depth(scale: number): number {
  return Math.max(0, Math.log10(3 / (scale * window.innerHeight)));
}

function iterations(scale: number): number {
  if (!autoIter) return manualIter;
  return Math.round(Math.min(100000, 500 + 400 * depth(scale)));
}

/** a − b (Festkomma, gemeinsame Präzision) als double */
function diff(a: HP, b: HP): [number, number] {
  const bits = Math.max(a.bits, b.bits);
  return [
    toDouble(withBits(a.x, a.bits, bits) - withBits(b.x, b.bits, bits), bits),
    toDouble(withBits(a.y, a.bits, bits) - withBits(b.y, b.bits, bits), bits),
  ];
}

/** 2^e auch für |e| > 1023 */
function pow2(e: number): number {
  const a = Math.trunc(e / 2);
  return 2 ** a * 2 ** (e - a);
}

// ---------------------------------------------------------------------------
// Referenzorbit im Worker

let worker: Worker | null = null;
let job: { id: number; target: HP; maxIter: number; progress: number } | null = null;
let jobId = 0;
let checkTimer = 0;

function startJob(hst: ModuleHost): void {
  const v = hst.view;
  const bits = needBits(v.scale) + 16;
  // Offset in den Anker übernehmen: neuer Anker = Bildmitte, Offset = 0
  anchor = {
    x: withBits(anchor.x, anchor.bits, bits) + fromDouble(v.cx, bits),
    y: withBits(anchor.y, anchor.bits, bits) + fromDouble(v.cy, bits),
    bits,
  };
  hst.setView({ cx: 0, cy: 0, scale: v.scale });

  const maxIter = iterations(v.scale);
  // Laufenden Auftrag verwerfen (ein Worker rechnet synchron und ist nicht unterbrechbar)
  if (job && worker) {
    worker.terminate();
    worker = null;
  }
  worker ??= createWorker();
  const id = ++jobId;
  job = { id, target: { ...anchor }, maxIter, progress: 0 };
  const req: OrbitRequest = { id, cx: anchor.x, cy: anchor.y, bits, maxIter };
  worker.postMessage(req);
}

function createWorker(): Worker {
  const w = new Worker(new URL('./orbit.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<OrbitResponse>) => {
    const msg = e.data;
    if (!job || msg.id !== job.id) return;
    if ('progress' in msg) {
      job.progress = msg.progress;
    } else {
      ref = { ...job.target, data: msg.data, length: msg.length, escaped: msg.escaped, maxIter: job.maxIter, dirty: true };
      job = null;
    }
    host?.requestRender();
  };
  return w;
}

/** Nach Ruhe im Bild prüfen, ob eine neue Referenz nötig ist. */
function scheduleCheck(): void {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    const hst = host;
    if (!hst) return;
    const v = hst.view;
    const base: HP & { maxIter: number; escaped: boolean } = job
      ? { ...job.target, maxIter: job.maxIter, escaped: false }
      : ref;
    const [dx, dy] = diff(anchor, base);
    const distPx = Math.hypot(dx + v.cx, dy + v.cy) / v.scale;
    const screen = Math.max(window.innerWidth, window.innerHeight);
    const need =
      needBits(v.scale) > base.bits || // Präzision reicht nicht mehr
      distPx > 1.5 * screen || // Referenz weit außerhalb
      (!base.escaped && iterations(v.scale) > 1.5 * base.maxIter); // Referenz zu kurz
    if (need) startJob(hst);
  }, 250);
}

// ---------------------------------------------------------------------------
// Textur

let texture: WebGLTexture | null = null;
let textureGl: WebGL2RenderingContext | null = null;

function uploadReference(gl: WebGL2RenderingContext): void {
  if (!texture || textureGl !== gl) {
    texture = gl.createTexture();
    textureGl = gl;
    ref.dirty = true;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!ref.dirty) return;
  const rows = Math.ceil(ref.length / ORBIT_W);
  const buf = new Float32Array(ORBIT_W * rows * 2);
  buf.set(ref.data.subarray(0, 2 * ref.length));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, ORBIT_W, rows, 0, gl.RG, gl.FLOAT, buf);
  ref.dirty = false;
}

// ---------------------------------------------------------------------------
// Auto-Zoom

let zoomFrame = 0;
let lastTime = 0;
function zoomStep(time: number) {
  const hst = host;
  if (!autoZoom || !hst) return;
  if (lastTime) {
    const dt = Math.min(time - lastTime, 50) / 1000;
    const v = hst.view;
    const scale = Math.max(MIN_SCALE, v.scale * Math.exp(-0.9 * dt)); // ≈ Faktor 2,5 pro Sekunde
    hst.setView({ ...v, scale });
    if (scale <= MIN_SCALE) return;
  }
  lastTime = time;
  zoomFrame = requestAnimationFrame(zoomStep);
}
function setAutoZoom(on: boolean) {
  autoZoom = on;
  cancelAnimationFrame(zoomFrame);
  lastTime = 0;
  if (on) zoomFrame = requestAnimationFrame(zoomStep);
}

function goTo(hst: ModuleHost, re: string, im: string, scale: number): void {
  const bits = Math.max(256, Math.ceil(Math.max(re.length, im.length) * 3.33) + 32);
  anchor = { x: fromDecimal(re, bits), y: fromDecimal(im, bits), bits };
  hst.setView({ cx: 0, cy: 0, scale: scale || overviewScale() });
  startJob(hst);
}

const overviewScale = () => 3.2 / Math.max(window.innerHeight, 1);

function updateCoords(v: ViewState): void {
  if (!coordsEl) return;
  const bits = Math.max(anchor.bits, needBits(v.scale));
  const x = withBits(anchor.x, anchor.bits, bits) + fromDouble(v.cx, bits);
  const y = withBits(anchor.y, anchor.bits, bits) + fromDouble(v.cy, bits);
  const digits = Math.min(320, Math.max(4, Math.ceil(-Math.log10(v.scale)) + 2));
  const text = `Re ${toDecimal(x, bits, digits)}\nIm ${toDecimal(y, bits, digits)}`;
  if (text !== lastCoords) {
    coordsEl.textContent = text;
    lastCoords = text;
  }
}

// ---------------------------------------------------------------------------

export const mandelbrotModule: VizModule = {
  id: 'mandelbrot',
  name: 'Mandelbrot',
  get initialView() {
    return { cx: -0.6 - toDouble(anchor.x, anchor.bits), cy: -toDouble(anchor.y, anchor.bits), scale: overviewScale() };
  },
  scaleRange: [MIN_SCALE, 0.05],

  get fragSource() {
    return source;
  },

  uniforms({ view, pixelRatio }) {
    const s = view.scale / pixelRatio; // Welt pro Gerätepixel
    const e = Math.floor(Math.log2(s));
    const inv = pow2(-e);
    const [dx, dy] = diff(anchor, ref);
    scheduleCheck();
    updateCoords(view);
    return {
      u_orbit: 0,
      u_refLen: ref.length,
      u_maxIter: iterations(view.scale),
      u_scaleM: s * inv,
      u_scaleE: e,
      // (Bildmitte − Referenz) in Einheiten von 2^e; Anker−Referenz exakt, Offset in double
      u_offM: [(dx + view.cx) * inv, (dy + view.cy) * inv],
      u_rebase: rebase ? 1 : 0,
      u_showGlitch: showGlitch ? 1 : 0,
      u_period: period,
      u_phase: phase,
    };
  },

  saveState(view) {
    // Absolute Bildmitte in voller Präzision; x/y = 0, da der Anker sie bereits enthält
    const bits = Math.max(anchor.bits, needBits(view.scale));
    const digits = Math.min(320, Math.max(6, Math.ceil(-Math.log10(view.scale)) + 4));
    const x = withBits(anchor.x, anchor.bits, bits) + fromDouble(view.cx, bits);
    const y = withBits(anchor.y, anchor.bits, bits) + fromDouble(view.cy, bits);
    return {
      x: 0,
      y: 0,
      re: toDecimal(x, bits, digits).replace(/\.?0+$/, ''),
      im: toDecimal(y, bits, digits).replace(/\.?0+$/, ''),
      per: +period.toFixed(2),
      ph: phase,
      it: autoIter ? 'auto' : manualIter,
      rb: rebase,
      gl: showGlitch,
    };
  },

  loadState(p, v) {
    period = read.num(p, 'per', period, 4, 1024);
    phase = read.num(p, 'ph', phase, 0, 1);
    const it = p.get('it');
    autoIter = it === null || it === 'auto';
    if (!autoIter) manualIter = Math.round(read.num(p, 'it', manualIter, 100, 100000));
    rebase = read.bool(p, 'rb', rebase);
    showGlitch = read.bool(p, 'gl', showGlitch);
    const re = p.get('re');
    const im = p.get('im');
    if (!re || !im) return;
    const scale = Math.max(MIN_SCALE, v.scale ?? overviewScale());
    try {
      const bits = Math.max(needBits(scale), Math.ceil(Math.max(re.length, im.length) * 3.33) + 32);
      anchor = { x: fromDecimal(re, bits), y: fromDecimal(im, bits), bits };
    } catch {
      return;
    }
    referenceOnStart = true; // Referenz sofort für den Link-Ort berechnen (sobald host bekannt)
    return { cx: 0, cy: 0, scale };
  },

  prepare(gl) {
    uploadReference(gl);
  },

  status() {
    const v = host?.view;
    if (!v) return '';
    const refInfo = job ? `Referenz ${Math.round(job.progress * 100)} %` : `Referenz ${ref.length}`;
    return `Maßstab ${v.scale.toExponential(1)} · ${iterations(v.scale)} Iter · ${refInfo} · ${ref.bits} bit`;
  },

  ui(container, hst) {
    host = hst;
    if (referenceOnStart) {
      referenceOnStart = false;
      queueMicrotask(() => startJob(hst));
    }
    coordsEl = h('pre', { class: 'coords', title: 'Bildmitte (markieren zum Kopieren)' });
    lastCoords = '';
    updateCoords(hst.view);

    const iterBox = h('div', { class: 'params' });
    const buildIter = () =>
      iterBox.replaceChildren(
        ...(autoIter
          ? []
          : [
              slider(
                'Iterationen',
                { min: 2, max: 5, step: 0.05, value: Math.log10(manualIter), format: (v) => String(Math.round(10 ** v)) },
                (v) => ((manualIter = Math.round(10 ** v)), hst.requestRender()),
              ),
            ]),
      );
    buildIter();

    container.append(
      chips(PRESETS.map((p) => ({ label: p.label, title: `${p.re} + ${p.im}i`, onClick: () => goTo(hst, p.re, p.im, p.scale) }))),
      coordsEl,
      h(
        'div',
        { class: 'params' },
        slider(
          'Farbperiode',
          { min: 2, max: 10, step: 0.1, value: Math.log2(period), format: (v) => String(Math.round(2 ** v)) },
          (v) => ((period = 2 ** v), hst.requestRender()),
        ),
        slider('Farbphase', { min: 0, max: 1, step: 0.01, value: phase }, (v) => ((phase = v), hst.requestRender())),
      ),
      iterBox,
      h(
        'div',
        { class: 'toggles' },
        toggle('Auto-Iterationen', autoIter, (v) => {
          autoIter = v;
          buildIter();
          hst.requestRender();
        }),
        toggle('Auto-Zoom', autoZoom, setAutoZoom),
        toggle('Rebasing', rebase, (v) => ((rebase = v), hst.requestRender())),
        toggle('Glitches markieren', showGlitch, (v) => ((showGlitch = v), hst.requestRender())),
      ),
      h('p', { class: 'hint' }, 'Zoom per Mausrad bis ~1e-290. Glitch-Markierung wirkt nur ohne Rebasing.'),
    );
    if (autoZoom) setAutoZoom(true);
    return () => {
      cancelAnimationFrame(zoomFrame);
      clearTimeout(checkTimer);
      coordsEl = null;
      host = null;
    };
  },
};

if (import.meta.hot) {
  import.meta.hot.accept('./mandelbrot.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
