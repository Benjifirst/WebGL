// Kleine, einheitliche UI-Bausteine (ohne Framework).

type Attrs = Record<string, string | number | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

/** Schalter mit Beschriftung */
export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-track' }), h('span', {}, label));
}

export interface Segmented<T extends string> {
  el: HTMLElement;
  set(value: T): void;
}

/** Segmentierte Auswahl (eine Option aktiv) */
export function segmented<T extends string>(
  options: readonly { value: T; label: string; title?: string }[],
  value: T,
  onChange: (v: T) => void,
  ariaLabel?: string,
): Segmented<T> {
  const el = h('div', { class: 'segmented', role: 'tablist', 'aria-label': ariaLabel });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', role: 'tab', title: o.title }, o.label);
    b.addEventListener('click', () => {
      set(o.value);
      onChange(o.value);
    });
    el.append(b);
    return [o.value, b] as const;
  });
  function set(v: T) {
    for (const [val, b] of buttons) b.setAttribute('aria-selected', String(val === v));
  }
  set(value);
  return { el, set };
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
}

/** Schieberegler mit Beschriftung und Wertanzeige */
export function slider(label: string, opts: SliderOptions, onInput: (v: number) => void): HTMLElement {
  const fmt = opts.format ?? ((v: number) => String(+v.toFixed(3)));
  const input = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step });
  input.value = String(opts.value);
  const out = h('output', {}, fmt(opts.value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return h('label', { class: 'slider' }, h('span', {}, label), input, out);
}

/** Reihe kleiner Schaltflächen (Beispiele, Vorlagen) */
export function chips(items: readonly { label: string; title?: string; onClick: () => void }[]): HTMLElement {
  const el = h('div', { class: 'chips' });
  for (const it of items) {
    const b = h('button', { type: 'button', class: 'chip', title: it.title }, it.label);
    b.addEventListener('click', it.onClick);
    el.append(b);
  }
  return el;
}
