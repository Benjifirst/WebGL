import type { ModuleHost, VizModule } from '../types';
import { parse, ParseError, realOptions } from '../../math/parser';
import type { Node } from '../../math/parser';
import { pretty } from '../../math/diff';
import { codegenReal, compileReal, evaluateReal, REAL_GLSL_HELPERS } from '../../math/real';
import { drawAxes2D, niceStep } from '../../ui/axes';
import { formulaField } from '../../ui/formula';
import { read } from '../../ui/urlState';
import { h, menu, section, slider, toggle } from '../../ui/widgets';
import {
  curveEvaluator, definitions, evaluator, findExtrema, findZeros, parsePlot, resolveItem, sampleCurve,
  sampleExplicit, scanDefinitions,
} from './items';
import type { PlotItem, Pt } from './items';
import plotSrc from './plot.frag?raw';

const COLORS = ['#e6887d', '#80a8ec', '#8cc97f', '#e2c46a', '#c592e0', '#6fcfc4', '#f0a45c', '#d97aa6'];
const MAX_ROWS = 10;
const MAX_PARAMS = 16;

interface Preset {
  label: string;
  rows: string[];
  params?: Record<string, [value: number, min: number, max: number]>;
  range?: [string, string];
}

const PRESETS: readonly { label: string; items: readonly Preset[] }[] = [
  {
    label: 'Funktionen',
    items: [
      { label: 'x³ − 3x', rows: ['x^3 - 3x'] },
      { label: 'a·sin(bx + c)', rows: ['a sin(b x + c)'] },
      { label: 'Gauß-Glocke', rows: ['e^(-x^2/2) / sqrt(2pi)'] },
      { label: 'tan und Polstellen', rows: ['tan(x)'] },
      { label: '√x, ∛x, ln x', rows: ['sqrt(x)', 'cbrt(x)', 'ln(x)'] },
      { label: 'Betrag |x|', rows: ['|x| - 1', '||x| - 2|'] },
      { label: 'Gammafunktion, x!', rows: ['gamma(x)', 'x!'] },
      { label: 'floor und frac', rows: ['floor(x)', 'frac(x)'] },
      { label: 'sin(1/x)', rows: ['sin(1/x)'] },
      { label: 'arcsin, arccos, arctan', rows: ['asin(x)', 'acos(x)', 'atan(x)'] },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { label: 'f und Ableitungen', rows: ['f(x) = x^3 - 3x^2 + 2', "f'(x)", "f''(x)"] },
      { label: 'Tangente an f', rows: ['f(x) = sin(x) + x/2', "f'(a)(x - a) + f(a)", '(a, f(a))'], params: { a: [1, -5, 5] } },
      { label: 'Taylorpolynom von sin', rows: ['sin(x)', 'sum(k = 0, n, (-1)^k x^(2k+1) / (2k+1)!)'], params: { n: [3, 0, 12] } },
      { label: 'Integralfunktion', rows: ['f(x) = e^(-x^2)', 'int(t = 0, x, f(t))'] },
      { label: 'Fläche unter der Kurve', rows: ['x^2', 'int(t = 0, b, t^2)'], params: { b: [1.5, -3, 3] } },
      { label: 'Stückweise', rows: ['if(x < 0, -x, x^2)', 'sin(x) {0 < x < 2pi}'] },
      { label: 'Riemann-Zeta (reell)', rows: ['sum(k = 1, 2000, 1/k^x) {x > 1}'] },
    ],
  },
  {
    label: 'Implizit & Bereiche',
    items: [
      { label: 'Kreis mit Radius r', rows: ['x^2 + y^2 = r^2'], params: { r: [2, 0, 5] } },
      { label: 'Elliptische Kurve', rows: ['y^2 = x^3 - x + a'] },
      { label: 'Herzkurve', rows: ['(x^2 + y^2 - 1)^3 = x^2 y^3'] },
      { label: 'xʸ = yˣ', rows: ['x^y = y^x'] },
      { label: 'Bereich zwischen Kurven', rows: ['x^2 - 2 < y < 2 - x^2'] },
      { label: 'Raute |x| + |y| ≤ 1', rows: ['|x| + |y| <= 1'] },
      { label: 'Halbkreis', rows: ['x^2 + y^2 = 4 {y > 0}'] },
    ],
  },
  {
    label: 'Kurven & Punkte',
    items: [
      { label: 'Lissajous', rows: ['(sin(3t), sin(2t))'] },
      { label: 'Kardioide', rows: ['r = 1 + cos(t)'] },
      { label: 'Rose', rows: ['r = cos(k t)'], params: { k: [3, 0, 8] } },
      { label: 'Spirale', rows: ['r = t/4'], range: ['0', '8pi'] },
      { label: 'Punkt auf der Kurve', rows: ['sin(x)', '(a, sin(a))'], params: { a: [1, -5, 5] } },
    ],
  },
];

