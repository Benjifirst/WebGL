#version 300 es
precision highp float;
// Parametrische Fläche S(u, v): Gitter in [0,1]² wird auf den Parameterbereich abgebildet
// und die Formel direkt hier auf der GPU ausgewertet.

layout(location = 0) in vec2 a_uv;

uniform vec4 u_range;    // (u0, u1, v0, v1)
uniform vec4 u_fit;      // Zentrum (math. Koordinaten), Skalierung
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camFwd;
uniform float u_aspect;  // Breite / Höhe des Gesamtbildes
uniform vec4  u_tileClip; // Kachel: x' = x·s + t·w  (s = xy, t = zw; ohne Kachel (1, 1, 0, 0))

out vec3 v_pos;
out vec3 v_normal;
out vec2 v_uv;

const float FOCAL = 1.8;  // wie scene.glsl
const float NEAR = 0.05;
const float FAR = 200.0;

//HELPERS

vec3 S(float u, float v) {
  return vec3(/*X*/, /*Y*/, /*Z*/);
}

// Mathematische Koordinaten (z nach oben) → Grafik (y nach oben), eingepasst
vec3 toWorld(vec3 m) {
  m = (m - u_fit.xyz) * u_fit.w;
  return vec3(m.x, m.z, -m.y);
}

void main() {
  float u = mix(u_range.x, u_range.y, a_uv.x);
  float v = mix(u_range.z, u_range.w, a_uv.y);
  vec3 p = toWorld(S(u, v));

  // Normale n = ∂S/∂u × ∂S/∂v aus zentralen Differenzen
  float hu = 1e-3 * (u_range.y - u_range.x);
  float hv = 1e-3 * (u_range.w - u_range.z);
  vec3 du = toWorld(S(u + hu, v)) - toWorld(S(u - hu, v));
  vec3 dv = toWorld(S(u, v + hv)) - toWorld(S(u, v - hv));
  v_normal = cross(du, dv);
  v_pos = p;
  v_uv = a_uv;

  // Perspektive passend zum Raymarching: Bildkoordinate = FOCAL · (x_c, y_c) / z_c
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
