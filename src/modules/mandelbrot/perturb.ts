// Referenzimplementierung der Pixel-Iteration aus mandelbrot.frag (in double), für Tests.
//
// Störungsrechnung: z_n = Z_n + δ_n mit dem Referenzorbit Z_n (Parameter C) und c = C + δc:
//   δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
// Skaliert (tiefer Zoom, δ unterhalb des float-Bereichs): δ = w·2^E, δc = dcm·2^Edc
//   w_{n+1} = 2·Z_n·w + w²·2^E + dcm·2^(Edc−E),  |w| wird regelmäßig auf ~1 renormiert.
// Rebasing (Zhuoran): Ist |z_n| < |δ_n| oder der Referenzorbit zu Ende, setze δ := z_n, n := 0
// (gültig, weil Z_0 = 0). Ohne Rebasing: Glitch-Kriterium (Pauldelbrot) |z_n| < 10⁻³·|Z_n|.
// Innen-Erkennung: Rebasings geschehen je Umlauf eines nahen Zyklus (z kommt nahe 0). Stimmen
// zwei aufeinanderfolgende Rebasing-Werte relativ bis auf INTERIOR_TOL überein UND schrumpft der
// Abstand zweimal nacheinander geometrisch (Faktor < INTERIOR_RATE je Umlauf), ist der Orbit auf einem anziehenden
// Zyklus → innen. Die Rate schließt langsames (parabolisches) Driften nahe der Grenze aus.
// Der relative Vergleich ist skaleninvariant (tiefer Zoom). Im skalierten Modus übernimmt die
// Stelle Z_n = 0 (n > 0, Referenz im Nukleus) die Rolle des Rebasings.

export interface PixelOptions {
  maxIter: number;
  rebase: boolean;
  /** Ab diesem Exponenten wird unskaliert gerechnet (Shader: −100, float-Bereich) */
  plainExponent?: number;
  bailout2?: number;
}

export interface PixelResult {
  iterations: number;
  escaped: boolean;
  /** Innen erkannt: z konvergiert auf einen Zyklus (Vergleich an aufeinanderfolgenden Rebasings) */
  interior: boolean;
  glitch: boolean;
  /** |z|² beim Entkommen (für glatte Färbung) */
  r2: number;
}

const ex2 = (e: number) => 2 ** e;
export const INTERIOR_TOL = 1e-6;
export const INTERIOR_RATE = 0.8;

