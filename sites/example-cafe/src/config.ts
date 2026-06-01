/**
 * Site configuration for The Corner Cup (example site).
 *
 * This is a worked example of the template — a fictional neighborhood café.
 * Compare it against sites/_template/src/config.ts to see how a real client
 * would be filled in.
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
  name: 'The Corner Cup',

  tagline: 'A cozy neighborhood café serving locally roasted coffee and fresh pastries.',

  seoDescription:
    'The Corner Cup is a cozy café in Maple Grove serving locally roasted coffee, ' +
    'fresh-baked pastries, and a warm welcome every morning.',

  area: 'Maple Grove, OR',

  contact: {
    phone: '(503) 555-0142',
    email: 'hello@thecornercup.coffee',
    address: '218 Birch Avenue, Maple Grove, OR 97001',
  },

  social: {
    facebook: 'https://facebook.com',
    instagram: 'https://instagram.com',
    google: 'https://google.com/maps',
  },

  hero: {
    heading: 'Your neighborhood spot for great coffee.',
    subheading:
      'Locally roasted beans, pastries baked fresh each morning, and a friendly face ' +
      'behind the counter. Stop by — we saved you a seat.',
    ctaText: 'See our hours',
    ctaHref: '#contact',
  },

  about: {
    heading: 'Brewing community since 2012',
    body:
      "We're a family-run café that's been part of Maple Grove for over a decade. " +
      'Every cup starts with beans roasted ten miles down the road, and every pastry ' +
      'is made from scratch in our little kitchen out back. We believe a good coffee ' +
      'shop is more than coffee — it’s where the neighborhood meets.',
  },

  servicesHeading: 'What’s on the menu',
  services: [
    {
      icon: '☕',
      title: 'Specialty coffee',
      description:
        'Espresso, pour-overs, and seasonal lattes made with locally roasted, ' +
        'fair-trade beans.',
    },
    {
      icon: '🥐',
      title: 'Fresh pastries',
      description:
        'Croissants, muffins, and scones baked from scratch every morning before ' +
        'we open the doors.',
    },
    {
      icon: '🥪',
      title: 'Light lunch',
      description:
        'Sandwiches, soups, and salads made with ingredients from nearby farms ' +
        'and bakeries.',
    },
    {
      icon: '💻',
      title: 'Free Wi-Fi & seating',
      description:
        'Comfy chairs, plenty of outlets, and fast Wi-Fi — perfect for catching up ' +
        'or getting work done.',
    },
  ] satisfies Service[],

  hours: [
    { day: 'Mon – Fri', hours: '6:30 AM – 6:00 PM' },
    { day: 'Saturday', hours: '7:00 AM – 6:00 PM' },
    { day: 'Sunday', hours: '7:00 AM – 3:00 PM' },
  ] satisfies BusinessHours[],

  theme: {
    brand: '#b45309', // warm coffee amber
    brandDark: '#92400e',
  },
};

export type SiteConfig = typeof config;
