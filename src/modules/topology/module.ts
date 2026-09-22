import type { ModuleHost, VizModule } from '../types';
import { tileClipTransform } from '../../core/tiles';
import { formulaField } from '../../ui/formula';
import { read } from '../../ui/urlState';
import { chips, h, segmented, slider, toggle } from '../../ui/widgets';
import { GridMesh } from '../shapes/mesh';
import { orbitCamera } from '../shapes/orbit';
import sceneSrc from '../shapes/scene.glsl?raw';
import { cohomology, dim, euler, formatGroup, homology } from './chain';
import type { ChainComplex } from './chain';
import { drawDiagram, drawGraph, edgeColorMap } from './diagram';
import { parseFacets, SIMPLICIAL_PRESETS, simplicial } from './simplicial';
import type { SimplicialInfo } from './simplicial';
import { layout, parseSpace } from './spaces';
import type { Primitive, Scene, Space } from './spaces';
import { classify, connectedSum, formatWord, parseWord } from './surface';
import type { Face, StandardShape, SurfaceInfo } from './surface';
import glueVertSrc from './glue.vert?raw';
import glueFragSrc from './glue.frag?raw';
import wedgeFragSrc from './wedge.frag?raw';

// ---------------------------------------------------------------------------
// Vorlagen

const POLYGON_PRESETS: readonly { label: string; word: string }[] = [
  { label: 'Sphäre', word: 'a a⁻¹' },
  { label: 'Torus', word: 'a b a⁻¹ b⁻¹' },
  { label: 'Kleinsche Flasche', word: 'a b a b⁻¹' },
  { label: 'ℝP²', word: 'a b a b' },
  { label: 'Möbiusband', word: 'c a d a' },
  { label: 'Zylinder', word: 'c a d a⁻¹' },
  { label: 'Doppeltorus', word: 'a b a⁻¹ b⁻¹ c d c⁻¹ d⁻¹' },
  { label: 'Dyck (T² # ℝP²)', word: 'a b a⁻¹ b⁻¹ c c' },
  { label: 'Tetraeder', word: 'a b c, d e⁻¹ a⁻¹, e f⁻¹ b⁻¹, f d⁻¹ c⁻¹' },
  { label: 'Pseudo-ℝP² (a³)', word: 'a a a' },
  { label: 'Torus mit Scheibe', word: 'a b a⁻¹ b⁻¹, a' },
];

