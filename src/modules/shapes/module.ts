import type { ModuleHost, VizModule } from '../types';
import { parse, ParseError, realOptions } from '../../math/parser';
import type { Node } from '../../math/parser';
import { codegenReal, evaluateReal, REAL_GLSL_HELPERS } from '../../math/real';
import { formulaField } from '../../ui/formula';
import { read } from '../../ui/urlState';
import type { StateRecord } from '../../ui/urlState';
import { chips, h, segmented, slider, toggle } from '../../ui/widgets';
import { tileClipTransform } from '../../core/tiles';
import { GridMesh } from './mesh';
import sceneSrc from './scene.glsl?raw';
import shapesSrc from './shapes.frag?raw';
import implicitSrc from './implicit.frag?raw';
import meshVertSrc from './mesh.vert?raw';
import meshFragSrc from './mesh.frag?raw';

// ---------------------------------------------------------------------------
// Vorlagen

interface Param {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

// Reihenfolge = u_shape in shapes.frag
const SHAPES: { label: string; params: [Param, Param?] }[] = [
  { label: 'Torus', params: [
    { label: 'Radius R', min: 0.3, max: 1.6, step: 0.01, value: 1 },
    { label: 'Rohr r', min: 0.05, max: 1, step: 0.01, value: 0.4 },
  ] },
  { label: 'Doppeltorus', params: [
    { label: 'Rohr r', min: 0.1, max: 0.45, step: 0.01, value: 0.25 },
    { label: 'Abstand', min: 0.7, max: 1.2, step: 0.01, value: 0.82 },
  ] },
  { label: 'Torusknoten', params: [
    { label: 'p (Umläufe)', min: 1, max: 7, step: 1, value: 2 },
    { label: 'q (Windungen)', min: 1, max: 9, step: 1, value: 3 },
  ] },
  { label: 'Hopf-Ringe', params: [
    { label: 'Radius R', min: 0.5, max: 1.4, step: 0.01, value: 0.9 },
    { label: 'Rohr r', min: 0.04, max: 0.4, step: 0.01, value: 0.15 },
  ] },
  { label: 'Gyroid', params: [
    { label: 'Frequenz', min: 2, max: 10, step: 0.1, value: 4.5 },
    { label: 'Dicke', min: 0.01, max: 0.2, step: 0.005, value: 0.04 },
  ] },
  { label: 'Mandelbulb', params: [{ label: 'Potenz n', min: 2, max: 12, step: 0.1, value: 8 }] },
  { label: 'Menger', params: [{ label: 'Iterationen', min: 0, max: 5, step: 1, value: 3 }] },
];

const IMPLICIT_PRESETS = [
  { label: 'Kugel', expr: 'x^2 + y^2 + z^2 = 1', bound: 1.5 },
  { label: 'Torus', expr: '(x^2 + y^2 + z^2 + 0.55)^2 = 2.56(x^2 + y^2)', bound: 1.5 },
  { label: 'Doppeltorus', expr: '((x^2 + y^2)^2 - x^2 + y^2)^2 + z^2 = 0.01', bound: 1.4 },
  { label: 'Tanglecube', expr: 'x^4 - 5x^2 + y^4 - 5y^2 + z^4 - 5z^2 + 11.8 = 0', bound: 3.6 },
  { label: 'Herz', expr: '(x^2 + 9/4 y^2 + z^2 - 1)^3 = x^2 z^3 + 9/80 y^2 z^3', bound: 1.5 },
  { label: 'Gyroid', expr: 'sin(4x)cos(4y) + sin(4y)cos(4z) + sin(4z)cos(4x) = 0', bound: 1.2 },
  { label: 'Hyperboloid', expr: 'x^2 + y^2 - z^2 = 0.3', bound: 1.5 },
];

interface ParamSurface {
  label: string;
  x: string;
  y: string;
  z: string;
  u: [string, string];
  v: [string, string];
}

const PARAM_PRESETS: ParamSurface[] = [
  { label: 'Möbiusband', x: '(1 + v cos(u/2)) cos(u)', y: '(1 + v cos(u/2)) sin(u)', z: 'v sin(u/2)',
    u: ['0', '2pi'], v: ['-0.4', '0.4'] },
  { label: 'Kleinsche Flasche', x: '(2 + cos(u/2) sin(v) - sin(u/2) sin(2v)) cos(u)',
    y: '(2 + cos(u/2) sin(v) - sin(u/2) sin(2v)) sin(u)', z: 'sin(u/2) sin(v) + cos(u/2) sin(2v)',
    u: ['0', '2pi'], v: ['0', '2pi'] },
  { label: 'Torus', x: '(2 + cos(v)) cos(u)', y: '(2 + cos(v)) sin(u)', z: 'sin(v)', u: ['0', '2pi'], v: ['0', '2pi'] },
  { label: 'Enneper', x: 'u - u^3/3 + u v^2', y: 'v - v^3/3 + v u^2', z: 'u^2 - v^2', u: ['-2', '2'], v: ['-2', '2'] },
  { label: 'Helikoid', x: 'u cos(v)', y: 'u sin(v)', z: '0.4v', u: ['-1', '1'], v: ['-2pi', '2pi'] },
  { label: 'Dini', x: 'cos(u) sin(v)', y: 'sin(u) sin(v)', z: 'cos(v) + ln(tan(v/2)) + 0.2u',
    u: ['0', '4pi'], v: ['0.05', '2'] },
  { label: 'Schnecke', x: '2(1 - e^(u/(6pi))) cos(u) cos(v/2)^2', y: '2(-1 + e^(u/(6pi))) sin(u) cos(v/2)^2',
    z: '1 - e^(u/(3pi)) - sin(v) + e^(u/(6pi)) sin(v)', u: ['0', '6pi'], v: ['0', '2pi'] },
];

// ---------------------------------------------------------------------------
// Zustand

type Mode = 'sdf' | 'implicit' | 'param';

let sources = { scene: sceneSrc, shapes: shapesSrc, implicit: implicitSrc, meshVert: meshVertSrc, meshFrag: meshFragSrc };
let mode: Mode = 'sdf';
let shapeIndex = 0;
let colorMode: 'neutral' | 'normal' = 'neutral';
let yaw = 0.6;
let pitch = 0.45;
let spinning = false;
let host: ModuleHost | null = null;
let dragFrom: [number, number] | null = null;

// Implizit
const IMPLICIT_OPTS = realOptions(['x', 'y', 'z'], true);
const implicitCode = (ast: Node) => codegenReal(ast, { x: 'x', y: 'y', z: 'z' });
let implicitExpr = IMPLICIT_PRESETS[1]!.expr;
let implicitGlsl = implicitCode(parse(implicitExpr, IMPLICIT_OPTS));
let bound = IMPLICIT_PRESETS[1]!.bound;

// Parametrisch: Programm wird verzögert im nächsten draw() gebaut (dirty),
// damit mehrere Feldänderungen hintereinander nur eine Kompilierung auslösen.
const PARAM_OPTS = realOptions(['u', 'v']);
const CONST_OPTS = realOptions([]);
const initialSurface = PARAM_PRESETS[0]!;
const param = {
  text: { ...initialSurface, u: [...initialSurface.u], v: [...initialSurface.v] } as ParamSurface,
  ast: {
    x: parse(initialSurface.x, PARAM_OPTS),
    y: parse(initialSurface.y, PARAM_OPTS),
    z: parse(initialSurface.z, PARAM_OPTS),
  } as Record<'x' | 'y' | 'z', Node>,
  range: [0, 2 * Math.PI, -0.4, 0.4] as [number, number, number, number],
  fit: [0, 0, 0, 1] as [number, number, number, number],
  gridLines: true,
  dirty: true,
};
const mesh = new GridMesh(200);

// Kameraabstand wird auf view.scale abgebildet, damit Mausrad und Pinch ohne
// Sonderbehandlung zoomen: Abstand = scale · DIST_PER_SCALE.
const DIST_PER_SCALE = 400;

const BACKGROUND_ONLY = `
void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  fragColor = vec4(background(uv), 1.0);
}
`;

function fragmentSource(): string {
  switch (mode) {
    case 'sdf':
      return sources.scene + sources.shapes;
    case 'implicit':
      return sources.scene + REAL_GLSL_HELPERS + sources.implicit.replace('return /*F*/;', `return ${implicitGlsl};`);
    case 'param':
      return sources.scene + BACKGROUND_ONLY;
  }
}

// ---------------------------------------------------------------------------
// Parametrische Fläche: Programm bauen und ins Bild einpassen

function buildParamProgram(hst: ModuleHost): void {
  param.dirty = false;
  const { x, y, z } = param.ast;
  const vars = { u: 'u', v: 'v' };
  const vs = sources.meshVert
    .replace('//HELPERS', REAL_GLSL_HELPERS)
    .replace('/*X*/', codegenReal(x, vars))
    .replace('/*Y*/', codegenReal(y, vars))
    .replace('/*Z*/', codegenReal(z, vars));
  const fs = '#version 300 es\nprecision highp float;\n' + sources.scene + sources.meshFrag;
  const program = hst.createProgram(vs, fs);
  if (program) mesh.setProgram(program);
  fitParamSurface();
}

/** Stichproben der Fläche → Mittelpunkt und Skalierung, sodass sie ins Bild passt. */
function fitParamSurface(): void {
  const { x, y, z } = param.ast;
  const [u0, u1, v0, v1] = param.range;
  const pts: V3[] = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const env = { u: u0 + ((u1 - u0) * i) / N, v: v0 + ((v1 - v0) * j) / N };
      const p: V3 = [evaluateReal(x, env), evaluateReal(y, env), evaluateReal(z, env)];
      if (p.every(Number.isFinite)) pts.push(p);
    }
  }
  if (!pts.length) return;
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
    }
  }
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
  param.fit = [c[0], c[1], c[2], r > 0 ? 1.6 / r : 1];
}

