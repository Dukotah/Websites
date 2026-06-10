/**
 * Composition engine — deterministic, data-gated page assembly (spec §8).
 *
 * composePage(config, ad) → { hero: HeroVariant, sections: Section[] }
 *
 * Key rules:
 *   - Data-gated: a section is only added if real data exists for it.
 *   - Deterministic: all ordering jitter uses ad.seed; same config → same page.
 *   - Distinct silhouette: recipes differ by category; within swap-safe groups
 *     seeds create variety so two same-category sites differ.
 *   - Backward compatible: config.sections (if authored) are respected; the
 *     engine only fills hero + connective tissue around them.
 */

import type { ProspectConfig, Section, SectionType } from '../types';
import type { ArtDirection } from './art-direction';
import type { HeroVariant, Tone } from '../types';
import { pick, shuffle } from './seed';
import { assignVariants } from './variants';
import { inferCategory } from './art-direction';
import { serviceCtaFor } from './labels';

/**
 * Resolve the CTA href for a service card. Prefer an explicit booking URL; for a
 * "Call …" CTA with a phone on file use tel:; otherwise the on-page #contact
 * anchor (which now hosts a real contact form).
 */
function serviceCtaHref(config: ProspectConfig, label: string): string {
  if (config.bookingUrl?.trim()) return config.bookingUrl.trim();
  const phone = config.contact?.phone?.trim();
  if (phone && /\bcall\b/i.test(label)) return `tel:${phone.replace(/[^+\d]/g, '')}`;
  return '#contact';
}

/**
 * Extended section type identifier that includes 'about' — used only in the
 * recipe ordering. 'about' is handled as a connective component (not a Section
 * union member) and is skipped by instantiateSection.
 */
type RecipeSectionType = SectionType | 'about';

// ─────────────────────────────────────────────────────────────────────────────
// Inventory — what real data does this config provide?
// ─────────────────────────────────────────────────────────────────────────────

export interface DataInventory {
  hasHeroImage: boolean;
  heroIsReal: boolean; // not under /images/library/
  imageCount: number;  // total real images (hero + gallery)
  hasAbout: boolean;
  hasServices: boolean;
  hasServicesWithDesc: boolean; // at least one service with a real description
  hasHighlights: boolean;
  hasHours: boolean;
  hasPhone: boolean;
  hasAddress: boolean;
  hasTestimonials: boolean;
  hasFaq: boolean;
  hasStats: boolean;
  hasGallery: boolean; // ≥3 real images
  hasFeatureSplit: boolean; // ≥1 service with description + image
  hasTimeline: boolean;
  hasMenu: boolean;
  hasTeam: boolean;
  hasMap: boolean;
  hasPress: boolean;
  hasBigQuote: boolean;
  hasServicesDetailed: boolean;
  hasServiceArea: boolean;
  hasHoursContact: boolean;
  hasProcess: boolean;
  hasLogos: boolean;
  hasBeforeAfter: boolean;
  hasFeatureGrid: boolean;
}

