import type { ModuleHost, VizModule } from '../types';
import { toggle } from '../../ui/widgets';
import gridSource from './grid.frag?raw';

let source = gridSource;
let injectError = false;
let host: ModuleHost | null = null;

/**
 * Für den Test des Fehler-Overlays: fügt direkt nach `void main() {` eine
 * fehlerhafte Zeile ein und liefert deren (1-basierte) Zeilennummer.
 */
function withInjectedError(src: string): { src: string; line: number } {
  const lines = src.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith('void main()')) + 1;
  lines.splice(at, 0, '  float broken = undefinedSymbol * 2.0;');
  return { src: lines.join('\n'), line: at + 1 };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const gridModule: VizModule = {
  id: 'grid',
  name: 'Gitter',
  hidden: true, // Platzhalter aus M0 zum Testen der Infrastruktur: #m=grid
  initialView: { cx: 0, cy: 0, scale: 0.01 },

  get fragSource() {
    return injectError ? withInjectedError(source).src : source;
  },

  uniforms({ view }) {
    // Hauptgitter: Zehnerpotenz, sodass eine Masche 100–1000 CSS-px breit ist.
    const spacing = 10 ** Math.ceil(Math.log10(view.scale * 100));
    const minorPx = spacing / 10 / view.scale;
    // Phase = c mod spacing (in [0, spacing)), exakt in double gerechnet –
    // der Shader sieht nur kleine, float-taugliche Werte.
    const mod = (a: number) => ((a % spacing) + spacing) % spacing;
    return {
      u_spacing: spacing,
      u_phase: [mod(view.cx), mod(view.cy)],
      u_origin: [-view.cx, -view.cy],
      u_minorAlpha: smoothstep(6, 30, minorPx),
    };
  },

  ui(container, h) {
    host = h;
    const label = () =>
      injectError ? `Shader-Fehler aktiv (Zeile ${withInjectedError(source).line})` : 'Shader-Fehler provozieren';
    const t = toggle(label(), injectError, (v) => {
      injectError = v;
      t.lastElementChild!.textContent = label();
      h.recompile();
    });
    container.append(t);
    return () => {
      host = null;
    };
  },
};

// Shader-Hot-Reload: Änderungen an grid.frag neu kompilieren statt Seite neu laden.
if (import.meta.hot) {
  import.meta.hot.accept('./grid.frag?raw', (mod) => {
    if (!mod) return;
    source = (mod as unknown as { default: string }).default;
    host?.recompile();
  });
}
