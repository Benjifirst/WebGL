// Hyperbolische Geometrie in der Poincaré-Scheibe (double) – Spiegel des Shaders und Basis der Tests.
//
// Fundamentaldreieck der Parkettierung {p,q}: Ecken A = 0 (Winkel π/p), B (Winkel π/q), C (Winkel π/2).
// Spiegel:  m1 = reelle Achse (Kante AC)
//           m2 = Gerade durch 0 unter Winkel π/p (Kante AB)
//           m3 = Kreis um (d, 0) mit Radius r, orthogonal zum Einheitskreis (Kante BC)
//   d = cos(π/q) / √(cos²(π/q) − sin²(π/p)),   r = sin(π/p) / √(cos²(π/q) − sin²(π/p))
import { div, mul } from '../../math/complex';
import type { C } from '../../math/complex';

/** Hyperbolisch genau dann, wenn die Winkelsumme π/p + π/q + π/2 < π, d. h. (p−2)(q−2) > 4. */
export function isHyperbolic(p: number, q: number): boolean {
  return (p - 2) * (q - 2) > 4;
}

/**
 * Geodäte der Scheibe: Gerade durch 0 (Einheitsnormale n) oder Kreis (Mittelpunkt c, Radius² r2),
 * der den Einheitskreis orthogonal schneidet (|c|² = r2 + 1).
 */
export type Geodesic = { kind: 'line'; n: C } | { kind: 'circle'; c: C; r2: number };

export interface Triangle {
  p: number;
  q: number;
  d: number;
  r: number;
  A: C;
  B: C;
  C: C;
  mirrors: [Geodesic, Geodesic, Geodesic];
}

export function triangle(p: number, q: number): Triangle {
  if (!isHyperbolic(p, q)) throw new Error(`{${p},${q}} ist nicht hyperbolisch`);
  const a = Math.PI / p;
  const cq = Math.cos(Math.PI / q);
  const sp = Math.sin(a);
  const den = Math.sqrt(cq * cq - sp * sp);
  const d = cq / den;
  const r = sp / den;
  // B = m2 ∩ m3: Punkte t·(cos a, sin a) mit |t·u − (d,0)|² = r²  ⇒  t² − 2td·cos a + (d² − r²) = 0,
  // wegen d² − r² = 1 die kleinere Wurzel t = d·cos a − √(d²cos²a − 1).
  const t = d * Math.cos(a) - Math.sqrt(d * d * Math.cos(a) ** 2 - 1);
  return {
    p,
    q,
    d,
    r,
    A: [0, 0],
    B: [t * Math.cos(a), t * Math.sin(a)],
    C: [d - r, 0],
    mirrors: [
      { kind: 'line', n: [0, 1] },
      { kind: 'line', n: [-Math.sin(a), Math.cos(a)] },
      { kind: 'circle', c: [d, 0], r2: r * r },
    ],
  };
}

/** Vorzeichenbehaftete Seitenfunktion (Seiten der Geodäte haben verschiedene Vorzeichen). */
export function side(g: Geodesic, w: C): number {
  if (g.kind === 'line') return g.n[0] * w[0] + g.n[1] * w[1];
  const dx = w[0] - g.c[0];
  const dy = w[1] - g.c[1];
  return dx * dx + dy * dy - g.r2;
}

/**
 * sinh des hyperbolischen Abstands von w zur Geodäte g:
 *   Gerade:  2|n·w| / (1 − |w|²)
 *   Kreis:   ||w − c|² − R²| / (R (1 − |w|²))
 */
export function sinhDistance(g: Geodesic, w: C): number {
  const k = 1 - (w[0] * w[0] + w[1] * w[1]);
  if (g.kind === 'line') return (2 * Math.abs(side(g, w))) / k;
  return Math.abs(side(g, w)) / (Math.sqrt(g.r2) * k);
}

/** Spiegelung an einer Geodäte (Gerade: Spiegelung, Kreis: Inversion). */
export function reflect(g: Geodesic, w: C): C {
  if (g.kind === 'line') {
    const s = 2 * side(g, w);
    return [w[0] - s * g.n[0], w[1] - s * g.n[1]];
  }
  const dx = w[0] - g.c[0];
  const dy = w[1] - g.c[1];
  const f = g.r2 / (dx * dx + dy * dy);
  return [g.c[0] + dx * f, g.c[1] + dy * f];
}

