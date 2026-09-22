#version 300 es
precision highp float;
// Schlauch um die Knotenkurve: Ecken mit Normale und Farbe, Projektion wie bei den anderen 3D-Ansichten.

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;

uniform vec3  u_camPos;
uniform vec3  u_camRight;
uniform vec3  u_camUp;
uniform vec3  u_camFwd;
uniform float u_aspect;
uniform vec4  u_tileClip;
uniform float u_shift;

out vec3 v_pos;
out vec3 v_normal;
out vec3 v_color;

const float FOCAL = 1.8;
const float NEAR = 0.05;
const float FAR = 200.0;

void main() {
  v_pos = a_pos;
  v_normal = a_normal;
  v_color = a_color;
  vec3 rel = a_pos - u_camPos;
  float zc = dot(rel, u_camFwd);
  vec4 clip = vec4(
    2.0 * FOCAL * dot(rel, u_camRight) / u_aspect,
    2.0 * FOCAL * dot(rel, u_camUp),
    (zc * (FAR + NEAR) - 2.0 * FAR * NEAR) / (FAR - NEAR),
    zc);
  clip.x += u_shift * clip.w;
  clip.xy = clip.xy * u_tileClip.xy + u_tileClip.zw * clip.w;
  gl_Position = clip;
}
