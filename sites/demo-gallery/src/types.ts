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
