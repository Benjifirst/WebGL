#version 300 es
precision highp float;
// Verklebe-Animation: Standardpolygon (u, v) ∈ [0,1]² → Fläche, Parameter u_t ∈ [0,1].
// Die Parametrisierungen respektieren die Identifikationen des jeweiligen Kantenworts, sodass die
// verklebten Kanten bei t = 1 exakt aufeinanderliegen.

layout(location = 0) in vec2 a_uv;

uniform int   u_shape;   // 0 Sphäre, 1 Torus, 2 Klein, 3 ℝP², 4 Möbius, 5 Zylinder, 6 Scheibe
uniform float u_t;
uniform vec3  u_camPos;
uniform vec3  u_camRight;
uniform vec3  u_camUp;
uniform vec3  u_camFwd;
uniform float u_aspect;
uniform vec4  u_tileClip;

out vec3 v_pos;
out vec3 v_normal;
out vec2 v_uv;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float FOCAL = 1.8;
const float NEAR = 0.05;
const float FAR = 200.0;

// sin(x·a)/a und (1 − cos(x·a))/a, stetig für a → 0 (Aufrollen eines flachen Blatts)
float sinc(float x, float a) { return abs(a) < 1e-4 ? x : sin(x * a) / a; }
float cosc(float x, float a) { return abs(a) < 1e-4 ? 0.5 * a * x * x : (1.0 - cos(x * a)) / a; }

// Mathematische Koordinaten (z nach oben) → Grafik (y nach oben)
vec3 gl3(vec3 m) { return vec3(m.x, m.z, -m.y); }

// Torus a b a⁻¹ b⁻¹: erst Blatt zum Zylinder rollen (v), dann Zylinder zum Ring biegen (u)
vec3 torus(vec2 uv, float t) {
  const float R = 1.0, r = 0.42;
  float W = TAU * R, H = TAU * r;
  float sA = clamp(2.0 * t, 0.0, 1.0), sB = clamp(2.0 * t - 1.0, 0.0, 1.0);
  // Stufe A: Querschnitt um die Achse (y = 0, z = ρ), ρ = H / (2π·sA)
  float a = TAU * sA / H;              // Krümmung des Querschnitts
  float yv = sinc(uv.y - 0.5, a * H) * H;
  float zv = cosc(uv.y - 0.5, a * H) * H;
  float x = (uv.x - 0.5) * W;
  float zAxis = sA > 0.0 ? H / (TAU * sA) : 0.0;
  // Versatz vom Querschnittszentrum (bei sA = 0 flach: zAxis = 0, Versatz (yv, 0))
  float offZ = zv - zAxis;
  // Stufe B: Achse (x, 0, zAxis) zum Kreis biegen, Normale dreht mit
  float b = TAU * sB / W;              // Krümmung der Achse
  float th = x * b;
  vec3 C = vec3(sinc(x, b), 0.0, zAxis + cosc(x, b));
  vec3 n = vec3(-sin(th), 0.0, cos(th));
  vec3 p = C + vec3(0.0, yv, 0.0) + offZ * n;
  float Rb = sB > 0.0 ? W / (TAU * sB) : 0.0;
  return p - vec3(0.0, 0.0, zAxis + Rb) * smoothstep(0.0, 1.0, t);
}

vec3 flatSquare(vec2 uv, float w, float h) { return vec3((uv.x - 0.5) * w, (uv.y - 0.5) * h, 0.0); }

// Kleinsche Flasche a b a b⁻¹ (Achter-Immersion): V ↔ u (links/rechts glatt verklebt… über V → −V),
// U ↔ v; K(U + 2π, V) = K(U, −V) entspricht oben/unten mit Spiegelung u ↦ 1 − u
vec3 klein(vec2 uv) {
  float U = TAU * uv.y, V = TAU * (uv.x - 0.5);
  float c = 2.0 + cos(U / 2.0) * sin(V) - sin(U / 2.0) * sin(2.0 * V);
  return 0.42 * gl3(vec3(c * cos(U), c * sin(U), sin(U / 2.0) * sin(V) + cos(U / 2.0) * sin(2.0 * V)));
}

