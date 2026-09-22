// Implizite Fläche F(x, y, z) = 0 innerhalb einer Begrenzungskugel.
// F ist kein Distanzfeld → Schrittweite aus |F| / |∇F| (lineare Näherung des Abstands),
// begrenzt nach unten und oben; Treffer über Vorzeichenwechsel und Bisektion.
// Konvention: F < 0 = innen. Schneidet die Kugel das Innere, wird die Schnittfläche gezeigt.

uniform float u_bound;  // Radius der Begrenzungskugel in mathematischen Einheiten

const float R_VIEW = 1.5;  // Radius der Begrenzungskugel in der Grafik

// Grafik → mathematische Koordinaten (z nach oben), skaliert auf den gewählten Bereich
float F(vec3 p) {
  p *= u_bound / R_VIEW;
  float x = p.x, y = -p.z, z = p.y;
  return /*F*/;
}

// Gradient per Tetraeder-Differenzen: Σ kᵢ·F(p + kᵢ) ≈ 4h²·∇F
vec3 gradF(vec3 p, float h) {
  vec2 e = vec2(1.0, -1.0) * h;
  return (e.xyy * F(p + e.xyy) + e.yyx * F(p + e.yyx) + e.yxy * F(p + e.yxy) + e.xxx * F(p + e.xxx)) / (4.0 * h * h);
}

void main() {
  vec2 uv = (fragCoord() - 0.5 * u_resolution) / u_resolution.y;
  vec3 ro = u_camPos;
  vec3 rd = normalize(uv.x * u_camRight + uv.y * u_camUp + FOCAL * u_camFwd);
  float pixelAngle = 1.0 / (FOCAL * u_resolution.y);
  float h = 1e-3 * R_VIEW;

  float t = 0.0;
  bool hit = false;
  bool cap = false;

  // Strahl ∩ Kugel |ro + t·rd| = R:  t² + 2bt + c = 0
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R_VIEW * R_VIEW;
  float disc = b * b - c;
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t0 = max(-b - sq, 0.0);
    float t1 = -b + sq;
    t = t0;
    float f = F(ro + rd * t);

    if (f < 0.0 && t0 > 0.0) {
      hit = true;  // Strahl tritt direkt ins Innere ein → Schnittfläche
      cap = true;
    } else if (t1 > 0.0) {
      float minStep = 0.004 * R_VIEW;
      float maxStep = 0.05 * R_VIEW;
      for (int i = 0; i < 600; i++) {
        float g = length(gradF(ro + rd * t, h));
        float stepLen = clamp(0.5 * abs(f) / max(g, 1e-6), max(minStep, pixelAngle * t), maxStep);
        float tn = t + stepLen;
        if (tn > t1) break;
        float fn = F(ro + rd * tn);
        if ((f < 0.0) != (fn < 0.0)) {
          // Bisektion auf [t, tn]
          float a = t, bb = tn, fa = f;
          for (int k = 0; k < 16; k++) {
            float m = 0.5 * (a + bb);
            float fm = F(ro + rd * m);
            if ((fa < 0.0) == (fm < 0.0)) { a = m; fa = fm; } else { bb = m; }
          }
          t = 0.5 * (a + bb);
          hit = true;
          break;
        }
        t = tn;
        f = fn;
      }
    }
  }

  // Bildschirmableitungen des Trefferpunkts – in gleichförmigem Kontrollfluss berechnet
  vec3 p = ro + rd * t;
  vec3 screenNormal = cross(dFdx(p), dFdy(p));

  vec3 col = background(uv);
  if (hit) {
    vec3 n;
    bool inner;
    if (cap) {
      n = normalize(p);
      inner = true;
    } else {
      // ∇F zeigt nach außen (F wächst). An singulären Stellen der Gleichung (∇F = 0 auf
      // glatter Fläche, z. B. F = A³ − …) taugt der Gradient nicht → Normale aus der Geometrie.
      // Erkennung: regulär ist |∇F| unabhängig von der Schrittweite, singulär wächst er mit ihr.
      vec3 gNear = gradF(p, 0.25 * h);
      vec3 gFar = gradF(p, 8.0 * h);
      bool singular = length(gNear) < 0.05 * length(gFar) && dot(screenNormal, screenNormal) > 0.0;
      if (singular) {
        n = normalize(screenNormal);
        if (dot(n, gFar) < 0.0) n = -n;  // nach außen ausrichten
      } else {
        n = normalize(gNear);
      }
      inner = dot(n, rd) > 0.0;
      if (inner) n = -n;
    }
    col = shade(n, rd, albedo(n, inner), 1.0, 1.0);
  }

  fragColor = vec4(col, 1.0);
}