/** Detect which sections CAN exist based on real data in config. */
export function detectAvailableData(config: ProspectConfig): DataInventory {
  const heroSrc = config.images?.hero ?? '';
  const hasHeroImage = Boolean(heroSrc && heroSrc !== '/images/library/placeholder.svg');
  const heroIsReal = hasHeroImage && !heroSrc.includes('/images/library/');

  const galleryImages = config.galleryImages ?? [];
  const realImageCount =
    (heroIsReal ? 1 : 0) +
    (config.images?.story && !config.images.story.includes('/images/library/') ? 1 : 0) +
    galleryImages.length;

  const services = config.services ?? [];
  const hasServicesWithDesc = services.some(
    (s) =>
      s.description &&
      s.description.trim().length > 20 &&
      !/professional \w+ for \w+ and nearby/i.test(s.description),
  );

  const sections = config.sections ?? [];
  const findSection = (type: SectionType) => sections.find((s) => s.type === type);

  const testimonialSection = findSection('testimonials') as
    | ({ type: 'testimonials'; items: { quote: string; author: string }[] } & object)
    | undefined;
  const faqSection = findSection('faq') as
    | ({ type: 'faq'; items: { q: string; a: string }[] } & object)
    | undefined;
  const statsSection = findSection('stats') as
    | ({ type: 'stats'; items: { value: string; label: string }[] } & object)
    | undefined;

  const hasMenu = Boolean(findSection('menu'));
  const hasTeam = Boolean(findSection('team'));
  const hasPress = Boolean(findSection('press'));
  const hasBeforeAfter = Boolean(findSection('before-after'));
  const hasLogos = Boolean(findSection('logos'));
  const hasProcess = Boolean(findSection('process'));
  const hasTimeline = Boolean(
    findSection('timeline') || (config.established && config.established.trim()),
  );

  const hours = config.hours ?? [];
  const hasHours = hours.length > 0;
  const hasPhone = Boolean(config.contact?.phone?.trim());
  const hasAddress = Boolean(config.contact?.address?.trim());

  const highlights = config.highlights ?? [];

  // service-area: services/about mention multiple towns, or config has a list
  const aboutBody = (config.about?.body ?? []).join(' ');
  const serviceArea = findSection('service-area') as
    | ({ type: 'service-area'; areas: string[] } & object)
    | undefined;
  const hasServiceArea = Boolean(
    serviceArea || (config.area && config.area.includes(',')) || aboutBody.match(/\b(and|serving)\b.+(area|county)/i),
  );

  // bigquote: strong testimonial or a distinctive tagline
  const testimonials =
    (testimonialSection as any)?.items ?? ([] as { quote: string; author: string }[]);
  const hasBigQuote = Boolean(
    testimonials.some((t: { quote: string }) => t.quote && t.quote.length > 60) ||
      (config.tagline && config.tagline.length > 40),
  );

  return {
    hasHeroImage,
    heroIsReal,
    imageCount: realImageCount,
    hasAbout: Boolean(config.about?.body?.length),
    hasServices: services.length > 0,
    hasServicesWithDesc,
    hasHighlights: highlights.length > 0,
    hasHours,
    hasPhone,
    hasAddress,
    hasTestimonials: Boolean(testimonialSection && (testimonialSection as any).items?.length > 0),
    hasFaq: Boolean(faqSection && (faqSection as any).items?.length > 0),
    hasStats: Boolean(statsSection && (statsSection as any).items?.length > 0),
    hasGallery: galleryImages.length >= 3 || realImageCount >= 3,
    hasFeatureSplit:
      services.some((s) => s.description && s.description.length > 30) && realImageCount >= 1,
    hasTimeline,
    hasMenu,
    hasTeam,
    hasMap: hasAddress,
    hasPress,
    hasBigQuote,
    hasServicesDetailed: hasServicesWithDesc,
    hasServiceArea,
    hasHoursContact: hasHours || hasPhone,
    hasProcess,
    hasLogos,
    hasBeforeAfter,
    hasFeatureGrid: highlights.length >= 3 || services.length >= 3,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipes — per-category preferred section order (spec §8.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface Recipe {
  heroVariant: HeroVariant;
  sectionOrder: RecipeSectionType[];
}

export const RECIPES: Record<string, Recipe> = {
  winery: {
    heroVariant: 'cinematic',
    sectionOrder: [
      'about', 'gallery', 'bigquote', 'menu', 'feature-split',
      'stats', 'testimonials', 'map', 'cta',
    ],
  },
  cafe: {
    heroVariant: 'collage',
    sectionOrder: [
      'about', 'menu', 'gallery', 'feature-grid', 'testimonials',
      'hours-contact', 'map', 'cta',
    ],
  },
  towing: {
    heroVariant: 'panel',
    sectionOrder: [
      'feature-grid', 'services-detailed', 'stats', 'service-area',
      'testimonials', 'process', 'hours-contact', 'cta',
    ],
  },
  plumbing: {
    heroVariant: 'split',
    sectionOrder: [
      'services-detailed', 'feature-grid', 'process', 'stats',
      'service-area', 'testimonials', 'faq', 'hours-contact', 'cta',
    ],
  },
  'auto-repair': {
    heroVariant: 'split',
    sectionOrder: [
      'services-detailed', 'stats', 'before-after', 'feature-grid',
      'testimonials', 'logos', 'faq', 'hours-contact', 'cta',
    ],
  },
  salon: {
    heroVariant: 'editorial',
    sectionOrder: [
      'about', 'gallery', 'services-detailed', 'bigquote',
      'team', 'testimonials', 'hours-contact', 'cta',
    ],
  },
  landscaping: {
    heroVariant: 'cinematic',
    sectionOrder: [
      'feature-split', 'before-after', 'gallery', 'stats',
      'process', 'testimonials', 'service-area', 'cta',
    ],
  },
  tattoo: {
    heroVariant: 'editorial',
    sectionOrder: [
      'about', 'gallery', 'services-detailed', 'bigquote',
      'team', 'testimonials', 'faq', 'hours-contact', 'cta',
    ],
  },
  default: {
    heroVariant: 'split',
    sectionOrder: [
      'about', 'feature-grid', 'services-detailed', 'stats',
      'testimonials', 'gallery', 'faq', 'hours-contact', 'cta',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hero selection
// ─────────────────────────────────────────────────────────────────────────────

/** Choose the hero variant based on available media and art direction. */
export function pickHero(
  ad: ArtDirection,
  inventory: DataInventory,
  seed: number,
): HeroVariant {
  // Config pin wins
  // (caller checks config.heroVariant before calling this)

  const { imageCount, heroIsReal } = inventory;

  if (imageCount >= 2) {
    // Favor the full-bleed cinematic hero — a strong real photo deserves the
    // whole stage (a split panel chops the money shot in half).
    return pick(seed ^ 0x3f4a8b1c, ['cinematic', 'cinematic', 'split', 'collage'] as const);
  }
  if (heroIsReal) {
    // One strong photo: cinematic/split, or the type-dominant asymmetric split
    // (wide display column beside a narrow tight crop) — the editorial move.
    return pick(seed ^ 0x7e2c9d44, ['cinematic', 'split', 'editorial-asym'] as const);
  }
  // No real photo (missing or stock art) — text-forward variants that look
  // intentional rather than stretching a flat stock SVG full-bleed. The
  // typographic-fill hero (type IS the hero) is the strongest of these.
  const isEditorial = ['editorial', 'boutique-contrast', 'classic-trad'].includes(ad.fontId);
  if (isEditorial) {
    return pick(seed ^ 0x1a2b3c4d, ['typographic', 'editorial', 'statement', 'panel'] as const);
  }
  return pick(seed ^ 0x9f8e7d6c, ['typographic', 'panel', 'editorial'] as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section instantiation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a logical section type to a concrete Section object from config data.
 * Returns null if there is truly no real data to populate the section.
 */
function instantiateSection(type: RecipeSectionType, config: ProspectConfig): Section | null {
  switch (type) {
    case 'about': {
      // 'about' is handled as a connective component, not a Section union member —
      // return null here so the composition only includes typed section union members.
      return null;
    }

    case 'feature-grid': {
      const highlights = config.highlights ?? [];
      const services = config.services ?? [];
      const items: { label: string; note?: string; icon?: string }[] = [];
      for (const h of highlights) {
        if (h.trim()) items.push({ label: h });
      }
      if (items.length < 3) {
        for (const s of services.slice(0, 6 - items.length)) {
          items.push({ label: s.title });
        }
      }
      if (items.length < 3) return null;
      return { type: 'feature-grid', items };
    }

    case 'services-detailed': {
      const category = inferCategory(config);
      const defaultCta = serviceCtaFor(category);
      const items = (config.services ?? [])
        .filter((s) => s.description && s.description.trim().length > 20)
        .map((s) => {
          const cta = s.cta?.trim() || defaultCta;
          return {
            title: s.title,
            description: s.description,
            image: s.image,
            cta,
            ctaHref: serviceCtaHref(config, cta),
          };
        });
      if (!items.length) return null;
      return { type: 'services-detailed', items };
    }

    case 'stats': {
      const existing = (config.sections ?? []).find((s) => s.type === 'stats') as
        | ({ type: 'stats'; items: { value: string; label: string }[] } & object)
        | undefined;
      if (existing && (existing as any).items?.length) return existing;
      return null;
    }

    case 'testimonials': {
      const existing = (config.sections ?? []).find((s) => s.type === 'testimonials');
      if (existing) return existing;
      return null;
    }

    case 'faq': {
      const existing = (config.sections ?? []).find((s) => s.type === 'faq');
      if (existing) return existing;
      return null;
    }

    case 'gallery': {
      const galleryImages = config.galleryImages ?? [];
      if (galleryImages.length < 3) return null;
      const images = galleryImages.map((img) => ({ src: img.src, alt: img.alt }));
      return { type: 'gallery', images };
    }

    case 'feature-split': {
      const services = (config.services ?? []).filter(
        (s) => s.description && s.description.trim().length > 30,
      );
      if (!services.length) return null;
      const storySrc = config.images?.story ?? '';
      const storyAlt = config.images?.storyAlt ?? '';
      const rows = services.slice(0, 4).map((s, i) => ({
        heading: s.title,
        body: s.description,
        ...(i === 0 && storySrc ? { image: storySrc, imageAlt: storyAlt } : {}),
      }));
      return { type: 'feature-split', rows };
    }

    case 'bigquote': {
      const testimonials = (config.sections ?? []).find((s) => s.type === 'testimonials') as
        | ({ type: 'testimonials'; items: { quote: string; author: string }[] } & object)
        | undefined;
      const long = (testimonials as any)?.items?.find(
        (t: { quote: string }) => t.quote && t.quote.length > 60,
      );
      if (long) {
        return {
          type: 'bigquote',
          quote: long.quote,
          author: long.author,
        };
      }
      if (config.tagline && config.tagline.length > 40) {
        return { type: 'bigquote', quote: config.tagline };
      }
      return null;
    }

    case 'menu': {
      const existing = (config.sections ?? []).find((s) => s.type === 'menu');
      if (existing) return existing;
      return null;
    }

    case 'team': {
      const existing = (config.sections ?? []).find((s) => s.type === 'team');
      if (existing) return existing;
      return null;
    }

    case 'map': {
      const address = config.contact?.address ?? '';
      if (!address.trim()) return null;
      const hoursSec = (config.sections ?? []).find((s) => s.type === 'hours-contact') as any;
      return {
        type: 'map',
        address,
        hours: hoursSec?.hours ?? config.hours,
      };
    }

    case 'press': {
      const existing = (config.sections ?? []).find((s) => s.type === 'press');
      if (existing) return existing;
      return null;
    }

    case 'timeline': {
      const existing = (config.sections ?? []).find((s) => s.type === 'timeline');
      if (existing) return existing;
      if (config.established && config.established.trim()) {
        const year = config.established.replace(/^est\.?\s*/i, '').trim();
        return {
          type: 'timeline',
          items: [{ year, title: `${config.name ?? 'We'} opened our doors`, body: '' }],
        };
      }
      return null;
    }

    case 'service-area': {
      const existing = (config.sections ?? []).find((s) => s.type === 'service-area');
      if (existing) return existing;
      if (config.area && config.area.includes(',')) {
        const areas = config.area.split(',').map((a) => a.trim()).filter(Boolean);
        if (areas.length >= 2) return { type: 'service-area', areas };
      }
      return null;
    }

    case 'hours-contact': {
      const hours = config.hours ?? [];
      const phone = config.contact?.phone ?? '';
      if (!hours.length && !phone.trim()) return null;
      return {
        type: 'hours-contact',
        hours,
        phone: phone || undefined,
        cta: config.hero?.ctaHref
          ? { text: config.hero.ctaText ?? 'Contact us', href: config.hero.ctaHref }
          : undefined,
      };
    }

    case 'process': {
      const existing = (config.sections ?? []).find((s) => s.type === 'process');
      if (existing) return existing;
      return null;
    }

    case 'logos': {
      const existing = (config.sections ?? []).find((s) => s.type === 'logos');
      if (existing) return existing;
      return null;
    }

    case 'before-after': {
      const existing = (config.sections ?? []).find((s) => s.type === 'before-after');
      if (existing) return existing;
      return null;
    }

    case 'cta': {
      // Always generate a CTA from config
      const existing = (config.sections ?? []).find((s) => s.type === 'cta');
      if (existing) return existing;
      return {
        type: 'cta',
        heading: config.hero?.ctaText
          ? `Ready? ${config.hero.ctaText}`
          : `Get in touch with ${config.name ?? 'us'}`,
        buttonText: config.hero?.ctaText ?? 'Contact Us',
        buttonHref: config.hero?.ctaHref ?? `mailto:${config.contact?.email ?? ''}`,
      };
    }

    case 'list': {
      const existing = (config.sections ?? []).find((s) => s.type === 'list');
      if (existing) return existing;
      return null;
    }

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tone assignment
// ─────────────────────────────────────────────────────────────────────────────

const TONE_CYCLE: Tone[] = ['default', 'alt', 'default', 'deep', 'default', 'alt', 'brand'];

// ─────────────────────────────────────────────────────────────────────────────
// Rating injection — surface real Google review data in the stats rail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When the business has a real rating (reviewCount > 0), replace one cell of an
 * existing stats section with a "4.8 ★ / 128 Google reviews" trust stat. Only
 * touches an authored stats section — never fabricates one — and only when the
 * rating is genuine, mirroring the no-fake-reviews rule for testimonials.
 */
function withRatingStat(sections: Section[], config: ProspectConfig): Section[] {
  const rating = config.rating;
  if (!rating || !(rating.count > 0) || !(rating.value > 0)) return sections;

  const ratingCell = {
    value: `${rating.value} ★`,
    label: `${rating.count} Google review${rating.count === 1 ? '' : 's'}`,
  };

  let injected = false;
  return sections.map((section) => {
    if (injected || section.type !== 'stats') return section;
    const items = (section as Extract<Section, { type: 'stats' }>).items ?? [];
    if (items.length === 0) return section;
    injected = true;
    // Replace the LAST flavor cell so the rail keeps its column count; if there's
    // only one cell, prepend instead so we don't lose the existing stat.
    const next =
      items.length >= 2
        ? [...items.slice(0, -1), ratingCell]
        : [ratingCell, ...items];
    return { ...section, items: next };
  });
}

/**
 * CRO: Insert a CTA immediately after any `testimonials` section that is not
 * already followed by one. Captures lead intent at the credibility peak rather
 * than letting momentum dissipate to the page footer.
 *
 * Rules (avoids adjacent-duplicate CTAs):
 *   - Only acts when `testimonials` appears in the list.
 *   - Skips the insertion if the section immediately following `testimonials`
 *     is already a `cta` (authored or previously appended).
 *   - The mid-page CTA is distinct from the closing CTA; both may coexist on
 *     the page — they are separated by at least one non-CTA section.
 *   - Only inserts when `instantiateSection('cta', config)` returns a real
 *     section (defensive null-guard, though `cta` is always satisfiable).
 */
function insertCtaAfterTestimonials(sections: Section[], config: ProspectConfig): Section[] {
  const testimonialsIdx = sections.findIndex((s) => s.type === 'testimonials');
  if (testimonialsIdx === -1) return sections;

  const afterIdx = testimonialsIdx + 1;
  // Already a CTA immediately after testimonials — nothing to do.
  if (afterIdx < sections.length && sections[afterIdx].type === 'cta') return sections;

  const midCta = instantiateSection('cta', config);
  if (!midCta) return sections;

  const result = [...sections];
  result.splice(afterIdx, 0, midCta);
  return result;
}

function assignTones(sections: Section[], seed: number): Section[] {
  // jitter the starting index so two slugs don't start on the same tone
  const offset = seed % TONE_CYCLE.length;
  return sections.map((section, i) => ({
    ...section,
    tone: (section as any).tone ?? TONE_CYCLE[(i + offset) % TONE_CYCLE.length],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimum section guarantee
// ─────────────────────────────────────────────────────────────────────────────

function ensureMinimum(sections: Section[], config: ProspectConfig, seed: number): Section[] {
  if (sections.length >= 3) return sections;

  // Backfill with always-possible sections
  const existing = new Set(sections.map((s) => s.type));
  const backfill: Section[] = [];

  if (!existing.has('feature-grid')) {
    const fg = instantiateSection('feature-grid', config);
    if (fg) backfill.push(fg);
  }
  if (!existing.has('cta')) {
    const cta = instantiateSection('cta', config);
    if (cta) backfill.push(cta);
  }
  if (!existing.has('hours-contact') && !existing.has('map')) {
    const hc = instantiateSection('hours-contact', config);
    if (hc) backfill.push(hc);
  }

  return [...sections, ...backfill];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface PagePlan {
  hero: HeroVariant;
  sections: Section[];
}

/**
 * Compose a page plan for a prospect config + resolved art direction.
 * Deterministic: same inputs → same output across builds.
 */
export function composePage(config: ProspectConfig, ad: ArtDirection): PagePlan {
  const seed = ad.seed;
  const inventory = detectAvailableData(config);

  // Hero
  const hero: HeroVariant =
    config.heroVariant ?? pickHero(ad, inventory, seed);

  // SINGLE STRUCTURE OWNER: when the config carries a sections array, the
  // GENERATOR (scripts/generate-prospects.mjs) has already decided the page's
  // full, hard-gated, ordered structure — including the photo service grid,
  // gallery, feature bands, mid/closing CTAs. The composer no longer injects or
  // reorders sections at render time (that render-time improvisation was the root
  // architectural defect). It only:
  //   (a) guarantees a closing CTA as a safety net for hand-authored configs that
  //       omit one, then
  //   (b) applies purely PRESENTATIONAL passes — real-rating stat swap,
  //       alternating surface tones, and deterministic layout variants.
  // What you see in the JSON is what renders.
  if (config.sections && config.sections.length > 0) {
    const authored = [...config.sections];
    const withClosingCta = authored.some((s) => s.type === 'cta')
      ? authored
      : ([...authored, instantiateSection('cta', config)].filter(Boolean) as Section[]);
    return {
      hero,
      sections: assignVariants(
        assignTones(withRatingStat(ensureMinimum(withClosingCta, config, seed), config), seed),
        seed,
        ad.category,
      ),
    };
  }

  // Recipe-driven assembly
  const recipe = RECIPES[ad.category] ?? RECIPES.default;
  const order = recipe.sectionOrder;

  // Within swap-safe groups (middle sections, not first/last), apply seeded shuffle jitter.
  // First 2 and last 2 are anchored; middle is shuffled.
  const anchorStart = order.slice(0, 2);
  const anchorEnd = order.slice(-2);
  const middle = order.slice(2, -2);
  const shuffledMiddle = shuffle(seed ^ 0xa3b8c9d1, middle);
  const orderedTypes = [...anchorStart, ...shuffledMiddle, ...anchorEnd];

  const sections: Section[] = [];
  const used = new Set<RecipeSectionType>();

  for (const type of orderedTypes) {
    if (used.has(type)) continue;
    // Data gate
    if (!inventorySupports(type, inventory)) continue;
    const section = instantiateSection(type, config);
    if (section) {
      sections.push(section);
      used.add(type);
    }
  }

  // CRO: insert a mid-page CTA immediately after testimonials (credibility peak).
  const sectionsWithMidCta = insertCtaAfterTestimonials(sections, config);

  return {
    hero,
    sections: assignVariants(
      assignTones(withRatingStat(ensureMinimum(sectionsWithMidCta, config, seed), config), seed),
      seed,
      ad.category,
    ),
  };
}

/** Check if the inventory has real data to support a section type. */
function inventorySupports(type: RecipeSectionType, inv: DataInventory): boolean {
  switch (type) {
    case 'about': return inv.hasAbout;
    case 'gallery': return inv.hasGallery;
    case 'feature-split': return inv.hasFeatureSplit;
    case 'feature-grid': return inv.hasFeatureGrid;
    case 'services-detailed': return inv.hasServicesDetailed;
    case 'stats': return inv.hasStats;
    case 'testimonials': return inv.hasTestimonials;
    case 'faq': return inv.hasFaq;
    case 'bigquote': return inv.hasBigQuote;
    case 'menu': return inv.hasMenu;
    case 'team': return inv.hasTeam;
    case 'map': return inv.hasMap;
    case 'press': return inv.hasPress;
    case 'timeline': return inv.hasTimeline;
    case 'service-area': return inv.hasServiceArea;
    case 'hours-contact': return inv.hasHoursContact;
    case 'process': return inv.hasProcess;
    case 'logos': return inv.hasLogos;
    case 'before-after': return inv.hasBeforeAfter;
    case 'cta': return true; // always available
    case 'list': return false; // only from authored config
    default: return false;
  }
}
