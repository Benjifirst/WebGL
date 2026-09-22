// Knoten und Verschlingungen als geschlossene Raumkurven (Polygonzüge).
//
// Quellen: Parameterkurven (Katalog, eigene Formeln), Torusknoten T(p, q) und Abschlüsse von Zöpfen.
// Zopfwort: Liste ±i für σᵢ^{±1} (Strang i kreuzt über i+1 bzw. darunter). Der Abschluss legt die
// Stränge nebeneinander um eine Achse; in jedem Abschnitt tauschen zwei benachbarte Stränge ihren
// Radius, der überkreuzende hebt sich dabei an (z > 0).

export type P3 = [number, number, number];
/** Komponenten, jede ein geschlossener Polygonzug (letzter Punkt ≠ erster) */
export type Link = P3[][];

const TAU = 2 * Math.PI;

export function sampleClosed(f: (t: number) => P3, n: number, t0 = 0, t1 = TAU): P3[] {
  return Array.from({ length: n }, (_, i) => f(t0 + ((t1 - t0) * i) / n));
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Torusknoten T(p, q): p-mal um die Achse, q-mal durch das Loch; gcd(p, q) Komponenten */
export function torusKnot(p: number, q: number, n = 480): Link {
  const g = gcd(p, q) || 1;
  const pp = p / g, qq = q / g;
  // Komponenten: Kopien von T(p/g, q/g), im Meridian um 2πk/(g·p/g) versetzt – so treffen sie sich nie
  return Array.from({ length: g }, (_, k) => {
    const shift = (TAU * k) / (g * Math.max(pp, 1));
    return sampleClosed((s) => {
      const phi = pp * s;
      const psi = qq * s + shift;
      const r = 2 + Math.cos(psi);
      return [r * Math.cos(phi), r * Math.sin(phi), -Math.sin(psi)];
    }, n);
  });
}

/** Abschluss eines Zopfs; Rückgabe null bei ungültigem Wort */
export function braidClosure(word: number[], strands?: number): Link {
  const n = Math.max(strands ?? 0, 2, ...word.map((x) => Math.abs(x) + 1));
  const L = Math.max(word.length, 1);
  const samples = 28;
  // Position je Slot: Radius; Strang s liegt anfangs in Slot s
  const radius = (slot: number) => 2 + 0.75 * slot;
  // Pfade der Stränge über einen Umlauf (Winkel 0 … 2π)
  const paths: P3[][] = Array.from({ length: n }, () => []);
  const slotOf = Array.from({ length: n }, (_, s) => s); // Strang → Slot
  for (let k = 0; k < L; k++) {
    const letter = word[k] ?? 0;
    const i = Math.abs(letter) - 1; // Slots i und i+1 tauschen
    for (let m = 0; m < samples; m++) {
      const u = m / samples;
      const theta = (TAU * (k + u)) / L;
      const e = Math.min(1, Math.max(0, (u - 0.12) / 0.76));
      const swap = 0.5 - 0.5 * Math.cos(Math.PI * e); // 0 → 1
      const bump = Math.sin(Math.PI * e);
      for (let s = 0; s < n; s++) {
        const slot = slotOf[s]!;
        let r = radius(slot);
        let z = 0;
        if (letter && (slot === i || slot === i + 1)) {
          const target = slot === i ? i + 1 : i;
          r = radius(slot) + (radius(target) - radius(slot)) * swap;
          // σᵢ: der Strang, der nach außen wandert, liegt oben; σᵢ⁻¹ umgekehrt
          const outward = slot === i;
          z = (outward === letter > 0 ? 1 : -1) * 0.45 * bump;
        }
        paths[s]!.push([r * Math.cos(theta), r * Math.sin(theta), z]);
      }
    }
    if (letter) {
      for (let s = 0; s < n; s++) {
        if (slotOf[s] === i) slotOf[s] = i + 1;
        else if (slotOf[s] === i + 1) slotOf[s] = i;
      }
    }
  }
  // Nach einem Umlauf liegt Strang s in Slot slotOf[s]; dort geht der Strang weiter, der in diesem Slot begann
  const next = slotOf; // Strang s → Strang, der in Slot slotOf[s] startet (= slotOf[s])
  const seen = new Set<number>();
  const link: Link = [];
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue;
    const comp: P3[] = [];
    let cur = s;
    while (!seen.has(cur)) {
      seen.add(cur);
      comp.push(...paths[cur]!);
      cur = next[cur]!;
    }
    link.push(comp);
  }
  return link;
}

