/**
 * structured-data.ts — build category-aware schema.org JSON-LD for a prospect.
 *
 * A precise @type (Restaurant, HairSalon, Plumber, TattooParlor…) plus rich
 * fields (aggregateRating, openingHoursSpecification, priceRange, servesCuisine)
 * makes a site eligible for Google rich results — stars, hours and the business
 * category right in search. That's a concrete cold-outreach selling point, and
 * we already hold the data. Everything here is emitted ONLY when real data
 * exists; ratings/hours/FAQ/services come from the SAME facts shown on the page.
 *
 * Typing: nodes are typed against `schema-dts`, so a property that isn't valid
 * for its schema.org type (a typo, or a field on the wrong type) fails
 * `astro check`. That turns the "did I spell `reviewCount` right / does
 * `acceptedAnswer` belong on a Question" guesswork into a compile error.
 *
 * Output shape: a single JSON-LD `@graph` so one <script> can carry several
 * cross-linked entities — the LocalBusiness, its per-service Service/OfferCatalog,
 * any FAQPage, and a BreadcrumbList — each its own rich-result candidate. The
 * call site (BaseLayout.astro) just JSON-stringifies whatever we return, so the
 * graph is a drop-in for the previous single object.
 *
 * Refs: https://schema.org/Restaurant · https://schema.org/LocalBusiness ·
 *       https://schema.org/FAQPage · https://schema.org/Service ·
 *       https://schema.org/BreadcrumbList · Google rich-results docs. Field
 *       coverage cross-checked against JayHoltslander/Structured-Data-JSON-LD.
 */
