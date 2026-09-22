// Ansichtstransformation und Eingabe (Pan, Zoom um Cursor, Pinch).
//
// Konvention: Bildschirmkoordinaten p in CSS-Pixeln relativ zur linken oberen
// Canvas-Ecke (y nach unten), Weltkoordinaten mit y nach oben.
//   Welt = c + ((p.x − W/2)·s, −(p.y − H/2)·s)
// c = Zentrum (double in JS), s = Welteinheiten pro CSS-Pixel.

export interface ViewState {
  cx: number;
  cy: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 1e-30;
export const MAX_SCALE = 1e30;

export function screenToWorld(v: ViewState, size: Size, px: number, py: number): [number, number] {
  return [v.cx + (px - size.width / 2) * v.scale, v.cy - (py - size.height / 2) * v.scale];
}

export function worldToScreen(v: ViewState, size: Size, x: number, y: number): [number, number] {
  return [(x - v.cx) / v.scale + size.width / 2, size.height / 2 - (y - v.cy) / v.scale];
}

/**
 * Zoom um den Bildschirmpunkt (px, py) mit Faktor k (k > 1 vergrößert).
 * Der Weltpunkt p unter dem Cursor bleibt invariant:
 *   s' = s / k,   c' = p + (c − p)·s'/s
 */
export function zoomAt(v: ViewState, size: Size, px: number, py: number, k: number): ViewState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale / k));
  const ratio = scale / v.scale;
  const [wx, wy] = screenToWorld(v, size, px, py);
  return { cx: wx + (v.cx - wx) * ratio, cy: wy + (v.cy - wy) * ratio, scale };
}

/** Verschiebt die Ansicht so, dass der Inhalt der Mausbewegung (dx, dy in CSS-px) folgt. */
export function panBy(v: ViewState, dx: number, dy: number): ViewState {
  return { cx: v.cx - dx * v.scale, cy: v.cy + dy * v.scale, scale: v.scale };
}

// ---------------------------------------------------------------------------

export interface ViewPointerEvent {
  kind: 'down' | 'move' | 'up';
  /** Weltkoordinaten */
  x: number;
  y: number;
  /** Bildschirmkoordinaten (CSS-px, relativ zum Canvas) */
  px: number;
  py: number;
  event: PointerEvent;
}

export interface ViewControllerOptions {
  onChange(state: ViewState): void;
  /**
   * Wird vor der Standardbehandlung aufgerufen. Gibt der Handler bei 'down'
   * true zurück, gehört dieser Pointer bis 'up' dem Handler (kein Pan).
   */
  onPointer?(e: ViewPointerEvent): boolean;
  onHover?(x: number, y: number): void;
}

interface TrackedPointer {
  x: number;
  y: number;
  owned: boolean;
}

export class ViewController {
  private _state: ViewState = { cx: 0, cy: 0, scale: 0.01 };
  private pointers = new Map<number, TrackedPointer>();

  constructor(private readonly el: HTMLElement, private readonly opts: ViewControllerOptions) {
    el.style.touchAction = 'none';
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('lostpointercapture', this.onUp);
  }

  get state(): ViewState {
    return this._state;
  }

  set state(v: ViewState) {
    this._state = { ...v, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale)) };
    this.opts.onChange(this._state);
  }

  get size(): Size {
    return { width: this.el.clientWidth, height: this.el.clientHeight };
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [px, py] = this.local(e);
    let dy = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= 16;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= this.el.clientHeight;
    // ctrlKey = Trackpad-Pinch (Chrome/Edge/Firefox): kleinere Deltas, höhere Empfindlichkeit.
    const k = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    this.state = zoomAt(this._state, this.size, px, py, k);
  };

  private emit(kind: ViewPointerEvent['kind'], e: PointerEvent): boolean {
    if (!this.opts.onPointer) return false;
    const [px, py] = this.local(e);
    const [x, y] = screenToWorld(this._state, this.size, px, py);
    return this.opts.onPointer({ kind, x, y, px, py, event: e });
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const [px, py] = this.local(e);
    // Das Modul darf nur Einzelpointer übernehmen; ein zweiter Finger ist immer Pinch.
    const owned = this.pointers.size === 0 && this.emit('down', e);
    this.pointers.set(e.pointerId, { x: px, y: py, owned });
    this.el.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    const [px, py] = this.local(e);
    if (this.opts.onHover) {
      const [x, y] = screenToWorld(this._state, this.size, px, py);
      this.opts.onHover(x, y);
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (p.owned) {
      p.x = px;
      p.y = py;
      this.emit('move', e);
      return;
    }

    const free = [...this.pointers.entries()].filter(([, q]) => !q.owned);
    if (free.length >= 2) {
      // Pinch: Mittelpunkt und Abstand der ersten beiden freien Pointer vorher/nachher.
      const [a, b] = free as [[number, TrackedPointer], [number, TrackedPointer]];
      const before = pinchGeometry(a[1], b[1]);
      p.x = px;
      p.y = py;
      const after = pinchGeometry(a[1], b[1]);
      // Erst verschieben (Mittelpunkt folgt den Fingern), dann um den neuen Mittelpunkt zoomen.
      let v = panBy(this._state, after.mx - before.mx, after.my - before.my);
      if (before.d > 0 && after.d > 0) v = zoomAt(v, this.size, after.mx, after.my, after.d / before.d);
      this.state = v;
    } else {
      const dx = px - p.x;
      const dy = py - p.y;
      p.x = px;
      p.y = py;
      if (dx !== 0 || dy !== 0) this.state = panBy(this._state, dx, dy);
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.owned) this.emit('up', e);
  };
}

function pinchGeometry(a: TrackedPointer, b: TrackedPointer) {
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}