/** Zopfwort lesen: „s1 s2^-1 s1“, „σ₁σ₂⁻¹“, „1 -2 1“ oder „aBa“ (a = σ₁, B = σ₂⁻¹) */
export function parseBraid(src: string): number[] {
  const text = src
    .replace(/[₀-₉]/g, (c) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(c)))
    .replace(/(⁻?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, m: string, d: string) => `^${m ? '-' : ''}${[...d].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)).join('')}`)
    .replace(/−/g, '-')
    .trim();
  if (!text) throw new Error('Leeres Zopfwort');
  const out: number[] = [];
  const re = /\s*(?:[sσ]\s*(\d+)\s*(?:\^\s*(-?\d+))?|(-?\d+)|([a-zA-Z]))\s*/y;
  let i = 0;
  while (i < text.length) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m || m[0].length === 0) throw new Error(`Unerwartetes Zeichen „${text[i]}“ an Stelle ${i + 1}`);
    if (m[1]) {
      const g = Number(m[1]);
      const e = m[2] ? Number(m[2]) : 1;
      if (g < 1) throw new Error('Zopferzeuger beginnen bei σ₁');
      for (let k = 0; k < Math.abs(e); k++) out.push(Math.sign(e) * g);
    } else if (m[3]) {
      const v = Number(m[3]);
      if (!v) throw new Error('0 ist kein Zopferzeuger');
      out.push(v);
    } else if (m[4]) {
      const c = m[4];
      const g = c.toLowerCase().charCodeAt(0) - 96;
      out.push(c === c.toLowerCase() ? g : -g);
    }
    i = re.lastIndex;
  }
  if (out.length > 60) throw new Error('Höchstens 60 Buchstaben');
  if (Math.max(...out.map(Math.abs)) > 8) throw new Error('Höchstens 9 Stränge');
  return out;
}

export interface CatalogEntry {
  id: string;
  name: string;
  info: string;
  build: () => Link;
  /** bekannte minimale Kreuzungszahl */
  crossings: number;
}

const circle = (c: P3, a: P3, b: P3, n = 240): P3[] =>
  sampleClosed((t) => [c[0] + a[0] * Math.cos(t) + b[0] * Math.sin(t), c[1] + a[1] * Math.cos(t) + b[1] * Math.sin(t), c[2] + a[2] * Math.cos(t) + b[2] * Math.sin(t)], n);

