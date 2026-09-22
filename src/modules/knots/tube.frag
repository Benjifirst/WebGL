// Beleuchtung wie die übrigen 3D-Ansichten (scene.glsl wird vorangestellt), Farbe je Komponente.

in vec3 v_pos;
in vec3 v_normal;
in vec3 v_color;
out vec4 fragColor;

void main() {
  vec3 n = normalize(v_normal);
  vec3 rd = normalize(v_pos - u_camPos);
  if (dot(n, rd) > 0.0) n = -n;
  fragColor = vec4(shade(n, rd, v_color, 1.0, 1.0), 1.0);
}