/**
 * Die Geodäte durch v, die den Spiegel m senkrecht schneidet.
 * Ein Kreis (c, R) ist orthogonal zum Einheitskreis ⇔ |c|² = R² + 1, orthogonal zu m (Kreis c_m, R_m)
 * ⇔ |c − c_m|² = R² + R_m², geht durch v ⇔ |c − v|² = R². Differenzen ergeben das lineare System
 *   c·v = (1 + |v|²)/2,   c·c_m = 1      (für eine Gerade m mit Normale n:  c·n = 0).
 * Ist es singulär (v ∥ c_m bzw. v ∥ n, oder v = 0), ist die Geodäte eine Gerade durch 0.
 */
export function perpendicular(v: C, m: Geodesic): Geodesic {
  const N: C = m.kind === 'line' ? m.n : m.c;
  const k2 = m.kind === 'line' ? 0 : 1;
  const k1 = (1 + v[0] * v[0] + v[1] * v[1]) / 2;
  const det = v[0] * N[1] - v[1] * N[0];
  const scale = Math.hypot(...v) * Math.hypot(...N);
  if (Math.abs(det) <= 1e-12 * Math.max(scale, 1e-300) || scale === 0) {
    // Gerade durch 0 in Richtung N; ihre Normale steht senkrecht auf N
    const l = Math.hypot(...N);
    return { kind: 'line', n: [-N[1] / l, N[0] / l] };
  }
  const c: C = [(k1 * N[1] - k2 * v[1]) / det, (v[0] * k2 - N[0] * k1) / det];
  return { kind: 'circle', c, r2: c[0] * c[0] + c[1] * c[1] - 1 };
}

// ---------------------------------------------------------------------------
// Wythoff-Konstruktion

export type WythoffKind =
  | 'regular' // {p,q}         v = B
  | 'dual' // {q,p}            v = A
  | 'rectified' // r{p,q}      v = C
  | 'truncated' // t{p,q}      v auf m3, gleich weit von m1 und m2
  | 'truncatedDual' // t{q,p}  v auf m1, gleich weit von m2 und m3
  | 'cantellated' // rr{p,q}   v auf m2, gleich weit von m1 und m3
  | 'omnitruncated'; // tr{p,q} v im Inneren, gleich weit von allen drei Spiegeln

