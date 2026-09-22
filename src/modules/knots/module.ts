import type { ModuleHost, VizModule } from '../types';
import { parse, ParseError, realOptions } from '../../math/parser';
import { compileReal } from '../../math/real';
import { formulaField } from '../../ui/formula';
import { panelShift } from '../../ui/layout';
import { read } from '../../ui/urlState';
import { h, menu, section, segmented, slider, toggle } from '../../ui/widgets';
import { orbitCamera } from '../shapes/orbit';
import sceneSrc from '../shapes/scene.glsl?raw';
import { analyze, formatGroupInfo } from '../topology/group';
import { braidClosure, CATALOG, fit, gcd, parseBraid, sampleClosed, torusKnot } from './curves';
import type { Link, P3 } from './curves';
import { computeDiagram, DiagramError } from './diagram';
import type { Diagram } from './diagram';
import { drawKnotDiagram } from './draw';
import { formatJones, formatPoly, invariants, MAX_JONES_CROSSINGS, mirrorJones, sameLaurent } from './invariants';
import type { KnotInvariants, Laurent } from './invariants';
import { buildTube, MeshBuffer } from './tube';
import tubeVertSrc from './tube.vert?raw';
import tubeFragSrc from './tube.frag?raw';

// Komponentenfarben (Diagramm: hex, Schlauch: linear)
const COLORS = ['#e6887d', '#80a8ec', '#8cc97f', '#e2c46a', '#c592e0', '#6fcfc4'];
const TUBE_COLORS: P3[] = COLORS.map((c) => [1, 3, 5].map((k) => (parseInt(c.slice(k, k + 2), 16) / 255) ** 2.2 * 0.9) as P3);
const DIST_PER_SCALE = 400;

type Mode = 'catalog' | 'torus' | 'braid' | 'curve';

const BRAID_EXAMPLES: readonly { label: string; word: string }[] = [
  { label: 'Kleeblatt σ₁³', word: 's1^3' },
  { label: 'Achterknoten (σ₁σ₂⁻¹)²', word: 's1 s2^-1 s1 s2^-1' },
  { label: 'Borromäische Ringe (σ₁σ₂⁻¹)³', word: '(s1 s2^-1)^3' },
  { label: 'Hopf σ₁²', word: 's1^2' },
  { label: '5₂: σ₁³σ₂σ₁⁻¹σ₂', word: 's1^3 s2 s1^-1 s2' },
  { label: 'Torusknoten T(3,4): (σ₁σ₂)⁴', word: 's1 s2 s1 s2 s1 s2 s1 s2' },
  { label: 'Unknoten mit Schlaufen σ₁σ₂σ₃', word: 's1 s2 s3' },
];

const CURVE_EXAMPLES: readonly { label: string; x: string; y: string; z: string }[] = [
  { label: 'Kleeblatt', x: 'sin(t) + 2sin(2t)', y: 'cos(t) - 2cos(2t)', z: '-sin(3t)' },
  { label: 'Achterknoten', x: '(2 + cos(2t)) cos(3t)', y: '(2 + cos(2t)) sin(3t)', z: 'sin(4t)' },
  { label: 'Lissajous-Knoten (3,2,7)', x: 'cos(3t + 0.7)', y: 'cos(2t + 0.2)', z: 'cos(7t)' },
  { label: 'Torusknoten (2,5)', x: '(2 + cos(5t)) cos(2t)', y: '(2 + cos(5t)) sin(2t)', z: '-sin(5t)' },
  { label: 'Kreis mit Welle (Unknoten)', x: 'cos(t)', y: 'sin(t)', z: '0.3 sin(5t)' },
];

// ---------------------------------------------------------------------------
// Zustand

let mode: Mode = 'catalog';
let catalogId = '3_1';
let p = 2, q = 3;
let braidText = 's1 s2^-1 s1 s2^-1';
let curve = { x: CURVE_EXAMPLES[0]!.x, y: CURVE_EXAMPLES[0]!.y, z: CURVE_EXAMPLES[0]!.z };
let view2D = false;
let showSigns = true;
let yaw = 0.3;
let pitch = 0.9;
let host: ModuleHost | null = null;
let dragFrom: [number, number] | null = null;
let rerender: (() => void) | null = null;

