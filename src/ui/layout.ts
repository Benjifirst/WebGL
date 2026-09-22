// Gemeinsame Layout-Hilfen für Ansichten neben dem Bedienpanel.

/** Verschiebung der 3D-Bildmitte (NDC-x) in die freie Fläche rechts neben dem Panel */
export function panelShift(cssWidth: number): number {
  return cssWidth > 900 ? 424 / cssWidth : 0;
}
