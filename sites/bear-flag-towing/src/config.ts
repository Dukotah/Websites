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
  name: 'Bear Flag Towing',

  /** One-line description used for SEO and the hero subtitle. */
  tagline: 'Fast and reliable towing in Santa Rosa, California.',

  /** Longer description for the <meta> description tag (SEO). ~150 chars. */
  seoDescription:
    'Bear Flag Towing offers fast-response towing, roadside assistance, and vehicle recovery in Santa Rosa, CA. Friendly, dependable service — call (707) 586-0938.',

  /** The town/area served — helps with local SEO. */
  area: 'Santa Rosa, CA',

  contact: {
    phone: '(707) 586-0938',
    email: 'bearflagtowing@gmail.com',
    address: '121 Chestnut Street, Santa Rosa, CA 95401',
  },

  /** Social links — leave a value empty ('') to hide that link. */
  social: {
    facebook: '', // TODO: add real Facebook page (current site uses Wix placeholders)
    instagram: '', // TODO: add real Instagram
    google: '', // Google Business Profile / reviews link
  },

  /** Headline + call-to-action shown in the hero section. */
  hero: {
    heading: 'Fast, reliable towing in Santa Rosa — day or night.',
    subheading:
      'From roadside emergencies to private-property tows and recoveries, our team gets to you quickly and gets the job done right.',
    ctaText: 'Call (707) 586-0938',
    ctaHref: 'tel:+17075860938',
  },

  /** The "About" / story section. */
  about: {
    heading: 'About Bear Flag Towing',
    body:
      'Bear Flag Towing, based in Santa Rosa, California, specializes in fast-response ' +
      'towing services. From emergencies on the road to private property towing and ' +
      'recoveries, our dedicated team delivers efficient, friendly service focused on ' +
      'customer satisfaction.',
  },

  /** Services / offerings shown as cards. Add or remove freely. */
  servicesHeading: 'Our services',
  services: [
    {
      icon: '🚨',
      title: 'Roadside Assistance',
      description:
        'Flat tires, dead batteries, lockouts, and out-of-gas situations — we get you back on the road fast.',
    },
    {
      icon: '🚚',
      title: 'Commercial Towing',
      description:
        'Reliable towing for commercial vehicles and fleets, handled by an experienced team.',
    },
    {
      icon: '🪝',
      title: 'Vehicle Recovery',
      description:
        'Stuck, ditched, or in an awkward spot? We safely recover your vehicle and minimize further damage.',
    },
    {
      icon: '🏠',
      title: 'Tiny Home Moving',
      description:
        'Specialized transport for tiny homes — moved carefully and securely to their destination.',
    },
    {
      icon: '🅿️',
      title: 'Private Property Towing',
      description:
        'Prompt, professional removal of unauthorized vehicles for property managers and owners.',
    },
  ] satisfies Service[],

  /** Opening hours shown in the contact section. */
  hours: [
    { day: 'Mon – Sun', hours: '24/7 Emergency Towing' },
  ] satisfies BusinessHours[],

  /**
   * Brand colors. Change these two and the whole site re-themes.
   * Use any valid CSS color. (California "Bear Flag" red.)
   */
  theme: {
    brand: '#c0392b', // primary / buttons / accents
    brandDark: '#922b21', // hover states, darker accents
  },
};

export type SiteConfig = typeof config;