function markParamDirty(hst: ModuleHost): void {
  param.dirty = true;
  hst.requestRender();
}

// ---------------------------------------------------------------------------
// Kamera

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Orbit-Kamera: Position auf Kugel (yaw um y, pitch über Äquator), Blick auf den Ursprung. */
function camera(distance: number) {
  const pos: V3 = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw),
  ];
  const fwd = normalize([-pos[0], -pos[1], -pos[2]]);
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { u_camPos: pos, u_camFwd: fwd, u_camRight: right, u_camUp: up };
}

let spinFrame = 0;
let lastTime = 0;
function spin(time: number) {
  if (!spinning || !host) return;
  if (lastTime) yaw += Math.min(time - lastTime, 50) * 0.0004;
  lastTime = time;
  host.requestRender();
  spinFrame = requestAnimationFrame(spin);
}
function setSpinning(on: boolean) {
  spinning = on;
  cancelAnimationFrame(spinFrame);
  lastTime = 0;
  if (on) spinFrame = requestAnimationFrame(spin);
}

// ---------------------------------------------------------------------------
// UI je Modus

function sdfControls(hst: ModuleHost): HTMLElement {
  const params = h('div', { class: 'params' });
  const buildParams = () =>
    params.replaceChildren(
      ...SHAPES[shapeIndex]!.params.filter((p): p is Param => !!p).map((p) =>
        slider(p.label, p, (v) => ((p.value = v), hst.requestRender())),
      ),
    );
  buildParams();
  const picker = segmented(
    SHAPES.map((s, i) => ({ value: String(i), label: s.label })),
    String(shapeIndex),
    (v) => {
      shapeIndex = Number(v);
      buildParams();
      hst.requestRender();
    },
    'Form',
  );
  picker.el.classList.add('wrap');
  return h('div', { class: 'stack' }, picker.el, params);
}

