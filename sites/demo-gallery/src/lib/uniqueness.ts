/**
 * Uniqueness scorer — makes "generic" a measurable defect (spec §10.2).
 *
 * scoreUniqueness(entries) → Map<slug, UniquenessResult>
 *
 * For each site, computes a 0-100 DISTINCTIVENESS score = how different it is
 * from every other site in the batch. The score is the inverse of its maximum
 * pairwise similarity to any other site. A score of 100 means totally unique;
 * a score near 0 means a near-duplicate exists.
 *
 * The "nearest" result includes the closest neighbor and the traits they share,
 * so the dashboard can flag: "looks like <other> — vary font/shape/sections".
 *
 * Pure, deterministic, no I/O, no external dependencies.
 */

import type { ArtDirection } from './art-direction';
import type { PagePlan } from './compose';
import { parseHex, rgbToHsl } from './color';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface UniquenessEntry {
  slug: string;
  ad: ArtDirection;
  plan: PagePlan;
}

export interface NearestNeighbor {
  slug: string;
  /** Human-readable traits that both sites share. */
  sharedTraits: string[];
}

export interface UniquenessResult {
  /** 0-100: 100 = totally unique; 0 = identical twin. */
  score: number;
  /** The most similar other site in the batch. */
  nearest: NearestNeighbor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Similarity dimensions and weights
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dimensions used to compare two sites. Each returns a similarity value in
 * [0, 1] where 1 = identical and 0 = completely different.
 *
 * Weights must sum to 1.0.
 */
const DIMENSIONS: Array<{
  key: string;
  weight: number;
  /** Label shown to user when the trait is shared. */
  label: (a: UniquenessEntry, b: UniquenessEntry) => string;
  /** 0 = different, 1 = identical */
  similarity: (a: UniquenessEntry, b: UniquenessEntry) => number;
}> = [
  {
    key: 'fontId',
    weight: 0.20,
    label: (a) => `same font (${a.ad.fontId})`,
    similarity: (a, b) => (a.ad.fontId === b.ad.fontId ? 1 : 0),
  },
  {
    key: 'brandHue',
    weight: 0.20,
    label: (a, b) => {
      const hueA = hexToHue(a.ad.palette.brand);
      const hueB = hexToHue(b.ad.palette.brand);
      return `similar brand hue (~${Math.round(hueA)}° vs ~${Math.round(hueB)}°)`;
    },
    similarity: (a, b) => hueSimilarity(
      hexToHue(a.ad.palette.brand),
      hexToHue(b.ad.palette.brand),
    ),
  },
  {
    key: 'shape',
    weight: 0.15,
    label: (a) => `same shape family (${a.ad.shape})`,
    similarity: (a, b) => (a.ad.shape === b.ad.shape ? 1 : 0),
  },
  {
    key: 'archetype',
    weight: 0.15,
    label: (a) => `same archetype/category (${a.ad.category})`,
    similarity: (a, b) => (a.ad.category === b.ad.category ? 1 : 0),
  },
  {
    key: 'heroVariant',
    weight: 0.10,
    label: (a) => `same hero variant (${a.plan.hero})`,
    similarity: (a, b) => (a.plan.hero === b.plan.hero ? 1 : 0),
  },
  {
    key: 'sections',
    weight: 0.20,
    label: (a, b) => {
      const shared = sharedSectionTypes(a, b);
      const pct = Math.round(jaccardSections(a, b) * 100);
      return `${pct}% section overlap (${shared.join(', ')})`;
    },
    similarity: (a, b) => jaccardSections(a, b),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the HSL hue (0–360) from a brand hex string. Defaults to 0. */
function hexToHue(hex: string): number {
  try {
    return rgbToHsl(parseHex(hex)).h;
  } catch {
    return 0;
  }
}

/**
 * Hue similarity on a circular scale (360°). Returns 1 when hues are within
 * 15° (effectively the same color family), scales linearly to 0 at 60° or more.
 *
 * Threshold choices:
 *   ≤15°  — effectively the same color family  → similarity 1.0
 *   15-60° — close but distinct                 → linear decay to 0
 *   ≥60°  — clearly different families          → similarity 0
 */
function hueSimilarity(hueA: number, hueB: number): number {
  // Circular distance on [0, 360)
  let diff = Math.abs(hueA - hueB) % 360;
  if (diff > 180) diff = 360 - diff;
  if (diff <= 15) return 1;
  if (diff >= 60) return 0;
  return 1 - (diff - 15) / 45;
}

/** Build a multiset (bag) of section types from a plan. */
function sectionBag(entry: UniquenessEntry): Map<string, number> {
  const bag = new Map<string, number>();
  for (const s of entry.plan.sections) {
    bag.set(s.type, (bag.get(s.type) ?? 0) + 1);
  }
  return bag;
}

/**
 * Jaccard similarity of section-type multisets.
 *   |A ∩ B| / |A ∪ B|  where sizes are sum-of-min / sum-of-max per type.
 */
function jaccardSections(a: UniquenessEntry, b: UniquenessEntry): number {
  const bagA = sectionBag(a);
  const bagB = sectionBag(b);
  const allTypes = new Set([...bagA.keys(), ...bagB.keys()]);
  let intersect = 0;
  let union = 0;
  for (const t of allTypes) {
    const ca = bagA.get(t) ?? 0;
    const cb = bagB.get(t) ?? 0;
    intersect += Math.min(ca, cb);
    union += Math.max(ca, cb);
  }
  if (union === 0) return 0;
  return intersect / union;
}

/** Return the list of section types that both sites share (for the label). */
function sharedSectionTypes(a: UniquenessEntry, b: UniquenessEntry): string[] {
  const typesA = new Set(a.plan.sections.map((s) => s.type));
  const typesB = new Set(b.plan.sections.map((s) => s.type));
  return [...typesA].filter((t) => typesB.has(t));
}

/**
 * Compute the weighted similarity score [0, 1] between two entries, and
 * collect the human-readable labels for traits that are "meaningfully shared"
 * (similarity ≥ 0.6 on that dimension).
 */
function pairSimilarity(
  a: UniquenessEntry,
  b: UniquenessEntry,
): { similarity: number; sharedTraits: string[] } {
  let total = 0;
  const sharedTraits: string[] = [];
  for (const dim of DIMENSIONS) {
    const sim = dim.similarity(a, b);
    total += sim * dim.weight;
    if (sim >= 0.6) {
      sharedTraits.push(dim.label(a, b));
    }
  }
  return { similarity: total, sharedTraits };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score the distinctiveness of every site relative to all others in the batch.
 *
 * @param entries - Array of { slug, ad, plan } objects (one per site).
 * @returns A Map from slug to { score: number (0-100), nearest: NearestNeighbor }.
 *
 * Edge cases:
 *   - 0 entries → empty Map.
 *   - 1 entry  → score 100 (no peers to be similar to); nearest = self with no sharedTraits.
 */
export function scoreUniqueness(
  entries: UniquenessEntry[],
): Map<string, UniquenessResult> {
  const result = new Map<string, UniquenessResult>();

  if (entries.length === 0) return result;

  // Single-site case: trivially unique.
  if (entries.length === 1) {
    const e = entries[0];
    result.set(e.slug, {
      score: 100,
      nearest: { slug: e.slug, sharedTraits: [] },
    });
    return result;
  }

  for (const entry of entries) {
    let maxSim = -1;
    let nearestSlug = '';
    let nearestTraits: string[] = [];

    for (const other of entries) {
      if (other.slug === entry.slug) continue;
      const { similarity, sharedTraits } = pairSimilarity(entry, other);
      if (similarity > maxSim) {
        maxSim = similarity;
        nearestSlug = other.slug;
        nearestTraits = sharedTraits;
      }
    }

    // Distinctiveness = inverse of maximum similarity, scaled 0-100.
    // A site that is 100% similar to its nearest neighbor scores 0.
    // A site with 0% similarity scores 100.
    const score = Math.round((1 - maxSim) * 100);

    result.set(entry.slug, {
      score,
      nearest: { slug: nearestSlug, sharedTraits: nearestTraits },
    });
  }

  return result;
}