// ℝP² a b a b: Quadrat mit antipodischem Rand = Scheibe mit antipodischem Rand → Halbkugel →
// Kreuzhaube f(x, y, z) = (yz, 2xy, x² − y²) (invariant unter p ↦ −p)
vec3 crosscap(vec2 uv) {
  vec2 q = 2.0 * uv - 1.0;
  float m = max(abs(q.x), abs(q.y));
  vec2 d = m > 0.0 ? q * (m / length(q)) : q;     // Quadrat → Scheibe, verträglich mit q ↦ −q
  vec3 s = vec3(d, sqrt(max(0.0, 1.0 - dot(d, d))));
  return 1.3 * gl3(vec3(s.y * s.z, 2.0 * s.x * s.y, s.x * s.x - s.y * s.y));
}

// Sphäre a a⁻¹ als Zweieck: Ränder v = 0 und v = 1 werden zum Meridian φ = ±π zusammengezogen
vec3 sphereFlat(vec2 uv) {
  float y = 2.0 * uv.x - 1.0;
  return 1.2 * vec3((2.0 * uv.y - 1.0) * sqrt(max(0.0, 1.0 - y * y)), y, 0.0);
}
vec3 sphere(vec2 uv) {
  float th = PI * uv.x, ph = PI * (2.0 * uv.y - 1.0);
  return 1.2 * vec3(sin(th) * sin(ph), -cos(th), sin(th) * cos(ph));
}

// Möbiusband c a d a: links/rechts mit Spiegelung v ↦ 1 − v verklebt
vec3 moebius(vec2 uv) {
  float U = TAU * uv.x, w = (uv.y - 0.5) * 0.9;
  return 1.1 * gl3(vec3((1.0 + w * cos(U / 2.0)) * cos(U), (1.0 + w * cos(U / 2.0)) * sin(U), w * sin(U / 2.0)));
}

vec3 cylinder(vec2 uv) {
  float U = TAU * uv.x;
  return 1.1 * gl3(vec3(cos(U), sin(U), (uv.y - 0.5) * 1.2));
}

vec3 S(vec2 uv) {
  float t = u_t;
  if (u_shape == 1) return 0.62 * torus(uv, t);
  if (u_shape == 0) return mix(sphereFlat(uv), sphere(uv), t);
  if (u_shape == 2) return mix(flatSquare(uv, 3.2, 3.2), klein(uv), t);
  if (u_shape == 3) return mix(flatSquare(uv, 2.6, 2.6), crosscap(uv), t);
  if (u_shape == 4) return mix(flatSquare(uv, TAU * 1.1 * 0.8, 1.0), moebius(uv), t);
  if (u_shape == 5) return mix(flatSquare(uv, TAU * 1.1 * 0.8, 1.32), cylinder(uv), t);
  return vec3((2.0 * uv.x - 1.0) * sqrt(max(0.0, 1.0 - pow(2.0 * uv.y - 1.0, 2.0))), 2.0 * uv.y - 1.0, 0.0) * 1.2;
}

void main() {
  vec3 p = S(a_uv);
  const float h = 1e-3;
  v_normal = cross(S(a_uv + vec2(h, 0.0)) - S(a_uv - vec2(h, 0.0)), S(a_uv + vec2(0.0, h)) - S(a_uv - vec2(0.0, h)));
  v_pos = p;
  v_uv = a_uv;
  vec3 rel = p - u_camPos;
  float zc = dot(rel, u_camFwd);
  vec4 clip = vec4(
    2.0 * FOCAL * dot(rel, u_camRight) / u_aspect,
    2.0 * FOCAL * dot(rel, u_camUp),
    (zc * (FAR + NEAR) - 2.0 * FAR * NEAR) / (FAR - NEAR),
    zc);
  clip.xy = clip.xy * u_tileClip.xy + u_tileClip.zw * clip.w;
  gl_Position = clip;
}
