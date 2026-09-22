import type { ModuleHost, VizModule } from '../types';
import type { ViewState } from '../../core/view';
import { read } from '../../ui/urlState';
import { drawAxes2D } from '../../ui/axes';
import { chips, h, slider, toggle } from '../../ui/widgets';
import { fromDecimal, fromDouble, toDecimal, toDouble, withBits } from './bigfixed';
import { computeOrbit } from './orbit';
import type { OrbitRequest, OrbitResponse } from './orbit.worker';
import type { NucleusRequest, NucleusResponse } from './nucleus.worker';
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

/** Zuletzt gefundenes Minibrot – steht die Ansicht noch darauf, sucht der nächste Klick tiefer */
let lastNucleus: (HP & { period: number; size: number }) | null = null;
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

/** Obergrenze der Minibrot-Suche: um Minibrots der Periode P entkommen Punkte erst nach
 *  bis zu ~64·P Iterationen – darüber wird es ohne Bilinear-Approximation zu rechenintensiv. */
const MAX_SEARCH_PERIOD = 2000;

/** Periode des gefundenen Minibrots, wenn die Ansicht in seiner Nähe ist (sonst 0) */
function nearbyPeriod(): number {
  if (!lastNucleus || !host) return 0;
  const v = host.view;
  const [dx, dy] = diff(anchor, lastNucleus);
  return Math.hypot(dx + v.cx, dy + v.cy) < 10 * lastNucleus.size ? lastNucleus.period : 0;
}

function iterations(scale: number): number {
  if (!autoIter) return manualIter;
  // Nahe einem Minibrot der Periode P: genug Iterationen für seine Umgebung (≈ 64 Umläufe)
  const it = Math.max(500 + 400 * depth(scale), 64 * nearbyPeriod());
  return Math.round(Math.min(100000, it));
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

// ---------------------------------------------------------------------------
// Minibrot-Suche im Worker

let nucleusWorker: Worker | null = null;

function searchMinibrot(hst: ModuleHost, report: (text: string) => void): void {
  nucleusWorker?.terminate();
  const v = hst.view;
  const bits = needBits(v.scale) + 32;
  const cx = withBits(anchor.x, anchor.bits, bits) + fromDouble(v.cx, bits);
  const cy = withBits(anchor.y, anchor.bits, bits) + fromDouble(v.cy, bits);
  // Suchradius: halbe kürzere Bildkante
  const radius = (v.scale * Math.min(window.innerWidth, window.innerHeight)) / 2;
  // Ansicht noch auf dem letzten Fund (Abstand < 1 % der Bildgröße)? Dann nur höhere Perioden.
  let deeper: NucleusRequest['deeper'];
  if (lastNucleus) {
    const [dx, dy] = diff({ x: cx, y: cy, bits }, lastNucleus);
    if (Math.hypot(dx, dy) < radius * 0.02) deeper = { period: lastNucleus.period, size: lastNucleus.size };
  }
  const req: NucleusRequest = { cx, cy, bits, log2r: Math.log2(radius), maxPeriod: MAX_SEARCH_PERIOD, deeper };
  const w = new Worker(new URL('./nucleus.worker.ts', import.meta.url), { type: 'module' });
  nucleusWorker = w;
  report('Suche …');
  w.onmessage = (e: MessageEvent<NucleusResponse>) => {
    w.terminate();
    if (nucleusWorker === w) nucleusWorker = null;
    const r = e.data;
    if (!r.ok) {
      report(r.reason);
      return;
    }
    anchor = { x: r.x, y: r.y, bits: r.bits };
    lastNucleus = { ...anchor, period: r.period, size: r.size };
    // Minibrot füllt etwa 40 % der kürzeren Bildkante
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    const scale = r.size > 0 ? Math.max(MIN_SCALE, (r.size * 2.5) / minDim) : v.scale;
    hst.setView({ cx: 0, cy: 0, scale });
    startJob(hst);
    report(`Periode ${r.period} · Größe ${r.size.toExponential(2)}`);
  };
  w.postMessage(req);
}

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
      // Um ein Minibrot der Periode P unterscheiden sich benachbarte Bänder um ~P Iterationen:
      // Farbperiode mitskalieren, sonst springt die Palette von Pixel zu Pixel
      u_period: period * Math.max(1, nearbyPeriod() / 64),
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
      // Gefundenes Minibrot (Periode, Größe): bestimmt Iterationen und Farbperiode in seiner Nähe
      ...(lastNucleus && nearbyPeriod() ? { np: lastNucleus.period, ns: lastNucleus.size.toPrecision(4) } : {}),
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
    const np = read.num(p, 'np', 0, 0, 1e6);
    const ns = read.num(p, 'ns', 0, 0, 1);
    lastNucleus = np > 0 && ns > 0 ? { ...anchor, period: Math.round(np), size: ns } : null;
    return { cx: 0, cy: 0, scale };
  },

  drawOverlay(ctx, i) {
    if (!i.axes) return;
    // Absolut beschriftet, solange es lesbar bleibt; tiefer schaltet drawAxes2D auf Δ zur Bildmitte
    // um (deren volle Koordinate steht im Panel)
    const shift: [number, number] = [toDouble(anchor.x, anchor.bits), toDouble(anchor.y, anchor.bits)];
    drawAxes2D(ctx, i.view, i.width, i.height, { xName: 'Re', yName: 'Im', shift });
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

    const searchInfo = h('span', { class: 'hint' });
    const search = h('button', { type: 'button', class: 'chip accent', title: 'Nächstes Mini-Mandelbrot im Bild suchen und hineinzoomen' }, 'Minibrot suchen');
    search.addEventListener('click', () => searchMinibrot(hst, (t) => (searchInfo.textContent = t)));

    container.append(
      chips(PRESETS.map((p) => ({ label: p.label, title: `${p.re} + ${p.im}i`, onClick: () => goTo(hst, p.re, p.im, p.scale) }))),
      h('div', { class: 'row' }, search, searchInfo),
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
      h(
        'p',
        { class: 'hint' },
        'Zoom per Mausrad bis ~1e-290. „Minibrot suchen“ findet beliebig tiefe Ziele mit Struktur. Glitch-Markierung wirkt nur ohne Rebasing.',
      ),
    );
    if (autoZoom) setAutoZoom(true);
    return () => {
      cancelAnimationFrame(zoomFrame);
      clearTimeout(checkTimer);
      nucleusWorker?.terminate();
      nucleusWorker = null;
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
