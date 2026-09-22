import { ParseError } from '../math/parser';
import { h } from './widgets';

export interface FormulaFieldOptions {
  label: string;
  value: string;
  /** Übernimmt den Text; wirft ParseError bei ungültiger Eingabe. */
  apply(text: string): void;
  ariaLabel?: string;
  /** Kleines Feld (z. B. für Bereichsgrenzen) */
  compact?: boolean;
}

export interface FormulaField {
  el: HTMLElement;
  set(text: string): void;
}

/**
 * Formeleingabe mit verzögerter Übernahme beim Tippen, sofort bei Enter.
 * Fehler werden mit markierter Position angezeigt; bis zur Korrektur bleibt
 * der zuletzt gültige Zustand aktiv.
 */
export function formulaField(opts: FormulaFieldOptions): FormulaField {
  const input = h('input', {
    class: 'formula',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-label': opts.ariaLabel ?? opts.label,
  });
  input.value = opts.value;
  const error = h('div', { class: 'formula-error', 'aria-live': 'polite' });

  const run = () => {
    const text = input.value;
    try {
      opts.apply(text);
      error.replaceChildren();
      input.classList.remove('invalid');
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      input.classList.add('invalid');
      const bad = text.slice(e.pos, Math.max(e.end, e.pos + 1)) || ' ';
      error.replaceChildren(
        h('span', {}, `${e.message} (Pos. ${e.pos + 1})`),
        h('code', {}, text.slice(0, e.pos), h('mark', {}, bad), text.slice(e.pos + bad.length)),
      );
    }
  };

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      run();
    }
  });

  const row = h(
    'div',
    { class: opts.compact ? 'formula-row compact' : 'formula-row' },
    h('span', { class: 'formula-label' }, opts.label),
    input,
  );
  return {
    el: h('div', { class: 'formula-field' }, row, error),
    set(text) {
      clearTimeout(timer);
      input.value = text;
      run();
    },
  };
}
