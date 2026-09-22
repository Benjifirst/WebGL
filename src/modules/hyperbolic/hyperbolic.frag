// Hyperbolische Parkettierung {p,q} per Faltung jedes Pixels ins Fundamentaldreieck.
// Geometrie und Bezeichnungen wie geometry.ts (A = 0, B, C; Spiegel m1, m2, m3).

uniform float u_p;
uniform float u_d;          // Mittelpunkt (d, 0) des Spiegelkreises m3
uniform float u_r2;         // Radius² von m3
uniform float u_triSize;    // euklidische Größe des Fundamentaldreiecks (|AC|) für die Randausblendung
uniform vec2  u_a;          // Automorphismus w = e^{iφ} (z − a)/(1 − āz)
uniform vec2  u_rot;        // e^{iφ}
uniform vec4  u_geo[3];     // Wythoff-Lote: Kreis (c, R², 0) oder Gerade (n, 0, 1)
uniform vec3  u_active;     // Lot i vorhanden (1) oder entartet (0)
uniform vec4  u_sides;      // Vorzeichen: A bzgl. g1, g2; B bzgl. g2, g3
uniform int   u_model;      // 0 = Poincaré-Scheibe, 1 = Halbebene, 2 = Klein
uniform float u_mirrors;    // Spiegelachsen einblenden
uniform float u_parity;     // Schachbrett nach Parität

const float PI = 3.141592653589793;
const int MAX_ITER = 96;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }

// Bildschirm (Weltkoordinaten des Modells) → Poincaré-Scheibe.
// factor = |dz/ds| (Streckung für Linienbreiten), edge = Abstand zum Modellrand in Welteinheiten.
vec2 toDisk(vec2 s, out float factor, out float edge) {
  if (u_model == 1) {
    // Halbebene → Scheibe (Cayley): z = (s − i)/(s + i),  |dz/ds| = 2/|s + i|²
    vec2 sp = s + vec2(0.0, 1.0);
    factor = 2.0 / dot(sp, sp);
    edge = s.y;
    return cdiv(s - vec2(0.0, 1.0), sp);
  }
  if (u_model == 2) {
    // Klein → Poincaré: z = k/(1 + √(1 − |k|²)); nicht konform → größere (radiale) Streckung
    float k2 = dot(s, s);
    float q = sqrt(max(1.0 - k2, 1e-12));
    factor = 1.0 / (q * (1.0 + q));
    edge = 1.0 - sqrt(k2);
    return s / (1.0 + q);
  }
  factor = 1.0;
  edge = 1.0 - length(s);
  return s;
}

// Seitenfunktion und euklidischer Abstand zu einer Geodäte (Kreis oder Gerade durch 0)
float side(vec4 g, vec2 w) { return g.w > 0.5 ? dot(w, g.xy) : dot(w - g.xy, w - g.xy) - g.z; }
float geoDist(vec4 g, vec2 w) { return g.w > 0.5 ? abs(dot(w, g.xy)) : abs(length(w - g.xy) - sqrt(g.z)); }

float line(float distPx, float widthPx) { return clamp(0.5 * widthPx - distPx + 0.5, 0.0, 1.0); }

void main() {
  vec2 s = u_center + localCoord();
  float factor, edge;
  vec2 z = toDisk(s, factor, edge);

  vec3 bg = vec3(0.055, 0.059, 0.071);
  float pxWorld = u_scale;  // Welteinheiten pro Gerätepixel
  float inside = clamp(edge / pxWorld + 0.5, 0.0, 1.0);
  if (inside <= 0.0) {
    fragColor = vec4(bg, 1.0);
    return;
  }

  // Automorphismus der Scheibe; |w'(z)| = (1 − |a|²)/|1 − āz|²
  vec2 den = vec2(1.0, 0.0) - cmul(cconj(u_a), z);
  vec2 w = cmul(u_rot, cdiv(z - u_a, den));
  float scale = factor * (1.0 - dot(u_a, u_a)) / dot(den, den);

  // ---- Faltung: Sektor (Drehung + ggf. Spiegelung an m2), dann Inversion an m3 ----
  float sector = PI / u_p;
  float parity = 0.0;
  bool converged = false;
  vec2 c3 = vec2(u_d, 0.0);
  for (int i = 0; i < MAX_ITER; i++) {
    float ang = atan(w.y, w.x);
    ang -= floor(ang / (2.0 * sector)) * 2.0 * sector;  // Drehung: gerade Anzahl Spiegelungen
    if (ang > sector) { ang = 2.0 * sector - ang; parity += 1.0; }
    w = length(w) * vec2(cos(ang), sin(ang));
    vec2 dc = w - c3;
    float l2 = dot(dc, dc);
    if (l2 >= u_r2) { converged = true; break; }
    float f = u_r2 / l2;                                 // Streckfaktor der Inversion
    w = c3 + dc * f;
    scale *= f;
    parity += 1.0;
  }

  // Pixelgröße im gefalteten Dreieck
  float px = max(pxWorld * scale, 1e-12);
  float lw = 1.25 * u_pixelRatio;

  // ---- Wythoff: Flächentyp aus den Seiten der Lote ----
  float s1 = side(u_geo[0], w), s2 = side(u_geo[1], w), s3 = side(u_geo[2], w);
  vec3 dist = vec3(geoDist(u_geo[0], w), geoDist(u_geo[1], w), geoDist(u_geo[2], w)) / px;
  // Entartete Lote sind keine Kanten. (Kein mix(1e9, d, a): x + (y − x)·a verliert d in float.)
  dist = vec3(u_active.x > 0.5 ? dist.x : 1e9, u_active.y > 0.5 ? dist.y : 1e9, u_active.z > 0.5 ? dist.z : 1e9);
  int face;
  float edgeDist;
  if (s1 * u_sides.x > 0.0 && s2 * u_sides.y > 0.0) { face = 0; edgeDist = min(dist.x, dist.y); }
  else if (s2 * u_sides.z > 0.0 && s3 * u_sides.w > 0.0) { face = 1; edgeDist = min(dist.y, dist.z); }
  else { face = 2; edgeDist = min(dist.x, dist.z); }

  vec3 faceCol[3] = vec3[3](vec3(0.30, 0.36, 0.50), vec3(0.62, 0.52, 0.40), vec3(0.28, 0.47, 0.45));
  vec3 col = faceCol[face];
  if (u_parity > 0.0 && mod(parity, 2.0) > 0.5) col *= 0.78;

  // Spiegelachsen (Unterteilung in Dreiecke), dezent
  if (u_mirrors > 0.0) {
    float dm = min(min(abs(w.y), abs(dot(w, vec2(-sin(sector), cos(sector))))), abs(length(w - c3) - sqrt(u_r2))) / px;
    col = mix(col, vec3(0.9), 0.35 * line(dm, 0.8 * u_pixelRatio));
  }
  col = mix(col, vec3(0.06, 0.065, 0.08), line(edgeDist, lw));

  // Zum Rand hin ausblenden: sinkt die Dreiecksgröße unter wenige Pixel, gegen Mittelwert
  vec3 avg = (faceCol[0] + faceCol[1] + faceCol[2]) / 3.0 * (u_parity > 0.0 ? 0.89 : 1.0);
  float sizePx = u_triSize / px;
  float detail = converged ? smoothstep(1.5, 6.0, sizePx) : 0.0;
  col = mix(avg * 0.7, col, detail);

  // Modellrand
  col = mix(bg, col, inside);
  col = mix(col, vec3(0.45, 0.5, 0.6), 0.6 * line(abs(edge) / pxWorld, u_pixelRatio));
  fragColor = vec4(col, 1.0);
}
