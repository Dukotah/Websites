/**
 * Site configuration — edit THIS file first when starting a new site.
 *
 * Almost everything visible on the page (business name, contact details, hours,
 * services, colors) is driven from here, so you can get a new client most of the
 * way done without touching the layout or components.
 */

export interface Service {
  title: string;
  description: string;
  /** Optional emoji or short icon shown above the title. */
  icon?: string;
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

  /** The "About" / story section. */
  about: {
    heading: 'About us',
    body:
      "Two or three sentences about the business — who they are, how long they've " +
      'been around, and why customers trust them. Keep it warm and human.',
  },

  /** Services / offerings shown as cards. Add or remove freely. */
  servicesHeading: 'What we offer',
  services: [
    {
      icon: '⭐',
      title: 'Service one',
      description: 'A sentence describing this service and why it matters.',
    },
    {
      icon: '🛠️',
      title: 'Service two',
      description: 'A sentence describing this service and why it matters.',
    },
    {
      icon: '💬',
      title: 'Service three',
      description: 'A sentence describing this service and why it matters.',
    },
  ] satisfies Service[],

  /** Opening hours shown in the contact section. */
  hours: [
    { day: 'Mon – Fri', hours: '9:00 AM – 5:00 PM' },
    { day: 'Saturday', hours: '10:00 AM – 2:00 PM' },
    { day: 'Sunday', hours: 'Closed' },
  ] satisfies BusinessHours[],

  /**
   * Brand colors. Change these two and the whole site re-themes.
   * Use any valid CSS color.
   */
  theme: {
    brand: '#2563eb', // primary / buttons / accents
    brandDark: '#1e40af', // hover states, darker accents
  },
};

export type SiteConfig = typeof config;
