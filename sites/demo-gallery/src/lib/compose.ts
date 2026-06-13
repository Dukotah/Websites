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
import type { ArtDirection, Archetype } from './art-direction';
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
      'feature-grid', 'services-detailed', 'stats', 'gallery', 'service-area',
      'testimonials', 'process', 'hours-contact', 'cta',
    ],
  },
  plumbing: {
    heroVariant: 'split',
    sectionOrder: [
      'services-detailed', 'feature-grid', 'process', 'stats', 'gallery',
      'service-area', 'testimonials', 'faq', 'hours-contact', 'cta',
    ],
  },
  'auto-repair': {
    heroVariant: 'split',
    sectionOrder: [
      'services-detailed', 'stats', 'before-after', 'feature-grid', 'gallery',
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

  // 'side'-tier photos are only medium-res — a full-bleed `cinematic`/`spotlight`
  // hero would upscale them blurry. For these, show the photo in a side-column
  // hero (split / editorial-asym / feature-stat / collage) where it renders
  // smaller (contained card / column) and stays sharp.
  const sideTier = ad.heroPhotoTier === 'side';

  // The two new variants (mined from Fulldev UI) are added to the union by the
  // wiring phase (types.ts HeroVariant + HeroRenderer). Cast their literals so
  // this selector stays build-safe regardless of when the union lands:
  //   - 'spotlight'    full-bleed photo + opaque boxed content card (full-bleed
  //                    only — keep it OUT of the 'side' rotation, like cinematic)
  //   - 'feature-stat' offset image CARD + stat strip (contained image → safe on
  //                    any tier, including 'side')
  const SPOTLIGHT = 'spotlight' as HeroVariant;
  const FEATURE_STAT = 'feature-stat' as HeroVariant;

  if (imageCount >= 2) {
    // Favor the full-bleed cinematic/spotlight heroes — a strong real photo
    // deserves the whole stage (a split panel chops the money shot in half) —
    // UNLESS the photo is only 'side'-tier, where a side-column hero (incl. the
    // contained feature-stat card) keeps it sharp.
    if (sideTier) {
      return pick(seed ^ 0x3f4a8b1c, ['split', 'editorial-asym', FEATURE_STAT, 'collage'] as const);
    }
    return pick(seed ^ 0x3f4a8b1c, ['cinematic', SPOTLIGHT, 'split', 'collage'] as const);
  }
  if (heroIsReal) {
    // One strong photo: cinematic/spotlight/split, the type-dominant asymmetric
    // split, or the offset-image-plus-stats feature-stat — the editorial moves.
    // For a 'side'-tier photo, drop the full-bleed variants and keep the
    // side-column / contained-card heroes.
    if (sideTier) {
      return pick(seed ^ 0x7e2c9d44, ['split', 'editorial-asym', FEATURE_STAT] as const);
    }
    return pick(seed ^ 0x7e2c9d44, ['cinematic', SPOTLIGHT, 'split', 'editorial-asym', FEATURE_STAT] as const);
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
 * Final guarantee that NO section type renders more than once. Previously a
 * "mid-page CTA after testimonials" was added on top of the closing CTA, so
 * every site with testimonials shipped TWO near-identical CTA banners (the
 * duplicate-section bug). The page is short enough that one strong closing CTA
 * is the right call; a mid-page nudge, if ever wanted, should be a visually
 * DISTINCT component, not a second copy of the same banner.
 *
 * Keeps the CLOSING cta (last occurrence) and the FIRST of every other type.
 */
/**
 * CRO: a slim mid-page conversion nudge at the credibility peak (right after
 * testimonials). Uses the distinct `cta-inline` type (a low-profile single-line
 * strip), NOT a second `cta` banner — so it can never read as a duplicate of the
 * closing CTA and `dedupeSections` keeps both (different types). Only added when
 * testimonials exist and the nudge won't sit adjacent to the closing CTA.
 */
function insertInlineCta(sections: Section[], config: ProspectConfig, category: string): Section[] {
  const tIdx = sections.findIndex((s) => s.type === 'testimonials');
  if (tIdx === -1) return sections; // no credibility peak → no mid-page nudge
  const afterIdx = tIdx + 1;
  if (afterIdx >= sections.length) return sections; // testimonials is last → skip
  const next = sections[afterIdx].type;
  if (next === 'cta' || next === 'cta-inline') return sections; // don't stack CTAs
  const label = serviceCtaFor(category);
  const inline: Section = {
    type: 'cta-inline',
    heading: 'Ready to get started?',
    buttonText: label,
    buttonHref: serviceCtaHref(config, label),
  };
  const out = [...sections];
  out.splice(afterIdx, 0, inline);
  return out;
}

/**
 * INVARIANT (the contract): a composed page renders AT MOST ONE section of each
 * type. This pass is the final, authoritative guarantee — every earlier stage
 * (recipe assembly, author-section injection, ensureMinimum, the inline-CTA
 * nudge) may propose sections freely; this is what makes "no duplicate sections"
 * actually true. audit.mjs independently re-checks the built HTML and FAILS the
 * build if any family is composed twice, so the contract is enforced on both ends.
 *
 * The only intentional "two CTAs" case is allowed because it is two DIFFERENT
 * types: the slim mid-page `cta-inline` nudge + the full closing `cta` banner.
 * For the repeatable `cta` type we keep the CLOSING one (last); for every other
 * type we keep the FIRST. Anything beyond that is dropped.
 */
function dedupeSections(sections: Section[]): Section[] {
  let lastCta = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].type === 'cta') { lastCta = i; break; }
  }
  // `feature-split` and `services-detailed` both render config.services — showing
  // both repeats the exact same services (with placeholder art on image-poor
  // sites). Keep only the richer services-detailed grid when both are present.
  const hasServicesGrid = sections.some((s) => s.type === 'services-detailed');
  const seen = new Set<string>();
  const out: Section[] = [];
  sections.forEach((s, i) => {
    if (s.type === 'cta') {
      if (i === lastCta) out.push(s);
      return;
    }
    if (s.type === 'feature-split' && hasServicesGrid) return; // redundant w/ services grid
    if (seen.has(s.type)) return; // drop a repeated non-cta section type
    seen.add(s.type);
    out.push(s);
  });
  return out;
}