let link: Link = [];
let diagram: Diagram | null = null;
let inv: KnotInvariants | null = null;
let problem: string | null = null;
const mesh = new MeshBuffer();
let program: ReturnType<ModuleHost['createProgram']> = null;

function currentLink(): Link {
  switch (mode) {
    case 'catalog':
      return (CATALOG.find((c) => c.id === catalogId) ?? CATALOG[1]!).build();
    case 'torus':
      return torusKnot(p, q);
    case 'braid':
      return braidClosure(parseBraidExpanded(braidText));
    case 'curve':
      return [curveLink(curve)];
  }
}

/** Zopfwort mit Klammerpotenzen „(s1 s2^-1)^3“ ausmultiplizieren */
function parseBraidExpanded(text: string): number[] {
  const expanded = text.replace(/\(([^()]*)\)\s*(?:\^\s*(\d+)|([²³⁴⁵⁶⁷⁸⁹]))?/g, (_, inner: string, e?: string, supE?: string) => {
    const n = e ? Number(e) : supE ? '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(supE) : 1;
    return Array(n).fill(inner).join(' ');
  });
  return parseBraid(expanded);
}

function curveLink(c: { x: string; y: string; z: string }): P3[] {
  const f = (['x', 'y', 'z'] as const).map((k) => compileReal(parse(c[k], realOptions(['t'])), false));
  const at = (t: number): P3 => [f[0]!({ t }), f[1]!({ t }), f[2]!({ t })];
  const pts = sampleClosed(at, 600);
  if (pts.some((pt) => !pt.every(Number.isFinite))) throw new Error('Die Kurve ist nicht überall definiert');
  const a = at(0), b = at(2 * Math.PI);
  const size = Math.max(...pts.map((pt) => Math.hypot(...pt)), 1e-9);
  if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-6 * size) {
    throw new Error('Die Kurve ist nicht geschlossen: f(0) ≠ f(2π)');
  }
  return pts;
}

/** Katalogwerte des Jones-Polynoms zum Erkennen (einmal berechnet) */
let jonesTable: { name: string; jones: Laurent; components: number }[] | null = null;
function recognize(k: KnotInvariants): string | null {
  if (!k.jones) return null;
  jonesTable ??= CATALOG.map((c) => {
    const l = fit(c.build());
    const i = invariants(computeDiagram(l), l.length);
    return { name: c.name, jones: i.jones!, components: l.length };
  });
  for (const e of jonesTable) {
    if (e.components !== k.components) continue;
    if (sameLaurent(e.jones, k.jones)) return e.name;
    if (sameLaurent(e.jones, mirrorJones(k.jones))) return `${e.name} (Spiegelbild)`;
  }
  return null;
}

function recompute(): void {
  problem = null;
  try {
    link = fit(currentLink());
    diagram = computeDiagram(link);
    inv = invariants(diagram, link.length);
  } catch (e) {
    problem = e instanceof DiagramError || e instanceof Error ? e.message : String(e);
    diagram = null;
    inv = null;
  }
  mesh.set(buildTube(link, TUBE_COLORS, 0.1));
  host?.requestRender();
  rerender?.();
}
recompute();

// ---------------------------------------------------------------------------

