import type { ModuleHost, VizModule } from '../types';
import { chips, h, toggle } from '../../ui/widgets';
import { codegen } from './codegen';
import { evaluate } from './complex';
import type { C } from './complex';
import { parse, ParseError } from './parser';
import type { Node } from './parser';
import template from './domain.frag?raw';

const EXAMPLES: readonly { label: string; expr: string }[] = [
  { label: 'z', expr: 'z' },
  { label: 'z³ − 1', expr: 'z^3 - 1' },
  { label: 'Möbius', expr: '(z - 1)/(z + 1)' },
  { label: 'rational', expr: '(z^2 - 1)(z - 2 - i)^2 / (z^2 + 2 + 2i)' },
  { label: 'sin', expr: 'sin(z)' },
  { label: 'exp(1/z)', expr: 'exp(1/z)' },
  { label: 'log', expr: 'log(z)' },
  { label: '√', expr: 'sqrt(z^2 - 1)' },
  { label: 'z^z', expr: 'z^z' },
  { label: 'tan', expr: 'tan(z^2)' },
];

let source = template;
let expr = '(z^2 - 1)(z - 2 - i)^2 / (z^2 + 2 + 2i)';
let ast: Node = parse(expr);
let glsl = codegen(ast);
let contours = true;
let phaseLines = false;
let gridLines = false;
let host: ModuleHost | null = null;

function fmtC([re, im]: C): string {
  if (!Number.isFinite(re) || !Number.isFinite(im)) return Number.isNaN(re + im) ? 'undefiniert' : '∞';
  const f = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(3));
  return `${f(re)} ${im < 0 ? '−' : '+'} ${f(Math.abs(im))}i`;
}

export const domainModule: VizModule = {
  id: 'domain',
  name: 'Funktionen',
  initialView: { cx: 0, cy: 0, scale: 0.008 },

  get fragSource() {
    return source.replace('return /*F*/;', `return ${glsl};`);
  },

  uniforms() {
    return {
      u_contours: contours ? 1 : 0,
      u_phaseLines: phaseLines ? 12 : 0,
      u_gridLines: gridLines ? 1 : 0,
    };
  },

  status(x, y) {
    return `z ${fmtC([x, y])}   f(z) ${fmtC(evaluate(ast, [x, y]))}`;
  },

  ui(container, hst) {
    host = hst;
    const input = h('input', {
      class: 'formula',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      'aria-label': 'Funktion f(z)',
    });
    input.value = expr;
    const error = h('div', { class: 'formula-error', 'aria-live': 'polite' });

    let timer = 0;
    const apply = () => {
      const text = input.value;
      try {
        const next = parse(text);
        const code = codegen(next);
        expr = text;
        ast = next;
        glsl = code;
        error.textContent = '';
        input.classList.remove('invalid');
        hst.recompile();
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        // Fehler mit Markierung der Position; letzte gültige Funktion rendert weiter.
        input.classList.add('invalid');
        const pre = text.slice(0, e.pos);
        const bad = text.slice(e.pos, Math.max(e.end, e.pos + 1)) || ' ';
        error.replaceChildren(
          h('span', {}, `${e.message} (Pos. ${e.pos + 1})`),
          h('code', {}, pre, h('mark', {}, bad), text.slice(e.pos + bad.length)),
        );
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(apply, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        apply();
      }
    });

    const setExpr = (s: string) => {
      input.value = s;
      apply();
    };

    container.append(
      h('div', { class: 'formula-row' }, h('span', { class: 'formula-label' }, 'f(z) ='), input),
      error,
      chips(EXAMPLES.map((ex) => ({ label: ex.label, title: ex.expr, onClick: () => setExpr(ex.expr) }))),
      h(
        'div',
        { class: 'toggles' },
        toggle('Konturen', contours, (v) => ((contours = v), hst.requestRender())),
        toggle('Phasenlinien', phaseLines, (v) => ((phaseLines = v), hst.requestRender())),
        toggle('Gitter', gridLines, (v) => ((gridLines = v), hst.requestRender())),
      ),
      h(
        'details',
        { class: 'help' },
        h('summary', {}, 'Syntax'),
        h(
          'p',
          {},
          'Operatoren + − * / ^ (auch implizit: 2z, 3(z+1), iz). Konstanten i, pi, e. ',
          'Funktionen exp, log, sqrt, sin, cos, tan, sinh, cosh, tanh, conj, abs, re, im. ',
          'Farbton = arg f(z) (Rot = positiv reell), Helligkeitsstufen = |f(z)| verdoppelt sich.',
        ),
      ),
    );
    return () => {
      clearTimeout(timer);
      host = null;
    };
  },
};

// Shader-Hot-Reload der Vorlage
if (import.meta.hot) {
  import.meta.hot.accept('./domain.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
