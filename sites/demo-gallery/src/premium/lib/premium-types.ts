/**
 * premium-types.ts — the v2, MULTI-PAGE prospect schema for the premium
 * (AVISP-caliber) rendering layer. This is the contract the agent-author step
 * emits (one JSON per prospect in src/data/premium/<slug>.json) and the premium
 * components render. Distinct from the legacy single-page ProspectConfig in
 * ../../types.ts — premium sites are 3-5 pages, brand-rich, and section-composed.
 *
 * Design notes:
 *  - Overlaps with the legacy schema on the fields the factory brand engine reads
 *    (name, category, area, contact, images.hero, seoDescription) so
 *    resolveArtDirection / buildJsonLd / resolveAsset accept a PremiumConfig.
 *  - Brand is PER-PROSPECT: `brand` lets the agent pin a real color + font
 *    pairing; when omitted the engine derives one from the business name.
 *  - Pages are an ORDERED list of sections; the agent decides which sections,
 *    in what order, per page — that's where the per-site judgment lives.
 */

export interface PremiumContact {
  phone?: string;
  email?: string;
  address?: string;
}

export interface PremiumSocial {
  facebook?: string;
  instagram?: string;
  google?: string;
  yelp?: string;
  linkedin?: string;
}

export interface PremiumHours {
  day: string;
  hours: string;
}

export interface PremiumRating {
  value: number;
  count?: number;
  source?: string;
}

/** A single image reference (path resolved via lib/assets.ts at build). */
export interface PremiumImage {
  src: string;
  alt?: string;
  /** CSS object-position focal point, e.g. "50% 40%". */
  focal?: string;
}

/**
 * Structural layout variant for the WHOLE site shell (not a single section).
 * Lets two sites in the same category differ in bones, not just color/font:
 *  - 'classic'  (default) — centered vertical stack; identical to pre-existing
 *    behavior, so omitting `layout` never changes any built site.
 *  - 'editorial' — asymmetric magazine column: content sits in a left-biased
 *    measure with a wide outer rail and a vertical brand wordmark, giving a
 *    distinctly art-directed cadence.
 *  - 'sidebar' — on wide screens the nav becomes a fixed vertical rail and the
 *    content scrolls beside it (collapses back to the classic top bar on
 *    tablet/mobile).
 * Implemented purely in premium/layouts/PremiumBase.astro (a wrapper class +
 * scoped global CSS), so section components are untouched.
 */
export type PremiumLayout = 'classic' | 'editorial' | 'sidebar';

/** Brand inputs the agent pins for this business (all optional → engine derives). */
export interface PremiumBrand {
  /** Seed/override brand color (hex). Drives the whole palette via palette.ts. */
  color?: string;
  /** Font pairing id from lib/fonts.ts FONT_REGISTRY (e.g. 'editorial-serif'). */
  fontId?: string;
  /** Optional logo image (else a typographic monogram is rendered). */
  logo?: string;
}

// ── Section union ──────────────────────────────────────────────────────────
// Each premium page is composed from these. `kind` is the discriminator.

export interface SecHero {
  kind: 'hero';
  /** Layout treatment. 'fullbleed' = photo behind; 'split' = photo beside;
   *  'editorial' = type-forward, no/secondary photo. */
  variant?: 'fullbleed' | 'split' | 'editorial';
  eyebrow?: string;
  heading: string;
  subheading?: string;
  /** Trust chips under the CTA, e.g. ["Family-owned since 1981", "Licensed & insured"]. */
  badges?: string[];
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  image?: PremiumImage;
  /** Decorative, clearly-illustrative category motif (a library SVG, drawn in
   *  currentColor) used as a brand-tinted backdrop behind the type on a
   *  photo-less editorial hero. NOT a photo — never counts as real imagery. */
  motif?: string;
}

export interface SecStory {
  kind: 'story';
  eyebrow?: string;
  heading: string;
  /** Paragraphs of real about/story copy. */
  body: string[];
  /** Optional checklist of differentiators beside the prose. */
  highlights?: string[];
  image?: PremiumImage;
  signature?: string;
}

