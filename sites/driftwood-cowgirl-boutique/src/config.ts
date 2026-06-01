/**
 * Site configuration for Driftwood Cowgirl Boutique.
 *
 * NOTE FOR DUKOTAH — a few details are best-guess and marked "VERIFY":
 *   - email (placeholder — confirm with the owner)
 *   - exact boutique hours (mirrored from Horse N Around Trail Rides)
 *   - phone is the shared location/sign-in line; confirm it's the one they want
 * Everything else is from public listings (address, vibe, products, socials).
 */

export interface Service {
  title: string;
  description: string;
  icon?: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export const config = {
  name: 'Driftwood Cowgirl Boutique',

  tagline: 'A beachy boutique with a boho western flare on the Sonoma Coast.',

  seoDescription:
    'Driftwood Cowgirl Boutique in Bodega, CA — a beachy, boho-western shop with ' +
    'coastal cowgirl apparel, jewelry, and gifts from local brands and artists. ' +
    'Home base for Horse N Around Trail Rides.',

  area: 'Bodega, California',

  contact: {
    phone: '(707) 875-3333', // VERIFY: shared location / trail-ride sign-in line
    email: 'hello@driftwoodcowgirl.com', // VERIFY placeholder
    address: '17135A Bodega Highway, Bodega, CA 94922',
  },

  social: {
    facebook: 'https://www.facebook.com/61565434221467',
    instagram: 'https://www.instagram.com/driftwoodcowgirlboutique/',
    google: 'https://maps.google.com/?q=Driftwood+Cowgirl+Boutique+Bodega+CA',
  },

  hero: {
    heading: 'Coastal cowgirl style, straight from the Sonoma Coast.',
    subheading:
      'A beachy little boutique with a boho-western soul — apparel, jewelry, and ' +
      'gifts you won’t find anywhere else, plus pieces from local brands and artists. ' +
      'Saddle up and stop in.',
    ctaText: 'Visit the shop',
    ctaHref: '#contact',
  },

  about: {
    heading: 'Where the coast meets the country',
    body:
      'Tucked into a coastal cattle ranch just up the road from Bodega Bay, Driftwood ' +
      'Cowgirl Boutique is where salt air meets western charm. We’re also the home base ' +
      'and check-in spot for Horse N Around Trail Rides, so you can browse boho-western ' +
      'finds before (or after) you hit the trail and the beach on horseback. We love ' +
      'championing local makers, so much of what’s on our shelves comes from artists and ' +
      'brands right here on the Sonoma Coast.',
  },

  servicesHeading: 'What you’ll find in the shop',
  services: [
    {
      icon: '👢',
      title: 'Boho-western apparel',
      description:
        'Coastal cowgirl tops, tees, and layers with that easy beachy-meets-western feel.',
    },
    {
      icon: '💍',
      title: 'Jewelry & accessories',
      description:
        'Turquoise, leather, and handmade pieces to finish off any coastal cowgirl look.',
    },
    {
      icon: '🐴',
      title: 'Horse N Around merch',
      description:
        'Signature Horse N Around tank tops and sweatshirts — a keepsake from your ride.',
    },
    {
      icon: '🌊',
      title: 'Bodega Bay keepsakes',
      description:
        'Local souvenirs and gifts to remember your trip to the Sonoma Coast.',
    },
    {
      icon: '🎨',
      title: 'Local makers',
      description:
        'Goods from Sonoma Coast artists and small brands — always something new to discover.',
    },
    {
      icon: '🎁',
      title: 'Gifts for everyone',
      description:
        'One-of-a-kind finds for the cowgirls, beach lovers, and free spirits in your life.',
    },
  ] satisfies Service[],

  // VERIFY: mirrored from Horse N Around Trail Rides hours.
  hours: [
    { day: 'Mon – Fri', hours: '9:00 AM – 5:00 PM' },
    { day: 'Sat – Sun', hours: '9:00 AM – 7:00 PM' },
  ] satisfies BusinessHours[],

  theme: {
    brand: '#b85c38', // sunset terracotta — warm western/coastal
    brandDark: '#8f4527',
  },
};

export type SiteConfig = typeof config;