function implicitControls(hst: ModuleHost): HTMLElement {
  const boundSlider = () =>
    slider('Bereich ±', { min: 0.5, max: 6, step: 0.05, value: bound }, (v) => ((bound = v), hst.requestRender()));
  const sliderBox = h('div', { class: 'params' }, boundSlider());
  const field = formulaField({
    label: 'F(x,y,z):',
    ariaLabel: 'Implizite Gleichung F(x,y,z) = 0',
    value: implicitExpr,
    apply(text) {
      implicitGlsl = implicitCode(parse(text, IMPLICIT_OPTS));
      implicitExpr = text;
      hst.recompile();
    },
  });
  return h(
    'div',
    { class: 'stack' },
    field.el,
    chips(
      IMPLICIT_PRESETS.map((p) => ({
        label: p.label,
        title: p.expr,
        onClick: () => {
          bound = p.bound;
          sliderBox.replaceChildren(boundSlider());
          field.set(p.expr);
        },
      })),
    ),
    sliderBox,
    h('p', { class: 'hint' }, 'Gleichung „links = rechts“ oder Ausdruck (= 0). Innenseite (F < 0) warm.'),
  );
}

function paramControls(hst: ModuleHost): HTMLElement {
  const coord = (k: 'x' | 'y' | 'z') =>
    formulaField({
      label: `${k}(u,v) =`,
      value: param.text[k],
      apply(text) {
        param.ast[k] = parse(text, PARAM_OPTS);
        param.text[k] = text;
        markParamDirty(hst);
      },
    });
  const bounds = (k: 'u' | 'v', i: 0 | 1) =>
    formulaField({
      label: i === 0 ? `${k} von` : 'bis',
      ariaLabel: `${k} ${i === 0 ? 'von' : 'bis'}`,
      compact: true,
      value: param.text[k][i],
      apply(text) {
        const val = evaluateReal(parse(text, CONST_OPTS), {});
        if (!Number.isFinite(val)) throw new ParseError('Kein endlicher Wert', 0, text.length);
        param.text[k][i] = text;
        param.range[(k === 'u' ? 0 : 2) + i] = val;
        markParamDirty(hst);
      },
    });

  const fields = { x: coord('x'), y: coord('y'), z: coord('z') };
  const ranges = [bounds('u', 0), bounds('u', 1), bounds('v', 0), bounds('v', 1)] as const;

  const load = (s: ParamSurface) => {
    ranges[0].set(s.u[0]);
    ranges[1].set(s.u[1]);
    ranges[2].set(s.v[0]);
    ranges[3].set(s.v[1]);
    fields.x.set(s.x);
    fields.y.set(s.y);
    fields.z.set(s.z);
  };

  return h(
    'div',
    { class: 'stack' },
    fields.x.el,
    fields.y.el,
    fields.z.el,
    h('div', { class: 'ranges' }, ...ranges.map((r) => r.el)),
    chips(PARAM_PRESETS.map((s) => ({ label: s.label, title: `(${s.x}, ${s.y}, ${s.z})`, onClick: () => load(s) }))),
    h(
      'div',
      { class: 'toggles' },
      toggle('Parameterlinien', param.gridLines, (v) => ((param.gridLines = v), hst.requestRender())),
    ),
    h('p', { class: 'hint' }, 'Rückseite warm – beim Möbiusband wechselt die Farbe an der Naht: nur eine Seite.'),
  );
}

