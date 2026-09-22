import type { ModuleHost, VizModule } from '../types';
import { tileClipTransform } from '../../core/tiles';
import { formulaField } from '../../ui/formula';
import { read } from '../../ui/urlState';
import { h, menu, section, segmented, slider, toggle } from '../../ui/widgets';
import { GridMesh } from '../shapes/mesh';
import { orbitCamera } from '../shapes/orbit';
import sceneSrc from '../shapes/scene.glsl?raw';
import { cohomology, dim, euler, formatGroup, homology } from './chain';
import type { ChainComplex } from './chain';
import { drawDiagram, drawGraph, edgeColorMap } from './diagram';
import { drawCellDiagram, drawComplex3D, layout3d } from './draw2d';
import type { Box, V3 } from './draw2d';
import { analyze, formatGroupInfo } from './group';
import type { GroupInfo, Presentation } from './group';
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

const POLYGON_PRESETS: readonly { label: string; items: readonly { label: string; word: string }[] }[] = [
  {
    label: 'Geschlossene Flächen',
    items: [
      { label: 'Sphäre', word: 'a a⁻¹' },
      { label: 'Torus', word: 'a b a⁻¹ b⁻¹' },
      { label: 'Kleinsche Flasche', word: 'a b a b⁻¹' },
      { label: 'Projektive Ebene ℝP²', word: 'a b a b' },
      { label: 'Doppeltorus', word: 'a b a⁻¹ b⁻¹ c d c⁻¹ d⁻¹' },
      { label: 'Dyck-Fläche (ℝP² # ℝP² # ℝP²)', word: 'a a b b c c' },
      { label: 'Tetraeder (4 Dreiecke)', word: 'a b c, d e⁻¹ a⁻¹, e f⁻¹ b⁻¹, f d⁻¹ c⁻¹' },
    ],
  },
  {
    label: 'Mit Rand',
    items: [
      { label: 'Kreisscheibe', word: 'a' },
      { label: 'Möbiusband', word: 'c a d a' },
      { label: 'Zylinder', word: 'c a d a⁻¹' },
      { label: 'Torus mit Loch', word: 'a b a⁻¹ b⁻¹ c' },
    ],
  },
  {
    label: 'Keine Flächen',
    items: [
      { label: 'Pseudo-ℝP² (a³)', word: 'a a a' },
      { label: 'Torus mit Scheibe auf a', word: 'a b a⁻¹ b⁻¹, a' },
      { label: 'Sphäre mit Äquatorscheibe (≃ S² ∨ S²)', word: 'a a⁻¹, a' },
      { label: 'Dunce Hat (a a a⁻¹)', word: 'a a a⁻¹' },
    ],
  },
];

