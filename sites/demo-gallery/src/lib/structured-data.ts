/**
 * structured-data.ts — build category-aware schema.org JSON-LD for a prospect.
 *
 * A precise @type (Restaurant, HairSalon, Plumber, TattooParlor…) plus rich
 * fields (aggregateRating, openingHoursSpecification, priceRange, servesCuisine)
 * makes a site eligible for Google rich results — stars, hours and the business
 * category right in search. That's a concrete cold-outreach selling point, and
 * we already hold the data. Everything here is emitted ONLY when real data
 * exists; ratings/hours come from the same facts shown on the page.
 *
 * Refs: https://schema.org/Restaurant · https://schema.org/LocalBusiness ·
 *       Google "Local Business" structured-data docs.
 */
import { inferCategory } from './art-direction';
import type { ProspectConfig } from '../types';

/** Category → most specific valid schema.org business type (falls back to LocalBusiness). */
const SCHEMA_TYPE: Record<string, string> = {
  cafe: 'Restaurant',
  winery: 'Winery',
  salon: 'HairSalon',
  tattoo: 'TattooParlor',
  'auto-repair': 'AutoRepair',
  plumbing: 'Plumber',
  landscaping: 'HomeAndConstructionBusiness',
  towing: 'AutomotiveBusiness',
  marina: 'SportsActivityLocation',
};

/** Categories where servesCuisine / menu make sense. */
const FOOD_CATEGORIES = new Set(['cafe']);

const DAY_BY_ABBR: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Expand a day label ("Mon – Fri", "Saturday", "Wed – Sat") into full day names. */
function parseDays(label: string): string[] {
  const idx = (tok: string) => DAY_BY_ABBR[tok.trim().toLowerCase().slice(0, 3)];
  const parts = label.split(/–|—|-|\bto\b|&|,/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) {
    const d = idx(parts[0]);
    return d == null ? [] : [DAY_NAME[d]];
  }
  const a = idx(parts[0]);
  const b = idx(parts[parts.length - 1]);
  if (a == null || b == null) return [];
  const out: string[] = [];
  for (let d = a; ; d = (d + 1) % 7) {
    out.push(DAY_NAME[d]);
    if (d === b) break;
    if (out.length > 7) break; // safety
  }
  return out;
}

/** "9:00 AM" → "09:00"; "9 PM" → "21:00"; "12:00 AM" → "00:00". */
function parseTime(t: string): string | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ?? '00';
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/** Build openingHoursSpecification[] from the prospect's hours rows. */
function openingHours(hours: ProspectConfig['hours'] = []): object[] {
  const specs: object[] = [];
  for (const row of hours) {
    if (!row?.hours || /closed/i.test(row.hours)) continue;
    // 24/7 businesses (towing, locksmith…) write "Open 24 hours" / "24/7" —
    // the range parser can't read those, so emit a full-week always-open spec.
    if (/24\s*\/?\s*7|24\s*hours|always open|round the clock/i.test(row.hours)) {
      const days = parseDays(row.day);
      specs.push({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: days.length ? days : DAY_NAME.slice(),
        opens: '00:00',
        closes: '23:59',
      });
      continue;
    }
    const range = row.hours.split(/–|—|-|\bto\b/i).map((s) => s.trim());
    if (range.length < 2) continue;
    const opens = parseTime(range[0]);
    const closes = parseTime(range[1]);
    const days = parseDays(row.day);
    if (!opens || !closes || days.length === 0) continue;
    specs.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: days,
      opens,
      closes,
    });
  }
  return specs;
}

/** Assemble the JSON-LD object for a prospect page. */
export function buildJsonLd(
  config: ProspectConfig,
  opts: { canonical: string; image?: string },
): Record<string, unknown> {
  const category = inferCategory(config);
  const type = SCHEMA_TYPE[category] ?? 'LocalBusiness';
  const socials = Object.values(config.social ?? {}).filter(Boolean);
  const hoursSpec = openingHours(config.hours);

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': type,
    // Stable entity identifier — anchors this business in Google's entity graph
    // and lets sameAs links (GBP/Yelp/socials) reconcile to one node.
    '@id': `${opts.canonical}#business`,
    name: config.name,
    description: config.seoDescription,
    telephone: config.contact.phone,
    url: opts.canonical,
  };

  if (config.contact.email) ld.email = config.contact.email;
  if (config.contact.address) {
    const address: Record<string, string> = {
      '@type': 'PostalAddress',
      streetAddress: config.contact.address,
    };
    // Enrich with locality/region parsed from the "Town, ST" area string when
    // available — these power Google's address rich result.
    const areaParts = (config.area ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (areaParts.length >= 2) {
      address.addressLocality = areaParts[0];
      address.addressRegion = areaParts[areaParts.length - 1];
    } else if (areaParts.length === 1) {
      address.addressLocality = areaParts[0];
    }
    ld.address = address;
  }
  if (config.area) ld.areaServed = config.area;
  if (config.geo && Number.isFinite(config.geo.lat) && Number.isFinite(config.geo.lng)) {
    ld.geo = {
      '@type': 'GeoCoordinates',
      latitude: config.geo.lat,
      longitude: config.geo.lng,
    };
  }
  if (opts.image) ld.image = opts.image;
  if (socials.length) ld.sameAs = socials;
  if (hoursSpec.length) ld.openingHoursSpecification = hoursSpec;
  if (config.priceRange) ld.priceRange = config.priceRange;
  if (FOOD_CATEGORIES.has(category) && config.servesCuisine?.length) {
    ld.servesCuisine = config.servesCuisine;
  }
  // Google's self-serving-review policy: a LocalBusiness page that marks up its
  // OWN Google Business Profile rating receives NO star snippet and risks a manual
  // action. Only third-party ratings that are visibly displayed on the page may be
  // marked up. We therefore suppress aggregateRating when source === 'google'.
  // All other sources (yelp, tripadvisor, onsite) are eligible, as is the absent
  // case (treated as on-page/third-party for backward compatibility — no existing
  // prospect JSON sets `source`, so their emission is unchanged).
  if (config.rating && config.rating.count > 0 && config.rating.source !== 'google') {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: config.rating.value,
      reviewCount: config.rating.count,
      bestRating: 5,
    };
  }

  return ld;
}
