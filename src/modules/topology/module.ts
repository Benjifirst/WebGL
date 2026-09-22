import type { ModuleHost, VizModule } from '../types';
import { tileClipTransform } from '../../core/tiles';
import { formulaField } from '../../ui/formula';
import { read } from '../../ui/urlState';
import { chips, h, slider, toggle } from '../../ui/widgets';
import { GridMesh } from '../shapes/mesh';
import { orbitCamera } from '../shapes/orbit';
import sceneSrc from '../shapes/scene.glsl?raw';
import { drawDiagram, edgeColorMap } from './diagram';
import { classify, connectedSum, formatWord, parseWord } from './surface';
import type { Face, StandardShape, SurfaceInfo } from './surface';
import glueVertSrc from './glue.vert?raw';
import glueFragSrc from './glue.frag?raw';
import genusFragSrc from './genus.frag?raw';

// ---------------------------------------------------------------------------
// Vorlagen und Standardpolygone

const PRESETS: readonly { label: string; word: string }[] = [
  { label: 'Sphäre', word: 'a a⁻¹' },
  { label: 'Torus', word: 'a b a⁻¹ b⁻¹' },
  { label: 'Kleinsche Flasche', word: 'a b a b⁻¹' },
  { label: 'ℝP²', word: 'a b a b' },
  { label: 'Möbiusband', word: 'c a d a' },
  { label: 'Zylinder', word: 'c a d a⁻¹' },
  { label: 'Doppeltorus', word: 'a b a⁻¹ b⁻¹ c d c⁻¹ d⁻¹' },
  { label: 'Dyck (T² # ℝP²)', word: 'a b a⁻¹ b⁻¹ c c' },
  { label: 'Tetraeder', word: 'a b c, d e⁻¹ a⁻¹, e f⁻¹ b⁻¹, f d⁻¹ c⁻¹' },
];

/**
 * Standardpolygon je Flächentyp für die 3D-Animation; `edges` belegt die Quadratseiten
 * (unten v = 0, rechts u = 1, oben v = 1, links u = 0) mit Kantenbezeichnern (null = keine Kante).
 */
const STANDARD: Record<Exclude<StandardShape, 'genus'>, { id: number; word: string; edges: (string | null)[] }> = {
  sphere: { id: 0, word: 'a a⁻¹', edges: ['a', null, 'a', null] },
  torus: { id: 1, word: 'a b a⁻¹ b⁻¹', edges: ['a', 'b', 'a', 'b'] },
  klein: { id: 2, word: 'a b a b⁻¹', edges: ['a', 'b', 'a', 'b'] },
  rp2: { id: 3, word: 'a b a b', edges: ['a', 'b', 'a', 'b'] },
  moebius: { id: 4, word: 'c a d a', edges: ['c', 'a', 'd', 'a'] },
  cylinder: { id: 5, word: 'c a d a⁻¹', edges: ['c', 'a', 'd', 'a'] },
  disk: { id: 6, word: 'a', edges: [null, 'a', null, 'a'] },
};

const MAX_GENUS_3D = 8;
const DIST_PER_SCALE = 400;

// ---------------------------------------------------------------------------
// Zustand

let word = 'a b a⁻¹ b⁻¹';
let faces: Face[] = parseWord(word);
let info: SurfaceInfo = classify(faces);
let t = 1;
let playing = false;
let gridLines = true;
let yaw = 0.5;
let pitch = 0.5;
let host: ModuleHost | null = null;
let dragFrom: [number, number] | null = null;
let rerender: (() => void) | null = null;

let program: ReturnType<ModuleHost['createProgram']> = null;
const mesh = new GridMesh(160);

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function meshShape(): (typeof STANDARD)[keyof typeof STANDARD] | null {
  const s = info.standard;
  return s && s !== 'genus' ? STANDARD[s] : null;
}

const BACKGROUND_ONLY = `
void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  fragColor = vec4(background(uv), 1.0);
}
`;

function setWord(text: string, hst: ModuleHost | null): void {
  const next = parseWord(text);
  const nextInfo = classify(next);
  const wasGenus = info.standard === 'genus';
  word = text;
  faces = next;
  info = nextInfo;
  if (hst) {
    // Der Fullscreen-Shader ändert sich nur zwischen Torus-Kette und Netz-Darstellung
    if (wasGenus !== (info.standard === 'genus')) hst.recompile();
    hst.requestRender();
  }
  rerender?.();
}

