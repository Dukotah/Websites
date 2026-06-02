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
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export const config = {
  /** Business name — shown in the header, footer, and browser tab. */
  name: 'Bodega Country Store',

  /** One-line description used for SEO and the hero subtitle. */
  tagline: "A historic country store on the Sonoma Coast — since the 1850s.",

  /** Longer description for the <meta> description tag (SEO). ~150 chars. */
  seoDescription:
    'The Bodega Country Store is a historic general store in Bodega, CA, serving the ' +
    'Sonoma Coast since the 1850s — local produce, deli sandwiches, Taylor Lane coffee, ' +
    'cheese, wine, gifts, and a slice of "The Birds" film history.',

  /** The town/area served — helps with local SEO. */
  area: 'Bodega, California',

  /** A short, memorable line shown as a badge in the hero. */
  established: 'Est. 1850s',

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
      'deli, real coffee, good wine, and a little Hollywood history under one roof.',
    ctaText: 'Plan your visit',
    ctaHref: '#visit',
  },

  /** Short list of what's inside, shown as understated meta in the hero. */
  highlights: ['Deli & Sandwiches', 'Local Produce', 'Taylor Lane Coffee', 'Cheese & Wine'],

  /**
   * Photography. Point these at real photos in public/images/.
   * Defaults are committed SVG placeholders (so the page looks finished before
   * real photography is added) except `landmark`, which uses a freely-licensed
   * Wikimedia photo of the actual filming location. Every photo falls back to a
   * placeholder if it fails to load. Run `node scripts/fetch-photos.mjs
   * bodega-country-store` to pull real, licensed Bodega photos locally.
   */
  images: {
    hero: '/images/coast.svg',
    heroAlt: 'The Sonoma Coast near Bodega, California.',

    story: '/images/storefront.svg',
    storyAlt: 'The historic Bodega Country Store on Bodega Highway.',

    // Verified Wikimedia Commons photo of the Potter Schoolhouse — the building
    // from "The Birds", a short walk from the store. Falls back to the SVG below.
    landmark:
      'https://commons.wikimedia.org/wiki/Special:FilePath/Bodega_,_California,_USA_-_Village_of_Bodega_Bay_-_Potter_School_House_(17110_Bodega_Ln,_Bodega,_CA_94922)_-_panoramio.jpg',
    landmarkAlt: 'The Potter Schoolhouse in Bodega, featured in Hitchcock’s “The Birds.”',
    landmarkCredit: 'Photo: Wikimedia Commons / Panoramio (CC BY 3.0)',

    placeholder: '/images/coast.svg',
  },

  /** The "Our Story" section — supports multiple paragraphs. */
  about: {
    heading: 'A landmark on the coast since the 1850s',
    body: [
      'The Bodega Country Store has anchored the little town of Bodega since the 1850s, ' +
        'back when this was Bodega Corners and the building was the McCaughey Brothers ' +
        'Mercantile. More than a century and a half later, it still does what a country ' +
        'store should — feed the neighbors, welcome the travelers, and keep the lights on ' +
        'at the edge of the coast.',
      'We stock the good stuff from right around here: produce from Andy’s, Taylor Lane ' +
        'coffee, local cheese and dairy, Panizzera meats, and Freestone Ranch beef, plus ' +
        'plenty of organic, vegan, and gluten-free options. Grab a sandwich and a bottle ' +
        'of wine and you’ve got the makings of a perfect coast-side picnic.',
    ],
  },

  /** What you'll find inside — shown as a clean editorial list. */
  offeringsHeading: "What's inside",
  offerings: [
    {
      title: 'Deli & sandwiches',
      description:
        'Gourmet sandwiches and salads made to order — the perfect grab-and-go for the ' +
        'beach, the trail, or the drive up Highway 1.',
    },
    {
      title: 'Local produce',
      description:
        "Fresh fruit and vegetables from Andy’s Produce and nearby growers, with organic, " +
        'vegan, and gluten-free options throughout the store.',
    },
    {
      title: 'Taylor Lane coffee',
      description:
        'Locally roasted Taylor Lane coffee to go — exactly what you need before a foggy ' +
        'morning on the Sonoma Coast.',
    },
    {
      title: 'Cheese & dairy',
      description:
        'A rotating selection of local cheeses and dairy, ready to pair with a bottle ' +
        'from our wine shelf.',
    },
    {
      title: 'Beer & wine',
      description:
        'Sonoma County wines and local brews — pick up a bottle for tonight or a case ' +
        'for the weekend.',
    },
    {
      title: 'Gifts & sundries',
      description:
        'Greeting cards, gifts, and the everyday country-store basics you forgot to ' +
        'pack for the coast.',
    },
  ] satisfies Offering[],

  /** The "The Birds" landmark feature section. */
  landmark: {
    eyebrow: 'A piece of film history',
    heading: 'You may recognize the place',
    body:
      'Bodega and its little schoolhouse sit at the heart of Alfred Hitchcock’s 1963 ' +
      'classic, "The Birds." Film fans make the pilgrimage from all over the world — ' +
      'and leave with a sandwich, a souvenir, and a story. Come see it for yourself.',
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
   * A muted coastal palette — warm gold against deep evergreen.
   */
  theme: {
    brand: '#c97b1f', // muted coastal gold
    brandDark: '#1f3b34', // deep evergreen — headings, dark sections
  },
};

export type SiteConfig = typeof config;
