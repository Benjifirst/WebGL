// Keilprodukte (Blumensträuße) aus Punkten, Kreisen, Sphären, Tori, Flächen, Scheiben und Strecken.
// Primitive gleicher Gruppe (z. B. die Tori einer Fläche vom Geschlecht g) werden per Smooth-Minimum
// verschmolzen, verschiedene Gruppen berühren sich nur im gemeinsamen Klebepunkt.
// scene.glsl wird vorangestellt.

uniform int  u_count;
uniform vec4 u_pa[16];   // Mittelpunkt, Typ (0 Punkt, 1 Kugel, 2 Kreis, 3 Torus, 4 Scheibe, 5 Strecke)
uniform vec4 u_pb[16];   // Achse (Normale bzw. Richtung), Gruppe
uniform vec4 u_pc[16];   // R, r, Länge, –
uniform float u_fitScale;   // Weltmaßstab (Einpassen)
uniform float u_shiftUv;    // Bildmitte nach rechts (Panel)

const float BLEND = 0.35;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Ring um die Achse n: Abstand zum Kreis vom Radius R, minus Rohrradius r
float sdRing(vec3 q, vec3 n, float R, float r) {
  float h = dot(q, n);
  return length(vec2(length(q - h * n) - R, h)) - r;
}

float sdPrim(vec3 p, int i) {
  vec4 a = u_pa[i], b = u_pb[i], c = u_pc[i];
  vec3 q = p - a.xyz;
  int type = int(a.w + 0.5);
  if (type == 0) return length(q) - c.x;
  if (type == 1) return length(q) - c.x;
  if (type == 2 || type == 3) return sdRing(q, b.xyz, c.x, c.y);
  if (type == 4) {
    // dünne Scheibe mit Normale n
    float h = dot(q, b.xyz);
    vec2 d = vec2(length(q - h * b.xyz) - c.x, abs(h) - c.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - 0.01;
  }
  // Strecke von a in Richtung b, Länge c.z, Radius c.x
  float t = clamp(dot(q, b.xyz), 0.0, c.z);
  return length(q - t * b.xyz) - c.x;
}

// Abstand und Gruppe des nächsten Teils
vec2 map(vec3 p) {
  p /= u_fitScale;
  float gd[16];
  for (int g = 0; g < 16; g++) gd[g] = 1e9;
  for (int i = 0; i < 16; i++) {
    if (i >= u_count) break;
    int g = int(u_pb[i].w + 0.5);
    gd[g] = smin(gd[g], sdPrim(p, i), BLEND);
  }
  float d = 1e9, group = 0.0;
  for (int g = 0; g < 16; g++) {
    if (gd[g] < d) {
      d = gd[g];
      group = float(g);
    }
  }
  return vec2(d * u_fitScale, group);
}

vec3 calcNormal(vec3 p, float eps) {
  vec2 e = vec2(1.0, -1.0) * eps;
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

vec3 groupColor(float g) {
  if (g > 14.5) return vec3(0.95, 0.78, 0.3); // Klebepunkt
  vec3 pal[6] = vec3[6](
    vec3(0.62, 0.66, 0.74), vec3(0.78, 0.55, 0.5), vec3(0.52, 0.7, 0.55),
    vec3(0.5, 0.6, 0.8), vec3(0.75, 0.68, 0.45), vec3(0.66, 0.55, 0.78));
  return pal[int(mod(g, 6.0))] * 0.62;
}

void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  uv.x -= u_shiftUv;
  vec3 ro = u_camPos;
  vec3 rd = normalize(uv.x * u_camRight + uv.y * u_camUp + FOCAL * u_camFwd);
  float pixelAngle = 1.0 / (FOCAL * u_resolution.y);
  vec3 col = background(uv);
  float t = 0.0;
  float tMax = length(ro) + 20.0;
  for (int i = 0; i < 300; i++) {
    vec2 m = map(ro + rd * t);
    if (m.x < 0.5 * pixelAngle * t) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p, max(1e-4, pixelAngle * t));
      vec3 base = u_colorMode == 1 ? albedo(n, false) : groupColor(m.y);
      col = shade(n, rd, base, 1.0, 1.0);
      break;
    }
    t += m.x;
    if (t > tMax) break;
  }
  fragColor = vec4(col, 1.0);
}