/**
 * Contact.astro is hardcoded into every page (after the composed sections) and
 * already renders the canonical address + embedded map + hours table + contact
 * form. A `map` or `hours-contact` section therefore DUPLICATES it — that is the
 * "double map / triplicate hours" bug. Strip both from every plan (authored or
 * recipe-driven); the page's single source of truth for contact is Contact.astro.
 */
function dropCanonicalContactSections(sections: Section[]): Section[] {
  return sections.filter((s) => s.type !== 'map' && s.type !== 'hours-contact');
}

/**
 * Reorder authored sections to follow the category RECIPE's narrative (spec §8.2)
 * instead of the order the generator happened to emit them in. This reclaims the
 * per-category section order for generated sites (which always carry an authored
 * `config.sections`, so they otherwise never benefit from the recipe spine).
 *
 * Stable, loss-free: a section type the recipe doesn't list is treated as a body
 * content band and slotted just BEFORE the recipe's tail (faq/cta), not dumped
 * after it — otherwise a feature-split/gallery the recipe omits strands itself
 * below the FAQ, reading like footer debris. `cta` is always forced last.
 */
// Sections that belong at the END of the page, in this order. An unlisted body
// band must rank ahead of these so it lands in the narrative, not the footer.
const TAIL_TYPES: RecipeSectionType[] = ['faq', 'hours-contact', 'cta'];

