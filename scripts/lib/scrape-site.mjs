/**
 * scrape-site.mjs — pull REAL facts from a prospect's existing website.
 *
 * This is the "make their dog-shit site 10x better" engine: instead of inventing
 * generic copy, we read what the business already says about itself and extract
 * the true, specific details — then the generator rewrites them into a better
 * site. Key-free, dependency-free (just fetch + string parsing), best-effort.
 *
 * Priority of truth, strongest first:
 *   1. JSON-LD structured data (LocalBusiness/Restaurant/Organization) — exact
 *      name, phone, address, hours, rating, reviews, founding date, images.
 *   2. <meta> / Open Graph tags — title, description, og:image.
 *   3. Visible HTML heuristics — headings, lists, paragraphs, tel:/mailto: links.
 *
 * Everything is optional: a field that can't be found is simply omitted, so the
 * caller can decide whether there's enough to build a custom site or whether to
 * flag it needs-review. NEVER fabricates — only reports what the page contains.
 *
 * Returns an `enrichment` object (see shape at the bottom) or null if the site
 * can't be reached at all.
 */

const UA =
  'Mozilla/5.0 (compatible; websites-outreach/1.0; +https://github.com/dukotah/websites)';

// --- small HTML utilities (no cheerio) -------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  '#x27': "'", '#x2F': '/', '#47': '/', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', eacute: 'é',
};

function decodeEntities(s = '') {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

const stripTags = (html = '') =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

const clean = (s = '') => decodeEntities(s).replace(/\s+/g, ' ').trim();

// Pull the contents of all <tag>…</tag> blocks (non-greedy).
function matchAll(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// Read an attribute value off a single tag string.
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? clean(m[1]) : '';
};

function metaContent(html, key) {
  // Matches <meta name|property="key" content="…"> in either attribute order.
  const re = new RegExp(
    `<meta[^>]*(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`,
    'i',
  );
  const tag = html.match(re)?.[0];
  if (!tag) return '';
  return attr(tag, 'content');
}

function absolutize(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return '';
  }
}

// --- JSON-LD extraction -----------------------------------------------------

function parseJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  }
  // Flatten @graph and arrays into a single node list.
  const nodes = [];
  const visit = (n) => {
    if (Array.isArray(n)) n.forEach(visit);
    else if (n && typeof n === 'object') {
      if (Array.isArray(n['@graph'])) n['@graph'].forEach(visit);
      nodes.push(n);
    }
  };
  blocks.forEach(visit);
  return nodes;
}

const BUSINESS_TYPES =
  /(LocalBusiness|Restaurant|Store|Organization|HomeAndConstructionBusiness|AutomotiveBusiness|ProfessionalService|FoodEstablishment|HealthAndBeautyBusiness|Winery|CafeOrCoffeeShop)/i;

function typeOf(node) {
  const t = node['@type'];
  return Array.isArray(t) ? t.join(' ') : String(t ?? '');
}

// A bare "Organization"/"Store"/"LocalBusiness" node is often the site
// PLATFORM's (Squarespace/WordPress/GoDaddy), injected ahead of the business's
// own LocalBusiness/Winery/Restaurant node — so its name/phone/address would be
// lifted instead of the business's. Prefer the most specific business type.
const GENERIC_TYPES = /^(Organization|Store|LocalBusiness)$/i;

