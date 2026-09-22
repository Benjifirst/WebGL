import type { ModuleHost, VizModule } from '../types';
import { h, segmented, slider, toggle } from '../../ui/widgets';
import shapesSource from './shapes.frag?raw';

interface Param {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

interface Shape {
  id: string;
  label: string;
  params: [Param, Param?];
}

// Reihenfolge = u_shape im Shader
const SHAPES: Shape[] = [
  { id: 'torus', label: 'Torus', params: [
    { label: 'Radius R', min: 0.3, max: 1.6, step: 0.01, value: 1 },
    { label: 'Rohr r', min: 0.05, max: 1, step: 0.01, value: 0.4 },
  ] },
  { id: 'genus2', label: 'Doppeltorus', params: [
    { label: 'Rohr r', min: 0.1, max: 0.45, step: 0.01, value: 0.25 },
    { label: 'Abstand', min: 0.7, max: 1.2, step: 0.01, value: 0.82 },
  ] },
  { id: 'knot', label: 'Torusknoten', params: [
    { label: 'p (Umläufe)', min: 1, max: 7, step: 1, value: 2 },
    { label: 'q (Windungen)', min: 1, max: 9, step: 1, value: 3 },
  ] },
  { id: 'hopf', label: 'Hopf-Ringe', params: [
    { label: 'Radius R', min: 0.5, max: 1.4, step: 0.01, value: 0.9 },
    { label: 'Rohr r', min: 0.04, max: 0.4, step: 0.01, value: 0.15 },
  ] },
  { id: 'gyroid', label: 'Gyroid', params: [
    { label: 'Frequenz', min: 2, max: 10, step: 0.1, value: 4.5 },
    { label: 'Dicke', min: 0.01, max: 0.2, step: 0.005, value: 0.04 },
  ] },
  { id: 'bulb', label: 'Mandelbulb', params: [
    { label: 'Potenz n', min: 2, max: 12, step: 0.1, value: 8 },
  ] },
  { id: 'menger', label: 'Menger', params: [
    { label: 'Iterationen', min: 0, max: 5, step: 1, value: 3 },
  ] },
];

let source = shapesSource;
let shapeIndex = 0;
let colorMode: 'neutral' | 'normal' = 'neutral';
let yaw = 0.6;
let pitch = 0.45;
let spinning = false;
let host: ModuleHost | null = null;
let dragFrom: [number, number] | null = null;

// Kameraabstand wird auf view.scale abgebildet, damit Mausrad und Pinch ohne
// Sonderbehandlung zoomen: Abstand = scale · DIST_PER_SCALE.
const DIST_PER_SCALE = 400;

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
  return { pos, fwd, right, up };
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

export const shapesModule: VizModule = {
  id: 'shapes',
  name: '3D',
  initialView: { cx: 0, cy: 0, scale: 6.5 / DIST_PER_SCALE },
  scaleRange: [1.3 / DIST_PER_SCALE, 30 / DIST_PER_SCALE],

  get fragSource() {
    return source;
  },

  uniforms({ view }) {
    const cam = camera(view.scale * DIST_PER_SCALE);
    const [a, b] = SHAPES[shapeIndex]!.params;
    return {
      u_camPos: cam.pos,
      u_camRight: cam.right,
      u_camUp: cam.up,
      u_camFwd: cam.fwd,
      u_shape: shapeIndex,
      u_param: [a.value, b?.value ?? 0],
      u_colorMode: colorMode === 'normal' ? 1 : 0,
    };
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
    const params = h('div', { class: 'params' });
    const buildParams = () => {
      params.replaceChildren(
        ...SHAPES[shapeIndex]!.params.filter((p): p is Param => !!p).map((p) =>
          slider(p.label, p, (v) => {
            p.value = v;
            hst.requestRender();
          }),
        ),
      );
    };
    buildParams();

    const shapePicker = segmented(
      SHAPES.map((s, i) => ({ value: String(i), label: s.label })),
      String(shapeIndex),
      (v) => {
        shapeIndex = Number(v);
        buildParams();
        hst.requestRender();
      },
      'Form',
    );
    shapePicker.el.classList.add('wrap');

    container.append(
      shapePicker.el,
      params,
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

if (import.meta.hot) {
  import.meta.hot.accept('./shapes.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
