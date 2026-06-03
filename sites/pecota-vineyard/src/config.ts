/**
 * Site configuration — edit THIS file first.
 *
 * Holds the business details, navigation, wine list, and brand colors that drive
 * the Pecota Vineyard site. Most content updates happen here.
 */

export interface Wine {
  name: string;
  varietal: string;
  type: 'Red' | 'White' | 'Blend';
  image: string;
  notes: string;
}

export const config = {
  name: 'Pecota Vineyard',
  tagline: 'Handcrafted wines, sustainably grown.',
  seoDescription:
    'Pecota Vineyard is a small family winery in Shingle Springs, El Dorado County, California, crafting award-winning, sustainably grown wines — 275–300 cases a year.',
  area: 'Shingle Springs, CA',

  contact: {
    phone: '(530) 677-4365',
    email: '', // no public email listed — inquiries via phone / Instagram
    location: 'Shingle Springs, El Dorado County, California',
    note: 'A small family micro-winery — we don’t have a public tasting room. Reach out by phone to purchase wine or ask a question.',
  },

  social: {
    instagram: 'https://www.instagram.com/pecotavineyard/',
  },

  /** Primary navigation, shared across pages. */
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Our Wines', href: '/wines/' },
    { label: 'Our Story', href: '/story/' },
    { label: 'Visit', href: '/visit/' },
  ],

  hero: {
    kicker: 'Shingle Springs · El Dorado County',
    heading: 'Handcrafted wines, sustainably grown',
    subheading:
      'A two-acre family vineyard in the Sierra foothills, where every bottle is grown, made, and poured with care.',
    ctaText: 'Explore our wines',
    ctaHref: '/wines/',
  },

  /** Short story used on the home page and expanded on the Story page. */
  story: {
    heading: 'A long-held dream, rooted in two acres',
    paragraphs: [
      'In 2012 we realized our long time dream of planting a two acre vineyard on our property. Jeff became a self-taught winemaker with the help of experienced mentors.',
      'Producing our first vintage in 2015 was a thrilling time, and we knew our vines grew on a special vineyard site. Today these two acres allow us to bottle 275–300 cases per year. Now each year brings new challenges and new successes.',
    ],
    signoff: '— Jeff & Renée Pecota',
  },

  sustainability: {
    heading: 'Grown the gentle way',
    body: 'We farm without pesticides, herbicides, or artificial fertilizers. Cover crops control erosion, suppress weeds, and invite the beneficial insects that keep our vineyard in balance — so the land stays healthy for the vintages to come.',
    points: [
      { title: 'No synthetic sprays', text: 'No pesticides, herbicides, or artificial fertilizers.' },
      { title: 'Living cover crops', text: 'For erosion control, weed suppression, and beneficial insects.' },
      { title: 'Estate grown & bottled', text: 'Every bottle is grown, made, and bottled on our two acres.' },
      { title: 'Truly small batch', text: 'Just 275–300 cases a year — handcrafted, never rushed.' },
    ],
  },

  /** The full wine list (bottle images live in src/assets/images). */
  wines: [
    {
      name: 'Cabernet Sauvignon',
      varietal: 'Cabernet Sauvignon',
      type: 'Red',
      image: 'wine-cabernet-sauvignon.jpg',
      notes: 'Full-bodied and structured, with dark fruit, a touch of oak, and a long, smooth finish.',
    },
    {
      name: 'Cabernet Franc',
      varietal: 'Cabernet Franc',
      type: 'Red',
      image: 'wine-cabernet-franc.jpg',
      notes: 'Aromatic and elegant, with red berry fruit, soft tannins, and a savory, herbal edge.',
    },
    {
      name: 'Merlot',
      varietal: 'Merlot',
      type: 'Red',
      image: 'wine-merlot.jpg',
      notes: 'Approachable and velvety, layered with plum, black cherry, and a gentle, rounded finish.',
    },
    {
      name: 'Tempranillo',
      varietal: 'Tempranillo',
      type: 'Red',
      image: 'wine-tempranillo.jpg',
      notes: 'Spanish-inspired and food-friendly, showing ripe cherry, leather, and warm spice.',
    },
    {
      name: 'Sangiovese',
      varietal: 'Sangiovese',
      type: 'Red',
      image: 'wine-sangiovese.jpg',
      notes: 'Bright and lively, with tart red cherry, dried herbs, and a refreshing acidity.',
    },
    {
      name: 'Primitivo',
      varietal: 'Primitivo',
      type: 'Red',
      image: 'wine-primitivo.jpg',
      notes: 'Bold and jammy, brimming with ripe berry fruit and a generous, rounded body.',
    },
    {
      name: 'Running Deer Red Blend',
      varietal: 'Red Wine Blend',
      type: 'Blend',
      image: 'wine-running-deer.jpg',
      notes: 'Our signature estate blend — balanced and easygoing, made to share at the table.',
    },
    {
      name: 'Sauvignon Blanc',
      varietal: 'Sauvignon Blanc',
      type: 'White',
      image: 'wine-sauvignon-blanc.jpg',
      notes: 'Crisp and aromatic, with citrus, green apple, and a clean, zesty finish.',
    },
    {
      name: 'Semillon',
      varietal: 'Semillon',
      type: 'White',
      image: 'wine-semillon.jpg',
      notes: 'Soft and rounded, offering stone fruit, a hint of honey, and a gentle texture.',
    },
  ] satisfies Wine[],

  /**
   * Brand colors. Deep wine burgundy from the Pecota wordmark.
   */
  theme: {
    brand: '#86222f', // primary — wine burgundy
    brandDark: '#651923', // hover / darker accents
  },
};

export type SiteConfig = typeof config;