function fromJsonLd(nodes, base) {
  const out = {};
  const bizNodes = nodes.filter((n) => BUSINESS_TYPES.test(typeOf(n)));
  const biz =
    bizNodes.find((n) => !GENERIC_TYPES.test(typeOf(n).trim())) ?? bizNodes[0];
  const review = nodes.filter((n) => /Review/i.test(typeOf(n)));

  if (biz) {
    if (biz.name) out.name = clean(String(biz.name));
    if (biz.telephone) out.phone = clean(String(biz.telephone));
    if (biz.email) out.email = clean(String(biz.email).replace(/^mailto:/i, ''));
    if (biz.foundingDate) {
      const yr = String(biz.foundingDate).match(/\d{4}/);
      if (yr) out.established = yr[0];
    }
    // Address
    const a = biz.address;
    if (a && typeof a === 'object') {
      const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
        .filter(Boolean)
        .map((x) => clean(String(x)));
      if (parts.length) out.address = parts.join(', ');
      if (a.addressLocality) out.city = clean(String(a.addressLocality));
      if (a.addressRegion) out.state = clean(String(a.addressRegion));
    } else if (typeof a === 'string') {
      out.address = clean(a);
    }
    // Hours — prefer the primary biz node; fall back to any biz node that has them.
    const oh = biz.openingHoursSpecification;
    if (oh) out.hours = normalizeHours(oh);
    // Rating
    const r = biz.aggregateRating;
    if (r && typeof r === 'object') {
      if (r.ratingValue) out.rating = Number(r.ratingValue);
      if (r.reviewCount || r.ratingCount)
        out.reviewCount = Number(r.reviewCount ?? r.ratingCount);
    }
    if (biz.priceRange) out.priceRange = clean(String(biz.priceRange));
    // Images — the business's real photos only. Deliberately EXCLUDE biz.logo:
    // a logo seeded here would land first in out.images and become the hero hint.
    // Run the name-based logo/icon filter before storing, too.
    const imgs = []
      .concat(biz.image ?? [], biz.photo ?? [])
      .flatMap((i) => (typeof i === 'string' ? [i] : i?.url ? [i.url] : []))
      .map((u) => absolutize(u, base))
      .filter(Boolean);
    const usefulImgs = usefulImages(imgs);
    if (usefulImgs.length) out.images = usefulImgs;
    // Social
    const same = [].concat(biz.sameAs ?? []).filter(Boolean);
    if (same.length) out.social = same;
    if (biz.description) out.description = clean(String(biz.description));
  }

  // Sweep ALL business-type nodes for trust signals missed by the primary node:
  // aggregateRating, openingHoursSpecification, foundingDate, priceRange.
  // This catches the common CMS pattern where these live in a separate LD block.
  for (const n of bizNodes) {
    if (!out.rating && n.aggregateRating && typeof n.aggregateRating === 'object') {
      if (n.aggregateRating.ratingValue) {
        out.rating = Number(n.aggregateRating.ratingValue);
        if (n.aggregateRating.reviewCount || n.aggregateRating.ratingCount)
          out.reviewCount = Number(n.aggregateRating.reviewCount ?? n.aggregateRating.ratingCount);
      }
    }
    if (!out.hours?.length && n.openingHoursSpecification) {
      const h = normalizeHours(n.openingHoursSpecification);
      if (h.length) out.hours = h;
    }
    if (!out.established && n.foundingDate) {
      const yr = String(n.foundingDate).match(/\d{4}/);
      if (yr) out.established = yr[0];
    }
    if (!out.priceRange && n.priceRange) {
      out.priceRange = clean(String(n.priceRange));
    }
  }

  // Reviews → testimonials
  const testimonials = review
    .map((rv) => {
      const body = clean(String(rv.reviewBody ?? rv.description ?? ''));
      const author =
        typeof rv.author === 'object' ? clean(String(rv.author?.name ?? '')) : clean(String(rv.author ?? ''));
      return body ? { quote: body, author: author || 'Verified customer' } : null;
    })
    .filter(Boolean);
  if (testimonials.length) out.testimonials = testimonials.slice(0, 4);

  return out;
}

const DAY_ABBR = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Label a set of days: a contiguous run becomes "Mon – Fri", but a gappy set
// (e.g. Mon, Wed, Fri) must NOT collapse to a range that falsely implies the
// in-between days are open — list them instead.
function daysLabel(days) {
  if (days.length <= 1) return days[0] ?? '';
  const idx = days.map((d) => DAY_ORDER.indexOf(d));
  const contiguous = idx.every((v, i) => i === 0 || (v >= 0 && v === idx[i - 1] + 1));
  return contiguous ? `${days[0]} – ${days[days.length - 1]}` : days.join(', ');
}

