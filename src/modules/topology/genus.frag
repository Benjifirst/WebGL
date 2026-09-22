// Orientierbare Fläche vom Geschlecht g als Kette von g Tori, per Smooth-Minimum verschmolzen.
// Die Ringe liegen mit kleinem Abstand nebeneinander (Mittelkreise schneiden sich nicht), sodass
// das Smooth-Minimum genau eine Brücke je Nachbarpaar bildet – überlappende Ringe erzeugten
// zusätzliche Löcher. scene.glsl wird vorangestellt.

uniform int u_genus;

const float R = 0.75;
const float r = 0.25;
const float SPACING = 1.6;   // > 2R: Ringe berühren sich nicht
const float BLEND = 0.35;

float sdTorus(vec3 p) { return length(vec2(length(p.xz) - R, p.y)) - r; }

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Skalierung, damit auch lange Ketten ins Bild passen
float fitScale() { return max(1.0, float(u_genus) * SPACING / 3.6); }

float map(vec3 p) {
  float s = fitScale();
  p *= s;
  float n = float(u_genus);
  float d = 1e9;
  for (int i = 0; i < 8; i++) {
    if (i >= u_genus) break;
    float x = (float(i) - 0.5 * (n - 1.0)) * SPACING;
    d = smin(d, sdTorus(p - vec3(x, 0.0, 0.0)), BLEND);
  }
  return d / s;
}

vec3 calcNormal(vec3 p, float eps) {
  vec2 e = vec2(1.0, -1.0) * eps;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.03 * float(i);
    occ += (h - map(p + n * h)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  vec3 ro = u_camPos;
  vec3 rd = normalize(uv.x * u_camRight + uv.y * u_camUp + FOCAL * u_camFwd);
  float pixelAngle = 1.0 / (FOCAL * u_resolution.y);
  vec3 col = background(uv);
  float t = 0.0;
  float tMax = length(ro) + 8.0;
  for (int i = 0; i < 300; i++) {
    float d = map(ro + rd * t);
    if (d < 0.5 * pixelAngle * t) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p, max(1e-4, pixelAngle * t));
      col = shade(n, rd, albedo(n, false), 1.0, ambientOcclusion(p, n));
      break;
    }
    t += d;
    if (t > tMax) break;
  }
  fragColor = vec4(col, 1.0);
}