function orderByRecipe(sections: Section[], recipeOrder: RecipeSectionType[]): Section[] {
  // Where the recipe's tail begins — unlisted body bands slot just before it.
  let firstTail = recipeOrder.findIndex((t) => TAIL_TYPES.includes(t));
  if (firstTail === -1) firstTail = recipeOrder.length;

  const rank = (type: string): number => {
    if (type === 'cta') return Number.MAX_SAFE_INTEGER;
    const i = recipeOrder.indexOf(type as RecipeSectionType);
    if (i !== -1) return i;
    // Unlisted type: if it's a tail kind keep it at the end, else treat as a body
    // band placed right before the recipe's tail (faq/cta).
    return TAIL_TYPES.includes(type as RecipeSectionType) ? recipeOrder.length : firstTail - 0.5;
  };
  return sections
    .map((s, i) => ({ s, i, r: rank(s.type) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Archetype rhythm — make the four page ARCHETYPES genuinely distinct page
 * SYSTEMS, not just a hero/max-width swap. After the category recipe has chosen
 * WHICH sections appear and their narrative order, this pass re-weights that
 * order per archetype so the page "bones" differ:
 *
 *   - magazine : gallery-forward — pull visual bands (gallery/feature-split/
 *                before-after) up toward the top so the page leads with imagery
 *                (the cover-story rhythm).
 *   - utility  : data-first — surface the trust/credibility bands (stats,
 *                feature-grid, services-detailed) ahead of softer story content
 *                so the dense conversion-focused spine reads first.
 *   - editorial: narrative chapters — lead with the story/about content and the
 *                chaptered MAJOR bands; keep accent bands (stats/logos) interleaved
 *                after, so the numbered chapters read as the spine.
 *   - classic  : unchanged — the balanced category-recipe order is the baseline.
 *
 * SAFETY: this is a pure, stable REORDER. It never adds, removes, duplicates, or
 * mutates sections, so every downstream guarantee still holds — dedupeSections,
 * dropCanonicalContactSections, and the closing-CTA-last rule all run afterwards.
 * The closing `cta` (and the slim `cta-inline` nudge, when present) are pinned to
 * the tail here too so a reorder can never float a CTA into the middle.
 */
// Section families each archetype wants to FRONT-LOAD, highest priority first.
const ARCHETYPE_LEAD: Record<Archetype, SectionType[]> = {
  magazine: ['gallery', 'feature-split', 'before-after', 'bigquote'],
  utility: ['stats', 'feature-grid', 'services-detailed', 'process'],
  editorial: ['bigquote', 'feature-split', 'gallery'],
  classic: [],
};

function applyArchetypeRhythm(sections: Section[], archetype: Archetype): Section[] {
  const lead = ARCHETYPE_LEAD[archetype] ?? [];
  if (!lead.length) return sections; // classic (and any unknown) keep recipe order

  // Tail families are pinned to the end regardless of archetype so a reorder can
  // never strand a CTA/FAQ mid-page (mirrors orderByRecipe's TAIL contract).
  const TAIL: SectionType[] = ['faq', 'cta-inline', 'cta'];

  const rank = (type: string): number => {
    const t = TAIL.indexOf(type as SectionType);
    if (t !== -1) return 1000 + t; // tail block, in TAIL order, always last
    const l = lead.indexOf(type as SectionType);
    if (l !== -1) return l; // front-loaded family, by archetype priority
    return 100; // body band — keeps its relative position between lead and tail
  };

  // Stable sort: equal ranks preserve the incoming (recipe) order, so we only
  // pull the lead families up and push the tail families down — everything else
  // floats in the middle exactly as the recipe arranged it.
  return sections
    .map((s, i) => ({ s, i, r: rank(s.type) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
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
  // NOTE: no hours-contact/map backfill — Contact.astro is the canonical contact
  // block (see dropCanonicalContactSections). A sparse page backfills with a
  // gallery instead, so it gains real media rather than a duplicate contact card.
  if (!existing.has('gallery')) {
    const g = instantiateSection('gallery', config);
    if (g) backfill.push(g);
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

  // If the config explicitly provides a sections array (author override), respect it.
  // The engine only adds hero + connective tissue (cta at min).
  if (config.sections && config.sections.length > 0) {
    // Drop map/hours-contact up front: Contact.astro already renders them, and
    // leaving them here is what produced the double-map / triplicate-hours pages.
    let authored = dropCanonicalContactSections([...config.sections]);
    // Every site gets a photo service-card grid (the bear-flag look) — inject one
    // from config.services if the author didn't include it.
    if (!authored.some((s) => s.type === 'services-detailed')) {
      const sd = instantiateSection('services-detailed', config);
      if (sd) authored = [authored[0], sd, ...authored.slice(1)];
    }
    // Show their REAL photos big — inject a gallery when we have ≥3 real images.
    if (!authored.some((s) => s.type === 'gallery')) {
      const g = instantiateSection('gallery', config);
      if (g) authored.splice(Math.min(2, authored.length), 0, g);
    }
    // No gallery (<3 real images) but a story photo + described services? Inject
    // ONE feature-split so 2-image sites get an editorial image band instead of a
    // blank gap between About and Services. Skipped if a feature-split is already
    // present (e.g. one the divergence pass added), so the two never double up.
    if (
      !authored.some((s) => s.type === 'gallery') &&
      !authored.some((s) => s.type === 'feature-split') &&
      inventory.hasFeatureSplit &&
      inventory.imageCount < 3
    ) {
      const fs = instantiateSection('feature-split', config);
      if (fs) authored.splice(Math.min(2, authored.length), 0, fs);
    }
    // Highlights band: generated configs never emit `feature-grid`, so the quick
    // "3 reasons to trust us" rail was missing on every page. Inject it when the
    // category recipe calls for one and the data (highlights/services) supports it.
    const recipe = RECIPES[ad.category] ?? RECIPES.default;
    if (
      recipe.sectionOrder.includes('feature-grid') &&
      !authored.some((s) => s.type === 'feature-grid')
    ) {
      const fg = instantiateSection('feature-grid', config);
      if (fg) authored.push(fg); // final position is set by orderByRecipe below
    }
    // Reclaim the category narrative: order the authored sections by the recipe
    // (and force the CTA last) rather than shipping the generator's emit order.
    authored = orderByRecipe(authored, recipe.sectionOrder);
    // Ensure CTA is present
    const hasCta = authored.some((s) => s.type === 'cta');
    const withTrailingCta = hasCta
      ? authored
      : ([...authored, instantiateSection('cta', config)].filter(Boolean) as Section[]);
    const planAuthored = insertInlineCta(withTrailingCta, config, ad.category);
    // Re-weight section order for the page archetype (gallery-forward magazine,
    // data-first utility, narrative editorial; classic keeps recipe order).
    const plan = applyArchetypeRhythm(planAuthored, ad.archetype);
    return {
      hero,
      sections: dedupeSections(
        dropCanonicalContactSections(
          assignVariants(
            assignTones(withRatingStat(ensureMinimum(plan, config, seed), config), seed),
            seed,
            ad.category,
          ),
        ),
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

  const planWithInline = insertInlineCta(sections, config, ad.category);
  // Re-weight section order for the page archetype (see applyArchetypeRhythm).
  const planRecipe = applyArchetypeRhythm(planWithInline, ad.archetype);
  return {
    hero,
    sections: dedupeSections(
      dropCanonicalContactSections(
        assignVariants(
          assignTones(withRatingStat(ensureMinimum(planRecipe, config, seed), config), seed),
          seed,
          ad.category,
        ),
      ),
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
