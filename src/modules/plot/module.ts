import type { ModuleHost, VizModule } from '../types';
import { parse, ParseError, realOptions } from '../../math/parser';
import { codegenReal, evaluateReal, REAL_GLSL_HELPERS } from '../../math/real';
import { drawAxes2D, niceStep } from '../../ui/axes';
import { formulaField } from '../../ui/formula';
import { read } from '../../ui/urlState';
import { chips, h, slider, toggle } from '../../ui/widgets';
import { evaluator, findExtrema, findZeros, parsePlot, sampleCurve, sampleExplicit } from './items';
import type { PlotItem, Pt } from './items';
import plotSrc from './plot.frag?raw';

const COLORS = ['#e6887d', '#80a8ec', '#8cc97f', '#e2c46a', '#c592e0', '#6fcfc4', '#f0a45c', '#d97aa6'];
const MAX_ROWS = 8;

const PRESETS: readonly { label: string; text: string }[] = [
  { label: 'sin(x)', text: 'sin(x)' },
  { label: 'x³ − 3x', text: 'x^3 - 3x' },
  { label: 'a·sin(bx)', text: 'a sin(b x)' },
  { label: 'Gauß', text: 'e^(-x^2/2)' },
  { label: 'tan', text: 'tan(x)' },
  { label: '1/x', text: '1/x' },
  { label: 'Kreis', text: 'x^2 + y^2 = 4' },
  { label: 'Elliptische Kurve', text: 'y^2 = x^3 - x + a' },
  { label: 'Ungleichung', text: 'y < sin(x) + 0.5' },
  { label: 'Lissajous', text: '(sin(3t), sin(2t))' },
  { label: 'Kardioide', text: 'r = 1 + cos(t)' },
  { label: 'Rose', text: 'r = cos(k t)' },
  { label: 'xʸ = yˣ', text: 'x^y = y^x' },
];

interface Row {
  text: string;
  color: string;
  visible: boolean;
  item: PlotItem | null;
  /** Parameterbereich für parametrische/polare Kurven */
  t0: number;
  t1: number;
  tText: [string, string];
}

interface Param {
  value: number;
  min: number;
  max: number;
  playing: boolean;
}

let source = plotSrc;
let rows: Row[] = [];
const params = new Map<string, Param>();
let markers = true;
let grid = true;
let host: ModuleHost | null = null;
let rebuildUi: (() => void) | null = null;

function makeRow(text: string, color?: string): Row {
  const row: Row = {
    text,
    color: color ?? COLORS.find((c) => !rows.some((r) => r.color === c)) ?? COLORS[rows.length % COLORS.length]!,
    visible: true,
    item: null,
    t0: 0,
    t1: 2 * Math.PI,
    tText: ['0', '2pi'],
  };
  try {
    row.item = parsePlot(text);
  } catch {
    row.item = null;
  }
  return row;
}

rows = [makeRow('sin(x)', COLORS[0]), makeRow('x - x^3/6', COLORS[1])];
syncParams();

/** Parameter aller Zeilen sammeln (Werte bekannter Parameter bleiben erhalten) */
function syncParams(): boolean {
  const names = new Set(rows.flatMap((r) => r.item?.params ?? []));
  let changed = false;
  for (const n of names) {
    if (!params.has(n)) {
      params.set(n, { value: 1, min: -5, max: 5, playing: false });
      changed = true;
    }
  }
  for (const n of [...params.keys()]) {
    if (!names.has(n)) {
      params.delete(n);
      changed = true;
    }
  }
  return changed;
}

const paramNames = () => [...params.keys()].sort();
const paramValues = (): Record<string, number> => Object.fromEntries([...params].map(([k, p]) => [k, p.value]));

// ---------------------------------------------------------------------------
// Shader für implizite Zeilen

function implicitRows() {
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.visible && r.item?.kind === 'implicit');
}

