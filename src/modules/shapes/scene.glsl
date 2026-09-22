// ---- Gemeinsame Szene: Kamera, Hintergrund, Beleuchtung (SDF, implizit, Netz) ----
// Weltkoordinaten der Grafik: y nach oben. Mathematische Formeln verwenden z nach oben;
// Umrechnung (x, y, z)_math = (p.x, −p.z, p.y) bzw. p = (x, z, −y) (rechtshändig).

uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camFwd;
uniform int  u_colorMode;  // 0 = neutral, 1 = Normalen

const float FOCAL = 1.8;   // Brennweite relativ zur Bildhöhe (≈ 31° vertikales Sichtfeld)
const vec3 LIGHT_DIR = vec3(0.5535, 0.7547, 0.3522);  // normalisiert

vec3 background(vec2 uv) {
  return mix(vec3(0.075, 0.08, 0.095), vec3(0.04, 0.043, 0.05), smoothstep(0.0, 1.0, length(uv)));
}

// Grundfarbe; `inner` = Rück- bzw. Innenseite (warm abgesetzt)
vec3 albedo(vec3 n, bool inner) {
  vec3 c = u_colorMode == 1 ? mix(vec3(0.45), 0.5 + 0.5 * n, 0.75) * 0.8 : vec3(0.42, 0.44, 0.48);
  return inner ? c * vec3(1.25, 0.82, 0.62) : c;
}

// Beleuchtungsmodell: Hauptlicht mit Schatten, Himmelslicht mit Umgebungsverdeckung,
// Gegenlicht, Glanzlicht und Fresnel-Rand. Rückgabe gammakorrigiert.
vec3 shade(vec3 n, vec3 rd, vec3 base, float shadow, float ao) {
  float diff = max(dot(n, LIGHT_DIR), 0.0);
  float spec = pow(max(dot(reflect(rd, n), LIGHT_DIR), 0.0), 40.0);
  float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
  vec3 lin = vec3(0.0);
  lin += base * diff * shadow * vec3(1.0, 0.96, 0.9) * 0.9;
  lin += base * (0.5 + 0.5 * n.y) * vec3(0.35, 0.4, 0.5) * 0.6 * ao;
  lin += base * max(dot(n, -LIGHT_DIR), 0.0) * 0.08 * ao;
  lin += spec * shadow * 0.25;
  lin += fres * vec3(0.4, 0.45, 0.55) * 0.25 * ao;
  return pow(lin, vec3(1.0 / 2.2));
}
