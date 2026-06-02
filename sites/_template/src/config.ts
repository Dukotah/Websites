/**
 * Site configuration — edit THIS file first when starting a new site.
 *
 * Almost everything visible on the page (name, contact, hours, services,
 * photos, colors) is driven from here, so you can get a new client most of the
 * way done without touching the layout or components.
 *
 * Tip: see sites/bodega-country-store for a fully filled-in example.
 */

export interface Service {
  title: string;
  description: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export const config = {
  /** Business name — shown in the header, footer, and browser tab. */
  name: 'Business Name',

  /** One-line description used for SEO and the hero subtitle. */
  tagline: 'A short, friendly description of what the business does.',

  /** Longer description for the <meta> description tag (SEO). ~150 chars. */
  seoDescription:
    'Describe the business and the main town/area it serves so it shows up in local Google searches.',

  /** The town/area served — helps with local SEO. */
  area: 'Your Town, ST',

  /** A short badge line shown in the hero (e.g. "Est. 1998"). Leave '' to hide. */
  established: 'Est. 2000',

  contact: {
    phone: '(555) 555-5555',
    email: 'hello@example.com',
    address: '123 Main St, Your Town, ST 00000',
  },

  /** Social links — leave a value empty ('') to hide that link. */
  social: {
    facebook: '',
    instagram: '',
    google: '', // Google Business Profile / reviews link
  },

  /** Headline + call-to-action shown in the hero section. */
  hero: {
    heading: 'A clear promise the business makes to its customers.',
    subheading: 'A supporting sentence that builds trust and explains the value.',
    ctaText: 'Get in touch',
    ctaHref: '#contact',
  },

  /** Short list shown as understated meta under the hero. Keep to 3–5 items. */
  highlights: ['Friendly service', 'Locally owned', 'Fair prices'],

  /**
   * Photos. Point these at images in public/images/.
   * Defaults are committed SVG placeholders so the page looks finished before
   * real photography is added; images fall back to a placeholder if they fail
   * to load. Run `npm run fetch-photos -- <this-folder>` (with a photos.json)
   * to pull freely-licensed photos, or just drop the client's own in.
   */
  images: {
    hero: '/images/hero.svg',
    heroAlt: 'Photo of the business or the area it serves.',

    story: '/images/about.svg',
    storyAlt: 'A photo for the about/story section.',
    storyCaption: '',
    storyCredit: '',

    placeholder: '/images/hero.svg',
  },

  /** The "About" / story section. `body` is an array of paragraphs. */
  about: {
    heading: 'About us',
    body: [
      "Two or three sentences about the business — who they are, how long they've " +
        'been around, and why customers trust them. Keep it warm and human.',
      'A second short paragraph can add detail: what makes them different, the people ' +
        'behind it, or the area they serve.',
    ],
    /** Optional signature line under the story. Leave '' to hide. */
    signature: '',
  },

  /** Services / offerings shown as a clean numbered list. Add or remove freely. */
  servicesHeading: 'What we offer',
  services: [
    {
      title: 'Service one',
      description: 'A sentence describing this service and why it matters.',
    },
    {
      title: 'Service two',
      description: 'A sentence describing this service and why it matters.',
    },
    {
      title: 'Service three',
      description: 'A sentence describing this service and why it matters.',
    },
    {
      title: 'Service four',
      description: 'A sentence describing this service and why it matters.',
    },
  ] satisfies Service[],

  /** Opening hours shown in the contact section. */
  hours: [
    { day: 'Mon – Fri', hours: '9:00 AM – 5:00 PM' },
    { day: 'Saturday', hours: '10:00 AM – 2:00 PM' },
    { day: 'Sunday', hours: 'Closed' },
  ] satisfies BusinessHours[],

  /** A short note under the hours (holidays, seasonal changes). Leave '' to hide. */
  hoursNote: '',

  /**
   * Brand colors. Change these two and the whole site re-themes.
   * `brand` is buttons/accents; `brandDark` is headings + dark sections.
   */
  theme: {
    brand: '#c2683a', // primary / buttons / accents
    brandDark: '#243b53', // headings, hover states, dark sections
  },
};

export type SiteConfig = typeof config;
