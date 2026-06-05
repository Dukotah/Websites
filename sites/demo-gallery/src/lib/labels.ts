/**
 * labels.ts — human-readable category labels and conversion CTA defaults.
 *
 * Two small, shared maps keyed by the SAME category vocabulary the art-direction
 * engine infers (see art-direction.ts KNOWN_CATEGORIES + inferCategory):
 *
 *   categoryLabelFor()  → an SEO-friendly descriptor for the <title>
 *                         ("Winery & Tasting Room") — not a raw slug.
 *   serviceCtaFor()     → the default call-to-action verb on a service card
 *                         ("Book a tasting", "Get a quote") when the service
 *                         data doesn't carry its own `cta`.
 *
 * Both are pure and fall back gracefully, so a brand-new/unknown category never
 * throws and just gets a neutral label/CTA.
 */

/** category → SEO descriptor used in the page <title> after the business name. */
const CATEGORY_LABEL: Record<string, string> = {
  winery: 'Winery & Tasting Room',
  cafe: 'Café & Bakery',
  towing: 'Towing & Roadside Assistance',
  plumbing: 'Plumbing Services',
  'auto-repair': 'Auto Repair',
  salon: 'Salon & Spa',
  landscaping: 'Landscaping & Lawn Care',
  tattoo: 'Tattoo & Piercing Studio',
  marina: 'Marina & Boat Rentals',
};

/**
 * Human-readable category label for the <title>, e.g.
 *   "Gellella Terra Vineyard — Winery & Tasting Room in Muncy, PA".
 * Returns '' for unknown/`default` categories so the title can fall back to the
 * plain "Name — Area" form rather than printing a meaningless slug.
 */
export function categoryLabelFor(category: string): string {
  return CATEGORY_LABEL[category] ?? '';
}

/**
 * Default service-card CTA verb per category (used when a service has no
 * explicit `cta`). Maps the engine's category vocabulary to the conversion
 * language a real operator in that trade would use.
 */
const SERVICE_CTA: Record<string, string> = {
  winery: 'Book a tasting',
  cafe: 'Make a reservation',
  towing: 'Call dispatch',
  'auto-repair': 'Call dispatch',
  plumbing: 'Get a quote',
  landscaping: 'Get a quote',
  salon: 'Book an appointment',
  tattoo: 'Book a consult',
  marina: 'Book a rental',
};

/** Default CTA label for a service card in the given category. */
export function serviceCtaFor(category: string): string {
  return SERVICE_CTA[category] ?? 'Get in touch';
}
