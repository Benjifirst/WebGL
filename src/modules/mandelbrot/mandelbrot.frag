// Deep-Zoom-Mandelbrot per Störungsrechnung – Algorithmus identisch zu perturb.ts.
//   z_n = Z_n + δ_n,  δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc   (Z_n: Referenzorbit als Textur)
// Tiefe Zooms: δ = w·2^E (Mantisse/Exponent), bis δ im float-Bereich liegt.
// Rebasing (Zhuoran): |z_n| < |δ_n| oder Referenz zu Ende → δ := z_n, n := 0.
// Innen-Erkennung (wie perturb.ts): z an aufeinanderfolgenden Rebasings relativ < 1e-6 gleich und
// der Abstand zweimal hintereinander geometrisch geschrumpft → anziehender Zyklus → innen.

uniform highp sampler2D u_orbit;  // RG32F, Breite ORBIT_W: Z_n bei (n mod W, n div W)
uniform int   u_refLen;           // gültige Einträge Z_0 … Z_{refLen−1}
uniform int   u_maxIter;
uniform float u_scaleM;           // Welt pro Gerätepixel = u_scaleM · 2^u_scaleE
uniform int   u_scaleE;
uniform vec2  u_offM;             // (Bildmitte − Referenz) / 2^u_scaleE
uniform float u_rebase;           // Rebasing an/aus
uniform float u_showGlitch;       // Glitch-Kandidaten (Pauldelbrot) markieren
uniform float u_period;           // Farbperiode in Iterationen
uniform float u_phase;

const int ORBIT_W = 2048;
const int PLAIN_EXP = -100;       // ab 2^−100 unskaliert (float reicht bis ~2^−126)
const float BAILOUT2 = 1e6;       // großer Fluchtradius für glatte Färbung
const float INTERIOR_TOL = 1e-6;
const float INTERIOR_RATE = 0.8;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 orbit(int n) { return texelFetch(u_orbit, ivec2(n % ORBIT_W, n / ORBIT_W), 0).xy; }
// 2^e mit Unterlauf zu 0
float ex2(int e) { return e < -149 ? 0.0 : exp2(float(e)); }

// Zyklische Palette: Nachtblau → Blau → Weiß → Gold → Dunkelrot → …
vec3 palette(float t) {
  t = fract(t) * 5.0;
  vec3 c0 = vec3(0.02, 0.03, 0.10), c1 = vec3(0.10, 0.32, 0.62), c2 = vec3(0.93, 0.94, 0.90);
  vec3 c3 = vec3(0.95, 0.66, 0.16), c4 = vec3(0.36, 0.07, 0.05);
  float f = smoothstep(0.0, 1.0, fract(t));
  if (t < 1.0) return mix(c0, c1, f);
  if (t < 2.0) return mix(c1, c2, f);
  if (t < 3.0) return mix(c2, c3, f);
  if (t < 4.0) return mix(c3, c4, f);
  return mix(c4, c0, f);
}

void main() {
  vec2 pix = fragCoord() - 0.5 * u_resolution;
  vec2 dcm = u_offM + pix * u_scaleM;  // δc = dcm · 2^Edc
  int Edc = u_scaleE;

  bool scaled = Edc <= PLAIN_EXP;
  vec2 w = vec2(0.0);                  // skaliertes δ = w · 2^E
  int E = Edc;
  vec2 d = vec2(0.0);                  // unskaliertes δ
  vec2 dc = scaled ? vec2(0.0) : dcm * ex2(Edc);
  int n = 0;
  bool escaped = false;
  bool interior = false;
  bool glitch = false;
  // Innen-Erkennung: letzter Vergleichswert (plain: z, skaliert: w·2^pE)
  bool hasPrev = false;
  vec2 prevV = vec2(0.0);
  int prevE = 0;
  float prevDelta = 1e30;
  int shrinking = 0;
  float r2 = 0.0;
  int i = 0;

  for (; i < u_maxIter; i++) {
    vec2 Z = orbit(n);

    if (scaled) {
      if (n >= u_refLen - 1) {
        // Referenz zu Ende, δ vernachlässigbar: z ≈ Z_n → unskaliert mit n = 0
        d = Z + w * ex2(E);
        dc = dcm * ex2(Edc);
        scaled = false;
        n = 0;
        Z = vec2(0.0);
      } else {
        if (n > 0 && Z == vec2(0.0)) {
          // Referenz im Nukleus: Zeitpunkt wie ein Rebasing → δ mit dem letzten Wert vergleichen
          if (hasPrev) {
            float delta = length(w - prevV * ex2(prevE - E)) / length(w);
            shrinking = delta < INTERIOR_RATE * prevDelta ? shrinking + 1 : 0;
            if (delta < INTERIOR_TOL && shrinking >= 2) { interior = true; break; }
            prevDelta = delta;
          }
          hasPrev = true;
          prevV = w;
          prevE = E;
        }
        w = 2.0 * cmul(Z, w) + cmul(w, w) * ex2(E) + dcm * ex2(Edc - E);
        n++;
        // Renormierung: |w| ≈ 1 halten, Exponent mitführen
        float m = max(abs(w.x), abs(w.y));
        if (m > 65536.0 || (m > 0.0 && m < 1.0 / 65536.0)) {
          int k = int(floor(log2(m)));
          w *= exp2(float(-k));
          E += k;
        }
        if (E > PLAIN_EXP) {
          d = w * ex2(E);
          dc = dcm * ex2(Edc);
          scaled = false;
          hasPrev = false;
          prevDelta = 1e30;
          shrinking = 0;
        }
        continue;
      }
    }

    vec2 z = Z + d;
    r2 = dot(z, z);
    if (r2 > BAILOUT2) { escaped = true; break; }
    if (u_rebase > 0.5) {
      if (r2 < dot(d, d) && r2 > 0.0) {
        if (hasPrev) {
          float delta = length(z - prevV) / sqrt(r2);
          shrinking = delta < INTERIOR_RATE * prevDelta ? shrinking + 1 : 0;
          if (delta < INTERIOR_TOL && shrinking >= 2) { interior = true; break; }
          prevDelta = delta;
        }
        hasPrev = true;
        prevV = z;
      }
      if (r2 < dot(d, d) || n >= u_refLen - 1) { d = z; n = 0; Z = vec2(0.0); }
    } else {
      if (r2 < 1e-6 * dot(Z, Z)) glitch = true;  // |z| < 10⁻³·|Z|: Präzisionsverlust
      if (n >= u_refLen - 1) { d = z; n = 0; Z = vec2(0.0); }
    }
    d = 2.0 * cmul(Z, d) + cmul(d, d) + dc;
    n++;
  }

  vec3 col;
  if (escaped) {
    // Glatte Iterationszahl ν = n + 1 − log2(log2|z|)
    float nu = float(i) + 1.0 - log2(max(0.5 * log2(r2), 1e-6));
    col = palette(nu / u_period + u_phase);
  } else {
    col = vec3(0.012, 0.014, 0.022);  // Inneres
  }
  if (u_showGlitch > 0.5 && glitch) col = mix(col, vec3(1.0, 0.1, 0.6), 0.8);
  fragColor = vec4(col, 1.0);
}
