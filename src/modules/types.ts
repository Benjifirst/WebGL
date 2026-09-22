import type { ProgramInfo } from '../core/gl';
import type { Uniforms } from '../core/renderer';
import type { Tile } from '../core/tiles';
import type { ViewPointerEvent, ViewState } from '../core/view';
import type { StateRecord } from '../ui/urlState';

/** Informationen zum aktuellen Frame, die Module für ihre Uniforms brauchen. */
export interface FrameInfo {
  view: ViewState;
  /** Gesamtbild in Pixeln (beim Export größer als der Canvas) */
  width: number;
  height: number;
  /** Bildpixel pro CSS-Pixel */
  pixelRatio: number;
  /** Gezeichneter Ausschnitt (Kachel) des Gesamtbildes, Ursprung unten links */
  tile: Tile;
}

/** Dienste der App für das aktive Modul. */
export interface ModuleHost {
  /** Zustand geändert → neu zeichnen */
  requestRender(): void;
  /** fragSource geändert → neu kompilieren (bei Fehler bleibt das alte Programm aktiv) */
  recompile(): void;
  readonly view: ViewState;
  /** Ansicht setzen (z. B. beim Wechsel des Modells) */
  setView(v: ViewState): void;
  /** Eigenes Programm kompilieren (Fehler → Overlay), null bei Fehler */
  createProgram(vertexSource: string, fragmentSource: string): ProgramInfo | null;
}

export interface VizModule {
  readonly id: string;
  readonly name: string;
  /** Nicht in der Modulauswahl zeigen (nur per Link erreichbar, z. B. Testmodule) */
  readonly hidden?: boolean;
  /** Fragment-Shader ohne Präambel (siehe core/prelude.glsl) */
  readonly fragSource: string;
  /** Startansicht beim Aktivieren bzw. Zurücksetzen */
  readonly initialView: ViewState;
  uniforms(frame: FrameInfo): Uniforms;
  /** Baut die Modul-Controls; optionaler Rückgabewert räumt beim Modulwechsel auf. */
  ui(container: HTMLElement, host: ModuleHost): void | (() => void);
  /** true bei 'down' = Pointer übernehmen (kein Pan) */
  onPointer?(e: ViewPointerEvent, host: ModuleHost): boolean;
  /** Vor dem Zeichnen: Texturen hochladen/binden */
  prepare?(gl: WebGL2RenderingContext): void;
  /** Zusätzliche Geometrie nach dem Fullscreen-Pass zeichnen (Tiefenpuffer verfügbar) */
  draw?(gl: WebGL2RenderingContext, frame: FrameInfo): void;
  /** Statuszeile für die Cursorposition (Weltkoordinaten) */
  status?(x: number, y: number): string;
  /** Modulzustand für den URL-Hash (Schlüssel x, y, s überschreiben die Ansicht) */
  saveState?(view: ViewState): StateRecord;
  /** Zustand aus dem URL-Hash übernehmen – vor ui(); optional eigene Ansicht zurückgeben */
  loadState?(params: URLSearchParams, view: Partial<ViewState>): ViewState | void;
  /** Erlaubter Bereich für view.scale (Standard: MIN_SCALE…MAX_SCALE) */
  readonly scaleRange?: readonly [number, number];
}