function buildSource(): string {
  const names = paramNames();
  const vars: Record<string, string> = { x: 'x', y: 'y' };
  names.forEach((n, i) => (vars[n] = `u_p[${i}]`));
  const funcs: string[] = [];
  const draws: string[] = [];
  for (const { r, i } of implicitRows()) {
    const it = r.item as Extract<PlotItem, { kind: 'implicit' }>;
    let code: string;
    try {
      code = codegenReal(it.F, vars);
    } catch {
      continue;
    }
    const [cr, cg, cb] = [1, 3, 5].map((k) => (parseInt(r.color.slice(k, k + 2), 16) / 255).toFixed(3));
    funcs.push(`float F${i}(float x, float y) { return ${code}; }`);
    const region =
      it.op === '<' || it.op === '<='
        ? `col = mix(col, C, 0.2 * step(v, 0.0));`
        : it.op === '>' || it.op === '>='
          ? `col = mix(col, C, 0.2 * step(0.0, v));`
          : '';
    const strict = it.op === '<' || it.op === '>';
    draws.push(
      `  { vec3 C = vec3(${cr}, ${cg}, ${cb}); float v = F${i}(x, y); ${region} ` +
        `col = mix(col, C, curve(v, lw)${strict ? ' * dash' : ''}); }`,
    );
  }
  return source
    .replace('//HELPERS', REAL_GLSL_HELPERS)
    .replace('//FUNCS', funcs.join('\n'))
    .replace('//DRAW', draws.join('\n'));
}

let lastSource = '';
function changed(hst: ModuleHost | null): void {
  const paramsChanged = syncParams();
  if (hst) {
    const src = buildSource();
    if (src !== lastSource) hst.recompile();
    hst.requestRender();
  }
  if (paramsChanged) rebuildUi?.();
}

// ---------------------------------------------------------------------------
// Parameter-Animation (hin und her zwischen min und max)