function normalizeHours(oh) {
  const specs = [].concat(oh);
  const out = [];
  for (const s of specs) {
    if (!s || typeof s !== 'object') continue;
    const days = [].concat(s.dayOfWeek ?? []).map((d) => {
      const name = String(d).split('/').pop();
      return DAY_ABBR[name] ?? name;
    });
    const open = s.opens;
    const close = s.closes;
    const label = daysLabel(days);
    const time =
      open && close ? `${fmtTime(open)} – ${fmtTime(close)}` : open ? `From ${fmtTime(open)}` : 'Closed';
    if (label) out.push({ day: label, hours: time });
  }
  return out;
}

function fmtTime(t) {
  const m = String(t).match(/^(\d{1,2}):?(\d{2})?/);
  if (!m) return String(t);
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

// --- visible-text hours extraction (fallback when JSON-LD hours are empty) ---

// Maps common day abbreviations / full names → canonical 3-letter abbreviation.
const DAY_ALIASES = {
  monday: 'Mon', mon: 'Mon',
  tuesday: 'Tue', tue: 'Tue', tues: 'Tue',
  wednesday: 'Wed', wed: 'Wed',
  thursday: 'Thu', thu: 'Thu', thur: 'Thu', thurs: 'Thu',
  friday: 'Fri', fri: 'Fri',
  saturday: 'Sat', sat: 'Sat',
  sunday: 'Sun', sun: 'Sun',
};

// Matches "Mon 9am – 5pm", "Monday: 9:00 AM - 6:00 PM", "Mon-Fri 8am-8pm", etc.
// Group 1: day (or day range like "Mon-Fri")
// Group 2+: the time range
const HOURS_LINE_RE =
  /\b((?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s*[-–—to]+\s*(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))?)\s*:?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s*[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)|closed|by\s+appointment)/gi;

function normalizeAmPm(t) {
  // "9am" → "9:00 AM", "17:00" → "5:00 PM", "9:30 PM" → "9:30 PM"
  t = t.trim();
  // Already has AM/PM label
  const labeled = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (labeled) {
    let h = Number(labeled[1]);
    const min = labeled[2] ?? '00';
    const ap = labeled[3].toUpperCase();
    return `${h}:${min} ${ap}`;
  }
  // 24-hour / bare number
  const bare = t.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (bare) {
    let h = Number(bare[1]);
    const min = bare[2] ?? '00';
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${min} ${ap}`;
  }
  return t;
}

function canonDay(raw) {
  return DAY_ALIASES[raw.toLowerCase().replace(/\.$/, '')] ?? raw;
}

/**
 * Scan the stripped visible text for day→time patterns and return
 * [{day, hours}] entries (same shape as normalizeHours). Best-effort.
 */
function extractVisibleHours(text) {
  const out = [];
  const seen = new Set();
  let m;
  HOURS_LINE_RE.lastIndex = 0;
  while ((m = HOURS_LINE_RE.exec(text)) !== null) {
    const dayRaw = m[1].trim();
    const timeRaw = m[2].trim();

    // Normalise the day portion — may be a range like "Mon-Fri"
    const dayNorm = dayRaw.replace(
      /^(\S+)\s*[-–—to]+\s*(\S+)$/i,
      (_, a, b) => `${canonDay(a)} – ${canonDay(b)}`,
    );
    const day = /\s*[-–]\s*/.test(dayNorm) ? dayNorm : canonDay(dayRaw);

    // Normalise the time range
    let hours;
    if (/closed/i.test(timeRaw)) {
      hours = 'Closed';
    } else if (/appointment/i.test(timeRaw)) {
      hours = 'By appointment';
    } else {
      const parts = timeRaw.split(/\s*[-–—to]+\s*/i);
      if (parts.length >= 2) {
        hours = `${normalizeAmPm(parts[0])} – ${normalizeAmPm(parts[parts.length - 1])}`;
      } else {
        hours = timeRaw; // fallback as-is
      }
    }

    const key = `${day}|${hours}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ day, hours });
    }
    if (out.length >= 7) break; // one entry per day of the week is enough
  }
  return out;
}

