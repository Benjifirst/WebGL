// Beleuchtung der parametrischen Fläche (scene.glsl wird vorangestellt).
// Zweiseitig: Rückseiten warm gefärbt – beim Möbiusband wechselt die Farbe
// entlang der Naht, weil es nur eine Seite hat.

uniform float u_gridLines;  // Parameterlinien pro Richtung (0 = aus)

in vec3 v_pos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  // Entartete Normale (z. B. an Polen) → Normale aus Bildschirmableitungen
  vec3 n = dot(v_normal, v_normal) > 1e-20
    ? normalize(v_normal)
    : normalize(cross(dFdx(v_pos), dFdy(v_pos)));
  vec3 rd = normalize(v_pos - u_camPos);
  bool back = dot(n, rd) > 0.0;
  if (back) n = -n;

  vec3 base = albedo(n, back);
  if (u_gridLines > 0.0) {
    // Antialiasierte u- und v-Linien
    vec2 g = v_uv * u_gridLines;
    vec2 d = abs(fract(g + 0.5) - 0.5) / max(fwidth(g), vec2(1e-6));
    float line = 1.0 - clamp(min(d.x, d.y) - 0.5, 0.0, 1.0);
    base *= 1.0 - 0.45 * line;
  }
  fragColor = vec4(shade(n, rd, base, 1.0, 1.0), 1.0);
}
