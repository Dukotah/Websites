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
  'services-detailed': 2, // [card-grid, editorial-rows]
  gallery: 2, // [masonry, uniform-grid]
  testimonials: 2, // [cards, spotlight]
  'feature-split': 2, // [alternating-zigzag, framed-cards]
  stats: 2, // [default, KPI-band]
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
  stats: 0x9a3e7c11,
  cta: 0x46d2b8e3,
};

/**
 * Assign a deterministic variant index to every section that supports variants.
 * Respects an authored `variant` if the config already pinned one.
 */
export function assignVariants(sections: Section[], seed: number): Section[] {
  return sections.map((s) => {
    const count = SECTION_VARIANTS[s.type];
    if (!count || count < 2 || s.variant != null) return s;
    const salt = TYPE_SALT[s.type] ?? 0;
    const variant = pick(
      seed ^ salt,
      Array.from({ length: count }, (_, i) => i),
    );
    return { ...s, variant };
  });
}
