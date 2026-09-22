import type { Uniforms } from '../core/renderer';
import type { ViewPointerEvent, ViewState } from '../core/view';

/** Informationen zum aktuellen Frame, die Module für ihre Uniforms brauchen. */
export interface FrameInfo {
  view: ViewState;
  /** Zeichenfläche in Gerätepixeln */
  width: number;
  height: number;
  pixelRatio: number;
}

/** Dienste der App für das aktive Modul. */
export interface ModuleHost {
  /** Zustand geändert → neu zeichnen */
  requestRender(): void;
  /** fragSource geändert → neu kompilieren (bei Fehler bleibt das alte Programm aktiv) */
  recompile(): void;
  readonly view: ViewState;
}

export interface VizModule {
  readonly id: string;
  readonly name: string;
  /** Fragment-Shader ohne Präambel (siehe core/prelude.glsl) */
  readonly fragSource: string;
  /** Startansicht beim Aktivieren bzw. Zurücksetzen */
  readonly initialView: ViewState;
  uniforms(frame: FrameInfo): Uniforms;
  /** Baut die Modul-Controls; optionaler Rückgabewert räumt beim Modulwechsel auf. */
  ui(container: HTMLElement, host: ModuleHost): void | (() => void);
  /** true bei 'down' = Pointer übernehmen (kein Pan) */
  onPointer?(e: ViewPointerEvent, host: ModuleHost): boolean;
  /** Statuszeile für die Cursorposition (Weltkoordinaten) */
  status?(x: number, y: number): string;
  /** Erlaubter Bereich für view.scale (Standard: MIN_SCALE…MAX_SCALE) */
  readonly scaleRange?: readonly [number, number];
}
