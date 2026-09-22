import './style.css';
import { Renderer } from './core/renderer';
import type { RenderFrame } from './core/renderer';
import { MAX_SCALE, MIN_SCALE, ViewController } from './core/view';
import type { ViewState } from './core/view';
import { domainModule } from './modules/domain/module';
import { gridModule } from './modules/grid/module';
import { hyperbolicModule } from './modules/hyperbolic/module';
import { mandelbrotModule } from './modules/mandelbrot/module';
import { shapesModule } from './modules/shapes/module';
import { topologyModule } from './modules/topology/module';
import type { FrameInfo, ModuleHost, VizModule } from './modules/types';
import { createControls } from './ui/controls';
import { ErrorOverlay } from './ui/errorOverlay';
import { decodeHash, encodeHash } from './ui/urlState';
import type { DecodedHash } from './ui/urlState';

const modules: readonly VizModule[] = [domainModule, shapesModule, hyperbolicModule, mandelbrotModule, topologyModule, gridModule];

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const overlay = new ErrorOverlay(document.querySelector<HTMLElement>('#error-overlay')!);
const panel = document.querySelector<HTMLElement>('#panel')!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
const overlayCtx = overlayCanvas.getContext('2d')!;
let axes = true;

let active: VizModule = modules[0]!;
let disposeModuleUi: (() => void) | null = null;
let hover: [number, number] | null = null;

const frameInfo = (f: RenderFrame): FrameInfo => ({
  view: view.state,
  width: f.width,
  height: f.height,
  pixelRatio: f.pixelRatio,
  tile: f.tile,
});

const renderer = new Renderer(canvas, {
  uniforms(f) {
    const v = view.state;
    return {
      u_center: [v.cx, v.cy],
      u_scale: v.scale / f.pixelRatio, // Welt pro Bildpixel
      u_pixelRatio: f.pixelRatio,
      ...active.uniforms(frameInfo(f)),
    };
  },
  beforeDraw(gl) {
    active.prepare?.(gl);
  },
  afterDraw(gl, f) {
    active.draw?.(gl, frameInfo(f));
  },
  onCompile(error, source) {
    if (error) overlay.show(error, source);
    else overlay.hide();
  },
  onFrame: () => drawOverlay(),
});

/** Beschriftungsebene in Gerätepixeln (scharfe Schrift), gezeichnet in CSS-Pixeln */
function drawOverlay(): void {
  const w = renderer.cssWidth;
  const h = renderer.cssHeight;
  const pr = renderer.pixelRatio;
  if (overlayCanvas.width !== renderer.width || overlayCanvas.height !== renderer.height) {
    overlayCanvas.width = renderer.width;
    overlayCanvas.height = renderer.height;
  }
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.setTransform(pr, 0, 0, pr, 0, 0);
  active.drawOverlay?.(overlayCtx, { view: view.state, width: w, height: h, axes });
}

// ---- Progressive Auflösung: während Interaktion reduziert, danach voll ----
let interactionTimer = 0;
function interact(): void {
  renderer.interacting = true;
  clearTimeout(interactionTimer);
  interactionTimer = window.setTimeout(() => {
    renderer.interacting = false;
    renderer.requestRender();
  }, 180);
}

const host: ModuleHost = {
  requestRender() {
    interact();
    renderer.requestRender();
    scheduleHash();
  },
  recompile() {
    renderer.setFragmentSource(active.fragSource);
    scheduleHash();
  },
  get view() {
    return view.state;
  },
  setView: (v) => (view.state = v),
  createProgram: (vs, fs) => renderer.compileProgram(vs, fs),
};

const view = new ViewController(canvas, {
  onChange() {
    interact();
    renderer.requestRender();
    updateStatus();
    scheduleHash();
  },
  onPointer: (e) => active.onPointer?.(e, host) ?? false,
  onHover(x, y) {
    hover = [x, y];
    updateStatus();
  },
});

