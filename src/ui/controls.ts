import type { VizModule } from '../modules/types';
import { h, segmented } from './widgets';

export interface ControlsOptions {
  modules: readonly VizModule[];
  onSelect(module: VizModule): void;
  onResetView(): void;
  /** Aktuellen Link erzeugen (Zustand im Hash) */
  shareLink(): string;
  /** Pixelmaße des Exports für einen Vergrößerungsfaktor */
  exportSize(factor: number): { width: number; height: number };
  exportImage(factor: number, onProgress: (fraction: number) => void): Promise<void>;
}

export interface Controls {
  /** Container für die Controls des aktiven Moduls */
  moduleContainer: HTMLElement;
  setActive(id: string): void;
  setStatus(text: string): void;
}

const EXPORT_FACTORS = [1, 2, 4, 8] as const;
/** Obergrenze für den Export (Speicher des 2D-Canvas, Browsergrenzen ~16k Kantenlänge) */
const MAX_EXPORT_PIXELS = 80e6;
const MAX_EXPORT_EDGE = 16384;

function iconButton(symbol: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'icon', title, 'aria-label': title }, symbol);
  b.addEventListener('click', onClick);
  return b;
}

export function createControls(panel: HTMLElement, opts: ControlsOptions): Controls {
  const tabs = segmented(
    opts.modules.filter((m) => !m.hidden).map((m) => ({ value: m.id, label: m.name })),
    opts.modules[0]?.id ?? '',
    (id) => {
      const m = opts.modules.find((x) => x.id === id);
      if (m) opts.onSelect(m);
    },
    'Modul',
  );

  // Auf schmalen Bildschirmen startet das Panel eingeklappt, damit die Visualisierung dominiert
  if (window.innerWidth < 640) panel.classList.add('collapsed');
  const collapse = iconButton('', 'Panel ein-/ausklappen', () => setCollapsed(!panel.classList.contains('collapsed')));
  const setCollapsed = (c: boolean) => {
    panel.classList.toggle('collapsed', c);
    collapse.textContent = c ? '+' : '–';
    collapse.setAttribute('aria-expanded', String(!c));
  };
  setCollapsed(panel.classList.contains('collapsed'));

  const moduleContainer = h('div', { class: 'module-controls' });
  const status = h('div', { class: 'status' });

  // ---- Link teilen ----
  const share = iconButton('⧉', 'Link mit aktuellem Zustand kopieren', async () => {
    const url = opts.shareLink();
    try {
      await navigator.clipboard.writeText(url);
      flash(share, '✓');
    } catch {
      status.textContent = url; // Fallback ohne Clipboard-Berechtigung: Link zum Markieren anzeigen
    }
  });

  // ---- PNG-Export ----
  const exportBox = h('div', { class: 'export', hidden: true });
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const exportButtons = EXPORT_FACTORS.map((f) => {
    const b = h('button', { type: 'button', class: 'chip' }, `${f}×`);
    b.addEventListener('click', async () => {
      exportButtons.forEach((x) => (x.disabled = true));
      progress.hidden = false;
      progress.value = 0;
      let error: unknown = null;
      try {
        await opts.exportImage(f, (p) => (progress.value = p));
      } catch (e) {
        console.error(e);
        error = e;
      }
      progress.hidden = true;
      refreshExport();
      if (error) sizeInfo.textContent = `Export fehlgeschlagen: ${(error as Error).message}`;
    });
    return b;
  });
  const sizeInfo = h('span', { class: 'hint' });
  const refreshExport = () => {
    exportButtons.forEach((b, i) => {
      const { width, height } = opts.exportSize(EXPORT_FACTORS[i]!);
      const tooBig = width * height > MAX_EXPORT_PIXELS || Math.max(width, height) > MAX_EXPORT_EDGE;
      b.disabled = tooBig;
      b.title = `${width} × ${height} px${tooBig ? ' – zu groß' : ''}`;
    });
    const { width, height } = opts.exportSize(1);
    sizeInfo.textContent = `PNG, 1× = ${width} × ${height} px`;
  };
  exportBox.append(h('div', { class: 'chips' }, ...exportButtons), sizeInfo, progress);
  const exportToggle = iconButton('⤓', 'Bild exportieren (PNG)', () => {
    exportBox.hidden = !exportBox.hidden;
    if (!exportBox.hidden) refreshExport();
  });

  const reset = iconButton('⟲', 'Ansicht zurücksetzen', opts.onResetView);

  panel.replaceChildren(
    h('header', {}, tabs.el, collapse),
    moduleContainer,
    exportBox,
    h('footer', {}, status, share, exportToggle, reset),
  );

  return {
    moduleContainer,
    setActive: (id) => tabs.set(id),
    setStatus(text) {
      status.textContent = text;
    },
  };
}

function flash(b: HTMLElement, text: string): void {
  const old = b.textContent;
  b.textContent = text;
  setTimeout(() => (b.textContent = old), 1200);
}
