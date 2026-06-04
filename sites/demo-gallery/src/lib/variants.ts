/**
 * Section layout variants — the "better samples" pool (spec §8 extension).
 *
 * Each section TYPE can have several rendered LAYOUTS (e.g. services as a photo
 * card grid OR an editorial numbered-row list). SECTION_VARIANTS records how
 * many a type has; assignVariants() picks one per section deterministically from
 * the slug seed, so two same-category prospects diverge instead of sharing one
 * fixed skeleton. SectionRenderer.astro holds the type→[components] arrays and
 * must stay length-aligned with the counts here (a higher count just wraps via
 * modulo, never errors).
 */

import type { Section, SectionType } from '../types';
import { pick } from './seed';

/** Number of rendered variants per section type (index 0 = the original). */
export const SECTION_VARIANTS: Partial<Record<SectionType, number>> = {
  'services-detailed': 3, // [card-grid, editorial-rows, bento]
  gallery: 3, // [masonry, uniform-grid, filmstrip]
  testimonials: 2, // [cards, spotlight]
  'feature-split': 2, // [alternating-zigzag, framed-cards]
  'feature-grid': 2, // [tiles, bordered-spec-sheet]
  stats: 3, // [default, KPI-band, inline-ribbon]
  cta: 2, // [centered, asymmetric-panel]
};

/**
 * Stable per-type salt so each section type's variant is chosen independently —
 * otherwise every variant-enabled section on a page would move together.
 */
const TYPE_SALT: Partial<Record<SectionType, number>> = {
  'services-detailed': 0x5d1e3a7f,
  gallery: 0x1b9a4c2d,
  testimonials: 0x73c6e519,
  'feature-split': 0x2f8b1d44,
  'feature-grid': 0x6c1f9ab2,
  stats: 0x9a3e7c11,
  cta: 0x46d2b8e3,
};

/**
 * Per-category bias for which variant a section type tends to get — weight per
 * variant index (length must equal SECTION_VARIANTS[type] or it's ignored).
 * Missing entry → uniform. This lets utility trades lean sturdy/structured and
 * editorial businesses lean refined/magazine, instead of every site coin-flipping
 * the same way. Still deterministic per slug (seeded).
 */
const VARIANT_WEIGHTS: Record<string, Partial<Record<SectionType, number[]>>> = {
  // ── utility / trades — structured, bold, spec-sheet ──────────────────────
  towing: { 'services-detailed': [3, 2, 1], stats: [1, 3, 1], 'feature-grid': [1, 3] },
  plumbing: { 'services-detailed': [3, 2, 1], stats: [1, 3, 1], 'feature-grid': [1, 3] },
  'auto-repair': { 'services-detailed': [3, 2, 1], stats: [1, 3, 1], 'feature-grid': [1, 3] },
  marina: { 'services-detailed': [2, 3, 1], stats: [1, 2, 2], 'feature-grid': [1, 2] },
  // ── editorial — refined, magazine, gallery-forward ───────────────────────
  winery: { 'services-detailed': [1, 2, 3], gallery: [3, 1, 2], stats: [2, 1, 3], 'feature-grid': [2, 1] },
  salon: { 'services-detailed': [1, 2, 3], gallery: [3, 1, 2], stats: [2, 1, 3], 'feature-grid': [2, 1] },
  cafe: { 'services-detailed': [1, 2, 3], gallery: [2, 2, 3], stats: [2, 1, 3], 'feature-grid': [2, 1] },
  tattoo: { 'services-detailed': [1, 2, 3], gallery: [2, 1, 3], stats: [2, 1, 3], 'feature-grid': [2, 1] },
  landscaping: { 'services-detailed': [2, 2, 2], gallery: [3, 1, 2], stats: [1, 2, 2], 'feature-grid': [2, 1] },
};

/** Expand a weight array into a selection pool (e.g. [3,2,1] → 0,0,0,1,1,2). */
function weightedPool(weights: number[]): number[] {
  const pool: number[] = [];
  weights.forEach((w, i) => {
    for (let k = 0; k < Math.max(0, Math.round(w)); k++) pool.push(i);
  });
  return pool;
}

/**
 * Assign a deterministic variant index to every section that supports variants.
 * Biased by `category` when weights exist; respects an authored `variant` pin.
 */
export function assignVariants(sections: Section[], seed: number, category?: string): Section[] {
  return sections.map((s) => {
    const count = SECTION_VARIANTS[s.type];
    if (!count || count < 2 || s.variant != null) return s;
    const salt = TYPE_SALT[s.type] ?? 0;
    const weights = category ? VARIANT_WEIGHTS[category]?.[s.type] : undefined;
    const pool =
      weights && weights.length === count
        ? weightedPool(weights)
        : Array.from({ length: count }, (_, i) => i);
    const variant = pick(seed ^ salt, pool.length ? pool : [0]);
    return { ...s, variant };
  });
}
