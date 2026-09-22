// Domain Coloring: Farbton = arg f(z), Helligkeit = Modulus-Konturen.
// Der Platzhalter in f(z) unten wird zur Laufzeit durch den generierten Ausdruck ersetzt.

uniform float u_contours;    // Stärke der Modulus-Konturen (0 = aus)
uniform float u_phaseLines;  // Anzahl Phasenlinien pro Umlauf (0 = aus)
uniform float u_gridLines;   // Koordinatengitter der z-Ebene (0 = aus)

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

// ---- Komplexe Arithmetik, z = (Re, Im) ----
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }
vec2 cabs(vec2 a) { return vec2(length(a), 0.0); }
vec2 cre(vec2 a) { return vec2(a.x, 0.0); }
vec2 cim(vec2 a) { return vec2(a.y, 0.0); }
// exp(x+iy) = eˣ(cos y + i sin y)
vec2 cexp(vec2 a) { return exp(a.x) * vec2(cos(a.y), sin(a.y)); }
// Hauptzweig: log z = ln|z| + i·arg z
vec2 clog(vec2 a) { return vec2(log(length(a)), atan(a.y, a.x)); }
// a^b = exp(b·log a), mit 0^b = 0
vec2 cpow(vec2 a, vec2 b) { return dot(a, a) == 0.0 ? vec2(0.0) : cexp(cmul(b, clog(a))); }
// Ganzzahlige Potenz durch wiederholtes Quadrieren (keine Verzweigungsschnitte)
vec2 cpowi(vec2 a, int n) {
  vec2 base = n < 0 ? cdiv(vec2(1.0, 0.0), a) : a;
  int m = abs(n);
  vec2 r = vec2(1.0, 0.0);
  while (m > 0) {
    if ((m & 1) == 1) r = cmul(r, base);
    base = cmul(base, base);
    m >>= 1;
  }
  return r;
}
// Hauptzweig: √z = √|z| · e^{i·arg(z)/2}
vec2 csqrt(vec2 a) {
  float t = 0.5 * atan(a.y, a.x);
  return sqrt(length(a)) * vec2(cos(t), sin(t));
}
// sin(x+iy) = sin x cosh y + i cos x sinh y
vec2 csin(vec2 a) { return vec2(sin(a.x) * cosh(a.y), cos(a.x) * sinh(a.y)); }
// cos(x+iy) = cos x cosh y − i sin x sinh y
vec2 ccos(vec2 a) { return vec2(cos(a.x) * cosh(a.y), -sin(a.x) * sinh(a.y)); }
vec2 csinh(vec2 a) { return vec2(sinh(a.x) * cos(a.y), cosh(a.x) * sin(a.y)); }
vec2 ccosh(vec2 a) { return vec2(cosh(a.x) * cos(a.y), sinh(a.x) * sin(a.y)); }
// tan(x+iy) = (sin 2x + i sinh 2y) / (cos 2x + cosh 2y); für |y| ≫ 1 gegen ±i (vermeidet ∞/∞)
vec2 ctan(vec2 a) {
  if (abs(a.y) > 20.0) return vec2(0.0, sign(a.y));
  float d = cos(2.0 * a.x) + cosh(2.0 * a.y);
  return vec2(sin(2.0 * a.x), sinh(2.0 * a.y)) / d;
}
// tanh(x+iy) = (sinh 2x + i sin 2y) / (cosh 2x + cos 2y)
vec2 ctanh(vec2 a) {
  if (abs(a.x) > 20.0) return vec2(sign(a.x), 0.0);
  float d = cosh(2.0 * a.x) + cos(2.0 * a.y);
  return vec2(sinh(2.0 * a.x), sin(2.0 * a.y)) / d;
}

vec2 f(vec2 z) { return /*F*/; }

// Box-gefilterter Sägezahn fract(x) über die Pixelbreite w (analytisches Antialiasing).
// Stammfunktion: F(x) = ⌊x⌋/2 + fract(x)²/2, Mittelwert = (F(x+w/2) − F(x−w/2)) / w.
float filteredFract(float x, float w) {
  w = max(w, 1e-5);
  float a = x - 0.5 * w, b = x + 0.5 * w;
  float fa = fract(a), fb = fract(b);
  return ((floor(b) - floor(a)) * 0.5 + 0.5 * (fb * fb - fa * fa)) / w;
}

// Antialiasierte Linie bei ganzzahligen x; w = Änderung von x pro Pixel.
float lineMask(float x, float w, float widthPx) {
  float d = abs(fract(x + 0.5) - 0.5) / max(w, 1e-6);
  return clamp(0.5 * widthPx - d + 0.5, 0.0, 1.0);
}

vec3 hue(float t) {
  // Glatter Farbkreis: t = 0 (positive reelle Werte) → Rot, dann Gelb, Grün, Cyan, Blau, Magenta.
  vec3 c = 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, -1.0 / 3.0, 1.0 / 3.0)));
  return mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.85);
}

void main() {
  vec2 local = localCoord();
  vec2 z = u_center + local;
  vec2 w = f(z);

  if (any(isnan(w)) || any(isinf(w))) {
    fragColor = vec4(vec3(0.5), 1.0);
    return;
  }

  // Ableitungen von w pro Pixel für Linienbreiten
  vec2 wx = dFdx(w), wy = dFdy(w);
  float r2 = max(dot(w, w), 1e-30);

  // Phase: arg w. Ableitung stetig über den Schnitt bei ±π: d(arg w) = (w × dw) / |w|²
  float phase = atan(w.y, w.x) / TAU;
  float dPhase = (abs(w.x * wx.y - w.y * wx.x) + abs(w.x * wy.y - w.y * wy.x)) / r2 / TAU;

  // Modulus: L = log2|w|, Konturen bei ganzzahligem L (|w| verdoppelt sich)
  float L = 0.5 * log2(r2);
  float dL = fwidth(L);

  vec3 col = hue(fract(phase));

  if (u_contours > 0.0) {
    float s = filteredFract(L, dL);
    // Kontrast ausblenden, wo die Konturen dichter als ~2 px liegen (Nullstellen, Pole)
    float k = u_contours * (1.0 - smoothstep(0.25, 0.6, dL));
    col *= mix(1.0, mix(0.55, 1.0, s), k);
  }

  if (u_phaseLines > 0.0) {
    float n = u_phaseLines;
    float m = lineMask(phase * n, dPhase * n, u_pixelRatio) * (1.0 - smoothstep(0.15, 0.4, dPhase * n));
    col = mix(col, vec3(0.08), 0.55 * m);
  }

  if (u_gridLines > 0.0) {
    // Gitter der z-Ebene mit Weite 1, Achsen hervorgehoben
    vec2 dz = fwidth(z);
    float g = max(lineMask(z.x, dz.x, u_pixelRatio), lineMask(z.y, dz.y, u_pixelRatio));
    g *= 1.0 - smoothstep(0.05, 0.2, max(dz.x, dz.y));  // ausblenden, wenn Maschen < ~5 px
    vec2 axis = clamp(u_pixelRatio - abs(z) / u_scale + 0.5, 0.0, 1.0);
    col = mix(col, vec3(1.0), 0.25 * g);
    col = mix(col, vec3(1.0), 0.6 * max(axis.x, axis.y));
  }

  fragColor = vec4(col, 1.0);
}
