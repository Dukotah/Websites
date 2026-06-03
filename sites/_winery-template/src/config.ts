/**
 * Site configuration — edit THIS file to customize your winery site.
 *
 * All pages pull their content from this config. Updating this file is all
 * you need for most content changes: name, wines, contact info, colors, etc.
 */

export interface Wine {
  name: string;
  varietal: string;
  type: 'Red' | 'White' | 'Rosé' | 'Blend' | 'Sparkling' | 'Dessert';
  image: string;
  notes: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export const config = {
  name: 'Winery Name',
  tagline: 'Small-batch wines from our estate vineyard',
  seoDescription:
    'A family winery crafting small-batch, estate-grown wines in the heart of wine country. Visit our tasting room or call to purchase.',
  area: 'Wine Country, CA',
  established: 'Est. 2000',

  contact: {
    phone: '(707) 555-0100',
    email: 'info@winery.com',
    address: '1234 Vineyard Lane, Wine Country, CA 95000',
    note: 'Give us a call or stop by the tasting room — we love talking wine.',
  },

  social: {
    facebook: '',
    instagram: '',
    yelp: '',
  },

  /** Primary navigation, shared across pages. */
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Our Wines', href: '/wines/' },
    { label: 'Our Story', href: '/story/' },
    { label: 'Visit', href: '/visit/' },
  ],

  hero: {
    kicker: 'Wine Country · California',
    heading: 'Estate wines crafted with patience and care',
    subheading:
      'A family vineyard where every bottle begins and ends on the same land — grown, made, and poured with intention.',
    ctaText: 'Explore our wines',
    ctaHref: '/wines/',
  },

  /** Short story used on the home page and expanded on the Story page. */
  story: {
    heading: 'Rooted in a love for the land',
    paragraphs: [
      'We planted our first vines with little more than curiosity and a deep respect for the land. Season after season, the vineyard taught us patience, and the wine began to speak for itself.',
      'Today we craft a small number of bottles each year — enough to share with those who seek out something genuine. Every vintage is a new conversation between the soil, the climate, and the people who tend these vines.',
    ],
    signoff: '— The Winery Family',
  },

  /** Value propositions shown as feature cards on the home page. */
  highlights: [
    'Estate grown & bottled',
    'Small-batch production',
    'Sustainably farmed',
    'Family owned since opening',
  ],

  /** The full wine list. Bottle images should live in public/images/ as wine-*.jpg */
  wines: [
    {
      name: 'Estate Red',
      varietal: 'Red Wine Blend',
      type: 'Blend' as const,
      image: 'wine-estate-red.jpg',
      notes: 'Our flagship blend — rich and balanced, with dark fruit, a touch of spice, and a smooth finish.',
    },
    {
      name: 'Sauvignon Blanc',
      varietal: 'Sauvignon Blanc',
      type: 'White' as const,
      image: 'wine-sauvignon-blanc.jpg',
      notes: 'Bright and aromatic, with citrus, green apple, and a clean, refreshing close.',
    },
  ] satisfies Wine[],

  tastingRoom: {
    available: true,
    note: 'Join us in the tasting room for a guided flight of our current releases.',
    hours: [
      { day: 'Sat – Sun', hours: '11:00 AM – 5:00 PM' },
    ] as BusinessHours[],
    reservationRequired: false,
    reservationLink: '',
  },

  awards: [
    'Gold Medal — California State Fair Wine Competition',
  ],

  /**
   * Brand colors. Adjust to match the winery's palette.
   */
  theme: {
    brand: '#722f37',    // primary — deep wine red
    brandDark: '#4a1e25', // hover / darker accents
  },
};

export type SiteConfig = typeof config;
