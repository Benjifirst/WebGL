// Referenzorbit Z_{n+1} = Z_n² + C in Festkomma (bigint, Wert = v / 2^bits).
// Ergebnis als float-Paare (Z_n reicht in float: |Z| ≤ 2, die Präzision steckt in δ).

export interface OrbitResult<T extends Float32Array | Float64Array = Float32Array> {
  /** Z_0 … Z_{length−1} als (re, im) */
  data: T;
  /** Anzahl Einträge; der letzte ist ggf. der erste mit |Z| > 2 */
  length: number;
  escaped: boolean;
}

export function computeOrbit(
  cx: bigint,
  cy: bigint,
  bits: number,
  maxIter: number,
  onProgress?: (fraction: number) => void,
): OrbitResult {
  return computeOrbitInto(new Float32Array(2 * (maxIter + 1)), cx, cy, bits, maxIter, onProgress);
}

/** Wie computeOrbit, aber in double (für Genauigkeitsvergleiche in Tests) */
export function computeOrbit64(cx: bigint, cy: bigint, bits: number, maxIter: number): OrbitResult<Float64Array> {
  return computeOrbitInto(new Float64Array(2 * (maxIter + 1)), cx, cy, bits, maxIter);
}

function computeOrbitInto<T extends Float32Array | Float64Array>(
  data: T,
  cx: bigint,
  cy: bigint,
  bits: number,
  maxIter: number,
  onProgress?: (fraction: number) => void,
): OrbitResult<T> {
  const B = BigInt(bits);
  const B1 = BigInt(bits - 1);
  const FOUR = 4n << (2n * B); // |Z|² > 4 im Raster 2^(2·bits)
  // Umrechnung in double: obere ~60 Bit behalten (|Z| ≤ 2, kleine Z werden zu 0 – für float irrelevant)
  const drop = BigInt(Math.max(0, bits - 60));
  const unit = 2 ** -Math.min(bits, 60);
  let x = 0n;
  let y = 0n;
  let n = 0;
  for (; n <= maxIter; n++) {
    data[2 * n] = Number(x >> drop) * unit;
    data[2 * n + 1] = Number(y >> drop) * unit;
    const x2 = x * x;
    const y2 = y * y;
    if (x2 + y2 > FOUR) return { data, length: n + 1, escaped: true };
    // Z² + C:  Re = x² − y²,  Im = 2xy  (Multiplikation verdoppelt die Nachkommabits)
    const xy = x * y;
    x = ((x2 - y2) >> B) + cx;
    y = (xy >> B1) + cy;
    if (onProgress && n % 4096 === 4095) onProgress(n / maxIter);
  }
  return { data, length: maxIter + 1, escaped: false };
}
