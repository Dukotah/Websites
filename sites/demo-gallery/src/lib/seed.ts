/**
 * Deterministic seeded randomness for the design-system factory.
 *
 * One source of determinism: a 32-bit FNV-1a hash of a string (usually the
 * slug). Every "random but stable" choice (font, shape family, motion level,
 * hero tie-breaks, section ordering jitter, tone assignment) derives from this
 * seed, so a re-run produces the identical site, but two different slugs get
 * visibly different sites.
 *
 * The seeded helpers take a numeric seed and are pure: same seed in → same
 * value out. They never mutate their inputs.
 */

/**
 * 32-bit FNV-1a hash of a string → unsigned 32-bit integer.
 * Stable across runs and platforms. Empty string yields the FNV offset basis.
 */
export function hash(str: string): number {
  let h = 0x811c9dc5; // FNV offset basis (2166136261)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // FNV prime 16777619, done with shifts to stay in 32-bit integer math
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Advance a seed deterministically (mulberry32-style mix) and return a fresh
 * 32-bit unsigned integer. Used internally so repeated draws from one seed do
 * not collide.
 */
function next(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Float in [0,1) from a seed, deterministic. */
export function randomFloat(seed: number): number {
  return next(seed) / 4294967296;
}

/** Pick one element from a non-empty array, deterministically by seed. */
export function pick<T>(seed: number, arr: readonly T[]): T {
  if (!arr.length) {
    throw new Error('pick(): cannot pick from an empty array');
  }
  const i = next(seed) % arr.length;
  return arr[i];
}

/**
 * Return a new array that is a deterministic shuffle of the input
 * (Fisher–Yates seeded by `seed`). Does not mutate the input.
 */
export function shuffle<T>(seed: number, arr: readonly T[]): T[] {
  const out = arr.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = next(s);
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** Deterministic boolean: true with probability `p` (0..1). */
export function chance(seed: number, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return randomFloat(seed) < p;
}

/** Deterministic integer in the inclusive range [a, b]. */
export function rangeInt(seed: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const span = hi - lo + 1;
  return lo + (next(seed) % span);
}