/** Nullstelle von f auf [lo, hi] per Bisektion (f(lo), f(hi) mit verschiedenem Vorzeichen). */
function bisect(f: (t: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fm < 0 === flo < 0) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Erzeugender Punkt v der uniformen Parkettierung im Fundamentaldreieck. */
export function wythoffPoint(t: Triangle, kind: WythoffKind): C {
  const [m1, m2, m3] = t.mirrors;
  const eps = 1e-9;
  const onRay = (angle: number, s: number): C => [s * Math.cos(angle), s * Math.sin(angle)];
  const half = Math.PI / (2 * t.p); // Winkelhalbierende bei A: gleich weit von m1 und m2
  const onBisectorToM3 = () => {
    // Schnitt der Winkelhalbierenden mit m3 (gleiche Rechnung wie für B)
    const s = t.d * Math.cos(half) - Math.sqrt(t.d * t.d * Math.cos(half) ** 2 - 1);
    return s;
  };
  switch (kind) {
    case 'regular':
      return t.B;
    case 'dual':
      return t.A;
    case 'rectified':
      return t.C;
    case 'truncated':
      return onRay(half, onBisectorToM3());
    case 'truncatedDual': {
      const x = bisect((s) => sinhDistance(m2, [s, 0]) - sinhDistance(m3, [s, 0]), eps, t.C[0] - eps);
      return [x, 0];
    }
    case 'cantellated': {
      const a = Math.PI / t.p;
      const tb = Math.hypot(...t.B);
      const s = bisect((s) => sinhDistance(m1, onRay(a, s)) - sinhDistance(m3, onRay(a, s)), eps, tb - eps);
      return onRay(a, s);
    }
    case 'omnitruncated': {
      const s = bisect(
        (s) => sinhDistance(m1, onRay(half, s)) - sinhDistance(m3, onRay(half, s)),
        eps,
        onBisectorToM3() - eps,
      );
      return onRay(half, s);
    }
  }
}

export interface WythoffSetup {
  v: C;
  /** Senkrechte Geodäten von v auf m1, m2, m3 */
  geodesics: [Geodesic, Geodesic, Geodesic];
  /** Liegt v nicht auf m_i, ist die Kante v→m_i vorhanden */
  active: [boolean, boolean, boolean];
  /** Vorzeichen der Seite von A bzgl. g1, g2 und von B bzgl. g2, g3 */
  sides: [number, number, number, number];
}

/**
 * Die Kanten der uniformen Parkettierung im Fundamentaldreieck sind die Lote von v auf die
 * Spiegel. Sie zerlegen das Dreieck in die Anteile der Flächen um A, B und C:
 *   Fläche A: A-Seite von g1 und g2,  Fläche B: B-Seite von g2 und g3,  sonst Fläche C.
 */
export function wythoff(t: Triangle, kind: WythoffKind): WythoffSetup {
  const v = wythoffPoint(t, kind);
  const geodesics = t.mirrors.map((m) => perpendicular(v, m)) as [Geodesic, Geodesic, Geodesic];
  const active = t.mirrors.map((m) => sinhDistance(m, v) > 1e-7) as [boolean, boolean, boolean];
  // Referenzseite: Eckpunkt, ersatzweise der gegenüberliegende Eckpunkt mit umgekehrtem Vorzeichen
  const ref = (g: Geodesic, own: C, other: C) => {
    const s = side(g, own);
    return Math.abs(s) > 1e-9 ? Math.sign(s) : -Math.sign(side(g, other)) || 1;
  };
  const [g1, g2, g3] = geodesics;
  return {
    v,
    geodesics,
    active,
    sides: [ref(g1, t.A, t.C), ref(g2, t.A, t.B), ref(g2, t.B, t.A), ref(g3, t.B, t.C)],
  };
}

// ---------------------------------------------------------------------------
// Faltung ins Fundamentaldreieck (Referenz für den Shader)

export interface FoldResult {
  w: C;
  parity: number;
  /** |Ableitung| der Gesamtabbildung (für Linienbreiten) */
  scale: number;
  converged: boolean;
}

export function fold(t: Triangle, z: C, maxIter = 200): FoldResult {
  const sector = Math.PI / t.p;
  let w: C = z;
  let parity = 0;
  let scale = 1;
  for (let i = 0; i < maxIter; i++) {
    // Drehung um ein Vielfaches von 2π/p (gerade Anzahl Spiegelungen an m1/m2) …
    let ang = Math.atan2(w[1], w[0]);
    ang -= Math.floor(ang / (2 * sector)) * 2 * sector;
    // … dann ggf. Spiegelung an m2
    if (ang > sector) {
      ang = 2 * sector - ang;
      parity++;
    }
    const len = Math.hypot(...w);
    w = [len * Math.cos(ang), len * Math.sin(ang)];
    // Inversion an m3, falls w im Kreis liegt; Streckfaktor der Inversion r²/|w − c|²
    const dx = w[0] - t.d;
    const dy = w[1];
    const l2 = dx * dx + dy * dy;
    if (l2 >= t.r * t.r) return { w, parity, scale, converged: true };
    const f = (t.r * t.r) / l2;
    w = [t.d + dx * f, dy * f];
    scale *= f;
    parity++;
  }
  return { w, parity, scale, converged: false };
}

// ---------------------------------------------------------------------------
// Scheibenautomorphismen als Matrizen [[α, β], [β̄, ᾱ]] mit |α|² − |β|² = 1 (SU(1,1)):
//   M(z) = (αz + β) / (β̄z + ᾱ) = e^{iφ} (z − a) / (1 − āz)   mit  a = −β/α,  e^{iφ} = α/ᾱ

export interface Mobius {
  alpha: C;
  beta: C;
}

const conj = (a: C): C => [a[0], -a[1]];

export const IDENTITY: Mobius = { alpha: [1, 0], beta: [0, 0] };

/** Hyperbolische Translation T_b⁻¹: 0 ↦ b, z ↦ (z + b)/(1 + b̄z). */
export function translationFromOrigin(b: C): Mobius {
  const k = 1 / Math.sqrt(1 - (b[0] * b[0] + b[1] * b[1]));
  return { alpha: [k, 0], beta: [b[0] * k, b[1] * k] };
}

/** T_b: b ↦ 0, z ↦ (z − b)/(1 − b̄z). */
export function translationToOrigin(b: C): Mobius {
  return translationFromOrigin([-b[0], -b[1]]);
}

/** Verkettung (M ∘ N)(z) = M(N(z)), anschließend auf |α|² − |β|² = 1 normiert. */
export function compose(M: Mobius, N: Mobius): Mobius {
  // [[α, β], [β̄, ᾱ]] · [[γ, δ], [δ̄, γ̄]] = [[αγ + βδ̄, αδ + βγ̄], …]
  const alpha = add(mul(M.alpha, N.alpha), mul(M.beta, conj(N.beta)));
  const beta = add(mul(M.alpha, N.beta), mul(M.beta, conj(N.alpha)));
  const det = alpha[0] ** 2 + alpha[1] ** 2 - beta[0] ** 2 - beta[1] ** 2;
  const k = 1 / Math.sqrt(det);
  return { alpha: [alpha[0] * k, alpha[1] * k], beta: [beta[0] * k, beta[1] * k] };
}

const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];

