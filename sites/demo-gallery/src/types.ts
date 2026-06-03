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
 * Optional rich content blocks. Each prospect composes its OWN ordered set of
 * these (rendered between Services and Contact), so no two sites share the same
 * structure. Add new block types here + a component + a case in Sections.astro.
 */
export type Section =
  | { type: 'stats'; items: { value: string; label: string }[] }
  | {
      type: 'testimonials';
      eyebrow?: string;
      heading?: string;
      items: { quote: string; author: string; source?: string }[];
    }
  | { type: 'faq'; eyebrow?: string; heading?: string; items: { q: string; a: string }[] }
  | {
      type: 'list';
      eyebrow?: string;
      heading?: string;
      intro?: string;
      groups: { title: string; items: { name: string; note?: string }[] }[];
    }
  | { type: 'cta'; heading: string; text?: string; buttonText?: string; buttonHref?: string };

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

  /** Optional rich blocks rendered between Services and Contact, in order. */
  sections?: Section[];

  /**
   * Visual design kit — switches the display font + heading treatment so a
   * winery doesn't look like a tow company. Defaults to 'elegant'.
   *   elegant → Fraunces serif (winery / cafe / salon / boutique)
   *   bold    → Oswald condensed (towing / auto / trades / bold brands)
   *   clean   → Inter (modern, minimal)
   */
  design?: 'elegant' | 'bold' | 'clean';

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
