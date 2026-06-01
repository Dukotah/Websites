/**
 * Site configuration for Driftwood Cowgirl Boutique.
 *
 * NOTE FOR DUKOTAH — a few details are best-guess and marked "VERIFY":
 *   - email (placeholder — confirm with the owner)
 *   - exact boutique hours (mirrored from Horse N Around Trail Rides)
 *   - phone is the shared location/sign-in line; confirm it's the one they want
 * Everything else is from public listings (address, products, socials).
 */

export interface Service {
  /** Key into the icon set in src/components/Services.astro */
  icon: 'apparel' | 'jewelry' | 'horse' | 'wave' | 'art' | 'gift';
  title: string;
  description: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export const config = {
  name: 'Driftwood Cowgirl Boutique',

  tagline: 'Western and beachy clothing, jewelry, and gifts in Bodega, California.',

  seoDescription:
    'Driftwood Cowgirl Boutique in Bodega, CA. Western and beach-inspired clothing, ' +
    'jewelry, and gifts, plus work from local artists. The check-in spot for Horse N ' +
    'Around Trail Rides.',

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
    heading: 'A little western, a little beachy.',
    subheading:
      'Clothing, jewelry, and gifts on a coastal ranch outside Bodega Bay — and the ' +
      'check-in spot for Horse N Around Trail Rides. Come browse before your ride.',
    ctaText: 'Plan your visit',
    ctaHref: '#contact',
  },

  about: {
    heading: 'About the shop',
    body:
      'Driftwood Cowgirl Boutique sits on a coastal cattle ranch just outside Bodega Bay. ' +
      'We carry western and beach-inspired clothing, jewelry, and gifts, along with work ' +
      'from artists and small brands here on the Sonoma Coast. The shop is also where you ' +
      'check in for Horse N Around Trail Rides, so you can stop in before or after a ride ' +
      'along the ranch trails and the beach.',
  },

  servicesHeading: 'What we carry',
  services: [
    {
      icon: 'apparel',
      title: 'Clothing',
      description: 'Western and beach-inspired tops, tees, and layers for everyday wear.',
    },
    {
      icon: 'jewelry',
      title: 'Jewelry & accessories',
      description: 'Turquoise, leather, and handmade pieces.',
    },
    {
      icon: 'horse',
      title: 'Horse N Around merch',
      description: 'Tank tops and sweatshirts from the trail-ride crew.',
    },
    {
      icon: 'wave',
      title: 'Bodega Bay souvenirs',
      description: 'Gifts and keepsakes from the Sonoma Coast.',
    },
    {
      icon: 'art',
      title: 'Local artists',
      description: 'Goods from makers and small brands around the area.',
    },
    {
      icon: 'gift',
      title: 'Gifts',
      description: 'Cards, small gifts, and finds for any occasion.',
    },
  ] satisfies Service[],

  // VERIFY: mirrored from Horse N Around Trail Rides hours.
  hours: [
    { day: 'Mon – Fri', hours: '9:00 AM – 5:00 PM' },
    { day: 'Sat – Sun', hours: '9:00 AM – 7:00 PM' },
  ] satisfies BusinessHours[],

  theme: {
    brand: '#b85c38', // sunset terracotta
    brandDark: '#8f4527',
  },
};

export type SiteConfig = typeof config;