let animFrame = 0;
let animLast = 0;
function animate(time: number) {
  const playing = [...params.values()].filter((p) => p.playing);
  if (!playing.length || !host) return;
  if (animLast) {
    const dt = Math.min(time - animLast, 50) / 1000;
    for (const p of playing) {
      const speed = ((p.max - p.min) / 4) * (p as Param & { dir?: number }).dir!;
      p.value += speed * dt;
      if (p.value > p.max || p.value < p.min) {
        (p as Param & { dir?: number }).dir! *= -1;
        p.value = Math.min(p.max, Math.max(p.min, p.value));
      }
    }
    onParamTick?.();
    host.requestRender();
  }
  animLast = time;
  animFrame = requestAnimationFrame(animate);
}
let onParamTick: (() => void) | null = null;
function startAnimation() {
  cancelAnimationFrame(animFrame);
  animLast = 0;
  animFrame = requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Zeichnen der Kurven (Beschriftungsebene)

function fmt(v: number): string {
  if (Math.abs(v) < 1e-10) return '0';
  const a = Math.abs(v);
  return a >= 1e5 || a < 1e-3 ? v.toExponential(2) : String(+v.toPrecision(4));
}

export const plotModule: VizModule = {
  id: 'plot',
  name: 'Graphen',
  initialView: { cx: 0, cy: 0, scale: 1 / 60 },
  scaleRange: [1e-12, 1e6],

  get fragSource() {
    lastSource = buildSource();
    return lastSource;
  },

  uniforms({ view }) {
    const step = niceStep(view.scale * 110);
    const mod = (a: number) => ((a % step) + step) % step;
    const minorPx = step / 5 / view.scale;
    const values = paramNames().map((n) => params.get(n)!.value);
    while (values.length < 16) values.push(0);
    return {
      u_spacing: step,
      u_phase: [mod(view.cx), mod(view.cy)],
      u_minorAlpha: Math.min(1, Math.max(0, (minorPx - 6) / 10)),
      u_grid: grid ? 1 : 0,
      u_p: values.slice(0, 16),
    };
  },

  drawOverlay(ctx, info) {
    const { view, width: w, height: hgt } = info;
    const s = view.scale;
    const toS = (p: Pt): Pt => [(p[0] - view.cx) / s + w / 2, hgt / 2 - (p[1] - view.cy) / s];
    const x0 = view.cx - (w / 2) * s;
    const x1 = view.cx + (w / 2) * s;
    const viewH = hgt * s;
    if (info.axes) drawAxes2D(ctx, view, w, hgt, { xName: 'x', yName: 'y' });

    const env = paramValues();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const explicitFns: { f: (x: number) => number; color: string }[] = [];
    for (const r of rows) {
      const it = r.item;
      if (!r.visible || !it || it.kind === 'implicit') continue;
      let segs: Pt[][];
      if (it.kind === 'explicit') {
        const f = evaluator(it.f, env, 'x');
        explicitFns.push({ f, color: r.color });
        segs = sampleExplicit(f, x0, x1, Math.ceil(w * 2), viewH);
      } else if (it.kind === 'parametric') {
        const fx = evaluator(it.x, env, 't');
        const fy = evaluator(it.y, env, 't');
        segs = sampleCurve((t) => [fx(t), fy(t)], r.t0, r.t1, 3000, viewH * 0.3);
      } else {
        const fr = evaluator(it.r, env, 't');
        segs = sampleCurve((t) => {
          const rr = fr(t);
          return [rr * Math.cos(t), rr * Math.sin(t)];
        }, r.t0, r.t1, 3000, viewH * 0.3);
      }
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2.2;
      for (const seg of segs) {
        ctx.beginPath();
        seg.forEach((p, i) => {
          const q = toS(p);
          // Extreme Werte begrenzen (Canvas verträgt keine riesigen Koordinaten)
          const y = Math.max(-1e5, Math.min(1e5, q[1]));
          if (i) ctx.lineTo(q[0], y);
          else ctx.moveTo(q[0], y);
        });
        ctx.stroke();
      }
    }

    if (!markers || !explicitFns.length) return;
    // Nullstellen, Extrema, Schnittpunkte expliziter Kurven
    const n = Math.ceil(w / 2);
    const pts: { p: Pt; color: string; kind: string }[] = [];
    for (const { f, color } of explicitFns) {
      for (const z of findZeros(f, x0, x1, n)) pts.push({ p: [z, 0], color, kind: 'Nullstelle' });
      for (const e of findExtrema(f, x0, x1, n)) pts.push({ p: [e.x, e.y], color, kind: e.max ? 'Maximum' : 'Minimum' });
    }
    for (let i = 0; i < explicitFns.length; i++) {
      for (let j = i + 1; j < explicitFns.length; j++) {
        const f = explicitFns[i]!.f, g = explicitFns[j]!.f;
        for (const z of findZeros((x) => f(x) - g(x), x0, x1, n)) pts.push({ p: [z, f(z)], color: '#f4f6fa', kind: 'Schnittpunkt' });
      }
    }
    const visible = pts.filter(({ p }) => Math.abs(p[1] - view.cy) < viewH / 2);
    ctx.font = '11px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const { p, color } of visible) {
      const [sx, sy] = toS(p);
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#0e0f12';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (visible.length <= 16) {
        const label = `(${fmt(p[0])}, ${fmt(p[1])})`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8, 9, 12, 0.85)';
        ctx.strokeText(label, sx + 6, sy - 4);
        ctx.fillStyle = 'rgba(225, 229, 236, 0.92)';
        ctx.fillText(label, sx + 6, sy - 4);
      }
    }
  },

  status(x, y) {
    const env = paramValues();
    const vals = rows
      .map((r, i) => (r.visible && r.item?.kind === 'explicit' ? `f${i + 1} = ${fmt(evaluateReal(r.item.f, { ...env, x }))}` : null))
      .filter(Boolean);
    return [`x ${fmt(x)}  y ${fmt(y)}`, ...vals].join('  ·  ');
  },

  saveState() {
    const st: Record<string, string | number | boolean> = { mk: markers, gr: grid };
    rows.forEach((r, i) => {
      st[`f${i + 1}`] = r.text;
      if (!r.visible) st[`h${i + 1}`] = true;
      if (r.item?.kind === 'parametric' || r.item?.kind === 'polar') st[`r${i + 1}`] = r.tText.join(',');
    });
    for (const [n, p] of params) st[`p_${n}`] = +p.value.toPrecision(6);
    return st;
  },

  loadState(p) {
    const loaded: Row[] = [];
    for (let i = 1; i <= MAX_ROWS; i++) {
      const text = p.get(`f${i}`);
      if (text === null) continue;
      const row = makeRow(text, COLORS[(i - 1) % COLORS.length]);
      row.visible = !read.bool(p, `h${i}`, false);
      const range = p.get(`r${i}`)?.split(',');
      if (range?.length === 2) {
        try {
          const [a, b] = range.map((s) => evaluateReal(parse(s, realOptions([])), {}));
          if (Number.isFinite(a) && Number.isFinite(b)) {
            row.t0 = a!;
            row.t1 = b!;
            row.tText = range as [string, string];
          }
        } catch {
          // ungültiger Bereich → Vorgabe
        }
      }
      loaded.push(row);
    }
    if (loaded.length) rows = loaded;
    syncParams();
    for (const [n, par] of params) par.value = read.num(p, `p_${n}`, par.value);
    markers = read.bool(p, 'mk', markers);
    grid = read.bool(p, 'gr', grid);
  },

  ui(container, hst) {
    host = hst;
    const list = h('div', { class: 'plot-rows' });
    const paramBox = h('div', { class: 'params' });

    const buildParams = () => {
      onParamTick = null;
      const updaters: (() => void)[] = [];
      paramBox.replaceChildren(
        ...paramNames().map((name) => {
          const par = params.get(name)!;
          const s = slider(name, { min: par.min, max: par.max, step: 0.01, value: par.value, format: (v) => String(+v.toFixed(2)) }, (v) => {
            par.value = v;
            hst.requestRender();
          });
          const play = h('button', { type: 'button', class: 'icon', title: `${name} animieren` }, par.playing ? '❚❚' : '▶');
          play.addEventListener('click', () => {
            par.playing = !par.playing;
            (par as Param & { dir?: number }).dir ??= 1;
            play.textContent = par.playing ? '❚❚' : '▶';
            startAnimation();
          });
          updaters.push(() => {
            const input = s.querySelector('input')!;
            const out = s.querySelector('output')!;
            input.value = String(par.value);
            out.textContent = String(+par.value.toFixed(2));
          });
          return h('div', { class: 'param-row' }, s, play);
        }),
      );
      onParamTick = () => updaters.forEach((u) => u());
    };

    const buildRows = () => {
      list.replaceChildren(
        ...rows.map((row, i) => {
          const swatch = h('button', {
            type: 'button',
            class: 'swatch',
            title: row.visible ? 'Ausblenden' : 'Einblenden',
            'aria-pressed': String(row.visible),
            style: `--c: ${row.color}`,
          });
          swatch.addEventListener('click', () => {
            row.visible = !row.visible;
            swatch.setAttribute('aria-pressed', String(row.visible));
            changed(hst);
          });
          const field = formulaField({
            label: `${i + 1}`,
            ariaLabel: `Funktion ${i + 1}`,
            value: row.text,
            apply(text) {
              const item = parsePlot(text);
              const kindChanged = (item.kind === 'parametric' || item.kind === 'polar') !== (row.item?.kind === 'parametric' || row.item?.kind === 'polar');
              row.item = item;
              row.text = text;
              changed(hst);
              if (kindChanged) buildRows();
            },
          });
          const del = h('button', { type: 'button', class: 'icon', title: 'Zeile entfernen' }, '×');
          del.addEventListener('click', () => {
            rows.splice(i, 1);
            buildRows();
            changed(hst);
          });
          const main = h('div', { class: 'plot-row' }, swatch, field.el, del);
          if (row.item?.kind !== 'parametric' && row.item?.kind !== 'polar') return main;
          // Bereich für t
          const bound = (k: 0 | 1) =>
            formulaField({
              label: k === 0 ? 't von' : 'bis',
              compact: true,
              value: row.tText[k],
              apply(text) {
                const v = evaluateReal(parse(text, realOptions([])), {});
                if (!Number.isFinite(v)) throw new ParseError('Kein endlicher Wert', 0, text.length);
                row.tText[k] = text;
                if (k === 0) row.t0 = v;
                else row.t1 = v;
                hst.requestRender();
              },
            }).el;
          return h('div', { class: 'stack' }, main, h('div', { class: 'ranges' }, bound(0), bound(1)));
        }),
      );
    };

    const add = (text: string) => {
      if (rows.length >= MAX_ROWS) rows.shift();
      rows.push(makeRow(text));
      buildRows();
      changed(hst);
    };
    const addButton = h('button', { type: 'button', class: 'chip accent' }, '+ Zeile');
    addButton.addEventListener('click', () => add(''));

    rebuildUi = () => buildParams();
    buildRows();
    buildParams();

    container.append(
      list,
      h('div', { class: 'chips' }, addButton),
      chips(PRESETS.map((p) => ({ label: p.label, title: p.text, onClick: () => add(p.text) }))),
      paramBox,
      h(
        'div',
        { class: 'toggles' },
        toggle('Nullstellen & Extrema', markers, (v) => ((markers = v), hst.requestRender())),
        toggle('Gitter', grid, (v) => ((grid = v), hst.requestRender())),
      ),
      h(
        'details',
        { class: 'help' },
        h('summary', {}, 'Syntax'),
        h(
          'p',
          {},
          'f(x) oder y = f(x); implizit F(x,y) = G(x,y); Bereiche mit <, >, ≤, ≥; parametrisch (x(t), y(t)); ',
          'polar r = f(t). Andere einzelne Buchstaben (a, b, k, …) werden zu Parametern mit Regler. ',
          'Farbfeld links blendet eine Zeile ein/aus. Unter dem Cursor stehen die Funktionswerte.',
        ),
      ),
    );
    if ([...params.values()].some((p) => p.playing)) startAnimation();
    return () => {
      cancelAnimationFrame(animFrame);
      onParamTick = null;
      rebuildUi = null;
      host = null;
    };
  },
};

if (import.meta.hot) {
  import.meta.hot.accept('./plot.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