interface Row {
  text: string;
  color: string;
  visible: boolean;
  /** geparst (eigene Funktionen noch nicht eingesetzt) */
  raw: PlotItem | null;
  /** eingesetzt und bereit zum Zeichnen */
  item: PlotItem | null;
  error: string | null;
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
  dir: number;
}

let source = plotSrc;
let rows: Row[] = [];
const params = new Map<string, Param>();
let markers = true;
let grid = true;
let host: ModuleHost | null = null;
let rebuildUi: (() => void) | null = null;
let refreshNotes: (() => void) | null = null;

function makeRow(text: string, color?: string): Row {
  return {
    text,
    color: color ?? COLORS.find((c) => !rows.some((r) => r.color === c)) ?? COLORS[rows.length % COLORS.length]!,
    visible: true,
    raw: null,
    item: null,
    error: null,
    t0: 0,
    t1: 2 * Math.PI,
    tText: ['0', '2pi'],
  };
}

/** Enthält der Ausdruck eine Ableitung f', f'' …? */
function hasDerivative(n: Node): boolean {
  switch (n.type) {
    case 'user': return n.order > 0 || hasDerivative(n.arg);
    case 'neg': case 'call': return hasDerivative(n.arg);
    case 'bin': return hasDerivative(n.left) || hasDerivative(n.right);
    case 'fn': case 'cmp': return n.args.some(hasDerivative);
    case 'big': return hasDerivative(n.from) || hasDerivative(n.to) || hasDerivative(n.body);
    default: return false;
  }
}
const hasBigNode = (n: Node): boolean => JSON.stringify(n).includes('"type":"big"');

/** Alle Zeilen parsen und eigene Funktionen einsetzen (Definitionen dürfen in jeder Zeile stehen) */
function reparseAll(): void {
  const user = scanDefinitions(rows.map((r) => r.text));
  for (const r of rows) {
    r.error = null;
    try {
      r.raw = r.text.trim() ? parsePlot(r.text, user) : null;
    } catch (e) {
      r.raw = null;
      r.error = e instanceof ParseError ? e.message : String(e);
    }
  }
  const defs = definitions(rows.map((r) => r.raw));
  for (const r of rows) {
    r.item = null;
    if (!r.raw) continue;
    try {
      r.item = resolveItem(r.raw, defs);
      if (r.item.kind === 'implicit') glslCheck(r.item);
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
      r.item = null;
    }
  }
}

/** Implizite Zeilen laufen im Shader: dort gibt es keine Summen/Integrale */
function glslCheck(it: Extract<PlotItem, { kind: 'implicit' }>): void {
  const vars: Record<string, string> = { x: 'x', y: 'y' };
  for (const p of it.params) vars[p] = '0.0';
  for (const part of it.parts) codegenReal(part.F, vars, true);
  if (it.domain) codegenReal(it.domain, vars, true);
}

rows = [makeRow('f(x) = sin(x)', COLORS[0]), makeRow("f'(x)", COLORS[1])];
reparseAll();
syncParams();