const controls = createControls(panel, {
  modules,
  onSelect: (m) => activate(m),
  onResetView: () => (view.state = active.initialView),
  shareLink: () => {
    writeHash();
    return location.href;
  },
  axes,
  onAxes(on) {
    axes = on;
    renderer.requestRender();
    scheduleHash();
  },
  exportSize: (factor) => ({ width: renderer.width * factor, height: renderer.height * factor }),
  async exportImage(factor, smooth, onProgress) {
    const W = renderer.width * factor;
    const H = renderer.height * factor;
    // Kantenglättung: doppelt so groß rendern, dann hochwertig herunterskalieren
    const ss = smooth ? 2 : 1;
    const big = await renderer.renderImage(W * ss, H * ss, renderer.pixelRatio * factor * ss, onProgress);
    let img = big;
    if (ss > 1) {
      img = document.createElement('canvas');
      img.width = W;
      img.height = H;
      const ctx = img.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(big, 0, 0, W, H);
      big.width = big.height = 0; // Speicher freigeben
    }
    // Beschriftung im gleichen Verhältnis zum Bild wie auf dem Bildschirm übernehmen
    const ctx = img.getContext('2d')!;
    ctx.setTransform(renderer.pixelRatio * factor, 0, 0, renderer.pixelRatio * factor, 0, 0);
    active.drawOverlay?.(ctx, { view: view.state, width: renderer.cssWidth, height: renderer.cssHeight, axes });
    const blob = await new Promise<Blob | null>((r) => img.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG-Kodierung fehlgeschlagen');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mathviz-${active.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  },
});

// ---- Tastaturkürzel (nicht in Eingabefeldern) ----
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (e.ctrlKey || e.metaKey || e.altKey || t?.closest('input, textarea, select, [contenteditable]')) return;
  const key = e.key.toLowerCase();
  if (key === 'h') controls.toggleCollapsed();
  else if (key === 'r') view.state = active.initialView;
  else if (key === 'l') controls.copyLink();
  else if (key === 'a') {
    axes = !axes;
    controls.setAxes(axes);
    renderer.requestRender();
    scheduleHash();
  }
  else return;
  e.preventDefault();
});

/** Koordinate auf Pixelgenauigkeit (Nachkommastellen aus dem Maßstab). */
function fmt(n: number, scale: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(scale)));
  return decimals <= 20 ? n.toFixed(decimals) : n.toExponential(6);
}

function updateStatus(): void {
  const v: ViewState = view.state;
  if (active.status) {
    controls.setStatus(hover ? active.status(hover[0], hover[1]) : '');
    return;
  }
  const pos = hover ? `x ${fmt(hover[0], v.scale)}  y ${fmt(hover[1], v.scale)}  ·  ` : '';
  controls.setStatus(`${pos}${v.scale.toExponential(2)} / px`);
}

// ---- Zustand im URL-Hash ----
let hashTimer = 0;
let lastHash = '';

function writeHash(): void {
  clearTimeout(hashTimer);
  const v = view.state;
  const state = { ...(active.saveState?.(v) ?? {}), ax: axes };
  const hash = encodeHash(active.id, v, state);
  if (hash !== location.hash) history.replaceState(null, '', hash);
  lastHash = hash;
}

function scheduleHash(): void {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(writeHash, 400);
}

window.addEventListener('hashchange', () => {
  if (location.hash === lastHash) return;
  const d = decodeHash(location.hash);
  const m = d && modules.find((x) => x.id === d.moduleId);
  if (m) activate(m, d);
});

function activate(m: VizModule, state?: DecodedHash | null): void {
  disposeModuleUi?.();
  controls.moduleContainer.replaceChildren();
  active = m;
  controls.setActive(m.id);
  // Zustand aus dem Link vor dem Aufbau der Controls übernehmen
  if (state?.params.has('ax')) {
    axes = state.params.get('ax') === '1';
    controls.setAxes(axes);
  }
  const custom = state ? m.loadState?.(state.params, state.view) : undefined;
  disposeModuleUi = m.ui(controls.moduleContainer, host) ?? null;
  renderer.setFragmentSource(m.fragSource);
  view.scaleLimits = m.scaleRange ?? [MIN_SCALE, MAX_SCALE];
  view.state = custom ?? { ...m.initialView, ...(state?.view ?? {}) };
  scheduleHash();
}

// Start: Zustand aus dem Link oder erstes Modul
const initial = decodeHash(location.hash);
const initialModule = initial && modules.find((x) => x.id === initial.moduleId);
activate(initialModule ?? active, initialModule ? initial : null);

// PWA: Service Worker nur im Produktions-Build (im Dev-Server würde er HMR stören)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker:', e));
  });
}