import type {
  Graph,
  Thing,
  LocalBusiness,
  PostalAddress,
  GeoCoordinates,
  OpeningHoursSpecification,
  DayOfWeek,
  AggregateRating,
  FAQPage,
  Question,
  Answer,
  Service,
  OfferCatalog,
  Offer,
  BreadcrumbList,
  ListItem,
} from 'schema-dts';
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
// Typed as DayOfWeek[] so schema-dts accepts these directly as
// OpeningHoursSpecification.dayOfWeek values (it requires the schema.org
// DayOfWeek enum, of which the plain "Monday"… names are members).
const DAY_NAME: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Expand a day label ("Mon – Fri", "Saturday", "Wed – Sat") into full day names. */
function parseDays(label: string): DayOfWeek[] {
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
  const out: DayOfWeek[] = [];
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
function openingHours(hours: ProspectConfig['hours'] = []): OpeningHoursSpecification[] {
  const specs: OpeningHoursSpecification[] = [];
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

/**
 * Build the FAQPage node from any `faq` sections — the page renders these Q/A
 * rows (FaqSection.astro), so marking them up is the "match visible content"
 * rule satisfied for free, and an easy rich-result win. Returns null when there
 * is no FAQ on the page (don't emit an empty FAQPage).
 */
function buildFaqPage(config: ProspectConfig, canonical: string): FAQPage | null {
  const rows: { q: string; a: string }[] = [];
  for (const section of config.sections ?? []) {
    if (section.type !== 'faq') continue;
    for (const item of section.items ?? []) {
      if (item?.q && item?.a) rows.push({ q: item.q, a: item.a });
    }
  }
  if (rows.length === 0) return null;

  const mainEntity: Question[] = rows.map((row) => {
    const acceptedAnswer: Answer = { '@type': 'Answer', text: row.a };
    return { '@type': 'Question', name: row.q, acceptedAnswer };
  });

  return {
    '@type': 'FAQPage',
    // Anchor the FAQ to the page URL; the business node lives at #business.
    '@id': `${canonical}#faq`,
    mainEntity,
  };
}

/**
 * Build per-service Service nodes (each provided by the business) plus the
 * OfferCatalog that lists them. Services are rendered on the page from
 * `config.services`, so the markup mirrors visible content. Returns the catalog
 * (to attach to the business as `hasOfferCatalog`) and the standalone Service
 * nodes (added to the graph as their own rich-result candidates).
 */
function buildServices(
  config: ProspectConfig,
  canonical: string,
  businessRef: { '@id': string },
): { catalog: OfferCatalog | null; services: Service[] } {
  const real = (config.services ?? []).filter((s) => s?.title);
  if (real.length === 0) return { catalog: null, services: [] };

  const services: Service[] = real.map((svc, i) => {
    const node: Service = {
      '@type': 'Service',
      '@id': `${canonical}#service-${i}`,
      name: svc.title,
      // provider links every Service back to the one business entity.
      provider: businessRef,
    };
    if (svc.description) node.description = svc.description;
    if (config.area) node.areaServed = config.area;
    return node;
  });

  // The OfferCatalog wraps each Service in an Offer (the schema.org-correct
  // container for "things this provider offers"), referencing the Service nodes
  // by @id so we don't duplicate their content.
  const itemListElement: Offer[] = services.map((svc) => ({
    '@type': 'Offer',
    itemOffered: { '@id': svc['@id'] as string },
  }));

  const catalog: OfferCatalog = {
    '@type': 'OfferCatalog',
    '@id': `${canonical}#services`,
    name: config.servicesHeading || `${config.name} services`,
    itemListElement,
  };

  return { catalog, services };
}

/**
 * Build a BreadcrumbList (Home → this business). It's a small, always-valid
 * rich result that gives the business name a breadcrumb trail in search, and we
 * can derive it entirely from the canonical URL — no extra config needed.
 */
function buildBreadcrumb(config: ProspectConfig, canonical: string): BreadcrumbList {
  let home = canonical;
  try {
    home = new URL(canonical).origin + '/';
  } catch {
    // Non-absolute canonical (shouldn't happen) — fall back to the canonical.
  }

  const itemListElement: ListItem[] = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: home },
    { '@type': 'ListItem', position: 2, name: config.name, item: canonical },
  ];

  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumb`,
    itemListElement,
  };
}

/**
 * Assemble the JSON-LD `@graph` for a prospect page.
 *
 * Returns a typed `Graph`; BaseLayout JSON-stringifies it into the page's
 * ld+json script. We type the *return* as Graph (so the call site is checked)
 * while the business node is built as a typed `LocalBusiness` value below — that
 * combination is what makes invalid schema.org properties fail `astro check`.
 */
export function buildJsonLd(
  config: ProspectConfig,
  opts: { canonical: string; image?: string },
): Graph {
  const category = inferCategory(config);
  const type = SCHEMA_TYPE[category] ?? 'LocalBusiness';
  const socials = Object.values(config.social ?? {}).filter(Boolean);
  const hoursSpec = openingHours(config.hours);
  const businessId = `${opts.canonical}#business`;

  // Build the business node as a typed LocalBusiness so every property below is
  // schema-validated. The specific @type (Restaurant/HairSalon/…) is chosen at
  // runtime from SCHEMA_TYPE, which schema-dts can't narrow to its literal
  // union; we attach it via a typed cast on JUST the @type field. Every OTHER
  // field still gets full property checking from the LocalBusiness type.
  const business: LocalBusiness = {
    // Stable entity identifier — anchors this business in Google's entity graph
    // and lets sameAs links (GBP/Yelp/socials) reconcile to one node.
    '@id': businessId,
    // SCHEMA_TYPE yields a runtime string ("Restaurant", "HairSalon", …) that
    // schema-dts can't narrow to its @type literal union; the cast applies to
    // JUST this field. Every OTHER property is still fully type-checked.
    '@type': type as 'LocalBusiness',
    name: config.name,
    description: config.seoDescription,
    telephone: config.contact.phone,
    url: opts.canonical,
  };

  if (config.contact.email) business.email = config.contact.email;
  if (config.contact.address) {
    const address: PostalAddress = {
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
    business.address = address;
  }
  if (config.area) business.areaServed = config.area;
  if (config.geo && Number.isFinite(config.geo.lat) && Number.isFinite(config.geo.lng)) {
    const geo: GeoCoordinates = {
      '@type': 'GeoCoordinates',
      latitude: config.geo.lat,
      longitude: config.geo.lng,
    };
    business.geo = geo;
  }
  if (opts.image) business.image = opts.image;
  if (socials.length) business.sameAs = socials;
  if (hoursSpec.length) business.openingHoursSpecification = hoursSpec;
  if (config.priceRange) business.priceRange = config.priceRange;
  if (FOOD_CATEGORIES.has(category) && config.servesCuisine?.length) {
    // servesCuisine is only valid on FoodEstablishment subtypes (Restaurant,
    // Winery…); we only reach here for FOOD_CATEGORIES, but the property isn't on
    // the base LocalBusiness type, so set it through a narrowed view.
    (business as { servesCuisine?: string[] }).servesCuisine = config.servesCuisine;
  }
  // Google's self-serving-review policy: a LocalBusiness page that marks up its
  // OWN Google Business Profile rating receives NO star snippet and risks a manual
  // action. Only third-party ratings that are visibly displayed on the page may be
  // marked up. We therefore suppress aggregateRating when source === 'google'.
  // All other sources (yelp, tripadvisor, onsite) are eligible, as is the absent
  // case (treated as on-page/third-party for backward compatibility — no existing
  // prospect JSON sets `source`, so their emission is unchanged).
  if (config.rating && config.rating.count > 0 && config.rating.source !== 'google') {
    const aggregateRating: AggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: config.rating.value,
      reviewCount: config.rating.count,
      bestRating: 5,
    };
    business.aggregateRating = aggregateRating;
  }

  // Per-service Service nodes + OfferCatalog (rendered services → markup).
  const { catalog, services } = buildServices(config, opts.canonical, { '@id': businessId });
  if (catalog) business.hasOfferCatalog = { '@id': catalog['@id'] as string };

  // The graph: business first, then its cross-linked satellites. Only nodes
  // backed by real, on-page content are added — empty FAQ/services emit nothing.
  const graph: Thing[] = [business];
  if (catalog) graph.push(catalog);
  graph.push(...services);

  const faq = buildFaqPage(config, opts.canonical);
  if (faq) graph.push(faq);

  graph.push(buildBreadcrumb(config, opts.canonical));

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}
