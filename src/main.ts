import './style.css';
import { Renderer } from './core/renderer';
import { MAX_SCALE, MIN_SCALE, ViewController } from './core/view';
import type { ViewState } from './core/view';
import { domainModule } from './modules/domain/module';
import { gridModule } from './modules/grid/module';
import { hyperbolicModule } from './modules/hyperbolic/module';
import { mandelbrotModule } from './modules/mandelbrot/module';
import { shapesModule } from './modules/shapes/module';
import type { ModuleHost, VizModule } from './modules/types';
import { createControls } from './ui/controls';
import { ErrorOverlay } from './ui/errorOverlay';

const modules: readonly VizModule[] = [domainModule, shapesModule, hyperbolicModule, mandelbrotModule, gridModule];

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const overlay = new ErrorOverlay(document.querySelector<HTMLElement>('#error-overlay')!);
const panel = document.querySelector<HTMLElement>('#panel')!;

let active: VizModule = modules[0]!;
let disposeModuleUi: (() => void) | null = null;
let hover: [number, number] | null = null;

const frameInfo = () => ({
  view: view.state,
  width: renderer.width,
  height: renderer.height,
  pixelRatio: renderer.pixelRatio,
});

const renderer = new Renderer(canvas, {
  uniforms() {
    const v = view.state;
    const pr = renderer.pixelRatio;
    return {
      u_center: [v.cx, v.cy],
      u_scale: v.scale / pr, // Welt pro Gerätepixel
      u_pixelRatio: pr,
      ...active.uniforms(frameInfo()),
    };
  },
  beforeDraw(gl) {
    active.prepare?.(gl);
  },
  afterDraw(gl) {
    active.draw?.(gl, frameInfo());
  },
  onCompile(error, source) {
    if (error) overlay.show(error, source);
    else overlay.hide();
  },
});

const host: ModuleHost = {
  requestRender: () => renderer.requestRender(),
  recompile: () => renderer.setFragmentSource(active.fragSource),
  get view() {
    return view.state;
  },
  setView: (v) => (view.state = v),
  createProgram: (vs, fs) => renderer.compileProgram(vs, fs),
};

const view = new ViewController(canvas, {
  onChange() {
    renderer.requestRender();
    updateStatus();
  },
  onPointer: (e) => active.onPointer?.(e, host) ?? false,
  onHover(x, y) {
    hover = [x, y];
    updateStatus();
  },
});

const controls = createControls(panel, {
  modules,
  onSelect: activate,
  onResetView: () => (view.state = active.initialView),
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

function activate(m: VizModule): void {
  disposeModuleUi?.();
  controls.moduleContainer.replaceChildren();
  active = m;
  controls.setActive(m.id);
  disposeModuleUi = m.ui(controls.moduleContainer, host) ?? null;
  renderer.setFragmentSource(m.fragSource);
  view.scaleLimits = m.scaleRange ?? [MIN_SCALE, MAX_SCALE];
  view.state = m.initialView;
}

activate(active);
