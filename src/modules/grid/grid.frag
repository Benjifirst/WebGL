// Koordinatengitter – Platzhaltermodul zum Testen der Infrastruktur.
// Alle Größen in lokalen Koordinaten (relativ zum Ansichtszentrum),
// daher genau bei beliebigem Zoom.

uniform float u_spacing;     // Hauptgitterweite in Welteinheiten
uniform vec2  u_phase;       // c mod u_spacing, in JS (double) berechnet
uniform vec2  u_origin;      // lokale Position des Ursprungs (= −c)
uniform float u_minorAlpha;  // Sichtbarkeit des Nebengitters (Weite/10)

// Antialiasierte Linienabdeckung: g in Gitter-Einheiten, Linien bei ganzen Zahlen.
// Abstand zur nächsten Linie in Pixeln = d / fwidth(g).
float gridLines(vec2 g, float widthPx) {
  vec2 d = abs(fract(g + 0.5) - 0.5);
  vec2 px = d / max(fwidth(g), vec2(1e-30));
  vec2 a = clamp(0.5 * widthPx - px + 0.5, 0.0, 1.0);
  return max(a.x, a.y);
}

void main() {
  vec2 p = localCoord();
  float lw = u_pixelRatio;  // 1 CSS-Pixel Linienbreite

  vec2 g = (p + u_phase) / u_spacing;
  float major = gridLines(g, lw);
  float minor = gridLines(g * 10.0, lw) * u_minorAlpha;

  // Achsen: Abstand zu x = 0 bzw. y = 0 in Pixeln
  vec2 dAxis = abs(p - u_origin) / u_scale;
  vec2 aAxis = clamp(0.75 * lw - dAxis + 0.5, 0.0, 1.0);
  float axis = max(aAxis.x, aAxis.y);

  vec3 col = vec3(0.055, 0.059, 0.071);
  col = mix(col, vec3(0.16, 0.17, 0.20), minor);
  col = mix(col, vec3(0.27, 0.29, 0.34), major);
  col = mix(col, vec3(0.55, 0.62, 0.75), axis);
  fragColor = vec4(col, 1.0);
}
