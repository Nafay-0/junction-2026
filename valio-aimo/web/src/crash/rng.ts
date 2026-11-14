/** Seeded randomness for building worlds. Same parts in, same sequence out, on every machine. */

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough to jitter prices. */
export function rngFor(...parts: (string | number)[]): () => number {
  let a = fnv1a(parts.join("|"));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** An integer in [min, max]. */
export const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

/** `base` moved by up to `pct` percent either way, rounded to whole cents. */
export const jitter = (rng: Rng, base: number, pct: number) => Math.round(base * (1 + ((rng() * 2 - 1) * pct) / 100));

export function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
