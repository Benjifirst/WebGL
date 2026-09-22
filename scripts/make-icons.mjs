// Erzeugt die App-Icons (PNG) ohne Abhängigkeiten: Mandelbrot-Menge in der App-Palette.
// Aufruf: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // Filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 Bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Palette wie mandelbrot.frag (Nachtblau → Blau → Weiß → Gold → Dunkelrot)
const stops = [[0.02, 0.03, 0.10], [0.10, 0.32, 0.62], [0.93, 0.94, 0.90], [0.95, 0.66, 0.16], [0.36, 0.07, 0.05]];
function palette(t) {
  t = (t - Math.floor(t)) * 5;
  const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
  const a = stops[i % 5], b = stops[(i + 1) % 5];
  return a.map((v, k) => v + (b[k] - v) * s);
}

function mandel(cx, cy) {
  let x = 0, y = 0;
  for (let i = 0; i < 300; i++) {
    const r2 = x * x + y * y;
    if (r2 > 1e6) return i + 1 - Math.log2(0.5 * Math.log2(r2));
    [x, y] = [x * x - y * y + cx, 2 * x * y + cy];
  }
  return -1;
}

/** maskable: Motiv im inneren Safe-Bereich (80 %), Hintergrund vollflächig */
function icon(size, maskable) {
  const ss = 3; // Supersampling
  const bg = [14, 15, 18];
  const radius = maskable ? 0.5 : 0.46; // Anteil der Kantenlänge
  const zoom = maskable ? 3.4 : 2.9;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < ss; sy++) {
      for (let sx = 0; sx < ss; sx++) {
        const u = (px + (sx + 0.5) / ss) / size - 0.5;
        const v = (py + (sy + 0.5) / ss) / size - 0.5;
        let c;
        if (!maskable && Math.hypot(u, v) > radius) c = null; // rundes Icon mit transparentem Rand
        else {
          const n = mandel(-0.65 + u * zoom, -v * zoom);
          c = n < 0 ? [0.012, 0.014, 0.022] : palette(n / 24);
        }
        const col = c ? c.map((k) => k * 255) : null;
        if (col) { r += col[0]; g += col[1]; b += col[2]; }
      }
    }
    const n = ss * ss;
    // Deckkraft aus dem Anteil der Abtastpunkte im Kreis (weiche Kante)
    let inside = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (px + (sx + 0.5) / ss) / size - 0.5, v = (py + (sy + 0.5) / ss) / size - 0.5;
      if (maskable || Math.hypot(u, v) <= radius) inside++;
    }
    if (inside === 0) return maskable ? [...bg, 255] : [0, 0, 0, 0];
    return [r / inside, g / inside, b / inside, Math.round((255 * inside) / n)].map((v) => Math.round(v));
  });
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
  ['favicon-32.png', 32, false],
]) {
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), icon(size, maskable));
  console.log('geschrieben:', name);
}
