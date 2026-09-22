#version 300 es
precision highp float;
precision highp int;
// --- gemeinsame Präambel, wird jedem Modul-Shader vorangestellt ---
uniform vec2  u_resolution;  // Zeichenfläche in Gerätepixeln
uniform float u_scale;       // Welteinheiten pro Gerätepixel
uniform vec2  u_center;      // Ansichtszentrum c (nur float-genau; bevorzugt lokale Koordinaten nutzen)
uniform float u_pixelRatio;  // Gerätepixel pro CSS-Pixel
out vec4 fragColor;
// Lokale Koordinate relativ zum Ansichtszentrum: Welt = c + localCoord().
// Bleibt bei jedem Zoom klein und damit float-genau.
vec2 localCoord() { return (gl_FragCoord.xy - 0.5 * u_resolution) * u_scale; }
