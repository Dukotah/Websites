/**
 * Site configuration for the Bodega Country Store.
 *
 * Almost everything visible on the page is driven from this file, so the
 * content can be updated without touching the layout or components.
 *
 * Sources for the content below: the store's existing site
 * (alwayssunnyinbodega.com), Sonoma County Tourism, and public listings.
 * Hours / phone / email should be confirmed with the owner before going live.
 */

export interface Offering {
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
  name: 'Bodega Country Store',

  /** One-line description used for SEO and the hero subtitle. */
  tagline: "It's always sunny in Bodega — a historic country store on the Sonoma Coast.",

  /** Longer description for the <meta> description tag (SEO). ~150 chars. */
  seoDescription:
    'The Bodega Country Store is a historic general store in Bodega, CA, serving the ' +
    'Sonoma Coast since the 1850s — local produce, deli sandwiches, Taylor Lane coffee, ' +
    'cheese, wine, gifts, and a slice of "The Birds" film history.',

  /** The town/area served — helps with local SEO. */
  area: 'Bodega, California',

  /** A short, memorable line shown as a badge in the hero. */
  established: 'Serving the coast since the 1850s',

  contact: {
    phone: '(707) 377-4080',
    email: 'hello@alwayssunnyinbodega.com',
    address: '17190 Bodega Highway, Bodega, CA 94922',
  },

  /** Social links — leave a value empty ('') to hide that link. */
  social: {
    facebook: 'https://www.facebook.com/thebodegacountrystore/',
    instagram: '',
    google: 'https://www.google.com/maps/search/Bodega+Country+Store+Bodega+CA',
  },

  /** Headline + call-to-action shown in the hero section. */
  hero: {
    heading: "It's always sunny in Bodega.",
    subheading:
      'A historic country store on the Sonoma Coast — fresh local produce, a stocked ' +
      'deli, real coffee, good wine, and a little Hollywood history under one roof. ' +
      'Stop in on your way to the beach.',
    ctaText: 'Plan your visit',
    ctaHref: '#visit',
  },

  /** Quick "what's inside" pills shown beneath the hero. */
  highlights: ['Local Produce', 'Deli & Sandwiches', 'Taylor Lane Coffee', 'Cheese & Wine', 'Gifts & Antiques'],

  /** The "Our Story" section — supports multiple paragraphs. */
  about: {
    heading: 'A landmark on the Sonoma Coast since the 1850s',
    body: [
      'The Bodega Country Store has anchored the little town of Bodega since the 1850s, ' +
        'back when this was Bodega Corners and the building was the McCaughey Brothers ' +
        'Mercantile. More than a century and a half later, it still does what a country ' +
        'store should — feed the neighbors, welcome the travelers, and keep the lights on ' +
        'at the edge of the coast.',
      'We stock the good stuff from right around here: produce from Andy’s, ' +
        'Taylor Lane coffee, local cheese and dairy, Panizzera meats, Freestone Ranch beef, ' +
        'plus plenty of organic, vegan, and gluten-free options. Grab a sandwich and a ' +
        'bottle of wine and you’ve got the makings of a perfect coast-side picnic.',
    ],
  },

  /** What you'll find inside — shown as cards. */
  offeringsHeading: "What's inside",
  offerings: [
    {
      icon: '🥪',
      title: 'Deli & sandwiches',
      description:
        'Gourmet sandwiches and salads made to order — the perfect grab-and-go for the ' +
        'beach, the trail, or the drive up Highway 1.',
    },
    {
      icon: '🥬',
      title: 'Local produce',
      description:
        "Fresh fruit and vegetables from Andy’s Produce and nearby growers, with " +
        'organic, vegan, and gluten-free options throughout the store.',
    },
    {
      icon: '☕',
      title: 'Taylor Lane coffee',
      description:
        'Locally roasted Taylor Lane coffee to go — exactly what you need before a foggy ' +
        'morning on the Sonoma Coast.',
    },
    {
      icon: '🧀',
      title: 'Cheese & dairy',
      description:
        'A rotating selection of local cheeses and dairy, ready to pair with a bottle ' +
        'from our wine shelf.',
    },
    {
      icon: '🍷',
      title: 'Beer & wine',
      description:
        'Sonoma County wines and local brews — pick up a bottle for tonight or a case ' +
        'for the weekend.',
    },
    {
      icon: '🎁',
      title: 'Gifts & antiques',
      description:
        'Greeting cards, gifts, and country-store treasures you won’t find anywhere ' +
        'else on the coast.',
    },
  ] satisfies Offering[],

  /** The "The Birds" landmark feature section. */
  landmark: {
    eyebrow: 'A piece of film history',
    heading: 'You may recognize the place',
    body:
      'Bodega and the country store sit at the heart of Alfred Hitchcock’s 1963 ' +
      'classic, "The Birds." Film fans make the pilgrimage from all over the world — ' +
      'and leave with a sandwich, a souvenir, and a story. Come see the landmark for ' +
      'yourself.',
    note: 'Featured in Alfred Hitchcock’s "The Birds" (1963)',
  },

  /** Opening hours shown in the visit section. */
  hours: [
    { day: 'Monday – Sunday', hours: '9:00 AM – 6:00 PM' },
  ] satisfies BusinessHours[],

  /** A short note shown under the hours (holidays, seasonal changes, etc.). */
  hoursNote: 'Open every day. Hours may vary on holidays — call ahead if you’re making a trip.',

  /**
   * Brand colors. Change these two and the whole site re-themes.
   * Warm "always sunny" gold against the cool Sonoma coast.
   */
  theme: {
    brand: '#e08a1e', // sunny coastal gold
    brandDark: '#b86c0c', // hover states, darker accents
  },
};

export type SiteConfig = typeof config;