export function apply(M: Mobius, z: C): C {
  return div(add(mul(M.alpha, z), M.beta), add(mul(conj(M.beta), z), conj(M.alpha)));
}

/** Parameter für den Shader: a und e^{iφ}. */
export function params(M: Mobius): { a: C; rot: C } {
  const a = div(M.beta, M.alpha);
  const rot = div(M.alpha, conj(M.alpha));
  return { a: [-a[0], -a[1]], rot };
}

/**
 * Ziehen von z0 nach z1 (Scheibenkoordinaten): Die neue Abbildung M' soll M'(z1) = M(z0) erfüllen,
 * also M' = M ∘ T mit T = T_{z0}⁻¹ ∘ T_{z1} (z1 ↦ 0 ↦ z0).
 */
export function drag(M: Mobius, z0: C, z1: C): Mobius {
  return compose(M, compose(translationFromOrigin(z0), translationToOrigin(z1)));
}

// ---------------------------------------------------------------------------
// Rückführung in den Fundamentalbereich (numerische Stabilität)
//
// Isometrie als f(z) = m · (anti ? z̄ : z), m eine komplexe 2×2-Matrix mit Möbius-Wirkung.
// Verkettung: f∘g hat Matrix m_f · (anti_f ? m̄_g : m_g) und anti = anti_f ⊕ anti_g.

type Mat = [C, C, C, C]; // (a, b, c, d) ↦ (az + b)/(cz + d)

interface Isometry {
  m: Mat;
  anti: boolean;
}

const matMul = (x: Mat, y: Mat): Mat => [
  add(mul(x[0], y[0]), mul(x[1], y[2])),
  add(mul(x[0], y[1]), mul(x[1], y[3])),
  add(mul(x[2], y[0]), mul(x[3], y[2])),
  add(mul(x[2], y[1]), mul(x[3], y[3])),
];
const matConj = (x: Mat): Mat => [conj(x[0]), conj(x[1]), conj(x[2]), conj(x[3])];

function composeIso(f: Isometry, g: Isometry): Isometry {
  const m = matMul(f.m, f.anti ? matConj(g.m) : g.m);
  // Skalierung ändert die Möbius-Wirkung nicht; hält die Einträge in der Größenordnung 1
  const k = 1 / Math.max(...m.map((x) => Math.hypot(...x)));
  const sc = (x: C): C => [x[0] * k, x[1] * k];
  return { m: [sc(m[0]), sc(m[1]), sc(m[2]), sc(m[3])], anti: f.anti !== g.anti };
}

