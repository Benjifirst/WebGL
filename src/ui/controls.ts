import type { VizModule } from '../modules/types';

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
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'row';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Modul');
  for (const m of opts.modules) select.append(new Option(m.name, m.id));
  select.addEventListener('change', () => {
    const m = opts.modules.find((x) => x.id === select.value);
    if (m) opts.onSelect(m);
  });
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Ansicht zurücksetzen';
  reset.addEventListener('click', opts.onResetView);
  header.append(select, reset);

  const moduleContainer = document.createElement('div');
  moduleContainer.className = 'module-controls';

  const status = document.createElement('div');
  status.className = 'status';

  panel.append(header, moduleContainer, status);

  return {
    moduleContainer,
    setActive(id) {
      select.value = id;
    },
    setStatus(text) {
      status.textContent = text;
    },
  };
}
