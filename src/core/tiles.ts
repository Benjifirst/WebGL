// Aufteilung eines großen Bildes in Kacheln (Koordinaten wie gl_FragCoord: Ursprung unten links).

export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function tiles(width: number, height: number, maxTile: number): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < height; y += maxTile) {
    for (let x = 0; x < width; x += maxTile) {
      out.push({ x, y, width: Math.min(maxTile, width - x), height: Math.min(maxTile, height - y) });
    }
  }
  return out;
}

/**
 * Clip-Raum-Transformation für Geometrie in einer Kachel: Punkte im Gesamtbild (NDC x ∈ [−1, 1])
 * werden so verschoben und skaliert, dass die Kachel den Viewport füllt:
 *   x_tile = x · s + t · w   mit  s = W / w_tile,  t = (W − 2·x0 − w_tile) / w_tile
 */
export function tileClipTransform(fullW: number, fullH: number, t: Tile): [number, number, number, number] {
  return [
    fullW / t.width,
    fullH / t.height,
    (fullW - 2 * t.x - t.width) / t.width,
    (fullH - 2 * t.y - t.height) / t.height,
  ];
}

/** Auflösungsfaktor während Interaktion, sodass ein Frame etwa `targetMs` dauert (Kosten ∝ Pixelzahl). */
export function interactiveQuality(lastFullMs: number, targetMs = 14, min = 0.25): number {
  if (!(lastFullMs > targetMs)) return 1;
  return Math.max(min, Math.min(1, Math.sqrt(targetMs / lastFullMs)));
}