// ---------------------------------------------------------------------------
// Animation des Verklebens (Hin und Zurück)

let frame = 0;
let lastTime = 0;
let phase = 0;
let onT: ((v: number) => void) | null = null;
function animate(time: number) {
  if (!playing || !host) return;
  if (lastTime) {
    phase += (Math.min(time - lastTime, 50) / 1000) * 0.9;
    t = 0.5 - 0.5 * Math.cos(phase); // weiches Pendeln zwischen flach (0) und verklebt (1)
    onT?.(t);
    host.requestRender();
  }
  lastTime = time;
  frame = requestAnimationFrame(animate);
}
function setPlaying(on: boolean) {
  playing = on;
  cancelAnimationFrame(frame);
  lastTime = 0;
  phase = Math.acos(1 - 2 * t);
  if (on) frame = requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Controls

function infoTable(): HTMLElement {
  const s = info;
  const rows: [string, string][] = [
    ['Typ', s.name],
    ['Symbol', s.symbol],
    ['χ = V − E + F', `${s.V} − ${s.E} + ${s.F} = ${s.chi}`],
    ['Orientierbar', s.orientable ? 'ja' : 'nein'],
    ['Rand', s.boundary ? `${s.boundary} Kreis${s.boundary > 1 ? 'e' : ''}` : 'keiner (geschlossen)'],
    [s.orientable ? 'Geschlecht' : 'Kreuzhauben', String(s.genus)],
    ['Normalform', s.normalForm],
    ['H₁', s.homology],
    ['π₁', s.pi1],
  ];
  return h('dl', { class: 'facts' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function note3D(): string {
  const s = info;
  if (!s.connected) return '3D: nur für zusammenhängende Flächen.';
  if (s.standard === 'genus') {
    return s.genus > MAX_GENUS_3D
      ? `3D: Kette aus ${MAX_GENUS_3D} Tori (Geschlecht ${s.genus} ist zu lang für die Ansicht).`
      : `3D: ${s.genus} verschmolzene Tori = Geschlecht ${s.genus}.`;
  }
  const m = meshShape();
  if (!m) return 'Nicht orientierbare Flächen mit mehr als 2 Kreuzhauben lassen sich nicht in ℝ³ einbetten; keine 3D-Darstellung.';
  const same = formatWord(faces) === formatWord(parseWord(m.word));
  return same
    ? '3D: Die farbigen Kanten wandern beim Verkleben aufeinander zu.'
    : `3D zeigt das Standardpolygon ${m.word} desselben Typs; farbige Kanten werden verklebt.`;
}

export const topologyModule: VizModule = {
  id: 'topology',
  name: 'Topologie',
  initialView: { cx: 0, cy: 0, scale: 8.5 / DIST_PER_SCALE },
  scaleRange: [2 / DIST_PER_SCALE, 40 / DIST_PER_SCALE],

  get fragSource() {
    return sceneSrc + (info.standard === 'genus' ? genusFragSrc : BACKGROUND_ONLY);
  },

  uniforms({ view }) {
    return {
      ...orbitCamera(yaw, pitch, view.scale * DIST_PER_SCALE),
      u_colorMode: 0,
      u_genus: Math.min(MAX_GENUS_3D, info.genus),
    };
  },

  draw(gl, f) {
    const m = meshShape();
    if (!m || !host) return;
    if (!program) {
      const vs = glueVertSrc;
      const fs = '#version 300 es\nprecision highp float;\n' + sceneSrc + glueFragSrc;
      program = host.createProgram(vs, fs);
      if (!program) return;
      mesh.setProgram(program);
    }
    const colors = edgeColorMap(parseWord(m.word));
    mesh.draw(gl, {
      ...orbitCamera(yaw, pitch, f.view.scale * DIST_PER_SCALE),
      u_colorMode: 0,
      u_shape: m.id,
      u_t: t,
      u_aspect: f.width / f.height,
      u_tileClip: tileClipTransform(f.width, f.height, f.tile),
      u_gridLines: gridLines ? 16 : 0,
      u_edgeColor: m.edges.flatMap((l) => (l ? hexToRgb(colors.get(l)!) : [0, 0, 0])),
      u_edgeOn: m.edges.map((l) => (l ? 1 : 0)),
    });
  },

  drawOverlay(ctx, i) {
    if (meshShape() || info.standard === 'genus') return;
    // Keine Darstellung in ℝ³: Hinweis in der Bildmitte
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210, 215, 225, 0.8)';
    ctx.fillText(info.symbol, i.width / 2 + 170, i.height / 2 - 10);
    ctx.fillStyle = 'rgba(140, 146, 158, 0.9)';
    ctx.fillText(info.connected ? 'keine Einbettung in ℝ³' : 'nicht zusammenhängend', i.width / 2 + 170, i.height / 2 + 14);
  },

  saveState: () => ({ w: word, t: +t.toFixed(3), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), pl: gridLines }),

  loadState(p) {
    const w = p.get('w');
    if (w) {
      try {
        setWord(w, null);
      } catch {
        // ungültiges Wort im Link → Vorgabe behalten
      }
    }
    t = read.num(p, 't', t, 0, 1);
    yaw = read.num(p, 'yaw', yaw);
    pitch = read.num(p, 'pitch', pitch, -1.5, 1.5);
    gridLines = read.bool(p, 'pl', gridLines);
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
    const field = formulaField({
      label: 'Wort:',
      ariaLabel: 'Kantenwort des Polygons',
      value: word,
      apply: (text) => setWord(text, hst),
    });

    const diagram = h('div', { class: 'diagram-box' });
    const facts = h('div', {});
    const note = h('p', { class: 'hint' });
    const glue = h('div', { class: 'params' });

    let tSlider: HTMLElement | null = null;
    const buildGlue = () => {
      tSlider = meshShape()
        ? slider('Verkleben', { min: 0, max: 1, step: 0.01, value: t, format: (v) => `${Math.round(v * 100)} %` }, (v) => {
            t = v;
            if (playing) setPlaying(false);
            hst.requestRender();
          })
        : null;
      glue.replaceChildren(...(tSlider ? [tSlider] : []));
    };
    onT = (v) => {
      const input = tSlider?.querySelector('input');
      const out = tSlider?.querySelector('output');
      if (input) input.value = String(v);
      if (out) out.textContent = `${Math.round(v * 100)} %`;
    };

    rerender = () => {
      const boundary = new Set(
        [...new Set(faces.flat().map((e) => e.label))].filter((l) => faces.flat().filter((e) => e.label === l).length === 1),
      );
      diagram.replaceChildren(drawDiagram(faces, info.vertexClass, boundary));
      facts.replaceChildren(infoTable());
      note.textContent = note3D();
      buildGlue();
    };
    rerender();

    const sum = (kind: 'torus' | 'rp2') => () => field.set(formatWord(connectedSum(faces, kind)));
    const normal = h('button', { type: 'button', class: 'chip', title: 'Wort durch die Normalform ersetzen' }, 'Normalform');
    normal.addEventListener('click', () => {
      if (info.connected && info.boundary === 0) field.set(info.normalForm);
    });

    container.append(
      field.el,
      chips(PRESETS.map((p) => ({ label: p.label, title: p.word, onClick: () => field.set(p.word) }))),
      h(
        'div',
        { class: 'chips' },
        ...[
          ['# T²', 'Zusammenhängende Summe mit einem Torus (Henkel ankleben)', sum('torus')],
          ['# ℝP²', 'Zusammenhängende Summe mit der projektiven Ebene (Kreuzhaube)', sum('rp2')],
        ].map(([label, title, fn]) => {
          const b = h('button', { type: 'button', class: 'chip accent', title: title as string }, label as string);
          b.addEventListener('click', fn as () => void);
          return b;
        }),
        normal,
      ),
      diagram,
      facts,
      note,
      glue,
      h(
        'div',
        { class: 'toggles' },
        toggle('Animation', playing, setPlaying),
        toggle('Parameterlinien', gridLines, (v) => ((gridLines = v), hst.requestRender())),
      ),
      h(
        'details',
        { class: 'help' },
        h('summary', {}, 'Syntax'),
        h(
          'p',
          {},
          'Kanten: Buchstabe mit optionalen Ziffern (a, b1). Invers: Großbuchstabe (A), a′ oder a⁻¹. ',
          'Mehrere Polygone mit Komma trennen. Zweimal vorkommende Kanten werden verklebt, ',
          'einmal vorkommende bilden den Rand. Ecken gleicher Farbe werden zu einem Punkt.',
        ),
      ),
    );
    if (playing) setPlaying(true);
    return () => {
      cancelAnimationFrame(frame);
      rerender = null;
      onT = null;
      host = null;
    };
  },
};
