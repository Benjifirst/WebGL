import type { ShaderCompileError } from '../core/gl';

/** Zeigt Shader-Fehler mit Zeilennummer und betroffener Quelltextzeile. */
export class ErrorOverlay {
  constructor(private readonly el: HTMLElement) {}

  show(error: ShaderCompileError, source: string): void {
    const lines = source.split(/\r?\n/);
    const el = this.el;
    el.replaceChildren();

    const title = document.createElement('div');
    title.className = 'error-title';
    title.textContent = `Shader-Fehler (${error.stage}) – letzte gültige Version wird weiter gerendert`;
    el.append(title);

    for (const d of error.diagnostics) {
      const item = document.createElement('div');
      item.className = 'error-item';
      const where = document.createElement('span');
      where.className = 'error-line';
      where.textContent =
        d.line === null ? '' : d.line > 0 ? `Zeile ${d.line}` : `Präambel (${d.line})`;
      const msg = document.createElement('span');
      msg.textContent = d.message;
      item.append(where, msg);
      const code = d.line !== null && d.line > 0 ? lines[d.line - 1] : undefined;
      if (code !== undefined) {
        const pre = document.createElement('code');
        pre.textContent = code.trim();
        item.append(pre);
      }
      el.append(item);
    }
    el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
    this.el.replaceChildren();
  }
}