export interface SecServiceItem {
  title: string;
  description: string;
  image?: PremiumImage;
  badge?: string;
}
export interface SecServices {
  kind: 'services';
  eyebrow?: string;
  heading: string;
  intro?: string;
  /** 'grid' = card grid; 'rows' = alternating feature rows (richer, page-filling). */
  layout?: 'grid' | 'rows';
  /** Author opt-in: rows-layout items WITHOUT images render a designed brand-tinted
   *  glyph panel (not a blank grey box) — set so QA's empty-panel check passes. */
  fallbackOk?: boolean;
  items: SecServiceItem[];
}

export interface SecStat {
  value: string;
  label: string;
}
export interface SecStats {
  kind: 'stats';
  /** Renders on a dark brand band by default for contrast. */
  tone?: 'ink' | 'light';
  heading?: string;
  items: SecStat[];
}

export interface SecTestimonial {
  quote: string;
  author: string;
  detail?: string;
}
export interface SecTestimonials {
  kind: 'testimonials';
  eyebrow?: string;
  heading?: string;
  items: SecTestimonial[];
  rating?: PremiumRating;
}

export interface SecGallery {
  kind: 'gallery';
  eyebrow?: string;
  heading?: string;
  images: PremiumImage[];
}

export interface SecFaqItem {
  q: string;
  a: string;
}
export interface SecFaq {
  kind: 'faq';
  eyebrow?: string;
  heading?: string;
  items: SecFaqItem[];
}

export interface SecCta {
  kind: 'cta';
  heading: string;
  body?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

/**
 * SecCallout — a "differentiator" band for sites too thin for a full stat row.
 * A brand-tinted editorial panel: eyebrow + heading + a short lead + a small set
 * of real highlight points (1–4). Used in place of a sparse 1–2 stat band so a
 * photo/stat-light home page still has a deliberate, composed mid-page beat
 * instead of a hole. Photo-free by design (type + brand motif only).
 */
export interface SecCallout {
  kind: 'callout';
  eyebrow?: string;
  heading: string;
  body?: string;
  /** Real differentiator points (credentials, specialties, area). 1–4. */
  points?: string[];
  primaryCta?: { label: string; href: string };
}

export interface SecContact {
  kind: 'contact';
  eyebrow?: string;
  heading?: string;
  blurb?: string;
  /** Show the embedded map (uses contact.address). */
  showMap?: boolean;
  /** Show the hours table (uses config.hours). */
  showHours?: boolean;
}

/**
 * SecSteps — a "how it works" / process flow. A numbered, sequential set of
 * beats (Reach out → We assess → We do the work → You're set) for services-led
 * businesses where the customer wants to know what working together looks like.
 * Reuses the brand kicker-num. Render only when items.length >= 3 (a 1–2 step
 * "process" reads as filler); the author emits it only for services-led families
 * with real about/services so it's never an empty hole.
 */
export interface SecStepItem {
  title: string;
  body: string;
}
export interface SecSteps {
  kind: 'steps';
  eyebrow?: string;
  heading?: string;
  intro?: string;
  items: SecStepItem[];
}

/**
 * SecTeam — owner/founder/team bios. ONLY emitted when research carries real
 * people (e.g. "pitmaster Larry Hillix"); never fabricated. A card grid reusing
 * .card + .media. Render only when members.length >= 1.
 */
export interface SecTeamMember {
  name: string;
  role?: string;
  bio?: string;
  image?: PremiumImage;
}
export interface SecTeam {
  kind: 'team';
  eyebrow?: string;
  heading?: string;
  members: SecTeamMember[];
}

/**
 * SecFeatures — benefit/feature cards with small inline-SVG icons. Gives the
 * home page a structured benefit band (instead of a flat checklist) by turning
 * a business's real highlights into iconned cards. `icon` is a keyword mapped to
 * a token-tinted inline SVG defined IN the component (no external deps); an
 * unknown/absent keyword falls back to a neutral mark. Render only when
 * items.length >= 2.
 */
export type FeatureIcon =
  | 'check' | 'clock' | 'shield' | 'leaf' | 'wrench' | 'sparkle' | 'map-pin' | 'phone';
export interface SecFeatureItem {
  title: string;
  body: string;
  icon?: FeatureIcon;
}
export interface SecFeatures {
  kind: 'features';
  eyebrow?: string;
  heading?: string;
  intro?: string;
  items: SecFeatureItem[];
}

/**
 * SecPricing — token-driven tier cards. Emitted ONLY when research carries real
 * pricing/packages (rare); default off. Render only when tiers.length >= 1.
 */
export interface SecPricingTier {
  name: string;
  price: string;
  blurb?: string;
  features?: string[];
  cta?: { label: string; href: string };
  /** Visually emphasize this tier as the recommended one. */
  featured?: boolean;
}
export interface SecPricing {
  kind: 'pricing';
  eyebrow?: string;
  heading?: string;
  intro?: string;
  tiers: SecPricingTier[];
}

export type PremiumSection =
  | SecHero
  | SecStory
  | SecServices
  | SecStats
  | SecTestimonials
  | SecGallery
  | SecFaq
  | SecCta
  | SecCallout
  | SecContact
  | SecSteps
  | SecTeam
  | SecFeatures
  | SecPricing;

// ── Page + top-level config ────────────────────────────────────────────────

export interface PremiumPage {
  /** URL segment: 'home' renders at /p/<slug>/, others at /p/<slug>/<slug>. */
  slug: 'home' | string;
  /** Nav label, e.g. "Services", "About". */
  label: string;
  /** <title> override; else derived. */
  title?: string;
  description?: string;
  sections: PremiumSection[];
}

export interface PremiumConfig {
  /** URL/file slug. */
  slug: string;
  name: string;
  legalName?: string;
  tagline?: string;
  seoDescription: string;
  category: string;
  categoryLabel?: string;
  area?: string;
  city?: string;
  state?: string;
  established?: string;