export function iteratePixel(
  orbit: Float32Array | Float64Array,
  refLen: number,
  dcm: [number, number],
  Edc: number,
  o: PixelOptions,
): PixelResult {
  const plainExp = o.plainExponent ?? -100;
  const bailout2 = o.bailout2 ?? 1e6;
  let n = 0;
  let glitch = false;
  let scaled = Edc <= plainExp;
  let wx = 0, wy = 0, E = Edc;
  let dx = 0, dy = 0;
  let cx = scaled ? 0 : dcm[0] * ex2(Edc);
  let cy = scaled ? 0 : dcm[1] * ex2(Edc);
  // letzter Rebasing-Wert (plain) bzw. letztes δ an Z_n = 0 (skaliert, als w·2^E)
  let hasPrev = false;
  let px = 0, py = 0, pE = 0;
  let prevDelta = Infinity; // relativer Abstand beim vorigen Vergleich
  let shrinking = 0; // wie oft hintereinander geometrisch geschrumpft

  for (let i = 0; i < o.maxIter; i++) {
    let Zx = orbit[2 * n]!;
    let Zy = orbit[2 * n + 1]!;

    if (scaled) {
      if (n >= refLen - 1) {
        // Referenz zu Ende, δ vernachlässigbar: z ≈ Z_n → unskaliert mit n = 0 fortsetzen
        dx = Zx + wx * ex2(E);
        dy = Zy + wy * ex2(E);
        cx = dcm[0] * ex2(Edc);
        cy = dcm[1] * ex2(Edc);
        scaled = false;
        n = 0;
        Zx = 0;
        Zy = 0;
      } else {
        if (n > 0 && Zx === 0 && Zy === 0) {
          // Referenz im Nukleus: wie ein Rebasing-Zeitpunkt; δ gegen den letzten Wert vergleichen
          if (hasPrev) {
            const k = ex2(pE - E);
            const delta = Math.hypot(wx - px * k, wy - py * k) / Math.hypot(wx, wy);
            shrinking = delta < INTERIOR_RATE * prevDelta ? shrinking + 1 : 0;
            if (delta < INTERIOR_TOL && shrinking >= 2) {
              return { iterations: i, escaped: false, interior: true, glitch, r2: 0 };
            }
            prevDelta = delta;
          }
          hasPrev = true;
          px = wx; py = wy; pE = E;
        }
        const s = ex2(E);
        const t = ex2(Edc - E);
        const nx = 2 * (Zx * wx - Zy * wy) + (wx * wx - wy * wy) * s + dcm[0] * t;
        const ny = 2 * (Zx * wy + Zy * wx) + 2 * wx * wy * s + dcm[1] * t;
        wx = nx;
        wy = ny;
        n++;
        const m = Math.max(Math.abs(wx), Math.abs(wy));
        if (m > 65536 || (m > 0 && m < 1 / 65536)) {
          const k = Math.floor(Math.log2(m));
          wx *= ex2(-k);
          wy *= ex2(-k);
          E += k;
        }
        if (E > plainExp) {
          dx = wx * ex2(E);
          dy = wy * ex2(E);
          cx = dcm[0] * ex2(Edc);
          cy = dcm[1] * ex2(Edc);
          scaled = false;
          hasPrev = false; // Vergleichswerte des skalierten Modus nicht übernehmen
          prevDelta = Infinity;
          shrinking = 0;
        }
        continue;
      }
    }

    const zx = Zx + dx;
    const zy = Zy + dy;
    const r2 = zx * zx + zy * zy;
    if (r2 > bailout2) return { iterations: i, escaped: true, interior: false, glitch, r2 };
    if (o.rebase) {
      if (r2 < dx * dx + dy * dy && r2 > 0) {
        if (hasPrev) {
          const delta = Math.hypot(zx - px, zy - py) / Math.sqrt(r2);
          shrinking = delta < INTERIOR_RATE * prevDelta ? shrinking + 1 : 0;
          if (delta < INTERIOR_TOL && shrinking >= 2) {
            return { iterations: i, escaped: false, interior: true, glitch, r2: 0 };
          }
          prevDelta = delta;
        }
        hasPrev = true;
        px = zx; py = zy;
      }
      if (r2 < dx * dx + dy * dy || n >= refLen - 1) {
        dx = zx;
        dy = zy;
        n = 0;
        Zx = 0;
        Zy = 0;
      }
    } else {
      if (r2 < 1e-6 * (Zx * Zx + Zy * Zy)) glitch = true;
      if (n >= refLen - 1) {
        dx = zx;
        dy = zy;
        n = 0;
        Zx = 0;
        Zy = 0;
      }
    }
    const nx = 2 * (Zx * dx - Zy * dy) + dx * dx - dy * dy + cx;
    const ny = 2 * (Zx * dy + Zy * dx) + 2 * dx * dy + cy;
    dx = nx;
    dy = ny;
    n++;
  }
  return { iterations: o.maxIter, escaped: false, interior: false, glitch, r2: 0 };
}

/** Direkte Iteration in double (Vergleichsgröße für Tests) */
export function iterateDirect(cx: number, cy: number, maxIter: number, bailout2 = 1e6): number {
  let x = 0, y = 0;
  for (let i = 0; i < maxIter; i++) {
    if (x * x + y * y > bailout2) return i;
    const nx = x * x - y * y + cx;
    y = 2 * x * y + cy;
    x = nx;
  }
  return maxIter;
}