const SPACE_PRESETS: readonly { label: string; items: readonly { label: string; expr: string }[] }[] = [
  {
    label: 'Keilprodukte (3D)',
    items: [
      { label: 'S² ∨ S¹ ∨ S¹', expr: 'S2 v S1 v S1' },
      { label: 'Bukett aus 3 Kreisen', expr: 'S1 v S1 v S1' },
      { label: 'T² ∨ S²', expr: 'T2 v S2' },
      { label: 'F(3)', expr: 'F(3)' },
      { label: 'D² / ∂D² = S²', expr: 'D2 / ∂' },
    ],
  },
  {
    label: 'Mannigfaltigkeiten',
    items: [
      { label: 'T³', expr: 'T3' },
      { label: 'ℝP³', expr: 'RP3' },
      { label: 'ℂP² ∨ S²', expr: 'CP2 v S2' },
      { label: 'L(5,2) # L(3,1)', expr: 'L(5,2) # L(3,1)' },
      { label: 'Poincaré-Sphäre', expr: 'P' },
      { label: 'ℝP³ × S¹', expr: 'RP3 x S1' },
    ],
  },
  {
    label: 'Konstruktionen',
    items: [
      { label: 'ℝP² × ℝP² (Künneth, Tor)', expr: 'RP2 x RP2' },
      { label: 'Σ ℝP²', expr: 'Σ RP2' },
      { label: 'S¹ ∪ e²(3)', expr: 'S1 ∪ e2(3)' },
      { label: 'Möbiusband / Rand = ℝP²', expr: 'Mb / ∂' },
      { label: 'Volltorus / Rand', expr: '(D2 x S1) / ∂' },
      { label: 'Rand von D² × D²', expr: '∂(D2 x D2)' },
      { label: 'ℝP² ∧ ℝP²', expr: 'RP2 ∧ RP2' },
      { label: 'join(S¹, S¹) = S³', expr: 'join(S1, S1)' },
      { label: 'T² / 1-Gerüst', expr: 'T2 / sk(1)' },
    ],
  },
  {
    label: 'Gruppen',
    items: [
      { label: '⟨a, b | a², b³⟩ = ℤ/2 ∗ ℤ/3', expr: '⟨a, b | a^2, b^3⟩' },
      { label: 'A₅ = ⟨a, b | a², b³, (ab)⁵⟩', expr: '⟨a, b | a^2, b^3, (ab)^5⟩' },
      { label: 'Quaternionen Q₈', expr: '⟨i, j | i^4, i^2 = j^2, j i J i⟩' },
      { label: 'Baumslag–Solitar BS(1,2)', expr: '⟨a, b | b a B = a^2⟩' },
    ],
  },
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
let simpLayout: V3[] = [];

let t = 1;
let playing = false;
let gridLines = true;
let yaw = 0.5;
let pitch = 0.35;
let host: ModuleHost | null = null;
let dragFrom: [number, number] | null = null;
let rerender: (() => void) | null = null;

let program: ReturnType<ModuleHost['createProgram']> = null;
const mesh = new GridMesh(160);

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Gruppenanalyse zwischenspeichern (Todd–Coxeter kann einen Moment dauern) */
const groupCache = new WeakMap<Presentation, GroupInfo>();
function groupInfo(p: Presentation): GroupInfo {
  let g = groupCache.get(p);
  if (!g) groupCache.set(p, (g = analyze(p)));
  return g;
}

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
  const idx = new Map(simp.vertices.map((v, i) => [v, i]));
  simpLayout = layout3d(simp.vertices.length, simp.edges.map(([a, b]) => [idx.get(a)!, idx.get(b)!]));
  facetText = text;
  afterChange(hst);
}
setFacets(facetText, null);

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

