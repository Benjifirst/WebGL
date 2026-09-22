// Beleuchtung wie mesh.frag (scene.glsl wird vorangestellt); zusätzlich färbt ein Saum die
// Polygonkanten in den Farben des Diagramms – gleichfarbige Säume werden miteinander verklebt.

uniform vec3  u_edgeColor[4];  // unten (v = 0), rechts (u = 1), oben (v = 1), links (u = 0)
uniform vec4  u_edgeOn;        // Kante vorhanden (1) oder nicht (0, z. B. Zweieck ohne Seiten)
uniform float u_gridLines;

in vec3 v_pos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec3 n = dot(v_normal, v_normal) > 1e-20 ? normalize(v_normal) : normalize(cross(dFdx(v_pos), dFdy(v_pos)));
  vec3 rd = normalize(v_pos - u_camPos);
  bool back = dot(n, rd) > 0.0;
  if (back) n = -n;
  vec3 base = albedo(n, back);

  if (u_gridLines > 0.0) {
    vec2 g = v_uv * u_gridLines;
    vec2 d = abs(fract(g + 0.5) - 0.5) / max(fwidth(g), vec2(1e-6));
    base *= 1.0 - 0.35 * (1.0 - clamp(min(d.x, d.y) - 0.5, 0.0, 1.0));
  }

  // Saum an den Polygonkanten, Breite in Bildpixeln (antialiasiert)
  vec2 fw = max(fwidth(v_uv), vec2(1e-6));
  vec4 dist = vec4(v_uv.y / fw.y, (1.0 - v_uv.x) / fw.x, (1.0 - v_uv.y) / fw.y, v_uv.x / fw.x);
  vec4 cover = clamp(5.0 - dist, 0.0, 1.0) * u_edgeOn;
  for (int i = 0; i < 4; i++) base = mix(base, u_edgeColor[i] * 0.85, cover[i]);

  fragColor = vec4(shade(n, rd, base, 1.0, 1.0), 1.0);
}
