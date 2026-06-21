/**
 * augment-enrichment.mjs — OPTIONAL "turbo mode" enrichment.
 *
 * The key-free scraper (scrape-site.mjs) can only read a business's OWN site, so
 * two scoring dimensions are unreachable on most sites: real REVIEWS/RATING and
 * extra real PHOTOS (both live on Google Maps, not the business's HTML). This
 * module fills that gap from Google Maps via Outscraper — but ONLY when
 * OUTSCRAPER_API_KEY is set. With no key it is a pure no-op, so the key-free
 * pipeline is completely unaffected.
 *
 *   Cost (Outscraper pay-as-you-go): ~$3 / 1,000 reviews, 500 reviews free on
 *   signup, no subscription. At ~3 reviews/site that's ~$0.009/site → the first
 *   ~160 sites are free, and it never expires.
 *
 * Enable:  set OUTSCRAPER_API_KEY in the environment (and optionally
 *          OUTSCRAPER_REVIEWS_LIMIT, default 5).
 *
 * LEGAL / ATTRIBUTION POLICY (encoded here, per the research):
 *   - Review TEXT is clipped to ≤50 words and attributed generically to
 *     "Google reviewer" — never the reviewer's real name.
 *   - Rating/review-count are shown as aggregate stats ("4.8 ★ · 212 reviews").
 *   - Nothing is fabricated: if Outscraper returns nothing, the fields stay
 *     empty and the site is flagged needs-review (never faked).
 *   - Google Maps photo URLs are passed to the downloader as CANDIDATES behind
 *     the business's own photos (own-site always wins the hero).
 */

const ENDPOINT = 'https://api.outscraper.com/maps/reviews-v3';

/** Clip review text to a max word count without cutting mid-word. */
function clipWords(s, maxWords = 50) {
  const words = String(s || '').replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ').replace(/[,;:.!?-]+$/, '') + '…';
}

/** Map Outscraper working_hours object → our [{day, hours}] shape. */
function mapHours(working) {
  if (!working || typeof working !== 'object') return [];
  const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return order
    .filter((d) => working[d])
    .map((d) => ({ day: d.slice(0, 3), hours: String(working[d]).replace(/ /g, ' ') }));
}

/**
 * Pull the first place object out of Outscraper's (variably-nested) response.
 * The Maps Reviews endpoint returns `data` as an array of places (sometimes
 * wrapped one level deeper), each with a `reviews_data` array.
 */
function firstPlace(json) {
  let d = json?.data ?? json;
  while (Array.isArray(d) && d.length && Array.isArray(d[0])) d = d[0];
  if (Array.isArray(d)) d = d[0];
  return d && typeof d === 'object' ? d : null;
}

/**
 * Augment (in place) and return the enrichment object with Google-Maps data.
 * Creates a minimal enrichment if `e` is null (e.g. a business with no website).
 * No-op (returns `e` unchanged) when OUTSCRAPER_API_KEY is absent.
 */
export async function augmentEnrichment(e, row) {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key) return e; // key-free mode — pure no-op

  const query = [row?.name, row?.city, row?.state].filter(Boolean).join(', ');
  if (!query) return e;

  const limit = Number(process.env.OUTSCRAPER_REVIEWS_LIMIT || 5);
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&reviewsLimit=${limit}&limit=1&async=false`;

  let place;
  try {
    const res = await fetch(url, { headers: { 'X-API-KEY': key, accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`    ! Outscraper ${res.status} for "${query}" — leaving key-free data as-is`);
      return e;
    }
    place = firstPlace(await res.json());
  } catch (err) {
    console.warn(`    ! Outscraper failed for "${query}" (${err.message}) — key-free data kept`);
    return e;
  }
  if (!place) return e;

  // Ensure we have an object to enrich.
  e = e || { images: [], testimonials: [], about: [], services: [], social: {} };
  e.images = e.images || [];
  const mapsUrl = place.link || place.google_maps_url || place.place_url || '';

  // Rating + review count (aggregate stats — no legal exposure).
  if (place.rating != null && !e.rating) e.rating = Number(place.rating);
  const rc = place.reviews ?? place.reviews_count ?? place.user_ratings_total;
  if (rc != null && !e.reviewCount) e.reviewCount = Number(rc);

  // Founding year, if Outscraper surfaced one.
  const founded = place.founded || place.opening_date || place.opened;
  if (founded && !e.established) {
    const yr = String(founded).match(/\b(19|20)\d{2}\b/);
    if (yr) e.established = yr[0];
  }

  // Real review text → testimonials (honest generic attribution, clipped).
  const reviews = (place.reviews_data || place.reviews_list || [])
    .filter((r) => (r.review_text || r.text || '').trim().length > 25)
    .slice(0, limit)
    .map((r) => ({
      quote: clipWords(r.review_text || r.text, 50),
      author: 'Google reviewer',
      ...(mapsUrl ? { source: mapsUrl } : {}),
    }));
  // Only override own-site testimonials when the scrape found none.
  if (reviews.length && !(e.testimonials?.length)) e.testimonials = reviews;

  // Hours, only if the own-site scrape came up empty.
  if (!(e.hours?.length)) {
    const hrs = mapHours(place.working_hours);
    if (hrs.length) e.hours = hrs;
  }

  // Photos: APPEND Google Maps photo URLs as candidates (own-site wins hero).
  const photos = (place.photos_data || place.photos || [])
    .map((p) => (typeof p === 'string' ? p : p?.photo_url || p?.url))
    .filter(Boolean);
  if (photos.length) e.images = [...e.images, ...photos];

  e._source = e._source ? `${e._source}+outscraper` : 'outscraper';
  return e;
}