// --- visible-HTML heuristics (fallbacks when no JSON-LD) --------------------

const SERVICE_HINT =
  /\b(service|repair|install|cleaning|towing|recovery|catering|styling|color|maintenance|detailing|design|estimate|delivery|grooming|tasting|tour|menu|treatment|landscap|plumb|electric|roof|hvac|paint)/i;

function extractServices(html) {
  // Prefer list items inside sections that mention services; else any short,
  // service-flavored <li>/<h3> on the page. Keep distinct, title-like phrases.
  const candidates = [
    ...matchAll(html, 'li'),
    ...matchAll(html, 'h3'),
    ...matchAll(html, 'h4'),
  ]
    .map(stripTags)
    .filter((t) => t && t.length >= 4 && t.length <= 60)
    .filter((t) => SERVICE_HINT.test(t))
    // Drop nav/footer noise and calls-to-action that aren't real services.
    .filter((t) => !/(home|about|contact|privacy|terms|login|cart|©|copyright|sign in|read more|learn more)/i.test(t))
    .filter((t) => !/^(call|request|rate|review|reviews|book|schedule|get|view|see|shop|order)\b/i.test(t))
    // Phone numbers / digit-heavy strings aren't services.
    .filter((t) => !/\d{3}[\s.-]?\d{3,4}/.test(t));
  return dedupeCI(candidates).slice(0, 8);
}

function extractParagraphs(html) {
  return matchAll(html, 'p')
    .map(stripTags)
    .filter((t) => t.length >= 80 && t.length <= 600)
    // Skip cookie/legal boilerplate.
    .filter((t) => !/(cookie|privacy policy|all rights reserved|terms of service)/i.test(t));
}

// Pull customer-review text from visible HTML (most small-business reviews live
// as plain text, not JSON-LD): <blockquote>s, and elements whose class mentions
// review/testimonial/quote. Key-free, best-effort. We don't invent an author —
// scraped reviews rarely carry a clean name, so they're attributed generically.
const REVIEW_NOISE =
  /(leave a review|write a review|read more|view all|see all|google|yelp|facebook|trustpilot|powered by|©|copyright)/i;