  contact?: PremiumContact;
  social?: PremiumSocial;
  hours?: PremiumHours[];
  rating?: PremiumRating;
  priceRange?: string;
  geo?: { lat: number; lng: number };

  brand?: PremiumBrand;
  /** Structural shell variant (see PremiumLayout). Default 'classic'. */
  layout?: PremiumLayout;
  /** Home hero image — also the OG/share image + JSON-LD image. */
  images?: { hero?: string; heroAlt?: string; logo?: string };

  /** The multi-page site. pages[0] should be the home page (slug 'home'). */
  pages: PremiumPage[];

  /** Outreach claim-banner gating (mirrors legacy schema). */
  outreach?: {
    published?: boolean;
    claimUrl?: string;
    claimByDate?: string;
    note?: string;
  };

  /** Build provenance / QA. */
  status?: 'ready' | 'needs-review' | 'draft';
  flags?: string[];
}

/**
 * URL base for premium multi-page demos. Kept distinct from the legacy
 * single-page `/p/<slug>` during the build-out so the two render systems don't
 * collide on routes; the cutover (retire the legacy renderer) flips this to '/p'
 * and moves the route folder. One constant = the whole link scheme.
 */
export const PREMIUM_BASE = '/s';

/** The nav model derived from pages (home is the logo link, not a nav item). */
export function navFor(config: PremiumConfig): { label: string; href: string; slug: string }[] {
  const base = `${PREMIUM_BASE}/${config.slug}`;
  return config.pages
    .filter((p) => p.slug !== 'home')
    .map((p) => ({ label: p.label, href: `${base}/${p.slug}`, slug: p.slug }));
}

/** Home href for the logo / brand link. */
export function homeHref(config: PremiumConfig): string {
  return `${PREMIUM_BASE}/${config.slug}/`;
}