// ---------------------------------------------------------------------------

export const shapesModule: VizModule = {
  id: 'shapes',
  name: '3D',
  initialView: { cx: 0, cy: 0, scale: 6.5 / DIST_PER_SCALE },
  scaleRange: [1.3 / DIST_PER_SCALE, 30 / DIST_PER_SCALE],

  get fragSource() {
    return fragmentSource();
  },

  uniforms({ view }) {
    const [a, b] = SHAPES[shapeIndex]!.params;
    return {
      ...camera(view.scale * DIST_PER_SCALE),
      u_shape: shapeIndex,
      u_param: [a.value, b?.value ?? 0],
      u_colorMode: colorMode === 'normal' ? 1 : 0,
      u_bound: bound,
    };
  },

  draw(gl, frame) {
    if (mode !== 'param') return;
    if (param.dirty && host) buildParamProgram(host);
    mesh.draw(gl, {
      ...camera(frame.view.scale * DIST_PER_SCALE),
      u_colorMode: colorMode === 'normal' ? 1 : 0,
      u_range: param.range,
      u_fit: param.fit,
      u_aspect: frame.width / frame.height,
      u_tileClip: tileClipTransform(frame.width, frame.height, frame.tile),
      u_gridLines: param.gridLines ? 24 : 0,
    });
  },

  saveState() {
    const base: StateRecord = { mode, col: colorMode, yaw: +yaw.toFixed(4), pitch: +pitch.toFixed(4) };
    if (mode === 'sdf') {
      const [a, b] = SHAPES[shapeIndex]!.params;
      return { ...base, shape: shapeIndex, p1: a.value, ...(b ? { p2: b.value } : {}) };
    }
    if (mode === 'implicit') return { ...base, F: implicitExpr, b: bound };
    const t = param.text;
    return { ...base, px: t.x, py: t.y, pz: t.z, u0: t.u[0], u1: t.u[1], v0: t.v[0], v1: t.v[1], pl: param.gridLines };
  },

  loadState(p) {
    mode = read.oneOf(p, 'mode', ['sdf', 'implicit', 'param'] as const, mode);
    colorMode = read.oneOf(p, 'col', ['neutral', 'normal'] as const, colorMode);
    yaw = read.num(p, 'yaw', yaw);
    pitch = read.num(p, 'pitch', pitch, -1.5, 1.5);
    if (mode === 'sdf') {
      shapeIndex = Math.round(read.num(p, 'shape', shapeIndex, 0, SHAPES.length - 1));
      const [a, b] = SHAPES[shapeIndex]!.params;
      a.value = read.num(p, 'p1', a.value, a.min, a.max);
      if (b) b.value = read.num(p, 'p2', b.value, b.min, b.max);
    } else if (mode === 'implicit') {
      const text = read.str(p, 'F', implicitExpr);
      try {
        implicitGlsl = implicitCode(parse(text, IMPLICIT_OPTS));
        implicitExpr = text;
      } catch {
        // ungültig → bisherige Fläche behalten
      }
      bound = read.num(p, 'b', bound, 0.5, 6);
    } else {
      try {
        const t = {
          x: read.str(p, 'px', param.text.x),
          y: read.str(p, 'py', param.text.y),
          z: read.str(p, 'pz', param.text.z),
          u: [read.str(p, 'u0', param.text.u[0]), read.str(p, 'u1', param.text.u[1])] as [string, string],
          v: [read.str(p, 'v0', param.text.v[0]), read.str(p, 'v1', param.text.v[1])] as [string, string],
        };
        const ast = { x: parse(t.x, PARAM_OPTS), y: parse(t.y, PARAM_OPTS), z: parse(t.z, PARAM_OPTS) };
        const range = [...t.u, ...t.v].map((s) => evaluateReal(parse(s, CONST_OPTS), {}));
        if (!range.every(Number.isFinite)) throw new Error('Bereich');
        param.text = { ...param.text, ...t };
        param.ast = ast;
        param.range = range as [number, number, number, number];
      } catch {
        // ungültige Fläche im Link → bisherige behalten
      }
      param.gridLines = read.bool(p, 'pl', param.gridLines);
      param.dirty = true;
    }
  },

  status() {
    return 'Ziehen: drehen · Rad/Pinch: Abstand';
  },

  onPointer(e, hst) {
    if (e.kind === 'down') {
      dragFrom = [e.px, e.py];
      return true;
    }
    if (e.kind === 'move' && dragFrom) {
      yaw -= (e.px - dragFrom[0]) * 0.008;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.py - dragFrom[1]) * 0.008));
      dragFrom = [e.px, e.py];
      hst.requestRender();
    }
    if (e.kind === 'up') dragFrom = null;
    return true;
  },

  ui(container, hst) {
    host = hst;
    const body = h('div', { class: 'stack' });
    const showMode = () => {
      body.replaceChildren(
        mode === 'sdf' ? sdfControls(hst) : mode === 'implicit' ? implicitControls(hst) : paramControls(hst),
      );
    };
    const modes = segmented(
      [
        { value: 'sdf', label: 'Formen' },
        { value: 'implicit', label: 'Implizit', title: 'Fläche F(x,y,z) = 0' },
        { value: 'param', label: 'Parametrisch', title: 'Fläche (x,y,z)(u,v)' },
      ] as const,
      mode,
      (m) => {
        mode = m;
        if (m === 'param') param.dirty = true;
        showMode();
        hst.recompile();
      },
      '3D-Modus',
    );
    showMode();

    container.append(
      modes.el,
      body,
      h(
        'div',
        { class: 'toggles' },
        segmented(
          [
            { value: 'neutral', label: 'Neutral' },
            { value: 'normal', label: 'Normalen' },
          ] as const,
          colorMode,
          (v) => ((colorMode = v), hst.requestRender()),
          'Färbung',
        ).el,
        toggle('Drehen', spinning, setSpinning),
      ),
    );
    if (spinning) setSpinning(true);
    return () => {
      cancelAnimationFrame(spinFrame);
      host = null;
    };
  },
};

// Shader-Hot-Reload
if (import.meta.hot) {
  import.meta.hot.accept(
    ['./scene.glsl?raw', './shapes.frag?raw', './implicit.frag?raw', './mesh.vert?raw', './mesh.frag?raw'],
    (mods) => {
      const src = (i: number, old: string) => (mods[i] as { default?: string } | undefined)?.default ?? old;
      sources = {
        scene: src(0, sources.scene),
        shapes: src(1, sources.shapes),
        implicit: src(2, sources.implicit),
        meshVert: src(3, sources.meshVert),
        meshFrag: src(4, sources.meshFrag),
      };
      param.dirty = true;
      host?.recompile();
    },
  );
}
