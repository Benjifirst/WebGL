// Festkommazahlen beliebiger Präzision: Wert = v / 2^bits mit v: bigint.

/** Anzahl signifikanter Bits von |v| */
export function bitLength(v: bigint): number {
  if (v < 0n) v = -v;
  if (v === 0n) return 0;
  const hex = v.toString(16);
  // volle Hex-Ziffern plus signifikante Bits der führenden Ziffer
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0]!, 16)));
}

/** 2^e auch für |e| > 1023 (in zwei Faktoren, damit kein Zwischenüberlauf entsteht) */
function pow2(e: number): number {
  const a = Math.trunc(e / 2);
  return 2 ** a * 2 ** (e - a);
}

/** double → Festkomma mit `bits` Nachkommabits (exakt bis auf Rundung auf das Raster) */
export function fromDouble(x: number, bits: number): bigint {
  if (x === 0 || !Number.isFinite(x)) return 0n;
  const e = Math.floor(Math.log2(Math.abs(x)));
  // x = m · 2^(e−52) mit ganzzahligem m (53 Bit Mantisse)
  const m = BigInt(Math.round(x * pow2(52 - e)));
  const shift = bits + e - 52;
  return shift >= 0 ? m << BigInt(shift) : m >> BigInt(-shift);
}

/** Festkomma → double (auf 53 Bit gerundet) */
export function toDouble(v: bigint, bits: number): number {
  if (v === 0n) return 0;
  const shift = Math.max(0, bitLength(v) - 62);
  const m = Number(v >> BigInt(shift));
  return m * pow2(shift - bits);
}

/** Präzision erhöhen (nie verringern) */
export function withBits(v: bigint, from: number, to: number): bigint {
  return to >= from ? v << BigInt(to - from) : v >> BigInt(from - to);
}

/** Dezimalstring („-0.7436…“, „1e-5“ nicht unterstützt) → Festkomma */
export function fromDecimal(s: string, bits: number): bigint {
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(s);
  if (!m || (!m[2] && !m[3])) throw new Error(`Keine Dezimalzahl: ${s}`);
  const frac = m[3] ?? '';
  const n = BigInt((m[2] || '0') + frac);
  const v = (n << BigInt(bits)) / 10n ** BigInt(frac.length);
  return m[1] === '-' ? -v : v;
}

/** Festkomma → Dezimalstring mit `digits` Nachkommastellen (kaufmännisch gerundet) */
export function toDecimal(v: bigint, bits: number, digits: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const B = BigInt(bits);
  // round(a · 10^digits / 2^bits), dann Ganzzahl- und Nachkommateil trennen
  const scaled = (a * 10n ** BigInt(digits) + (1n << (B - 1n))) >> B;
  const p = 10n ** BigInt(digits);
  const int = scaled / p;
  const frac = scaled % p;
  const f = digits > 0 ? '.' + frac.toString().padStart(digits, '0') : '';
  return `${neg && scaled !== 0n ? '-' : ''}${int}${f}`;
}
