/**
 * Site configuration — edit THIS file first.
 *
 * Almost everything visible on the page (business name, contact details, hours,
 * services, reviews, FAQ, colors) is driven from here, so the site can be kept
 * up to date without touching the layout or components.
 */

export interface Service {
  title: string;
  description: string;
  /** Image imported from src/assets/images and passed to <Image />. */
  image: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export interface Step {
  title: string;
  description: string;
}

export interface Testimonial {
  quote: string;
  name: string;
  detail?: string;
}

export interface Faq {
  question: string;
  answer: string;
}

export const config = {
  /** Business name — shown in the header, footer, and browser tab. */
  name: 'Bear Flag Towing',

  /** One-line description used for SEO and the hero subtitle. */
  tagline: 'Fast and reliable towing in Santa Rosa, California.',

  /** Longer description for the <meta> description tag (SEO). ~150 chars. */
  seoDescription:
    'Bear Flag Towing offers fast, 24/7 towing, roadside assistance, and vehicle recovery in Santa Rosa & Sonoma County, CA. Friendly, licensed service — call (707) 586-0938.',

  /** The town/area served — helps with local SEO. */
  area: 'Santa Rosa, CA',

  /** California motor carrier permit — shown for trust. Seen on the truck. */
  license: 'CA #567069',

  /** Years/credibility line shown in the hero trust strip. */
  trustPoints: [
    { label: '24/7', sub: 'Day & night dispatch' },
    { label: 'Fast', sub: 'Quick local response' },
    { label: 'Licensed', sub: 'CA #567069' },
    { label: 'Local', sub: 'Santa Rosa based' },
  ],

  contact: {
    phone: '(707) 586-0938',
    email: 'bearflagtowing@gmail.com',
    address: '121 Chestnut Street, Santa Rosa, CA 95401',
  },

  /** Social links — leave a value empty ('') to hide that link. */
  social: {
    facebook: '', // TODO: add real Facebook page (old site used Wix placeholders)
    instagram: '', // TODO: add real Instagram
    google: '', // Google Business Profile / reviews link
  },

  /** Headline + call-to-action shown in the hero section. */
  hero: {
    badge: '24/7 Emergency Towing',
    heading: 'Stranded? We’ll get you back on the road — fast.',
    subheading:
      'Bear Flag Towing provides quick, dependable towing, roadside assistance, and vehicle recovery across Santa Rosa and Sonoma County. One call and we’re on the way.',
    ctaText: 'Call (707) 586-0938',
    ctaHref: 'tel:+17075860938',
    secondaryText: 'See our services',
    secondaryHref: '#services',
  },

  /** The "About" / story section. */
  about: {
    heading: 'Local, dependable towing you can count on',
    body: [
      'Bear Flag Towing is a Santa Rosa–based company built on fast response and friendly, honest service. From highway breakdowns to private-property tows and tricky recoveries, our team handles every job with care.',
      'We tow everyday drivers, classic and specialty vehicles, and commercial fleets — treating every vehicle like it’s our own. When you call, you talk to a local who knows the area and gets to you quickly.',
    ],
  },

  /** Services / offerings shown as cards. */
  servicesHeading: 'Our towing & roadside services',
  servicesSub: 'Whatever the situation, we have the equipment and experience to help.',
  services: [
    {
      image: 'svc-roadside.jpg',
      title: 'Roadside Assistance',
      description:
        'Flat tires, dead batteries, lockouts, and out-of-gas situations — we get you moving again fast.',
    },
    {
      image: 'svc-commercial.jpg',
      title: 'Commercial Towing',
      description:
        'Reliable towing for commercial vehicles and fleets, handled by an experienced team.',
    },
    {
      image: 'svc-recovery.jpg',
      title: 'Vehicle Recovery',
      description:
        'Stuck, ditched, or in an awkward spot? We safely recover your vehicle and minimize further damage.',
    },
    {
      image: 'svc-tinyhome.jpg',
      title: 'Tiny Home Moving',
      description:
        'Specialized transport for tiny homes — moved carefully and securely to their destination.',
    },
    {
      image: 'svc-property.jpg',
      title: 'Private Property Towing',
      description:
        'Prompt, professional removal of unauthorized vehicles for property managers and owners.',
    },
  ] satisfies Service[],

  /** "How it works" — keeps customers confident about what happens next. */
  stepsHeading: 'Help in three simple steps',
  steps: [
    {
      title: 'Call us',
      description: 'Reach a real local dispatcher any time, day or night, at (707) 586-0938.',
    },
    {
      title: 'We dispatch',
      description: 'Tell us where you are and what you need — we send the right truck right away.',
    },
    {
      title: 'Back on the road',
      description: 'We arrive quickly, take care of your vehicle, and get you on your way.',
    },
  ] satisfies Step[],

  /** Towns we serve — great for local SEO. */
  serviceAreaHeading: 'Proudly serving Sonoma County',
  serviceArea: [
    'Santa Rosa',
    'Rohnert Park',
    'Petaluma',
    'Windsor',
    'Healdsburg',
    'Sebastopol',
    'Sonoma',
    'Cotati',
  ],

  /** Customer reviews. */
  reviewsHeading: 'What our customers say',
  testimonials: [
    {
      quote:
        'I was stranded on the highway, and Bear Flag Towing arrived quickly and efficiently!',
      name: 'Alex Johnson',
      detail: 'Santa Rosa',
    },
  ] satisfies Testimonial[],

  /** Frequently asked questions — also good for SEO. */
  faqHeading: 'Frequently asked questions',
  faq: [
    {
      question: 'Are you available 24/7?',
      answer:
        'Yes. We provide round-the-clock emergency towing and roadside assistance — just call (707) 586-0938 any time.',
    },
    {
      question: 'What areas do you serve?',
      answer:
        'We’re based in Santa Rosa and serve the surrounding Sonoma County area, including Rohnert Park, Petaluma, Windsor, Healdsburg, and more.',
    },
    {
      question: 'What types of vehicles can you tow?',
      answer:
        'From everyday cars and trucks to classic and specialty vehicles, commercial vehicles, and even tiny homes — we have the right equipment for the job.',
    },
    {
      question: 'How fast can you get to me?',
      answer:
        'Response times vary with traffic and location, but as a local Santa Rosa company we aim to reach you as quickly as possible. Call us and we’ll give you an honest estimate.',
    },
  ] satisfies Faq[],

  /** Opening hours shown in the contact section. */
  hours: [{ day: 'Every day', hours: 'Open 24 hours' }] satisfies BusinessHours[],

  /**
   * Brand colors. Change these two and the whole site re-themes.
   * California "Bear Flag" red to match the logo and trucks.
   */
  theme: {
    brand: '#c0392b', // primary / buttons / accents
    brandDark: '#922b21', // hover states, darker accents
  },
};

export type SiteConfig = typeof config;