function facts(rows: [string, string | HTMLElement][]): HTMLElement {
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

/** π₁: Name, vereinfachte Präsentation, Ordnung und Abelisierung */
function pi1Rows(p: Presentation | null, note?: string): [string, string | HTMLElement][] {
  if (!p) return [['π₁', `unbekannt${note ? ` (${note})` : ''} – aus den Zellen allein nicht bestimmbar`]];
  const g = formatGroupInfo(groupInfo(p));
  return [
    ['π₁', h('strong', {}, g.name)],
    ['Präsentation', g.presentation],
    ['', g.detail],
  ];
}

/** Randmatrizen ∂ₖ als kleine Tabellen (aufklappbar) */
function chainDetails(c: ChainComplex): HTMLElement {
  const blocks: HTMLElement[] = [];
  for (let k = 1; k < c.cells.length; k++) {
    const D = c.d[k]!;
    const rows = c.cells[k - 1]!, cols = c.cells[k]!;
    if (!rows || !cols) {
      blocks.push(h('p', { class: 'hint' }, `∂${sub(k)}: C${sub(k)} → C${sub(k - 1)} ist 0 (keine Zellen)`));
      continue;
    }
    if (rows > 12 || cols > 12) {
      blocks.push(h('p', { class: 'hint' }, `∂${sub(k)}: ${rows} × ${cols}-Matrix (zu groß zum Anzeigen)`));
      continue;
    }
    const table = h(
      'table',
      { class: 'matrix' },
      h('tr', {}, h('th', {}, ''), ...Array.from({ length: cols }, (_, j) => h('th', {}, `${k}.${j + 1}`))),
      ...D.map((r, i) => h('tr', {}, h('th', {}, `${k - 1}.${i + 1}`), ...r.map((v) => h('td', { class: v === 0n ? 'zero' : v > 0n ? 'pos' : 'neg' }, String(v))))),
    );
    blocks.push(h('div', { class: 'matrix-block' }, h('span', { class: 'hint' }, `∂${sub(k)}: C${sub(k)} → C${sub(k - 1)}`), table));
  }
  return h(
    'details',
    { class: 'help chain' },
    h('summary', {}, 'Kettenkomplex (Randmatrizen)'),
    h('p', {}, 'Spalten: k-Zellen, Zeilen: (k−1)-Zellen. Hₖ = ker ∂ₖ / im ∂ₖ₊₁ über die Smith-Normalform.'),
    ...blocks,
  );
}

function polygonFacts(): HTMLElement {
  const s = info;
  const rows: [string, string | HTMLElement][] = [
    ['Typ', h('strong', {}, s.name)],
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
  ];
  return h(
    'div',
    { class: 'stack' },
    section('Klassifikation', facts(rows)),
    section('Fundamentalgruppe', facts(pi1Rows(s.pi1, s.connected ? undefined : 'Komponente der ersten Ecke'))),
    section('Homologie', homologyTable(s.complex)),
    chainDetails(s.complex),
  );
}

function note3D(): string {
  if (mode === 'space') {
    return space.scene
      ? '3D: Keilprodukte als Blumenstrauß – alle Teile berühren sich im goldenen Klebepunkt.'
      : 'Bild: Zellstruktur mit den Randabbildungen. 3D gibt es für Keilprodukte aus pt, S⁰, S¹, S², D¹, D², T² und F(g).';
  }
  if (mode === 'simplicial') return '3D: Ecken räumlich nach Graphabständen angeordnet – Ziehen dreht. Nicht jede Triangulierung ist ohne Selbstdurchdringung einbettbar.';
  const s = info;
  if (!s.connected) return 'Nicht zusammenhängend – Bild: Zellstruktur.';
  if (!s.surface) return 'Keine Fläche – Bild: Zellstruktur mit Randabbildungen; Homologie und π₁ gelten trotzdem.';
  if (s.standard === 'genus') {
    return s.genus > MAX_GENUS_3D
      ? `3D: Kette aus ${MAX_GENUS_3D} Tori (Geschlecht ${s.genus} ist zu lang für die Ansicht).`
      : `3D: ${s.genus} verschmolzene Tori = Geschlecht ${s.genus}.`;
  }
  const m = meshShape();
  if (!m) return 'Diese Fläche hat keine Standarddarstellung in ℝ³ (z. B. N₃ oder mehrere Randkreise) – Bild: Zellstruktur.';
  const same = formatWord(faces) === formatWord(parseWord(m.word));
  return same
    ? '3D: Die farbigen Kanten wandern beim Verkleben aufeinander zu.'
    : `3D zeigt das Standardpolygon ${m.word} desselben Typs; farbige Kanten werden verklebt.`;
}

/** Zeichenfläche rechts neben dem Panel */
function drawBox(w: number, hgt: number): Box {
  const left = w > 900 ? 440 : 16;
  return { x: left, y: 24, w: w - left - 24, h: hgt - 60 };
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
    const box = drawBox(i.width, i.height);
    if (mode === 'simplicial') {
      const idx = new Map(simp.vertices.map((v, k) => [v, k]));
      const tris: [number, number, number][] = [];
      // alle 2-Seiten der Facetten (bei Tetraedern deren Seitendreiecke)
      const seen = new Set<string>();
      for (const f of simp.facets) {
        for (let a = 0; a < f.length; a++) for (let b = a + 1; b < f.length; b++) for (let c = b + 1; c < f.length; c++) {
          const key = `${f[a]}|${f[b]}|${f[c]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tris.push([idx.get(f[a]!)!, idx.get(f[b]!)!, idx.get(f[c]!)!]);
        }
      }
      drawComplex3D(
        ctx,
        simpLayout,
        simp.vertices,
        simp.edges.map(([a, b]) => [idx.get(a)!, idx.get(b)!]),
        tris,
        { yaw, pitch, distance: i.view.scale * DIST_PER_SCALE },
        box,
      );
      return;
    }
    if (meshShape() || currentScene()) return;
    // Keine 3D-Darstellung: Zellstruktur des Kettenkomplexes
    const c = mode === 'space' ? space.complex : info.complex;
    drawCellDiagram(ctx, c, homology(c), box, mode === 'space' ? `X = ${spaceExpr}` : 'Zellen des Polygonkomplexes');
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
    if (mode === 'space' && !space.scene) return 'Zellstruktur: Spalten = Dimensionen, Linien = Randkoeffizienten';
    if (mode === 'polygon' && !meshShape() && !currentScene()) return 'Zellstruktur: Spalten = Dimensionen, Linien = Randkoeffizienten';
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
        { value: 'polygon', label: 'Polygone', title: 'Flächen und 2-Komplexe aus Polygonen mit Kantenidentifikationen' },
        { value: 'space', label: 'Räume', title: 'CW-Räume beliebiger Dimension: ∨, #, ×, ∧, Σ, Rand, Quotienten, Präsentationen' },
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
  const tools = h('div', { class: 'toolbar' });

  let tSlider: HTMLElement | null = null;
  const buildGlue = () => {
    tSlider = meshShape()
      ? slider('Verkleben', { min: 0, max: 1, step: 0.01, value: t, format: (v) => `${Math.round(v * 100)} %` }, (v) => {
          t = v;
          if (playing) setPlaying(false);
          hst.requestRender();
        })
      : null;
    glue.replaceChildren(
      ...(tSlider
        ? [
            tSlider,
            h(
              'div',
              { class: 'toggles' },
              toggle('Animation', playing, setPlaying),
              toggle('Parameterlinien', gridLines, (v) => ((gridLines = v), hst.requestRender())),
            ),
          ]
        : []),
    );
  };
  onT = (v) => {
    const input = tSlider?.querySelector('input');
    const out = tSlider?.querySelector('output');
    if (input) input.value = String(v);
    if (out) out.textContent = `${Math.round(v * 100)} %`;
  };

  const examples = menu(
    'Beispiele …',
    POLYGON_PRESETS.map((g) => ({ label: g.label, items: g.items.map((p) => ({ label: p.label, title: p.word })) })),
    (gi, ii) => field.set(POLYGON_PRESETS[gi]!.items[ii]!.word),
  );
  const sum = (kind: 'torus' | 'rp2') => () => field.set(formatWord(connectedSum(faces, kind)));
  const makeTools = () => {
    const btn = (label: string, title: string, fn: () => void, enabled: boolean) => {
      const b = h('button', { type: 'button', class: 'chip accent', title }, label);
      b.disabled = !enabled;
      b.addEventListener('click', fn);
      return b;
    };
    const ok = info.surface && info.connected;
    tools.replaceChildren(
      examples,
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
    makeTools();
    buildGlue();
  };
  rerender();

  return h(
    'div',
    { class: 'stack' },
    field.el,
    tools,
    diagram,
    note,
    glue,
    factsBox,
    h(
      'details',
      { class: 'help' },
      h('summary', {}, 'Syntax'),
      h(
        'ul',
        {},
        h('li', {}, 'Kanten: Buchstabe mit optionalen Ziffern (a, b1). Invers: Großbuchstabe (A), a′ oder a⁻¹.'),
        h('li', {}, 'Mehrere Polygone mit Komma trennen. Kanten dürfen beliebig oft vorkommen (allgemeiner 2-Komplex).'),
        h('li', {}, 'Fläche: jede Kante höchstens zweimal, und jede Ecke hat eine Kreis- bzw. Halbkreisumgebung. Einmal vorkommende Kanten bilden den Rand.'),
        h('li', {}, 'Gleichfarbige Ecken im Diagramm werden zu einem Punkt verklebt.'),
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
    const c = space.complex;
    factsBox.replaceChildren(
      section('Fundamentalgruppe', facts(pi1Rows(space.pi1, space.pi1Note))),
      section('Homologie', homologyTable(c), h('p', { class: 'hint' }, `Dimension ${dim(c)} · ${c.cells.reduce((a, b) => a + b, 0)} Zellen`)),
      chainDetails(c),
    );
    note.textContent = note3D();
  };
  rerender();
  const examples = menu(
    'Beispiele …',
    SPACE_PRESETS.map((g) => ({ label: g.label, items: g.items.map((p) => ({ label: p.label, title: p.expr })) })),
    (gi, ii) => field.set(SPACE_PRESETS[gi]!.items[ii]!.expr),
  );
  const ops: { label: string; apply: (x: string) => string; title: string }[] = [
    { label: '∨ S¹ (Keil)', apply: (x) => `${x} ∨ S1`, title: 'Keilprodukt: an einem Punkt verkleben' },
    { label: '# T² (Summe)', apply: (x) => `${x} # T2`, title: 'Zusammenhängende Summe' },
    { label: '× S¹ (Produkt)', apply: (x) => `${wrap(x)} × S1`, title: 'Produkt' },
    { label: '∧ S¹ (Smash)', apply: (x) => `${wrap(x)} ∧ S1`, title: 'Smash-Produkt X × Y / X ∨ Y' },
    { label: 'Σ (Suspension)', apply: (x) => `Σ ${wrap(x)}`, title: 'Reduzierte Suspension' },
    { label: 'cone (Kegel)', apply: (x) => `cone(${x})`, title: 'Kegel CX = X × I / X × {1}' },
    { label: '∂ (Rand)', apply: (x) => `∂${wrap(x)}`, title: 'Rand als eigener Raum' },
    { label: '∪ e²(2) (Zelle)', apply: (x) => `${x} ∪ e2(2)`, title: '2-Zelle entlang a₁² anheften' },
    { label: '/ ∂ (Rand zu Punkt)', apply: (x) => `${wrap(x)} / ∂`, title: 'Rand zu einem Punkt zusammenschlagen' },
    { label: '/ sk(1) (Gerüst zu Punkt)', apply: (x) => `${wrap(x)} / sk(1)`, title: '1-Gerüst zu einem Punkt zusammenschlagen' },
    { label: '⊔ pt (disjunkt)', apply: (x) => `${x} ⊔ pt`, title: 'Disjunkte Vereinigung' },
  ];
  const wrap = (x: string) => (/^[\w⁰-⁹()]+$/.test(x.trim()) ? x.trim() : `(${x.trim()})`);
  const opMenu = menu('Operation anwenden …', [{ label: 'X ↦ …', items: ops.map((o) => ({ label: o.label, title: o.title })) }], (_, ii) =>
    field.set(ops[ii]!.apply(spaceExpr)),
  );
  const code = (s: string) => h('code', {}, s);
  return h(
    'div',
    { class: 'stack' },
    field.el,
    h('div', { class: 'toolbar' }, examples, opMenu),
    note,
    factsBox,
    h(
      'details',
      { class: 'help' },
      h('summary', {}, 'Syntax'),
      h(
        'ul',
        {},
        h('li', {}, 'Bausteine: ', code('pt'), ', ', code('S2'), ' (oder S^2, S²), ', code('D3'), ', ', code('I'), ', ', code('T3'), ', ', code('RP2'), ', ', code('CP2'), ', ', code('K'), ', ', code('Mb'), ' (Möbiusband), ', code('F(g)'), ', ', code('N(k)'), ', ', code('L(p,q)'), ', ', code('M(n,k)'), ' (Moore), ', code('P'), ' (Poincaré-Sphäre)'),
        h('li', {}, 'Gruppen: ', code('⟨a, b | a^2, b^3, (ab)^5⟩'), ' bzw. ', code('<a,b | [a,b]>'), ' – Präsentationskomplex mit π₁ = der Gruppe'),
        h('li', {}, 'Operationen: ', code('∨'), '/', code('v'), ' Keil, ', code('#'), ' Summe, ', code('×'), '/', code('x'), ' Produkt, ', code('∧'), ' Smash, ', code('Σ X'), ', ', code('∂X'), ', ', code('cone(X)'), ', ', code('join(X, Y)'), ', ', code('⊔'), '/', code('+')),
        h('li', {}, code('X ∪ e2(c₁, c₂, …)'), ': 2-Zelle entlang a₁^c₁ a₂^c₂ ⋯ (a = 1-Zellen); ', code('X / ∂'), ' Rand, ', code('X / sk(k)'), ' k-Gerüst zu einem Punkt'),
        h('li', {}, 'Bindung (schwach → stark): ⊔, dann ∪ und /, dann ∨, #, schließlich × und ∧. Klammern gehen immer.'),
        h('li', {}, 'Hₖ exakt über ℤ (Smith-Normalform), Hᵏ per UKT; π₁ per van Kampen aus den Bausteinen, vereinfacht (Tietze) und – wenn endlich – mit Todd–Coxeter gezählt.'),
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
    factsBox.replaceChildren(
      section('Kombinatorik', facts(rows)),
      section('Fundamentalgruppe', facts(pi1Rows(simp.pi1))),
      section('Homologie', homologyTable(simp.complex)),
      chainDetails(simp.complex),
    );
    note.textContent = note3D();
  };
  rerender();
  const examples = menu(
    'Beispiele …',
    [{ label: 'Triangulierungen', items: SIMPLICIAL_PRESETS.map((p) => ({ label: p.label, title: p.title })) }],
    (_, ii) => field.set(SIMPLICIAL_PRESETS[ii]!.facets),
  );
  return h(
    'div',
    { class: 'stack' },
    field.el,
    h('div', { class: 'toolbar' }, examples),
    graph,
    note,
    factsBox,
    h(
      'details',
      { class: 'help' },
      h('summary', {}, 'Syntax'),
      h('p', {}, 'Facetten als „123 134 234“ (einstellige Ecken) oder „[1,2,3], [1,3,4]“ bzw. „10 11 12; 10 12 13“. ', 'Alle Seiten werden automatisch ergänzt; orientiert wird nach aufsteigender Eckenordnung. π₁ ist die Kantenweg-Gruppe.'),
    ),
  );
}