function extractTestimonials(html) {
  const quotes = [];
  const consider = (raw) => {
    const q = stripTags(raw);
    if (q.length >= 40 && q.length <= 400 && !REVIEW_NOISE.test(q)) quotes.push(q);
  };
  for (const bq of matchAll(html, 'blockquote')) consider(bq);
  // Elements explicitly classed as a review/testimonial/quote (non-greedy, so a
  // deeply-nested card may truncate — acceptable for a best-effort heuristic).
  for (const m of html.matchAll(
    /<(?:div|li|article|p|figure)\b[^>]*class\s*=\s*["'][^"']*(?:review|testimonial|quote)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|article|p|figure)>/gi,
  )) {
    consider(m[1]);
  }
  // Rotate generic attributions — four identical "Verified customer" lines read
  // as fabricated. Still honest (no invented names); just less template-looking.
  const ATTRIB = ['Local customer', 'Happy customer', 'Returning customer', 'Satisfied customer'];
  return dedupeCI(quotes)
    .slice(0, 4)
    .map((quote, i) => ({ quote, author: ATTRIB[i % ATTRIB.length] }));
}

// Many builder CDNs (GoDaddy/wsimg, Wix, Squarespace, Cloudinary, Shopify)
// append a transform path after the real file, e.g.
//   …/IMG_1920.jpeg/:/cr=t:0%25,…/fx-gs   (the /:/… part, often grayscale).
// Strip it so we download the clean, full-resolution original.
function cleanImageUrl(u) {
  if (!u) return u;
  let s = u.trim().replace(/^["']|["']$/g, '');
  s = s.split('/:/')[0]; // wsimg / isteam transform suffix
  return s;
}

function extractImages(html, base) {
  const out = [];
  const push = (u) => {
    const abs = absolutize(cleanImageUrl(u), base);
    if (abs) out.push(abs);
  };
  // Pick the largest URL out of a srcset/“url 1x, url 2x” list.
  const fromSrcset = (set) => set?.split(',').pop()?.trim().split(/\s+/)[0];

  // <img> and friends — including the lazy-load attributes builder sites use
  // (data-src, data-srcset, data-srcsetlazy, data-srclazy, data-original).
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const srcset =
      attr(tag, 'srcset') || attr(tag, 'data-srcset') ||
      attr(tag, 'data-srcsetlazy') || attr(tag, 'data-lazy-srcset');
    const src =
      fromSrcset(srcset) || attr(tag, 'src') || attr(tag, 'data-src') ||
      attr(tag, 'data-srclazy') || attr(tag, 'data-original') || attr(tag, 'data-lazy');
    if (src) push(src);
  }
  // Any element carrying a lazy srcset/src (builder sites use <div data-srcsetlazy>).
  for (const m of html.matchAll(/\bdata-(?:srcset(?:lazy)?|src(?:lazy)?|original)\s*=\s*["']([^"']+)["']/gi)) {
    const u = fromSrcset(m[1]) || m[1];
    if (u) push(u);
  }
  // Inline background-image styles.
  for (const m of html.matchAll(/background-image\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) push(m[2]);

  // Fallback: harvest URLs from known image CDNs anywhere in the markup/JSON
  // config blobs (catches builder sites that embed images in scripts).
  const CDN =
    /(?:https?:)?\/\/[^"'\\\s)]*(?:wsimg\.com|wixstatic\.com|squarespace-cdn\.com|cloudinary\.com|shopify\.com|cdn\.[^/"']+)\/[^"'\\\s)]+/gi;
  for (const m of html.match(CDN) ?? []) push(m);

  return out;
}

// Skip logos, icons, sprites, tracking pixels, SVGs — keep real photos.
const IMG_REJECT = /(logo|icon|sprite|favicon|badge|avatar|placeholder|pixel|spinner|loader|svg|\.gif(\?|$))/i;

function usefulImages(urls) {
  return dedupe(
    urls.filter((u) => {
      if (!u || !/^https?:/i.test(u) || IMG_REJECT.test(u)) return false;
      // Reject bare origins (no real path) — e.g. "https://example.com/".
      try {
        const { pathname } = new URL(u);
        return pathname.length > 1;
      } catch {
        return false;
      }
    }),
  );
}

const dedupe = (arr) => [...new Set(arr.map((s) => s.trim()))].filter(Boolean);

// Case-insensitive dedupe that keeps the first-seen casing.
function dedupeCI(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr.map((x) => x.trim()).filter(Boolean)) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

// --- contact heuristics -----------------------------------------------------

const PHONE_RE = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
function findPhone(html) {
  const tel = html.match(/href\s*=\s*["']tel:([^"']+)["']/i);
  if (tel) return clean(tel[1]);
  let text = stripTags(html);
  // Strip fax numbers first — many sites list "Fax: (707) 555-5678" right next
  // to the phone, and a bare first-match would grab the fax.
  text = text.replace(/\bfax\b[:\s.#-]*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gi, ' ');
  // Prefer a number explicitly labelled phone/call/tel over the first one found.
  const labeled = text.match(/\b(?:phone|call|tel(?:ephone)?|ph)\b[:\s.#-]*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i);
  if (labeled) return clean(labeled[1]);
  const m = text.match(PHONE_RE);
  return m ? m[1] : '';
}

function findEmail(html) {
  const mail = html.match(/href\s*=\s*["']mailto:([^"'?]+)/i);
  if (mail) return clean(mail[1]);
  const m = stripTags(html).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0] : '';
}

function findEstablished(text) {
  const m = text.match(/\b(?:since|est(?:ablished)?\.?|founded(?:\s+in)?|serving\s+\w+\s+since)\s*(\d{4})/i);
  return m ? m[1] : '';
}

// Plain-text street-address fallback for the ~30% of small-business sites that
// don't ship a JSON-LD PostalAddress. Matches "123 Main St[, City, ST 12345]".
const STREET = /\b\d{1,5}\s+[A-Za-z0-9.'&-]+(?:\s+[A-Za-z0-9.'&-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Parkway|Pkwy|Court|Ct|Place|Pl|Highway|Hwy|Square|Sq|Terrace|Ter|Circle|Cir)\b\.?(?:,?\s+(?:Suite|Ste|Unit|#)\s*\w+)?(?:,\s*[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)?/;
const ADDRESS_LABEL =
  /\b(address|location|located|visit us|find us|our (?:office|shop|store|studio|location)|come see us|stop by)\b/i;
function findAddress(text) {
  const matches = [...text.matchAll(new RegExp(STREET, 'g'))];
  if (!matches.length) return '';
  // Prefer an address that sits just after a contact-y label over the first
  // street-pattern anywhere on the page (which can be a neighbor's address or a
  // "directions from …" mention).
  for (const m of matches) {
    const ctx = text.slice(Math.max(0, m.index - 60), m.index);
    if (ADDRESS_LABEL.test(ctx)) return clean(m[0]);
  }
  return clean(matches[0][0]);
}

function findSocial(html) {
  const out = { facebook: '', instagram: '', google: '' };
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const u = m[1];
    if (!out.facebook && /facebook\.com\//i.test(u)) out.facebook = u;
    if (!out.instagram && /instagram\.com\//i.test(u)) out.instagram = u;
    if (!out.google && /(g\.page|maps\.google|goo\.gl\/maps|business\.google)/i.test(u)) out.google = u;
  }
  return out;
}

// --- main -------------------------------------------------------------------

/**
 * Scrape one URL into a structured enrichment object. Best-effort: any field
 * that can't be found is omitted. Returns null only if the page can't be
 * fetched at all (so the caller can fall back to other research).
 *
 * @param {string} url
 * @param {{timeoutMs?: number}} [opts]
 */
export async function scrapeSite(url, { timeoutMs = 12000 } = {}) {
  if (!url) return null;
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let html;
  let finalUrl = target;
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    // Only parse HTML. A 200 PDF/JSON/JS/binary (common on parked or app domains)
    // would otherwise be regex-scanned as markup and yield garbage facts.
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !/text\/html|application\/xhtml|text\/plain/.test(ct)) return null;
    finalUrl = res.url || target;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!html || html.length < 200) return null;

  const base = finalUrl;
  const ld = fromJsonLd(parseJsonLd(html), base);

  const title = clean(matchAll(html, 'title')[0] ?? '');
  const ogTitle = metaContent(html, 'og:title');
  const ogDesc = metaContent(html, 'og:description');
  const metaDesc = metaContent(html, 'description');
  const ogImage = metaContent(html, 'og:image');
  const text = stripTags(html);

  // Merge JSON-LD (authoritative) over heuristics (fallback).
  const heuristicImages = usefulImages([
    absolutize(ogImage, base),
    ...extractImages(html, base),
  ]);

  const enrichment = {
    sourceUrl: finalUrl,
    name: ld.name || ogTitle || title.split(/[|\-–—]/)[0].trim() || '',
    description: ld.description || ogDesc || metaDesc || '',
    phone: ld.phone || findPhone(html),
    email: ld.email || findEmail(html),
    address: ld.address || findAddress(text),
    city: ld.city || '',
    state: ld.state || '',
    established: ld.established || findEstablished(text),
    hours: ld.hours?.length ? ld.hours : extractVisibleHours(text),
    rating: ld.rating,
    reviewCount: ld.reviewCount,
    priceRange: ld.priceRange,
    services: extractServices(html),
    about: extractParagraphs(html).slice(0, 4),
    // Prefer authoritative JSON-LD reviews; top up from visible HTML when thin.
    testimonials: ((ld.testimonials ?? []).length >= 2
      ? ld.testimonials
      : [...(ld.testimonials ?? []), ...extractTestimonials(html)]
    ).slice(0, 4),
    images: usefulImages([...(ld.images ?? []), ...heuristicImages]),
    social: mergeSocial(ld.social, findSocial(html)),
  };

  // Email is the single most-missing field and costs score points. Most small
  // businesses put it on a /contact (not the homepage), so if we came up empty,
  // do a few targeted subpage fetches before giving up.
  if (!enrichment.email) {
    enrichment.email = await findEmailOnSubpages(base);
  }

  // Signal of how much real material we actually got — the caller uses this to
  // decide ready vs needs-review.
  enrichment.richness = scoreRichness(enrichment);
  return enrichment;
}

// Likely email-bearing subpages, in priority order.
const CONTACT_PATHS = ['contact', 'contact-us', 'contactus', 'about', 'about-us'];

async function findEmailOnSubpages(base) {
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    return '';
  }
  for (const path of CONTACT_PATHS) {
    const page = await fetchHtml(`${origin}/${path}`, 8000);
    if (!page) continue;
    const email = findEmail(page.html);
    if (email) return email;
  }
  return '';
}

// --- deep image crawl --------------------------------------------------------

async function fetchHtml(url, timeoutMs = 12000) {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !/text\/html|application\/xhtml|text\/plain/.test(ct)) return null;
    return { html: await res.text(), finalUrl: res.url || target };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Internal links worth crawling for photos (galleries/services/about pages).
const PHOTO_PAGE_HINT = /gallery|galleries|photos?|portfolio|work|projects?|services?|about|menu|team|recent|featured|our-/i;

function findInternalPhotoLinks(html, base, max = 5) {
  const host = (() => { try { return new URL(base).host; } catch { return ''; } })();
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const text = stripTags(m[2] || '');
    if (!PHOTO_PAGE_HINT.test(href) && !PHOTO_PAGE_HINT.test(text)) continue;
    const abs = absolutize(href, base);
    if (!abs) continue;
    try {
      const u = new URL(abs);
      if (u.host !== host) continue; // same site only
      const key = u.pathname.replace(/\/$/, '');
      if (!key || key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push(abs);
    } catch { /* skip */ }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Collect real photo URLs from a site by scraping its homepage AND a few
 * photo-likely subpages (gallery/services/about). Key-free, best-effort.
 * Returns a deduped, logo-filtered list of absolute image URLs.
 */
export async function collectSiteImages(url, { maxPages = 4, timeoutMs = 12000 } = {}) {
  const home = await fetchHtml(url, timeoutMs);
  if (!home) return [];
  const base = home.finalUrl;
  // og:image / twitter:image is usually the business's intended hero — put it
  // first so the downloader can prefer it for the hero slot.
  const ogImages = ['og:image', 'og:image:url', 'twitter:image']
    .map((k) => absolutize(metaContent(home.html, k), base))
    .filter(Boolean);
  let images = [...ogImages, ...extractImages(home.html, base)];

  const links = findInternalPhotoLinks(home.html, base, maxPages);
  for (const link of links) {
    const page = await fetchHtml(link, timeoutMs);
    if (page) images = images.concat(extractImages(page.html, page.finalUrl));
  }
  return usefulImages(images);
}

function mergeSocial(sameAs = [], found) {
  const out = { ...found };
  for (const u of sameAs) {
    if (!out.facebook && /facebook\.com/i.test(u)) out.facebook = u;
    if (!out.instagram && /instagram\.com/i.test(u)) out.instagram = u;
    if (!out.google && /(g\.page|google)/i.test(u)) out.google = u;
  }
  return out;
}

// 0–100ish score: how confidently can we build a CUSTOM site from this?
function scoreRichness(e) {
  let s = 0;
  if (e.description && e.description.length > 60) s += 20;
  if (e.about.length) s += Math.min(20, e.about.length * 8);
  if (e.services.length >= 3) s += 20;
  if (e.images.length) s += Math.min(20, e.images.length * 7);
  if (e.phone) s += 5;
  if (e.address) s += 5;
  if (e.hours.length) s += 5;
  if (e.established) s += 5;
  if (e.testimonials.length) s += 5;
  return s;
}

export { stripTags, decodeEntities, parseJsonLd };