export const CATALOG: readonly CatalogEntry[] = [
  { id: '0_1', name: '0₁ Unknoten', info: 'Ein einfacher Kreis', crossings: 0, build: () => [circle([0, 0, 0], [2, 0, 0], [0, 2, 0])] },
  {
    id: '3_1',
    name: '3₁ Kleeblatt',
    info: 'Einfachster echter Knoten, chiral (vom Spiegelbild verschieden)',
    crossings: 3,
    build: () => [sampleClosed((t) => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)], 360)],
  },
  {
    id: '4_1',
    name: '4₁ Achterknoten',
    info: 'Amphichiral: gleich seinem Spiegelbild',
    crossings: 4,
    build: () => [sampleClosed((t) => [(2 + Math.cos(2 * t)) * Math.cos(3 * t), (2 + Math.cos(2 * t)) * Math.sin(3 * t), Math.sin(4 * t)], 480)],
  },
  { id: '5_1', name: '5₁ Fünfblatt (T(2,5))', info: 'Torusknoten', crossings: 5, build: () => torusKnot(2, 5) },
  { id: '5_2', name: '5₂', info: 'Zopf σ₁³σ₂σ₁⁻¹σ₂', crossings: 5, build: () => braidClosure([1, 1, 1, 2, -1, 2]) },
  { id: '6_1', name: '6₁ Stevedore', info: 'Zopf σ₁²σ₂σ₁⁻¹σ₃⁻¹σ₂σ₃⁻¹', crossings: 6, build: () => braidClosure([1, 1, 2, -1, -3, 2, -3]) },
  { id: '6_2', name: '6₂', info: 'Zopf σ₁³σ₂⁻¹σ₁σ₂⁻¹', crossings: 6, build: () => braidClosure([1, 1, 1, -2, 1, -2]) },
  { id: '6_3', name: '6₃', info: 'Zopf σ₁²σ₂⁻¹σ₁σ₂⁻²', crossings: 6, build: () => braidClosure([1, 1, -2, 1, -2, -2]) },
  { id: '7_1', name: '7₁ (T(2,7))', info: 'Torusknoten', crossings: 7, build: () => torusKnot(2, 7) },
  { id: '8_19', name: '8₁₉ = T(3,4)', info: 'Kleinster nicht alternierender Knoten', crossings: 8, build: () => torusKnot(3, 4) },
  { id: 'granny', name: 'Altweiberknoten 3₁ # 3₁', info: 'Summe zweier gleichhändiger Kleeblätter (Zopf σ₁³σ₂³)', crossings: 6, build: () => braidClosure([1, 1, 1, 2, 2, 2]) },
  { id: 'square', name: 'Kreuzknoten 3₁ # 3₁*', info: 'Kleeblatt plus Spiegelbild (Zopf σ₁³σ₂⁻³)', crossings: 6, build: () => braidClosure([1, 1, 1, -2, -2, -2]) },
  {
    id: 'hopf',
    name: 'Hopf-Verschlingung',
    info: 'Zwei Kreise, einmal verschlungen',
    crossings: 2,
    build: () => [circle([-0.9, 0, 0], [1.5, 0, 0], [0, 1.5, 0]), circle([0.9, 0, 0], [1.5, 0, 0], [0, 0, 1.5])],
  },
  { id: 'solomon', name: 'Salomonsknoten T(2,4)', info: 'Zwei Komponenten, Verschlingungszahl 2', crossings: 4, build: () => torusKnot(2, 4) },
  { id: 'whitehead', name: 'Whitehead-Verschlingung', info: 'Verschlingungszahl 0, trotzdem nicht trennbar (Zopf σ₁σ₂⁻¹σ₁σ₂⁻¹σ₁)', crossings: 5, build: () => braidClosure([1, -2, 1, -2, 1]) },
  {
    id: 'borromean',
    name: 'Borromäische Ringe',
    info: 'Je zwei Ringe sind unverschlungen, alle drei zusammen nicht trennbar',
    crossings: 6,
    build: () => [
      circle([0, 0, 0], [2, 0, 0], [0, 1, 0]),
      circle([0, 0, 0], [0, 2, 0], [0, 0, 1]),
      circle([0, 0, 0], [0, 0, 2], [1, 0, 0]),
    ],
  },
];

/** Auf Radius ≈ 2 skalieren und zentrieren */
export function fit(link: Link, radius = 2): Link {
  const all = link.flat();
  if (!all.length) return link;
  const c = [0, 1, 2].map((k) => all.reduce((s, p) => s + p[k]!, 0) / all.length);
  const r = Math.max(1e-9, ...all.map((p) => Math.hypot(p[0] - c[0]!, p[1] - c[1]!, p[2] - c[2]!)));
  return link.map((comp) => comp.map((p) => [0, 1, 2].map((k) => ((p[k]! - c[k]!) / r) * radius) as P3));
}
