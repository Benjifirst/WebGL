import type { VizModule } from '../modules/types';
import { h, segmented } from './widgets';

export interface ControlsOptions {
  modules: readonly VizModule[];
  onSelect(module: VizModule): void;
  onResetView(): void;
}

export interface Controls {
  /** Container für die Controls des aktiven Moduls */
  moduleContainer: HTMLElement;
  setActive(id: string): void;
  setStatus(text: string): void;
}

export function createControls(panel: HTMLElement, opts: ControlsOptions): Controls {
  const tabs = segmented(
    opts.modules.map((m) => ({ value: m.id, label: m.name })),
    opts.modules[0]?.id ?? '',
    (id) => {
      const m = opts.modules.find((x) => x.id === id);
      if (m) opts.onSelect(m);
    },
    'Modul',
  );

  const collapse = h('button', { type: 'button', class: 'icon', title: 'Panel ein-/ausklappen', 'aria-expanded': 'true' }, '–');
  collapse.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    collapse.textContent = collapsed ? '+' : '–';
    collapse.setAttribute('aria-expanded', String(!collapsed));
  });

  const reset = h('button', { type: 'button', class: 'icon', title: 'Ansicht zurücksetzen' }, '⟲');
  reset.addEventListener('click', opts.onResetView);

  const moduleContainer = h('div', { class: 'module-controls' });
  const status = h('div', { class: 'status' });

  panel.replaceChildren(
    h('header', {}, tabs.el, collapse),
    moduleContainer,
    h('footer', {}, status, reset),
  );

  return {
    moduleContainer,
    setActive: (id) => tabs.set(id),
    setStatus(text) {
      status.textContent = text;
    },
  };
}