/** Parameter aller Zeilen sammeln (Werte bekannter Parameter bleiben erhalten) */
function syncParams(): boolean {
  const names = new Set(rows.flatMap((r) => r.item?.params ?? []));
  let changed = false;
  for (const n of names) {
    if (!params.has(n)) {
      params.set(n, { value: 1, min: -5, max: 5, playing: false, dir: 1 });
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

const paramNames = () => [...params.keys()].sort().slice(0, MAX_PARAMS);
const paramValues = (): Record<string, number> => Object.fromEntries([...params].map(([k, p]) => [k, p.value]));

// ---------------------------------------------------------------------------
// Shader für implizite Zeilen (Kurven, Bereiche, Ketten a < F < b, Einschränkungen {…})

function rgb(hex: string): string {
  return [1, 3, 5].map((k) => (parseInt(hex.slice(k, k + 2), 16) / 255).toFixed(3)).join(', ');
}

function buildSource(): string {
  const names = paramNames();
  const vars: Record<string, string> = { x: 'x', y: 'y' };
  names.forEach((n, i) => (vars[n] = `u_p[${i}]`));
  const funcs: string[] = [];
  const draws: string[] = [];
  rows.forEach((r, i) => {
    const it = r.item;
    if (!r.visible || it?.kind !== 'implicit') return;
    try {
      const codes = it.parts.map((p) => codegenReal(p.F, vars, true));
      const dom = it.domain ? codegenReal(it.domain, vars, true) : 'true';
      codes.forEach((c, j) => funcs.push(`float F${i}_${j}(float x, float y) { return ${c}; }`));
      funcs.push(`bool D${i}(float x, float y) { return ${dom}; }`);
      const lines = [`vec3 C = vec3(${rgb(r.color)});`, `bool dom = D${i}(x, y);`];
      it.parts.forEach((p, j) => {
        lines.push(`float v${j} = F${i}_${j}(x, y);`);
        // ok: Bedingung erfüllt (Fläche); near: nicht verletzt (Rand der übrigen Bedingungen)
        const strictCmp = p.op === '=' ? 'true' : `v${j} ${p.op} 0.0`;
        const looseCmp = p.op === '=' ? 'true' : `v${j} ${p.op.startsWith('<') ? '<=' : '>='} 0.0`;
        lines.push(`bool ok${j} = !isnan(v${j}) && (${strictCmp});`, `bool near${j} = !isnan(v${j}) && (${looseCmp});`);
      });
      if (it.parts.some((p) => p.op !== '=')) {
        lines.push(`col = mix(col, C, 0.2 * float(dom && ${it.parts.map((_, j) => `ok${j}`).join(' && ')}));`);
      }
      it.parts.forEach((p, j) => {
        const mask = ['dom', ...it.parts.flatMap((_, k) => (k === j ? [] : [`near${k}`]))].join(' && ');
        const strict = p.op === '<' || p.op === '>';
        lines.push(`col = mix(col, C, curve(isnan(v${j}) ? 1e30 : v${j}, lw) * float(${mask})${strict ? ' * dash' : ''});`);
      });
      draws.push(`  {\n    ${lines.join('\n    ')}\n  }`);
    } catch {
      // Fehler wurde bereits beim Parsen gemeldet
    }
  });
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
  refreshNotes?.();
}

// ---------------------------------------------------------------------------
// Parameter-Animation (hin und her zwischen min und max)

let animFrame = 0;
let animLast = 0;
let onParamTick: (() => void) | null = null;
function animate(time: number) {
  const playing = [...params.values()].filter((p) => p.playing);
  if (!playing.length || !host) return;
  if (animLast) {
    const dt = Math.min(time - animLast, 50) / 1000;
    for (const p of playing) {
      p.value += ((p.max - p.min) / 4) * p.dir * dt;
      if (p.value > p.max || p.value < p.min) {
        p.dir *= -1;
        p.value = Math.min(p.max, Math.max(p.min, p.value));
      }
    }
    onParamTick?.();
    refreshNotes?.();
    host.requestRender();
  }
  animLast = time;
  animFrame = requestAnimationFrame(animate);
}
function startAnimation() {
  cancelAnimationFrame(animFrame);
  animLast = 0;
  animFrame = requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Zeichnen der Kurven (Beschriftungsebene)

function fmt(v: number): string {
  if (Number.isNaN(v)) return 'undefiniert';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (Math.abs(v) < 1e-12) return '0';
  const a = Math.abs(v);
  return a >= 1e6 || a < 1e-4 ? v.toExponential(6) : String(+v.toPrecision(10));
}
const fmtShort = (v: number) =>
  Number.isNaN(v) ? '–' : Math.abs(v) < 1e-10 ? '0' : Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 ? v.toExponential(2) : String(+v.toPrecision(4));

/** Name einer Zeile für Anzeigen (f bei Definitionen, sonst Zeilennummer) */
const rowName = (r: Row, i: number) => (r.item?.def ? r.item.def.name : `(${i + 1})`);

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
    const points: { p: Pt; color: string }[] = [];
    const clampY = (y: number) => Math.max(-1e5, Math.min(1e5, y));
    const stroke = (segs: Pt[][], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      for (const seg of segs) {
        ctx.beginPath();
        seg.forEach((p, i) => {
          const q = toS(p);
          if (i) ctx.lineTo(q[0], clampY(q[1]));
          else ctx.moveTo(q[0], clampY(q[1]));
        });
        ctx.stroke();
      }
    };
    const t = (name: string): Node => ({ type: 'var', name });

    for (const r of rows) {
      const it = r.item;
      if (!r.visible || !it || it.kind === 'implicit') continue;
      if (it.kind === 'explicit') {
        const f = evaluator(it.f, env, 'x', it.domain);
        explicitFns.push({ f, color: r.color });
        // Summen/Integrale sind teuer: weniger Abtastpunkte
        stroke(sampleExplicit(f, x0, x1, Math.ceil(hasBigNode(it.f) ? w / 2 : w * 1.5), viewH), r.color);
      } else if (it.kind === 'parametric') {
        stroke(sampleCurve(curveEvaluator(it.x, it.y, env, it.domain), r.t0, r.t1, 4000, viewH * 0.3), r.color);
      } else if (it.kind === 'polar') {
        const px: Node = { type: 'bin', op: '*', left: it.r, right: { type: 'call', fn: 'cos', arg: t('t') } };
        const py: Node = { type: 'bin', op: '*', left: it.r, right: { type: 'call', fn: 'sin', arg: t('t') } };
        stroke(sampleCurve(curveEvaluator(px, py, env, it.domain), r.t0, r.t1, 4000, viewH * 0.3), r.color);
      } else if (it.kind === 'point') {
        const p = curveEvaluator(it.x, it.y, env, it.domain)(0);
        if (Number.isFinite(p[0]) && Number.isFinite(p[1])) points.push({ p, color: r.color });
      } else if (it.kind === 'value' && it.v.type === 'big' && it.v.op === 'int') {
        // Integral ohne x: Fläche zwischen Integrand und Achse zeigen
        const { from, to, body, index } = it.v;
        const a = compileReal(from, true)({ ...env });
        const b = compileReal(to, true)({ ...env });
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
        const g = evaluator(body, env, index);
        const lo = Math.max(Math.min(a, b), x0 - (x1 - x0));
        const hi = Math.min(Math.max(a, b), x1 + (x1 - x0));
        ctx.fillStyle = r.color + '40';
        ctx.beginPath();
        const start = toS([lo, 0]);
        ctx.moveTo(start[0], start[1]);
        const n = 400;
        for (let k = 0; k <= n; k++) {
          const tt = lo + ((hi - lo) * k) / n;
          const y = g(tt);
          const q = toS([tt, Number.isFinite(y) ? y : 0]);
          ctx.lineTo(q[0], clampY(q[1]));
        }
        const end = toS([hi, 0]);
        ctx.lineTo(end[0], end[1]);
        ctx.closePath();
        ctx.fill();
        stroke(sampleExplicit(g, lo, hi, 400, viewH), r.color);
      }
    }

    ctx.font = '11px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    // Werte unterhalb der Bildauflösung als 0 zeigen (numerisches Rauschen der Extremsuche)
    const snap = (v: number) => (Math.abs(v) < s * 1e-3 ? 0 : v);
    const coord = (p: Pt) => `(${fmtShort(snap(p[0]))}, ${fmtShort(snap(p[1]))})`;
    const label = (sx: number, sy: number, text: string) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 9, 12, 0.85)';
      ctx.strokeText(text, sx + 6, sy - 4);
      ctx.fillStyle = 'rgba(225, 229, 236, 0.92)';
      ctx.fillText(text, sx + 6, sy - 4);
    };
    for (const { p, color } of points) {
      const [sx, sy] = toS(p);
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      label(sx, sy, coord(p));
    }

    if (!markers || !explicitFns.length) return;
    // Nullstellen, Extrema, Schnittpunkte expliziter Kurven
    const n = Math.ceil(w / 2);
    const pts: { p: Pt; color: string }[] = [];
    for (const { f, color } of explicitFns) {
      for (const z of findZeros(f, x0, x1, n)) pts.push({ p: [z, 0], color });
      for (const e of findExtrema(f, x0, x1, n)) pts.push({ p: [e.x, e.y], color });
    }
    for (let i = 0; i < explicitFns.length; i++) {
      for (let j = i + 1; j < explicitFns.length; j++) {
        const f = explicitFns[i]!.f, g = explicitFns[j]!.f;
        for (const z of findZeros((x) => f(x) - g(x), x0, x1, n)) pts.push({ p: [z, f(z)], color: '#f4f6fa' });
      }
    }
    const visible = pts.filter(({ p }) => Number.isFinite(p[1]) && Math.abs(p[1] - view.cy) < viewH / 2);
    for (const { p, color } of visible) {
      const [sx, sy] = toS(p);
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#0e0f12';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (visible.length <= 16) label(sx, sy, coord(p));
    }
  },

  status(x, y) {
    const env = paramValues();
    const vals = rows
      .map((r, i) => {
        const it = r.item;
        if (!r.visible || it?.kind !== 'explicit') return null;
        const v = evaluator(it.f, env, 'x', it.domain)(x);
        return it.def ? `${rowName(r, i)}(x) = ${fmtShort(v)}` : `${rowName(r, i)} ${fmtShort(v)}`;
      })
      .filter(Boolean);
    return [`x ${fmtShort(x)}  y ${fmtShort(y)}`, ...vals].join('  ·  ');
  },

  saveState() {
    const st: Record<string, string | number | boolean> = { mk: markers, gr: grid };
    rows.forEach((r, i) => {
      st[`f${i + 1}`] = r.text;
      if (!r.visible) st[`h${i + 1}`] = true;
      if (r.item?.kind === 'parametric' || r.item?.kind === 'polar') st[`r${i + 1}`] = r.tText.join(',');
    });
    for (const [n, p] of params) {
      st[`p_${n}`] = +p.value.toPrecision(6);
      if (p.min !== -5 || p.max !== 5) st[`pr_${n}`] = `${p.min},${p.max}`;
    }
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
      if (range?.length === 2) setRange(row, range as [string, string]);
      loaded.push(row);
    }
    if (loaded.length) rows = loaded;
    reparseAll();
    syncParams();
    for (const [n, par] of params) {
      const pr = p.get(`pr_${n}`)?.split(',').map(Number);
      if (pr?.length === 2 && pr.every(Number.isFinite) && pr[0]! < pr[1]!) [par.min, par.max] = pr as [number, number];
      par.value = read.num(p, `p_${n}`, par.value);
    }
    markers = read.bool(p, 'mk', markers);
    grid = read.bool(p, 'gr', grid);
  },

  ui(container, hst) {
    host = hst;
    const list = h('div', { class: 'plot-rows' });
    const paramBox = h('div', { class: 'params' });
    const paramSection = section('Parameter', paramBox);
    const notes: (() => void)[] = [];

    const buildParams = () => {
      onParamTick = null;
      const updaters: (() => void)[] = [];
      const names = paramNames();
      paramSection.hidden = !names.length;
      paramBox.replaceChildren(
        ...names.map((name) => {
          const par = params.get(name)!;
          const format = (v: number) => String(+v.toFixed(3));
          const s = slider(name, { min: par.min, max: par.max, step: (par.max - par.min) / 1000, value: par.value, format }, (v) => {
            par.value = v;
            refreshNotes?.();
            hst.requestRender();
          });
          const input = s.querySelector('input')!;
          const out = s.querySelector('output')!;
          // Bereich einstellen (aufklappbar)
          const num = (value: number, apply: (v: number) => void, label: string) => {
            const el = h('input', { type: 'number', value, step: 'any', 'aria-label': `${name} ${label}`, class: 'num' });
            el.addEventListener('change', () => {
              const v = Number(el.value);
              if (Number.isFinite(v)) apply(v);
            });
            return h('label', { class: 'num-field' }, h('span', {}, label), el);
          };
          const rangeBox = h(
            'div',
            { class: 'param-range' },
            num(par.value, (v) => {
              par.value = v;
              par.min = Math.min(par.min, v);
              par.max = Math.max(par.max, v);
              buildParams();
              refreshNotes?.();
              hst.requestRender();
            }, 'Wert'),
            num(par.min, (v) => {
              if (v < par.max) par.min = v;
              par.value = Math.max(par.value, par.min);
              buildParams();
              hst.requestRender();
            }, 'von'),
            num(par.max, (v) => {
              if (v > par.min) par.max = v;
              par.value = Math.min(par.value, par.max);
              buildParams();
              hst.requestRender();
            }, 'bis'),
          );
          rangeBox.hidden = true;
          const more = h('button', { type: 'button', class: 'icon', title: `Wert und Bereich von ${name} eingeben` }, '⋯');
          more.addEventListener('click', () => (rangeBox.hidden = !rangeBox.hidden));
          const play = h('button', { type: 'button', class: 'icon', title: `${name} animieren` }, par.playing ? '❚❚' : '▶');
          play.addEventListener('click', () => {
            par.playing = !par.playing;
            play.textContent = par.playing ? '❚❚' : '▶';
            startAnimation();
          });
          updaters.push(() => {
            input.value = String(par.value);
            out.textContent = format(par.value);
          });
          return h('div', { class: 'param' }, h('div', { class: 'param-row' }, s, more, play), rangeBox);
        }),
      );
      onParamTick = () => updaters.forEach((u) => u());
    };

    /** Hinweiszeile unter einer Zeile: Fehler, Wert, abgeleitete Formel, Schnellaktionen */
    const noteFor = (row: Row, el: HTMLElement) => () => {
      el.className = 'row-note';
      el.replaceChildren();
      el.hidden = false;
      if (row.error) {
        el.classList.add('error');
        el.textContent = row.error;
        return;
      }
      const it = row.item;
      if (!it) {
        el.hidden = true;
        return;
      }
      const env = paramValues();
      if (it.kind === 'value') {
        el.textContent = `= ${fmt(compileReal(it.v, true)({ ...env }))}`;
      } else if (it.kind === 'point') {
        const p = curveEvaluator(it.x, it.y, env, null)(0);
        el.textContent = `= (${fmt(p[0])}, ${fmt(p[1])})`;
      } else if (it.kind === 'explicit' && row.raw && hasDerivative(row.raw.kind === 'explicit' ? row.raw.f : { type: 'num', value: 0 })) {
        const text = pretty(it.f);
        el.textContent = `= ${text.length > 200 ? text.slice(0, 200) + ' …' : text}`;
      } else if (it.def) {
        const { name } = it.def;
        const add = (label: string, text: string, title: string) => {
          const b = h('button', { type: 'button', class: 'chip', title }, label);
          b.addEventListener('click', () => addRows([text]));
          return b;
        };
        el.append(
          add(`${name}′`, `${name}'(x)`, 'Ableitung als neue Zeile'),
          add(`∫ ${name}`, `int(t = 0, x, ${name}(t))`, 'Stammfunktion (Integral ab 0) als neue Zeile'),
          add('Tangente', `${name}'(a)(x - a) + ${name}(a)`, 'Tangente im Punkt a als neue Zeile'),
        );
      } else {
        el.hidden = true;
      }
    };

    const buildRows = () => {
      notes.length = 0;
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
            ariaLabel: `Zeile ${i + 1}`,
            value: row.text,
            apply(text) {
              const wasCurve = row.item?.kind === 'parametric' || row.item?.kind === 'polar';
              row.text = text;
              reparseAll();
              changed(hst);
              const isCurve = row.item?.kind === 'parametric' || row.item?.kind === 'polar';
              if (wasCurve !== isCurve) buildRows();
              // Parserfehler mit Position im Feld markieren (Hinweiszeile zeigt ihn zusätzlich)
              if (!row.raw && row.text.trim()) parsePlot(text, scanDefinitions(rows.map((r) => r.text)));
            },
          });
          const del = h('button', { type: 'button', class: 'icon', title: 'Zeile entfernen' }, '×');
          del.addEventListener('click', () => {
            rows.splice(i, 1);
            reparseAll();
            buildRows();
            changed(hst);
          });
          const note = h('div', { class: 'row-note' });
          const refresh = noteFor(row, note);
          notes.push(refresh);
          refresh();
          const parts: HTMLElement[] = [h('div', { class: 'plot-row' }, swatch, field.el, del), note];
          if (row.item?.kind === 'parametric' || row.item?.kind === 'polar') {
            const bound = (k: 0 | 1) =>
              formulaField({
                label: k === 0 ? 't von' : 'bis',
                compact: true,
                value: row.tText[k],
                apply(text) {
                  const next: [string, string] = [...row.tText];
                  next[k] = text;
                  if (!setRange(row, next)) throw new ParseError('Kein endlicher Wert', 0, text.length);
                  hst.requestRender();
                },
              }).el;
            parts.push(h('div', { class: 'ranges' }, bound(0), bound(1)));
          }
          return h('div', { class: 'plot-item' }, ...parts);
        }),
      );
    };

    const addRows = (texts: string[], preset?: Preset) => {
      for (const text of texts) {
        if (rows.length >= MAX_ROWS) rows.shift();
        const row = makeRow(text);
        if (preset?.range) setRange(row, preset.range);
        rows.push(row);
      }
      reparseAll();
      syncParams();
      for (const [name, [value, min, max]] of Object.entries(preset?.params ?? {})) {
        const par = params.get(name);
        if (par) Object.assign(par, { value, min, max });
      }
      buildRows();
      buildParams();
      changed(hst);
    };
    const addButton = h('button', { type: 'button', class: 'chip accent', title: 'Leere Zeile anhängen' }, '+ Zeile');
    addButton.addEventListener('click', () => addRows(['']));
    const clearButton = h('button', { type: 'button', class: 'chip', title: 'Alle Zeilen entfernen' }, 'Leeren');
    clearButton.addEventListener('click', () => {
      rows = [makeRow('')];
      reparseAll();
      buildRows();
      changed(hst);
    });
    const examples = menu(
      'Beispiel hinzufügen …',
      PRESETS.map((g) => ({ label: g.label, items: g.items.map((p) => ({ label: p.label, title: p.rows.join('   ') })) })),
      (gi, ii) => {
        const preset = PRESETS[gi]!.items[ii]!;
        addRows(preset.rows, preset);
      },
    );

    rebuildUi = () => buildParams();
    refreshNotes = () => notes.forEach((n) => n());
    buildRows();
    buildParams();

    const code = (s: string) => h('code', {}, s);
    const li = (...c: (string | HTMLElement)[]) => h('li', {}, ...c);
    container.append(
      list,
      h('div', { class: 'toolbar' }, addButton, examples, clearButton),
      paramSection,
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
          'ul',
          {},
          li(code('sin(x)'), ' oder ', code('y = x^2'), ' Funktion; ', code('f(x) = …'), ' definiert f, dann ', code("f'(x)"), ', ', code("f''(x)"), ', ', code('f(x+1)')),
          li(code('x^2 + y^2 = 4'), ' implizit; ', code('y < sin(x)'), ', ', code('0 < y < 1 - x^2'), ' Bereiche'),
          li(code('(cos(3t), sin(2t))'), ' Kurve, ', code('r = 1 + cos(θ)'), ' polar, ', code('(1, 2)'), ' Punkt'),
          li(code('sin(x) {0 < x < pi}'), ' einschränken; ', code('if(x < 0, -x, x^2)'), ' stückweise'),
          li(code('|x|'), ', ', code('x!'), ', ', code('sin x'), ', ', code('sin^2(x)'), ', ', code('min'), ', ', code('max'), ', ', code('mod'), ', ', code('floor'), ', ', code('gamma'), ', ', code('erf'), ', ', code('asin'), ', ', code('root(x, n)'), ', ', code('log(b, x)'), ', ', code('binom')),
          li(code('sum(k = 1, n, 1/k^2)'), ', ', code('prod(…)'), ', ', code('int(t = 0, x, e^(-t^2))'), '; ein Integral ohne x wird als Fläche gezeigt'),
          li('Andere Buchstaben (a, b, k, …) werden Parameter mit Regler; ⋯ stellt Wert und Bereich ein.'),
        ),
      ),
    );
    if ([...params.values()].some((p) => p.playing)) startAnimation();
    return () => {
      cancelAnimationFrame(animFrame);
      onParamTick = null;
      rebuildUi = null;
      refreshNotes = null;
      host = null;
    };
  },
};

/** t-Bereich aus Text (Ausdrücke wie 2pi erlaubt); false bei ungültiger Eingabe */
function setRange(row: Row, text: [string, string]): boolean {
  try {
    const [a, b] = text.map((s) => evaluateReal(parse(s, realOptions([])), {}));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    row.t0 = a!;
    row.t1 = b!;
    row.tText = text;
    return true;
  } catch {
    return false;
  }
}

if (import.meta.hot) {
  import.meta.hot.accept('./plot.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
