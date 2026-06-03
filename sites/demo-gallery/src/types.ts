/**
 * Prospect site config — the shape of every JSON file in src/data/prospects/.
 *
 * This is the SAME schema as a single site's `src/config.ts` in the template,
 * so anything the generator produces here can be lifted straight into a
 * standalone site when a prospect converts.
 */

export interface Service {
  title: string;
  description: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

/**
 * Surface tone for a section — chooses which background tokens it paints with so
 * adjacent sections alternate without the renderer hardcoding it (spec §6).
 */
export type Tone = 'default' | 'alt' | 'deep' | 'brand';

/** Horizontal alignment of a section's header block. */
export type Align = 'left' | 'center';

/**
 * Shared optional envelope every rich section accepts (spec §6). Type-specific
 * fields are added per member of the Section union below.
 */
export interface SectionEnvelope {
  eyebrow?: string;
  heading?: string;
  intro?: string;
  tone?: Tone;
  align?: Align;
}

/**
 * Optional rich content blocks. Each prospect composes its OWN ordered set of
 * these, so no two sites share the same structure. Legacy types are kept and
 * still render; new rich types (spec §9) each render ONLY from real data.
 *
 * Add a new block type here + a component + a case in SectionRenderer.astro.
 */
export type Section =
  // ── existing (kept, restyled to tokens) ───────────────────────────────────
  | ({ type: 'stats'; items: { value: string; label: string }[] } & SectionEnvelope)
  | ({
      type: 'testimonials';
      items: { quote: string; author: string; source?: string }[];
    } & SectionEnvelope)
  | ({ type: 'faq'; items: { q: string; a: string }[] } & SectionEnvelope)
  | ({
      type: 'list';
      groups: { title: string; items: { name: string; note?: string }[] }[];
    } & SectionEnvelope)
  | ({
      type: 'cta';
      heading: string;
      text?: string;
      buttonText?: string;
      buttonHref?: string;
    } & SectionEnvelope)
  // ── new rich sections (spec §6 / §9) ──────────────────────────────────────
  | ({
      type: 'gallery';
      images: { src: string; alt: string; caption?: string }[];
    } & SectionEnvelope)
  | ({
      type: 'feature-split';
      rows: { heading: string; body: string; image?: string; imageAlt?: string }[];
    } & SectionEnvelope)
  | ({
      type: 'timeline';
      items: { year?: string; title: string; body?: string }[];
    } & SectionEnvelope)
  | ({
      type: 'menu';
      groups: { title: string; items: { name: string; price?: string; note?: string }[] }[];
    } & SectionEnvelope)
  | ({
      type: 'team';
      members: { name: string; role?: string; photo?: string; bio?: string }[];
    } & SectionEnvelope)
  | ({
      type: 'map';
      address: string;
      lat?: number;
      lng?: number;
      hours?: BusinessHours[];
    } & SectionEnvelope)
  | ({
      type: 'press';
      items: { quote?: string; source: string; logo?: string; href?: string }[];
    } & SectionEnvelope)
  | ({ type: 'bigquote'; quote: string; author?: string; source?: string } & SectionEnvelope)
  | ({
      type: 'services-detailed';
      items: { title: string; description: string; icon?: string }[];
    } & SectionEnvelope)
  | ({ type: 'service-area'; areas: string[]; note?: string } & SectionEnvelope)
  | ({
      type: 'hours-contact';
      hours: BusinessHours[];
      phone?: string;
      cta?: { text: string; href: string };
    } & SectionEnvelope)
  | ({ type: 'process'; steps: { title: string; body?: string }[] } & SectionEnvelope)
  | ({ type: 'logos'; items: { label: string; logo?: string }[] } & SectionEnvelope)
  | ({
      type: 'before-after';
      pairs: { before: string; after: string; label?: string }[];
    } & SectionEnvelope)
  | ({
      type: 'feature-grid';
      items: { label: string; note?: string; icon?: string }[];
    } & SectionEnvelope);

/** The discriminant string of any Section (handy for the composition engine). */
export type SectionType = Section['type'];

/**
 * Art-direction overrides (spec §9). All optional — `resolveArtDirection` fills
 * everything not pinned here from theme.brand + inferred category + slug seed.
 */
export interface ArtDirectionConfig {
  /** pin a FontPairing id (fonts.ts FONT_REGISTRY). */
  fontId?: string;
  /** pin a palette preset id (palette.ts PALETTE_PRESETS). */
  paletteId?: string;
  accentStrategy?: 'analogous' | 'complementary';
  shape?: 'soft' | 'sharp' | 'editorial' | 'rounded-pill' | 'framed';
  motion?: 'none' | 'subtle' | 'expressive';
  density?: 'compact' | 'standard' | 'spacious';
  neutralTemp?: 'warm' | 'cool';
}

/** Explicit per-token CSS overrides (escape hatch, applied last). */
export type TokenOverrides = Partial<Record<string, string>>;

/** Hero variant ids (spec §7). */
export type HeroVariant = 'cinematic' | 'split' | 'editorial' | 'panel' | 'collage' | 'statement';

export interface ProspectConfig {
  /** Business name — header, footer, browser tab. */
  name: string;
  /** One-line description (SEO + hero subtitle). */
  tagline: string;
  /** ~150-char meta description for local SEO. */
  seoDescription: string;
  /** Town/area served. */
  area: string;
  /** Short hero badge, e.g. "Est. 1998". '' hides it. */
  established: string;