function facts(rows: [string, string | HTMLElement][]): HTMLElement {
  return h('dl', { class: 'facts' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function invariantsView(): HTMLElement {
  if (problem) return h('p', { class: 'row-note error' }, problem);
  const k = inv!;
  const entry = mode === 'catalog' ? CATALOG.find((c) => c.id === catalogId) : null;
  const knot = k.components === 1;
  const rows: [string, string | HTMLElement][] = [];
  const name = recognize(k);
  if (name) rows.push(['Erkannt als', h('strong', {}, name)]);
  else if (k.jones && sameLaurent(k.jones, new Map([[0, 1]])) && knot) rows.push(['Erkannt als', h('strong', {}, 'vermutlich Unknoten (Jones = 1)')]);
  rows.push(['Komponenten', String(k.components)]);
  rows.push(['Kreuzungen', `${k.crossings} in diesem Diagramm${entry ? ` · minimal ${entry.crossings}` : ''}`]);
  rows.push(['Writhe', `${k.writhe > 0 ? '+' : ''}${k.writhe} (Summe der Vorzeichen)`]);
  if (!knot) rows.push(['Verschlingungszahlen', k.linking.map((l) => `lk(${l.i + 1},${l.j + 1}) = ${l.lk}`).join(', ')]);
  const inv2: [string, string | HTMLElement][] = [
    [knot ? 'Alexander Δ(t)' : 'Alexander (einvariabel)', k.alexander ? formatPoly(k.alexander) : '– (zu groß)'],
    ['Determinante |Δ(−1)|', k.determinant === null ? '–' : String(k.determinant)],
    ['Jones V(t)', k.jones ? formatJones(k.jones) : `– (mehr als ${MAX_JONES_CROSSINGS} Kreuzungen)`],
    ['3-färbbar', `${k.colorings3 > 3 ** k.components ? 'ja' : 'nein'} (${k.colorings3} Färbungen mod 3)`],
    ['5-färbbar', `${k.colorings5 > 5 ** k.components ? 'ja' : 'nein'} (${k.colorings5} Färbungen mod 5)`],
  ];
  if (k.jones) {
    const amph = sameLaurent(k.jones, mirrorJones(k.jones));
    inv2.push(['Spiegelbild', amph ? 'Jones symmetrisch – möglicherweise amphichiral' : 'chiral (Jones ≠ Jones des Spiegelbilds)']);
  }
  const g = formatGroupInfo(analyze(k.group));
  return h(
    'div',
    { class: 'stack' },
    section('Diagramm', facts(rows)),
    section('Invarianten', facts(inv2)),
    section(
      'Knotengruppe π₁(ℝ³ ∖ K)',
      facts([
        ['Wirtinger', `${k.group.gens.length} Erzeuger (Bögen), ${k.group.rels.length} Relationen (Kreuzungen)`],
        ['vereinfacht', g.presentation],
        ['', `${g.name === 'ℤ' ? 'ℤ – wie beim Unknoten' : g.name} · abelsch gemacht: ${g.detail.split('abelsch gemacht: ')[1]}`],
      ]),
    ),
  );
}

export const knotsModule: VizModule = {
  id: 'knots',
  name: 'Knoten',
  initialView: { cx: 0, cy: 0, scale: 9 / DIST_PER_SCALE },
  scaleRange: [3 / DIST_PER_SCALE, 40 / DIST_PER_SCALE],

  get fragSource() {
    return `${sceneSrc}
void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  fragColor = vec4(background(uv), 1.0);
}
`;
  },

  uniforms() {
    return {};
  },

  draw(gl, f) {
    if (view2D || !host) return;
    if (!program) {
      program = host.createProgram(tubeVertSrc, '#version 300 es\nprecision highp float;\n' + sceneSrc + tubeFragSrc);
      if (!program) return;
    }
    mesh.draw(gl, program, {
      ...orbitCamera(yaw, pitch, f.view.scale * DIST_PER_SCALE),
      u_colorMode: 0,
      u_aspect: f.width / f.height,
      u_tileClip: tileClip(f),
      u_shift: panelShift(f.width / f.pixelRatio),
    });
  },

  drawOverlay(ctx, i) {
    if (!view2D || !diagram) return;
    const left = i.width > 900 ? 440 : 16;
    drawKnotDiagram(ctx, diagram, { x: left, y: 30, w: i.width - left - 30, h: i.height - 70 }, COLORS, { signs: showSigns });
  },

  status() {
    return view2D ? 'Diagramm: + rechtshändige, − linkshändige Kreuzung' : 'Ziehen: drehen · Rad/Pinch: Abstand';
  },

  saveState: () => ({
    km: mode,
    ...(mode === 'catalog' ? { k: catalogId } : mode === 'torus' ? { p, q } : mode === 'braid' ? { b: braidText } : { cx: curve.x, cy: curve.y, cz: curve.z }),
    d2: view2D,
    yaw: +yaw.toFixed(3),
    pitch: +pitch.toFixed(3),
  }),

  loadState(ps) {
    mode = read.oneOf(ps, 'km', ['catalog', 'torus', 'braid', 'curve'] as const, mode);
    const k = ps.get('k');
    if (k && CATALOG.some((c) => c.id === k)) catalogId = k;
    p = Math.round(read.num(ps, 'p', p, 1, 12));
    q = Math.round(read.num(ps, 'q', q, 1, 12));
    braidText = ps.get('b') ?? braidText;
    const cx = ps.get('cx'), cy = ps.get('cy'), cz = ps.get('cz');
    if (cx && cy && cz) curve = { x: cx, y: cy, z: cz };
    view2D = read.bool(ps, 'd2', view2D);
    yaw = read.num(ps, 'yaw', yaw);
    pitch = read.num(ps, 'pitch', pitch, -1.5, 1.5);
    recompute();
  },

  onPointer(e, hst) {
    if (view2D) return false;
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
    const controls = h('div', { class: 'stack' });
    const factsBox = h('div', {});
    const info = h('p', { class: 'hint' });
    const small = h('canvas', { class: 'knot-diagram', width: 360, height: 220 });

    const modes = segmented(
      [
        { value: 'catalog', label: 'Katalog', title: 'Bekannte Knoten und Verschlingungen' },
        { value: 'torus', label: 'Torusknoten', title: 'T(p, q): p-mal um die Achse, q-mal durch das Loch' },
        { value: 'braid', label: 'Zopf', title: 'Abschluss eines Zopfs σ₁, σ₂⁻¹, …' },
        { value: 'curve', label: 'Kurve', title: 'Eigene geschlossene Raumkurve (x(t), y(t), z(t))' },
      ] as const,
      mode,
      (m) => {
        mode = m;
        buildControls();
        recompute();
      },
      'Knotenquelle',
    );

    const buildControls = () => {
      if (mode === 'catalog') {
        const list = menu('Knoten wählen …', [
          { label: 'Knoten', items: CATALOG.filter((c) => !['hopf', 'solomon', 'whitehead', 'borromean'].includes(c.id)).map((c) => ({ label: c.name, title: c.info })) },
          { label: 'Verschlingungen', items: CATALOG.filter((c) => ['hopf', 'solomon', 'whitehead', 'borromean'].includes(c.id)).map((c) => ({ label: c.name, title: c.info })) },
        ], (gi, ii) => {
          const pool = CATALOG.filter((c) => ['hopf', 'solomon', 'whitehead', 'borromean'].includes(c.id) === (gi === 1));
          catalogId = pool[ii]!.id;
          recompute();
        });
        const chipsRow = h(
          'div',
          { class: 'chips' },
          ...CATALOG.slice(0, 8).map((c) => {
            const b = h('button', { type: 'button', class: 'chip', title: c.info }, c.name.split(' ')[0]!);
            b.addEventListener('click', () => {
              catalogId = c.id;
              recompute();
            });
            return b;
          }),
        );
        controls.replaceChildren(h('div', { class: 'toolbar' }, list), chipsRow);
      } else if (mode === 'torus') {
        const note = h('p', { class: 'hint' });
        const upd = () => {
          const g = gcd(p, q);
          note.textContent = g > 1 ? `gcd(${p}, ${q}) = ${g}: Verschlingung aus ${g} Komponenten` : p === 1 || q === 1 ? 'p oder q = 1: Unknoten' : `Torusknoten, minimal ${Math.min(p * (q - 1), q * (p - 1))} Kreuzungen`;
        };
        upd();
        controls.replaceChildren(
          slider('p (um die Achse)', { min: 1, max: 9, step: 1, value: p, format: (v) => String(v) }, (v) => {
            p = v;
            upd();
            recompute();
          }),
          slider('q (durchs Loch)', { min: 1, max: 9, step: 1, value: q, format: (v) => String(v) }, (v) => {
            q = v;
            upd();
            recompute();
          }),
          note,
        );
      } else if (mode === 'braid') {
        const field = formulaField({
          label: 'Zopf:',
          ariaLabel: 'Zopfwort',
          value: braidText,
          apply(text) {
            try {
              parseBraidExpanded(text);
            } catch (e) {
              throw new ParseError((e as Error).message, 0, text.length);
            }
            braidText = text;
            recompute();
          },
        });
        controls.replaceChildren(
          field.el,
          h('div', { class: 'toolbar' }, menu('Beispiele …', [{ label: 'Zöpfe', items: BRAID_EXAMPLES.map((b) => ({ label: b.label, title: b.word })) }], (_, ii) => field.set(BRAID_EXAMPLES[ii]!.word))),
          h('p', { class: 'hint' }, 's1 = σ₁ (Strang 1 über Strang 2), s2^-1 = σ₂⁻¹, (…)^3 wiederholt. Auch „aBa“ (a = σ₁, B = σ₂⁻¹) oder „1 -2 1“.'),
        );
      } else {
        const fields = (['x', 'y', 'z'] as const).map((key) =>
          formulaField({
            label: `${key}(t) =`,
            ariaLabel: `${key}(t)`,
            value: curve[key],
            apply(text) {
              parse(text, realOptions(['t']));
              const next = { ...curve, [key]: text };
              try {
                curveLink(next);
              } catch (e) {
                throw new ParseError((e as Error).message, 0, text.length);
              }
              curve = next;
              recompute();
            },
          }),
        );
        const examples = menu('Beispiele …', [{ label: 'Kurven', items: CURVE_EXAMPLES.map((c) => ({ label: c.label })) }], (_, ii) => {
          const c = CURVE_EXAMPLES[ii]!;
          curve = { x: c.x, y: c.y, z: c.z };
          buildControls();
          recompute();
        });
        controls.replaceChildren(...fields.map((f) => f.el), h('div', { class: 'toolbar' }, examples), h('p', { class: 'hint' }, 't läuft von 0 bis 2π; die Kurve muss sich schließen und darf sich nicht selbst schneiden.'));
      }
    };
    buildControls();

    rerender = () => {
      factsBox.replaceChildren(invariantsView());
      const entry = mode === 'catalog' ? CATALOG.find((c) => c.id === catalogId) : null;
      info.textContent = entry ? `${entry.name}: ${entry.info}` : '';
      const ctx = small.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        small.width = 360 * dpr;
        small.height = 220 * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, 360, 220);
        if (diagram) drawKnotDiagram(ctx, diagram, { x: 0, y: 0, w: 360, h: 220 }, COLORS, { signs: false, bg: '#15171c' });
      }
      small.hidden = view2D;
    };
    rerender();

    const code = (s: string) => h('code', {}, s);
    container.append(
      modes.el,
      controls,
      info,
      h(
        'div',
        { class: 'toggles' },
        toggle('Diagramm statt 3D', view2D, (v) => {
          view2D = v;
          rerender?.();
          hst.requestRender();
        }),
        toggle('Vorzeichen', showSigns, (v) => ((showSigns = v), hst.requestRender())),
      ),
      small,
      factsBox,
      h(
        'details',
        { class: 'help' },
        h('summary', {}, 'Was bedeuten die Invarianten?'),
        h(
          'ul',
          {},
          h('li', {}, 'Diagramm: Projektion mit möglichst wenigen Kreuzungen; die Lücke zeigt den unteren Strang. Vorzeichen + = rechtshändig.'),
          h('li', {}, 'Alexander- und Jones-Polynom ändern sich nicht bei Reidemeister-Zügen – verschiedene Polynome ⇒ verschiedene Knoten.'),
          h('li', {}, 'Jones erkennt Chiralität: V(t) ≠ V(1/t) ⇒ Knoten ≠ Spiegelbild (Kleeblatt); der Achterknoten ist symmetrisch.'),
          h('li', {}, 'Färbbar mod p: Bögen so mit Zahlen mod p beschriften, dass an jeder Kreuzung 2·oben ≡ unten ein + unten aus – nichtkonstant möglich ⇔ p teilt die Determinante.'),
          h('li', {}, 'Knotengruppe: Wirtinger-Präsentation (ein Erzeuger je Bogen), vereinfacht per Tietze; ℤ genau beim Unknoten.'),
          h('li', {}, 'Zöpfe: ', code('s1 s2^-1 s1'), ', ', code('(s1 s2^-1)^3'), '; Kurven: ', code('x(t), y(t), z(t)'), ' mit t ∈ [0, 2π].'),
        ),
      ),
    );
    return () => {
      rerender = null;
      host = null;
    };
  },
};

function tileClip(f: { width: number; height: number; tile: { x: number; y: number; width: number; height: number } }): [number, number, number, number] {
  const t = f.tile;
  return [f.width / t.width, f.height / t.height, (f.width - 2 * t.x - t.width) / t.width, (f.height - 2 * t.y - t.height) / t.height];
}
