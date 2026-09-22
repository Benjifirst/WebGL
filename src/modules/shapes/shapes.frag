// 3D-Formen per Raymarching (Sphere Tracing) über vorzeichenbehaftete Distanzfelder.
// Kamera, Hintergrund und Beleuchtung: scene.glsl (wird vorangestellt).

uniform int   u_shape;
uniform vec2  u_param;      // formabhängige Parameter

const float TAU = 6.283185307179586;

// Torus in der xz-Ebene: Abstand zum Kreis vom Radius R, minus Rohrradius r
float sdTorus(vec3 p, float R, float r) { return length(vec2(length(p.xz) - R, p.y)) - r; }

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Polynomielles Smooth-Minimum (Verschmelzen zweier Felder), k = Übergangsbreite
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Torusknoten (p, q): die Kurve umläuft die Seele p-mal und windet sich dabei q-mal
// um das Rohr. Zu gegebenem Winkel a um die y-Achse liegen p Stränge im Querschnitt
// bei den Winkeln φ_k = q(a + 2πk)/p. Kein exaktes SDF (Metrik verzerrt) → kleinere Schritte.
float sdTorusKnot(vec3 p, float P, float Q) {
  float a = atan(p.z, p.x);
  vec2 c = vec2(length(p.xz) - 1.0, p.y);   // Querschnittskoordinaten
  float d = 1e9;
  for (int k = 0; k < 8; k++) {
    if (float(k) >= P) break;
    float phi = Q * (a + TAU * float(k)) / P;
    d = min(d, length(c - 0.42 * vec2(cos(phi), sin(phi))));
  }
  return d - 0.13;
}

// Gyroid sin x cos y + sin y cos z + sin z cos x = 0 als dünne Schale, auf Kugel beschnitten.
// |∇g| ≤ √3·f → Abstandsschätzung durch Division (konservativ).
float sdGyroid(vec3 p, float f, float thickness) {
  vec3 q = p * f;
  float g = abs(dot(sin(q), cos(q.yzx))) / (f * 1.8) - thickness;
  return max(g, length(p) - 1.2);
}

// Mandelbulb: z ↦ z^n + c in Kugelkoordinaten; Abstandsschätzer 0.5·r·ln r / |dz|
float sdMandelbulb(vec3 p, float n) {
  float bound = length(p) - 1.25;
  if (bound > 0.2) return bound;
  vec3 z = p;
  float dr = 1.0;
  float r = length(z);
  for (int i = 0; i < 12; i++) {
    r = length(z);
    if (r > 2.0 || r < 1e-6) break;
    float theta = acos(clamp(z.y / r, -1.0, 1.0)) * n;
    float phi = atan(z.z, z.x) * n;
    dr = pow(r, n - 1.0) * n * dr + 1.0;
    z = pow(r, n) * vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi)) + p;
  }
  return 0.5 * log(max(r, 1e-6)) * r / dr;
}

// Menger-Schwamm: Würfel minus iterativ gedrittelte Kreuze
float sdMenger(vec3 p, float iterations) {
  float d = sdBox(p, vec3(1.0));
  float s = 1.0;
  for (int m = 0; m < 6; m++) {
    if (float(m) >= iterations) break;
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

float map(vec3 p) {
  vec2 k = u_param;
  switch (u_shape) {
    case 0: return sdTorus(p, k.x, k.y);
    case 1: // Doppeltorus (Geschlecht 2): zwei verschmolzene Tori im Abstand ±k.y
      return smin(sdTorus(p - vec3(k.y, 0, 0), 0.75, k.x), sdTorus(p + vec3(k.y, 0, 0), 0.75, k.x), 0.25);
    case 2: return sdTorusKnot(p, k.x, k.y);
    case 3: { // Hopf-Verschlingung: zwei Ringe in orthogonalen Ebenen
      float a = sdTorus(p + vec3(0.5 * k.x, 0, 0), k.x, k.y);
      float b = sdTorus((p - vec3(0.5 * k.x, 0, 0)).xzy, k.x, k.y);
      return min(a, b);
    }
    case 4: return sdGyroid(p, k.x, k.y);
    case 5: return sdMandelbulb(p, k.x);
    default: return sdMenger(p, k.x);
  }
}

// Schrittweitenfaktor für Felder, die keine exakten Abstände liefern
float stepScale() { return u_shape == 2 ? 0.5 : u_shape == 5 ? 0.9 : 1.0; }

// Normale per Tetraeder-Differenzen (4 Auswertungen)
vec3 calcNormal(vec3 p, float eps) {
  vec2 e = vec2(1.0, -1.0) * eps;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

// Weicher Schatten: kleinster Winkelabstand k·h/t des Schattenstrahls zur Geometrie.
// Kleine, begrenzte Schritte, damit das Minimum auch bei ungenauen Distanzfeldern
// (Torusknoten) nicht übersprungen wird – sonst entstehen Streifen.
float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 128; i++) {
    float h = map(ro + rd * t) * stepScale();
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.005, 0.06);
    if (res < 0.002 || t > 4.0) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
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
  float pixelAngle = 1.0 / (FOCAL * u_resolution.y);  // Öffnungswinkel eines Pixels

  vec3 bg = background(uv);
  vec3 col = bg;

  float t = 0.0;
  bool hit = false;
  float tMax = length(ro) + 4.0;
  for (int i = 0; i < 300; i++) {
    float d = map(ro + rd * t) * stepScale();
    // Treffer, sobald der Abstand unter die Pixelgröße in dieser Tiefe fällt
    if (d < 0.5 * pixelAngle * t) { hit = true; break; }
    t += d;
    if (t > tMax) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, max(1e-4, pixelAngle * t));
    // Startpunkt des Schattenstrahls sicher außerhalb der Fläche (der Primärstrahl kann
    // bei ungenauen Distanzfeldern leicht eindringen → sonst Streifen durch Selbstschatten)
    vec3 ps = p + n * (0.01 + max(0.0, -map(p) / stepScale()));
    float shadow = dot(n, LIGHT_DIR) > 0.0 ? softShadow(ps, LIGHT_DIR) : 0.0;
    col = shade(n, rd, albedo(n, false), shadow, ambientOcclusion(p, n));
    // Weicher Übergang in den Hintergrund in großer Tiefe
    col = mix(col, bg, smoothstep(tMax - 3.0, tMax, t));
  }

  fragColor = vec4(col, 1.0);
}