  contact: {
    phone: string;
    email: string;
    address: string;
  };

  social: {
    facebook: string;
    instagram: string;
    google: string;
  };

  hero: {
    heading: string;
    subheading: string;
    ctaText: string;
    ctaHref: string;
  };

  highlights: string[];

  images: {
    hero: string;
    heroAlt: string;
    story: string;
    storyAlt: string;
    storyCaption: string;
    storyCredit: string;
    placeholder: string;
  };

  about: {
    heading: string;
    body: string[];
    signature: string;
  };

  servicesHeading: string;
  services: Service[];

  hours: BusinessHours[];
  hoursNote: string;

  /** Optional rich blocks (stats, testimonials, faq, …) composed per prospect. */
  sections?: Section[];

  /**
   * Visual layout variant. KEPT for back-compat; superseded by `artDirection` +
   * the composition engine. Defaults to 'classic'.
   *   classic   — full-bleed hero, story → services → sections
   *   split     — text-panel + photo hero, services → story → sections
   *   editorial — centered magazine hero, sections → story → services
   */
  layout?: 'classic' | 'split' | 'editorial';

  /**
   * Optional art-direction overrides. Anything not set is derived
   * deterministically from theme.brand + inferred category + slug seed. Legacy
   * configs (only theme.brand) still render with a full computed identity.
   */
  artDirection?: ArtDirectionConfig;

  /** Optional explicit token overrides (escape hatch, applied last). */
  tokens?: TokenOverrides;

  /** Optional pin for the hero variant; otherwise chosen by the engine. */
  heroVariant?: HeroVariant;

  /** Extra real photos the generator collected (feeds gallery/collage). */
  galleryImages?: { src: string; alt: string }[];

  /**
   * Optional explicit business category. When absent the art-direction engine
   * infers it from name/services keywords.
   */
  category?: string;

  /**
   * Legacy "design kit" font hint from the prior system. Superseded by the v2
   * art-direction engine (which derives the font); kept optional so older
   * prospect JSON still type-checks.
   */
  design?: string;

  /**
   * Quality status surfaced on the dashboard. Omit and the dashboard infers it
   * (e.g. still on stock art → needs-review). `flags` are human-readable reasons.
   */
  status?: 'ready' | 'needs-review';
  flags?: string[];

  theme: {
    brand: string;
    brandDark: string;
  };
}

/** Metadata wrapper so the gallery can list/sort prospects. */
export interface Prospect {
  slug: string;
  config: ProspectConfig;
}