const expI = (t: number): C => [Math.cos(t), Math.sin(t)];

/** Spiegelungen an m1 (z ↦ z̄), m2 (z ↦ e^{2iπ/p} z̄) und m3 (z ↦ (c·z̄ − 1)/(z̄ − c̄), da |c|² − r² = 1). */
function mirrorIsometries(t: Triangle): [Isometry, Isometry, Isometry] {
  const c: C = [t.d, 0];
  return [
    { m: [[1, 0], [0, 0], [0, 0], [1, 0]], anti: true },
    { m: [expI((2 * Math.PI) / t.p), [0, 0], [0, 0], [1, 0]], anti: true },
    { m: [c, [-1, 0], [1, 0], [-c[0], c[1]]], anti: true },
  ];
}

/**
 * Symmetrie g der Parkettierung (gerade Anzahl Spiegelungen, erhält also Färbung und Flächentypen),
 * die w in die Nähe des Fundamentaldreiecks bringt – dieselben Schritte wie fold().
 */
export function foldIsometry(t: Triangle, w: C, maxIter = 400): Isometry {
  const [s1, s2, s3] = mirrorIsometries(t);
  const sector = Math.PI / t.p;
  let g: Isometry = { m: [[1, 0], [0, 0], [0, 0], [1, 0]], anti: false };
  let z = w;
  const step = (s: Isometry) => {
    g = composeIso(s, g);
    z = applyIso(s, z);
  };
  for (let i = 0; i < maxIter; i++) {
    const ang = Math.atan2(z[1], z[0]);
    const k = Math.floor(ang / (2 * sector));
    if (k !== 0) step({ m: [expI(-k * 2 * sector), [0, 0], [0, 0], [1, 0]], anti: false });
    if (ang - k * 2 * sector > sector) step(s2);
    const dx = z[0] - t.d;
    if (dx * dx + z[1] * z[1] >= t.r * t.r) break;
    step(s3);
  }
  // Ungerade Anzahl → zusätzlich an m1 spiegeln (bleibt am Fundamentaldreieck)
  return g.anti ? composeIso(s1, g) : g;
}

function applyIso(f: Isometry, z: C): C {
  const w = f.anti ? conj(z) : z;
  return div(add(mul(f.m[0], w), f.m[1]), add(mul(f.m[2], w), f.m[3]));
}

/** Komplexe Quadratwurzel (Hauptzweig) */
function csqrt(a: C): C {
  const r = Math.sqrt(Math.hypot(...a));
  const t = Math.atan2(a[1], a[0]) / 2;
  return [r * Math.cos(t), r * Math.sin(t)];
}

/**
 * Ersetzt M durch g∘M mit einer Symmetrie g, sodass M(0) im Fundamentaldreieck liegt.
 * Das Bild ist unverändert (Tiling(g(w)) = Tiling(w)), aber |a| bleibt klein –
 * sonst wächst |α| mit dem zurückgelegten Weg exponentiell und float/double laufen über.
 */
export function recenter(t: Triangle, M: Mobius): Mobius {
  const g = foldIsometry(t, apply(M, [0, 0]));
  const m = matMul(g.m, [M.alpha, M.beta, conj(M.beta), conj(M.alpha)]);
  // m = λ·[[α, β], [β̄, ᾱ]] mit λ² = det m
  const det = add(mul(m[0], m[3]), mul([-m[1][0], -m[1][1]], m[2]));
  const lambda = csqrt(det);
  const alpha = div(m[0], lambda);
  const beta = div(m[1], lambda);
  return compose({ alpha, beta }, IDENTITY);
}

/** Hyperbolische Translation entlang der reellen Achse um die Strecke s (0 ↦ tanh(s/2)). */
export function translationAlongReal(s: number): Mobius {
  return translationFromOrigin([Math.tanh(s / 2), 0]);
}

/** Hyperbolischer Abstand vom Ursprung: 2·artanh|z|. */
export function distanceFromOrigin(z: C): number {
  return 2 * Math.atanh(Math.min(Math.hypot(...z), 1 - 1e-16));
}
