// Graphen: Hintergrundgitter, implizite Kurven F(x,y) = 0 und Ungleichungen (Bereiche).
// Explizite, parametrische und polare Kurven zeichnet die Beschriftungsebene (Canvas 2D).
// Die Platzhalter für Funktionen und Zeichenbefehle (unten) werden zur Laufzeit durch generierten Code ersetzt.

uniform float u_spacing;     // Hauptgitterweite (Welt)
uniform vec2  u_phase;       // c mod u_spacing (in double berechnet)
uniform float u_minorAlpha;
uniform float u_grid;        // Gitter an/aus
uniform float u_p[16];       // Parameterwerte (a, b, …)

//HELPERS

// Antialiasierte Linien bei ganzzahligem g; Breite in Bildpixeln
float gridLines(vec2 g, float widthPx) {
  vec2 d = abs(fract(g + 0.5) - 0.5);
  vec2 px = d / max(fwidth(g), vec2(1e-30));
  vec2 a = clamp(0.5 * widthPx - px + 0.5, 0.0, 1.0);
  return max(a.x, a.y);
}

// Kurve F = 0: Abstand |F| / |∇F| über die Bildableitungen, antialiasiert
float curve(float v, float widthPx) {
  float w = fwidth(v);
  return w > 0.0 ? clamp(0.5 * widthPx - abs(v) / w + 0.5, 0.0, 1.0) : 0.0;
}

//FUNCS

void main() {
  vec2 local = localCoord();
  vec2 world = u_center + local;
  float x = world.x, y = world.y;

  vec3 col = vec3(0.055, 0.059, 0.071);
  if (u_grid > 0.0) {
    vec2 g = (local + u_phase) / u_spacing;
    col = mix(col, vec3(0.13, 0.14, 0.165), gridLines(g * 5.0, u_pixelRatio) * u_minorAlpha);
    col = mix(col, vec3(0.2, 0.215, 0.25), gridLines(g, u_pixelRatio));
  }
  float lw = 2.2 * u_pixelRatio;
  // gestrichelter Rand bei strikten Ungleichungen
  float dash = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (10.0 * u_pixelRatio)));

//DRAW

  fragColor = vec4(col, 1.0);
}
