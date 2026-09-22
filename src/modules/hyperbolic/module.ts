import type { ModuleHost, VizModule } from '../types';
import type { ViewState } from '../../core/view';
import type { C } from '../../math/complex';
import { read } from '../../ui/urlState';
import { drawAxes2D } from '../../ui/axes';
import { chips, h, segmented, slider, toggle } from '../../ui/widgets';
import {
  compose,
  distanceFromOrigin,
  drag,
  IDENTITY,
  isHyperbolic,
  params,
  recenter,
  translationAlongReal,
  triangle,
  wythoff,
} from './geometry';
import type { Geodesic, Mobius, Triangle, WythoffKind, WythoffSetup } from './geometry';
import hyperbolicSrc from './hyperbolic.frag?raw';

type Model = 'poincare' | 'halfplane' | 'klein';

const KINDS: readonly { value: WythoffKind; label: string; title: string }[] = [
  { value: 'regular', label: '{p,q}', title: 'Regulär: p-Ecke, q an jeder Ecke' },
  { value: 'dual', label: '{q,p}', title: 'Dual: q-Ecke, p an jeder Ecke' },
  { value: 'rectified', label: 'r', title: 'Rektifiziert: p- und q-Ecke' },
  { value: 'truncated', label: 't', title: 'Gestutzt: 2p- und q-Ecke' },
  { value: 'truncatedDual', label: 't*', title: 'Gestutzt dual: 2q- und p-Ecke' },
  { value: 'cantellated', label: 'rr', title: 'Kantelliert: p-, q-Ecke und Vierecke' },
  { value: 'omnitruncated', label: 'tr', title: 'Omnigestutzt: 2p-, 2q-Ecke und Vierecke' },
];

const PRESETS: readonly [number, number][] = [[7, 3], [3, 7], [5, 4], [4, 5], [6, 4], [8, 3], [5, 5], [4, 6]];

let source = hyperbolicSrc;
let p = 7;
let q = 3;
let kind: WythoffKind = 'regular';
let model: Model = 'poincare';
let showMirrors = false;
let showParity = true;
let moving = false;
let M: Mobius = IDENTITY;
let host: ModuleHost | null = null;
let dragFrom: C | null = null;

let tri: Triangle = triangle(p, q);
let setup: WythoffSetup = wythoff(tri, kind);

function rebuildGeometry(): void {
  tri = triangle(p, q);
  setup = wythoff(tri, kind);
  M = recenter(tri, M);
}

const geoUniform = (g: Geodesic): number[] =>
  g.kind === 'line' ? [g.n[0], g.n[1], 0, 1] : [g.c[0], g.c[1], g.r2, 0];

/** Bildschirm (Weltkoordinaten des Modells) → Poincaré-Scheibe, wie toDisk() im Shader. */
function toDisk(x: number, y: number): C {
  let z: C;
  if (model === 'halfplane') {
    // Cayley-Abbildung z = (s − i)/(s + i)
    const yy = Math.max(y, 1e-6);
    const d = x * x + (yy + 1) ** 2;
    z = [(x * x + yy * yy - 1) / d, (-2 * x) / d];
  } else if (model === 'klein') {
    const k2 = x * x + y * y;
    const f = 1 / (1 + Math.sqrt(Math.max(1 - k2, 0)));
    z = [x * f, y * f];
  } else {
    z = [x, y];
  }
  const r = Math.hypot(...z);
  return r > 0.995 ? [(z[0] * 0.995) / r, (z[1] * 0.995) / r] : z;
}

function viewFor(m: Model): ViewState {
  const w = Math.max(window.innerWidth, 1);
  const hgt = Math.max(window.innerHeight, 1);
  if (m === 'halfplane') {
    const scale = 5 / w;
    return { cx: 0, cy: (scale * hgt) / 2 - 0.15, scale };
  }
  return { cx: 0, cy: 0, scale: 2.2 / Math.min(w, hgt) };
}

// Bewegung entlang einer Geodäte (reelle Achse der Scheibe), mit Rückführung pro Schritt
let moveFrame = 0;
let lastTime = 0;
function move(time: number) {
  if (!moving || !host) return;
  if (lastTime) {
    const dt = Math.min(time - lastTime, 50) / 1000;
    M = recenter(tri, compose(M, translationAlongReal(0.35 * dt)));
    host.requestRender();
  }
  lastTime = time;
  moveFrame = requestAnimationFrame(move);
}
function setMoving(on: boolean) {
  moving = on;
  cancelAnimationFrame(moveFrame);
  lastTime = 0;
  if (on) moveFrame = requestAnimationFrame(move);
}