const SPACE_PRESETS: readonly { label: string; expr: string }[] = [
  { label: 'S² ∨ S¹ ∨ S¹', expr: 'S2 v S1 v S1' },
  { label: 'S² ∨ S²', expr: 'S2 v S2' },
  { label: 'Bukett aus 3 Kreisen', expr: 'S1 v S1 v S1' },
  { label: 'T² ∨ S²', expr: 'T2 v S2' },
  { label: 'F(3)', expr: 'F(3)' },
  { label: 'S¹ × S¹', expr: 'S1 x S1' },
  { label: 'T³', expr: 'T3' },
  { label: 'ℝP³', expr: 'RP3' },
  { label: 'ℂP² ∨ S²', expr: 'CP2 v S2' },
  { label: 'L(5,2) # L(3,1)', expr: 'L(5,2) # L(3,1)' },
  { label: 'ℝP² × ℝP²', expr: 'RP2 x RP2' },
  { label: 'Σ ℝP²', expr: 'Σ RP2' },
  { label: 'S¹ ∪ e²(3)', expr: 'S1 ∪ e2(3)' },
  { label: 'T² / sk(1)', expr: 'T2 / sk(1)' },
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

type Mode = 'polygon' | 'space' | 'simplicial';

// ---------------------------------------------------------------------------
// Zustand

let mode: Mode = 'polygon';
let word = 'a b a⁻¹ b⁻¹';
let faces: Face[] = parseWord(word);
let info: SurfaceInfo = classify(faces);
let spaceExpr = 'S2 v S1 v S1';
let space: Space = parseSpace(spaceExpr);
let facetText = SIMPLICIAL_PRESETS[2]!.facets;
let simp: SimplicialInfo = simplicial(parseFacets(facetText));

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

/** Netz-Darstellung (Verklebe-Animation) nur im Polygonmodus für Standardtypen */
function meshShape(): (typeof STANDARD)[keyof typeof STANDARD] | null {
  if (mode !== 'polygon') return null;
  const s = info.standard;
  return s && s !== 'genus' ? STANDARD[s] : null;
}

/** Szene für den Blumenstrauß-Shader (Räume, oder Geschlecht ≥ 2 im Polygonmodus) */
function currentScene(): Scene | null {
  if (mode === 'space') return space.scene;
  if (mode === 'polygon' && info.standard === 'genus') {
    return [[{ kind: 'genus', genus: Math.min(MAX_GENUS_3D, info.genus) }]];
  }
  return null;
}

let sceneCache: { scene: Scene | null; prims: Primitive[]; radius: number } = { scene: null, prims: [], radius: 1 };
function prims() {
  const scene = currentScene();
  if (scene !== sceneCache.scene) sceneCache = { scene, ...(scene ? layout(scene) : { prims: [], radius: 1 }) };
  return sceneCache;
}

const BACKGROUND_ONLY = `
void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  fragColor = vec4(background(uv), 1.0);
}
`;

let lastShaderKind = '';
function shaderKind(): string {
  return currentScene() ? 'wedge' : 'plain';
}
function afterChange(hst: ModuleHost | null): void {
  if (hst) {
    const kind = shaderKind();
    if (kind !== lastShaderKind) hst.recompile();
    hst.requestRender();
  }
  rerender?.();
}

function setWord(text: string, hst: ModuleHost | null): void {
  const next = parseWord(text);
  info = classify(next);
  faces = next;
  word = text;
  afterChange(hst);
}
function setSpace(text: string, hst: ModuleHost | null): void {
  space = parseSpace(text);
  spaceExpr = text;
  afterChange(hst);
}
function setFacets(text: string, hst: ModuleHost | null): void {
  simp = simplicial(parseFacets(text));
  facetText = text;
  afterChange(hst);
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
// Anzeige der Invarianten

function facts(rows: [string, string][]): HTMLElement {
  return h('dl', { class: 'facts' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

const sub = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[+d]!);
const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!);

/** Tabelle H_k, H^k, Betti-Zahlen, χ, Poincaré-Polynom, Zellen je Dimension */
function homologyTable(c: ChainComplex): HTMLElement {
  const H = homology(c);
  const Hc = cohomology(H);
  const head = h('tr', {}, h('th', {}, 'k'), ...H.map((_, k) => h('th', {}, String(k))));
  const row = (label: string, cells: string[]) => h('tr', {}, h('th', {}, label), ...cells.map((x) => h('td', {}, x)));
  const poincare = H.map((g, k) => (g.betti ? `${g.betti === 1 && k ? '' : g.betti}${k ? (k === 1 ? 't' : `t${sup(k)}`) : ''}` : ''))
    .filter(Boolean)
    .join(' + ') || '0';
  return h(
    'div',
    { class: 'homology' },
    h(
      'table',
      {},
      head,
      row('Zellen', c.cells.map(String)),
      row('Hₖ', H.map(formatGroup)),
      row('Hᵏ', Hc.map(formatGroup)),
      row('bₖ', H.map((g) => String(g.betti))),
    ),
    facts([
      ['χ', `${euler(c)} = Σ (−1)ᵏ bₖ`],
      ['Poincaré-Polynom', poincare],
    ]),
  );
}

function polygonFacts(): HTMLElement {
  const s = info;
  const rows: [string, string][] = [
    ['Typ', s.name],
    ...(s.surface
      ? ([
          ['Symbol', s.symbol],
          ['Orientierbar', s.orientable ? 'ja' : 'nein'],
          ['Rand', s.boundary ? `${s.boundary} Kreis${s.boundary > 1 ? 'e' : ''}` : 'keiner (geschlossen)'],
          [s.orientable ? 'Geschlecht' : 'Kreuzhauben', String(s.genus)],
          ['Normalform', s.normalForm],
        ] as [string, string][])
      : ([['Warum keine Fläche', s.reasons.join('; ')]] as [string, string][])),
    ['χ = V − E + F', `${s.V} − ${s.E} + ${s.F} = ${s.chi}`],
    ['π₁', s.pi1],
  ];
  return h('div', {}, facts(rows), homologyTable(s.complex));
}

function note3D(): string {
  if (mode === 'space') {
    return space.scene
      ? '3D: Keilprodukte als Blumenstrauß – alle Teile berühren sich im goldenen Klebepunkt.'
      : '3D nur für Keilprodukte aus pt, S⁰, S¹, S², D¹, D², T² und F(g); die Homologie gilt für jeden Ausdruck.';
  }
  if (mode === 'simplicial') return 'Das 1-Gerüst ist nur schematisch gezeichnet (Kräfte-Layout).';
  const s = info;
  if (!s.connected) return '3D: nur für zusammenhängende Komplexe.';
  if (!s.surface) return 'Keine Fläche – daher keine Standarddarstellung; Homologie und π₁ gelten trotzdem.';
  if (s.standard === 'genus') {
    return s.genus > MAX_GENUS_3D
      ? `3D: Kette aus ${MAX_GENUS_3D} Tori (Geschlecht ${s.genus} ist zu lang für die Ansicht).`
      : `3D: ${s.genus} verschmolzene Tori = Geschlecht ${s.genus}.`;
  }
  const m = meshShape();
  if (!m) return 'Nicht orientierbare Flächen mit mehr als 2 Kreuzhauben lassen sich nicht in ℝ³ einbetten.';
  const same = formatWord(faces) === formatWord(parseWord(m.word));
  return same
    ? '3D: Die farbigen Kanten wandern beim Verkleben aufeinander zu.'
    : `3D zeigt das Standardpolygon ${m.word} desselben Typs; farbige Kanten werden verklebt.`;
}

// ---------------------------------------------------------------------------

export const topologyModule: VizModule = {
  id: 'topology',
  name: 'Topologie',
  initialView: { cx: 0, cy: 0, scale: 8.5 / DIST_PER_SCALE },
  scaleRange: [2 / DIST_PER_SCALE, 40 / DIST_PER_SCALE],

  get fragSource() {
    lastShaderKind = shaderKind();
    return sceneSrc + (lastShaderKind === 'wedge' ? wedgeFragSrc : BACKGROUND_ONLY);
  },

  uniforms({ view }) {
    const { prims: list, radius } = prims();
    const pa: number[] = [], pb: number[] = [], pc: number[] = [];
    for (let i = 0; i < 16; i++) {
      const p = list[i];
      pa.push(...(p ? [...p.center, p.type] : [0, 0, 0, 0]));
      pb.push(...(p ? [...p.axis, p.group] : [0, 1, 0, 0]));
      pc.push(...(p ? [p.R, p.r, p.len, 0] : [0, 0, 0, 0]));
    }
    return {
      ...orbitCamera(yaw, pitch, view.scale * DIST_PER_SCALE),
      u_colorMode: 0,
      u_count: list.length,
      u_pa: pa,
      u_pb: pb,
      u_pc: pc,
      u_fitScale: 2.1 / Math.max(radius, 0.5),
    };
  },

  draw(gl, f) {
    const m = meshShape();
    if (!m || !host) return;
    if (!program) {
      const fs = '#version 300 es\nprecision highp float;\n' + sceneSrc + glueFragSrc;
      program = host.createProgram(glueVertSrc, fs);
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
    if (meshShape() || currentScene()) return;
    // Keine 3D-Darstellung: Kurzfassung der Homologie in der Bildmitte
    const c = mode === 'space' ? space.complex : mode === 'simplicial' ? simp.complex : info.complex;
    const H = homology(c);
    const x = i.width / 2 + 200;
    ctx.textAlign = 'center';
    ctx.font = '15px ui-monospace, "Cascadia Mono", Consolas, monospace';
    H.forEach((g, k) => {
      ctx.fillStyle = 'rgba(210, 215, 225, 0.85)';
      ctx.fillText(`H${sub(k)} = ${formatGroup(g)}`, x, i.height / 2 - (H.length * 22) / 2 + k * 22);
    });
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140, 146, 158, 0.9)';
    ctx.fillText(`χ = ${euler(c)} · Dimension ${dim(c)}`, x, i.height / 2 + (H.length * 22) / 2 + 12);
  },

  saveState: () => ({
    tm: mode,
    ...(mode === 'polygon' ? { w: word, t: +t.toFixed(3), pl: gridLines } : mode === 'space' ? { X: spaceExpr } : { K: facetText }),
    yaw: +yaw.toFixed(3),
    pitch: +pitch.toFixed(3),
  }),

  loadState(p) {
    mode = read.oneOf(p, 'tm', ['polygon', 'space', 'simplicial'] as const, mode);
    const tryDo = (f: () => void) => {
      try {
        f();
      } catch {
        // ungültige Eingabe im Link → Vorgabe behalten
      }
    };
    const w = p.get('w');
    if (w) tryDo(() => setWord(w, null));
    const x = p.get('X');
    if (x) tryDo(() => setSpace(x, null));
    const k = p.get('K');
    if (k) tryDo(() => setFacets(k, null));
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
    const body = h('div', { class: 'stack' });

    const modes = segmented(
      [
        { value: 'polygon', label: 'Polygone', title: '2-dimensionale CW-Komplexe aus Polygonen mit Kantenidentifikationen' },
        { value: 'space', label: 'Räume', title: 'CW-Räume beliebiger Dimension: ∨, #, ×, Σ, Zellen anheften, Quotienten' },
        { value: 'simplicial', label: 'Simplizial', title: 'Simplizialkomplexe aus Facettenlisten' },
      ] as const,
      mode,
      (m) => {
        mode = m;
        build();
        afterChange(hst);
      },
      'Topologie-Modus',
    );

    const build = () => {
      if (playing && mode !== 'polygon') setPlaying(false);
      body.replaceChildren(mode === 'polygon' ? polygonUi(hst) : mode === 'space' ? spaceUi(hst) : simplicialUi(hst));
    };
    build();

    container.append(modes.el, body);
    return () => {
      cancelAnimationFrame(frame);
      rerender = null;
      onT = null;
      host = null;
    };
  },
};

// ---------------------------------------------------------------------------
// Controls je Modus

function polygonUi(hst: ModuleHost): HTMLElement {
  const field = formulaField({
    label: 'Wort:',
    ariaLabel: 'Kantenwort des Polygons',
    value: word,
    apply: (text) => setWord(text, hst),
  });
  const diagram = h('div', { class: 'diagram-box' });
  const factsBox = h('div', {});
  const note = h('p', { class: 'hint' });
  const glue = h('div', { class: 'params' });
  const sumButtons = h('div', { class: 'chips' });

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

  const sum = (kind: 'torus' | 'rp2') => () => field.set(formatWord(connectedSum(faces, kind)));
  const makeSumButtons = () => {
    const btn = (label: string, title: string, fn: () => void, enabled: boolean) => {
      const b = h('button', { type: 'button', class: 'chip accent', title }, label);
      b.disabled = !enabled;
      b.addEventListener('click', fn);
      return b;
    };
    const ok = info.surface && info.connected;
    sumButtons.replaceChildren(
      btn('# T²', 'Zusammenhängende Summe mit einem Torus (Henkel ankleben)', sum('torus'), ok),
      btn('# ℝP²', 'Zusammenhängende Summe mit der projektiven Ebene (Kreuzhaube)', sum('rp2'), ok),
      btn('Normalform', 'Wort durch die Normalform ersetzen', () => field.set(info.normalForm), ok && info.boundary === 0),
    );
  };

  rerender = () => {
    const counts = new Map<string, number>();
    for (const e of faces.flat()) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    const boundary = new Set([...counts].filter(([, n]) => n === 1).map(([l]) => l));
    diagram.replaceChildren(drawDiagram(faces, info.vertexClass, boundary));
    factsBox.replaceChildren(polygonFacts());
    note.textContent = note3D();
    makeSumButtons();
    buildGlue();
  };
  rerender();

  return h(
    'div',
    { class: 'stack' },
    field.el,
    chips(POLYGON_PRESETS.map((p) => ({ label: p.label, title: p.word, onClick: () => field.set(p.word) }))),
    sumButtons,
    diagram,
    factsBox,
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
        'Mehrere Polygone mit Komma trennen. Kanten dürfen beliebig oft vorkommen (allgemeiner 2-Komplex); ',
        'eine Fläche entsteht, wenn jede Kante höchstens zweimal vorkommt und jede Ecke eine Kreis- bzw. ',
        'Wegumgebung hat. Einmal vorkommende Kanten bilden den Rand. Gleichfarbige Ecken werden zu einem Punkt.',
      ),
    ),
  );
}

function spaceUi(hst: ModuleHost): HTMLElement {
  const factsBox = h('div', {});
  const note = h('p', { class: 'hint' });
  const field = formulaField({
    label: 'X =',
    ariaLabel: 'CW-Raum als Ausdruck',
    value: spaceExpr,
    apply: (text) => setSpace(text, hst),
  });
  rerender = () => {
    factsBox.replaceChildren(homologyTable(space.complex));
    note.textContent = note3D();
  };
  rerender();
  const ops: [string, string][] = [['∨', ' ∨ '], ['#', ' # '], ['×', ' × '], ['Σ', 'Σ '], ['∪ e²( )', ' ∪ e2()'], ['/ sk(1)', ' / sk(1)'], ['⊔', ' ⊔ ']];
  const insert = (s: string) => field.set((spaceExpr + s).trim().replace(/\s+/g, ' '));
  return h(
    'div',
    { class: 'stack' },
    field.el,
    chips(SPACE_PRESETS.map((p) => ({ label: p.label, title: p.expr, onClick: () => field.set(p.expr) }))),
    chips(ops.map(([label, s]) => ({ label, title: `„${s.trim()}“ anhängen`, onClick: () => insert(s) }))),
    factsBox,
    note,
    h(
      'details',
      { class: 'help' },
      h('summary', {}, 'Syntax'),
      h(
        'p',
        {},
        'Bausteine: pt, Sⁿ (S2 oder S^2), Dⁿ, Tⁿ, RPⁿ, CPⁿ, K, F(g), N(k), L(p,q), M(n,k). ',
        'Operationen: ∨ bzw. v (Keil), # (zusammenhängende Summe), × bzw. x (Produkt), Σ bzw. susp(X), cone(X), ',
        '⊔ bzw. + (disjunkt), X ∪ eⁿ(c₁,…) (n-Zelle mit zellulärem Rand Σcᵢ·(i-te (n−1)-Zelle) anheften), ',
        'X / sk(k) (k-Gerüst zu einem Punkt). Die Homologie wird exakt über ℤ berechnet (Smith-Normalform), ',
        'die Kohomologie per universellem Koeffiziententheorem.',
      ),
    ),
  );
}

function simplicialUi(hst: ModuleHost): HTMLElement {
  const graph = h('div', { class: 'diagram-box' });
  const factsBox = h('div', {});
  const note = h('p', { class: 'hint' });
  const field = formulaField({
    label: 'Facetten:',
    ariaLabel: 'Facetten des Simplizialkomplexes',
    value: facetText,
    apply: (text) => setFacets(text, hst),
  });
  rerender = () => {
    const tri = simp.facets.filter((f) => f.length === 3);
    graph.replaceChildren(simp.vertices.length <= 40 ? drawGraph(simp.vertices, simp.edges, tri) : h('p', { class: 'hint' }, 'Zu viele Ecken für das Diagramm.'));
    const rows: [string, string][] = [
      ['f-Vektor', `(${simp.f.join(', ')})`],
      ['Dimension', simp.pure !== null ? `${simp.pure} (rein)` : `${simp.f.length - 1} (nicht rein)`],
      ['Pseudomannigfaltigkeit', simp.pseudomanifold ? (simp.boundaryFaces ? `ja, mit ${simp.boundaryFaces} Randseiten` : 'ja, geschlossen') : 'nein'],
      ...(simp.orientable !== null ? ([['Orientierbar', simp.orientable ? 'ja' : 'nein']] as [string, string][]) : []),
    ];
    factsBox.replaceChildren(facts(rows), homologyTable(simp.complex));
    note.textContent = note3D();
  };
  rerender();
  return h(
    'div',
    { class: 'stack' },
    field.el,
    chips(SIMPLICIAL_PRESETS.map((p) => ({ label: p.label, title: p.title, onClick: () => field.set(p.facets) }))),
    graph,
    factsBox,
    note,
    h(
      'details',
      { class: 'help' },
      h('summary', {}, 'Syntax'),
      h('p', {}, 'Facetten als „123 134 234“ (einstellige Ecken) oder „[1,2,3], [1,3,4]“ bzw. „10 11 12; 10 12 13“. ', 'Alle Seiten werden automatisch ergänzt; orientiert wird nach aufsteigender Eckenordnung.'),
    ),
  );
}
