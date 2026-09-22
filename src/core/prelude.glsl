#version 300 es
precision highp float;
precision highp int;
// --- gemeinsame Präambel, wird jedem Modul-Shader vorangestellt ---
uniform vec2  u_resolution;  // Zeichenfläche in Gerätepixeln
uniform float u_scale;       // Welteinheiten pro Gerätepixel
uniform vec2  u_center;      // Ansichtszentrum c (nur float-genau; bevorzugt lokale Koordinaten nutzen)
uniform float u_pixelRatio;  // Gerätepixel pro CSS-Pixel
uniform vec2  u_tileOffset;  // Versatz der Kachel im Gesamtbild (Export, sonst 0)
out vec4 fragColor;
// Pixelkoordinate im Gesamtbild (statt gl_FragCoord verwenden, damit gekachelter Export funktioniert)
vec2 fragCoord() { return gl_FragCoord.xy + u_tileOffset; }
// Lokale Koordinate relativ zum Ansichtszentrum: Welt = c + localCoord().
// Bleibt bei jedem Zoom klein und damit float-genau.
vec2 localCoord() { return (fragCoord() - 0.5 * u_resolution) * u_scale; }