export const hyperbolicModule: VizModule = {
  id: 'hyperbolic',
  name: 'Hyperbolisch',
  get initialView() {
    return viewFor(model);
  },
  scaleRange: [1e-5, 0.2],

  get fragSource() {
    return source;
  },

  uniforms() {
    const { a, rot } = params(M);
    return {
      u_p: p,
      u_d: tri.d,
      u_r2: tri.r * tri.r,
      u_triSize: tri.C[0],
      u_a: a,
      u_rot: rot,
      u_geo: setup.geodesics.flatMap(geoUniform),
      u_active: setup.active.map(Number),
      u_sides: setup.sides,
      u_model: model === 'poincare' ? 0 : model === 'halfplane' ? 1 : 2,
      u_mirrors: showMirrors ? 1 : 0,
      u_parity: showParity ? 1 : 0,
    };
  },

  saveState: () => ({
    p,
    q,
    w: kind,
    mo: model,
    par: showParity,
    mir: showMirrors,
    // Automorphismus als α, β (SU(1,1)); bestimmt, welche Stelle der Parkettierung zu sehen ist
    a: [...M.alpha, ...M.beta].map((v) => +v.toPrecision(12)).join(','),
  }),

  loadState(params) {
    const pp = read.num(params, 'p', p, 3, 12);
    const qq = read.num(params, 'q', q, 3, 12);
    if (Number.isInteger(pp) && Number.isInteger(qq) && isHyperbolic(pp, qq)) {
      p = pp;
      q = qq;
    }
    kind = read.oneOf(params, 'w', KINDS.map((k) => k.value), kind);
    model = read.oneOf(params, 'mo', ['poincare', 'halfplane', 'klein'] as const, model);
    showParity = read.bool(params, 'par', showParity);
    showMirrors = read.bool(params, 'mir', showMirrors);
    const a = (params.get('a') ?? '').split(',').map(Number);
    M = IDENTITY;
    if (a.length === 4 && a.every(Number.isFinite)) M = compose({ alpha: [a[0]!, a[1]!], beta: [a[2]!, a[3]!] }, IDENTITY);
    rebuildGeometry();
  },

  drawOverlay(ctx, i) {
    if (!i.axes) return;
    const half = model === 'halfplane';
    drawAxes2D(ctx, i.view, i.width, i.height, { xName: half ? 'x' : 'Re', yName: half ? 'y' : 'Im' });
  },

  status(x, y) {
    const z = toDisk(x, y);
    const re = z[0].toFixed(3);
    const im = `${z[1] < 0 ? '−' : '+'} ${Math.abs(z[1]).toFixed(3)}i`;
    return `{${p},${q}}   z ${re} ${im}   d(0,z) ${distanceFromOrigin(z).toFixed(3)}`;
  },

  onPointer(e, hst) {
    // Ziehen = hyperbolische Verschiebung: der Punkt unter dem Cursor folgt exakt
    if (e.kind === 'down') {
      dragFrom = toDisk(e.x, e.y);
      return true;
    }
    if (e.kind === 'move' && dragFrom) {
      const to = toDisk(e.x, e.y);
      M = recenter(tri, drag(M, dragFrom, to));
      dragFrom = to;
      hst.requestRender();
    }
    if (e.kind === 'up') dragFrom = null;
    return true;
  },

  ui(container, hst) {
    host = hst;
    const hint = h('p', { class: 'hint' });
    const updateHint = (pp: number, qq: number) => {
      const s = (pp - 2) * (qq - 2);
      hint.textContent = isHyperbolic(pp, qq)
        ? `Je ${q} ${p}-Ecke an jeder Ecke; Winkelsumme π/${p} + π/${q} + π/2 < π.`
        : `{${pp},${qq}} ist ${s === 4 ? 'euklidisch' : 'sphärisch'} – (p−2)(q−2) muss > 4 sein. Es bleibt {${p},${q}}.`;
    };

    let pending: [number, number] = [p, q];
    const setPQ = (pp: number, qq: number) => {
      pending = [pp, qq];
      if (isHyperbolic(pp, qq)) {
        p = pp;
        q = qq;
        rebuildGeometry();
        hst.requestRender();
      }
      updateHint(pp, qq);
    };
    const sliders = h('div', { class: 'params' });
    const buildSliders = () =>
      sliders.replaceChildren(
        slider('p (Ecken)', { min: 3, max: 12, step: 1, value: pending[0] }, (v) => setPQ(v, pending[1])),
        slider('q (pro Ecke)', { min: 3, max: 12, step: 1, value: pending[1] }, (v) => setPQ(pending[0], v)),
      );
    buildSliders();
    updateHint(p, q);

    const kinds = segmented(KINDS, kind, (k) => {
      kind = k;
      rebuildGeometry();
      hst.requestRender();
    }, 'Wythoff-Konstruktion');
    kinds.el.classList.add('wrap');

    const models = segmented(
      [
        { value: 'poincare', label: 'Poincaré' },
        { value: 'halfplane', label: 'Halbebene' },
        { value: 'klein', label: 'Klein' },
      ] as const,
      model,
      (m) => {
        model = m;
        hst.setView(viewFor(m));
      },
      'Modell',
    );

    const center = h('button', { type: 'button', class: 'chip', title: 'Automorphismus zurücksetzen' }, 'Zentrieren');
    center.addEventListener('click', () => {
      M = IDENTITY;
      hst.requestRender();
    });

    container.append(
      models.el,
      sliders,
      chips(PRESETS.map(([pp, qq]) => ({
        label: `{${pp},${qq}}`,
        onClick: () => {
          setPQ(pp, qq);
          buildSliders();
        },
      }))),
      hint,
      kinds.el,
      h(
        'div',
        { class: 'toggles' },
        toggle('Parität', showParity, (v) => ((showParity = v), hst.requestRender())),
        toggle('Spiegelachsen', showMirrors, (v) => ((showMirrors = v), hst.requestRender())),
        toggle('Bewegen', moving, setMoving),
        center,
      ),
      h('p', { class: 'hint' }, 'Ziehen verschiebt hyperbolisch (Punkt unter dem Cursor folgt), Mausrad zoomt.'),
    );
    if (moving) setMoving(true);
    return () => {
      cancelAnimationFrame(moveFrame);
      host = null;
    };
  },
};

if (import.meta.hot) {
  import.meta.hot.accept('./hyperbolic.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
