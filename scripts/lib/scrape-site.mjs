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

function fromJsonLd(nodes, base) {
  const out = {};
  const biz = nodes.find((n) => BUSINESS_TYPES.test(typeOf(n)));
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
    // Hours
    const oh = biz.openingHoursSpecification;
    if (oh) out.hours = normalizeHours(oh);
    // Rating
    const r = biz.aggregateRating;
    if (r && typeof r === 'object') {
      if (r.ratingValue) out.rating = Number(r.ratingValue);
      if (r.reviewCount || r.ratingCount)
        out.reviewCount = Number(r.reviewCount ?? r.ratingCount);
    }
    // Images
    const imgs = []
      .concat(biz.image ?? [], biz.photo ?? [], biz.logo ?? [])
      .flatMap((i) => (typeof i === 'string' ? [i] : i?.url ? [i.url] : []))
      .map((u) => absolutize(u, base))
      .filter(Boolean);
    if (imgs.length) out.images = imgs;
    // Social
    const same = [].concat(biz.sameAs ?? []).filter(Boolean);
    if (same.length) out.social = same;
    if (biz.description) out.description = clean(String(biz.description));
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
    const label = days.length > 1 ? `${days[0]} – ${days[days.length - 1]}` : days[0] ?? '';
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
  // Scraped reviews rarely carry a clean name. Rather than stamp a fabricated-
  // looking "Yelp reviewer" / "Happy customer" attribution, leave the author
  // EMPTY — the component renders an unattributed quote (no fake byline), and the
  // copy-sanity guard keeps only substantive (>=60 char) unattributed quotes.
  return dedupeCI(quotes)
    .slice(0, 4)
    .map((quote) => ({ quote, author: '' }));
}

// Many builder CDNs (GoDaddy/wsimg, Wix, Squarespace, Cloudinary, Shopify)
// append a transform path after the real file, e.g.
//   …/IMG_1920.jpeg/:/cr=t:0%25,…/fx-gs   (the /:/… part, often grayscale).
// Strip it so we download the clean, full-resolution original. ALSO strip the
// width/resize QUERY tokens those CDNs add (?w=400, ?width=600, ?h=, ?fit=,
// ?resize=, ?q=, Wix's w_400,h_300 path segment) so we fetch the LARGEST native
// frame instead of a thumbnail — the #1 "that's my business" resolution lever.
const RESIZE_QUERY = /^(w|width|h|height|fit|crop|resize|quality|q|dpr|sz|size|maxwidth|max-w|format|fm|auto)$/i;

function cleanImageUrl(u) {
  if (!u) return u;
  let s = u.trim().replace(/^["']|["']$/g, '');
  s = s.split('/:/')[0]; // wsimg / isteam transform suffix
  // Wix-style inline transform segment: …/v1/fill/w_400,h_300,al_c,q_80/file.jpg
  s = s.replace(/\/(?:fill|fit|crop|scale)\/[^/]*\d+[^/]*\//i, '/');
  try {
    const url = new URL(s, 'https://_base_/'); // base lets us parse relative URLs
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (RESIZE_QUERY.test(key)) { url.searchParams.delete(key); changed = true; }
    }
    if (changed) {
      // Rebuild keeping the original (possibly relative) form when there was no host.
      s = url.host === '_base_' ? url.pathname + (url.search || '') : url.href;
    }
  } catch { /* leave s as-is on parse failure */ }
  return s;
}

// Parse a srcset / "url 1x, url 2x" list and return the LARGEST candidate URL.
// srcset entries are "<url> <descriptor>" where the descriptor is a width (640w)
// or density (2x); we pick the biggest by width, then by density, then last.
// Returns '' when the set is empty. (The old code blindly took the LAST entry,
// which on density lists is the largest but on some width lists is NOT.)
function largestFromSrcset(set) {
  if (!set) return '';
  const entries = set
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor = ''] = part.split(/\s+/);
      const wMatch = descriptor.match(/^(\d+)w$/i);
      const xMatch = descriptor.match(/^([\d.]+)x$/i);
      return {
        url,
        w: wMatch ? Number(wMatch[1]) : 0,
        x: xMatch ? Number(xMatch[1]) : 0,
      };
    })
    .filter((e) => e.url);
  if (!entries.length) return '';
  // Prefer the widest explicit width; else the highest density; else the last.
  entries.sort((a, b) => b.w - a.w || b.x - a.x);
  return entries[0].url;
}

function extractImages(html, base) {
  const out = [];
  const push = (u) => {
    const abs = absolutize(cleanImageUrl(u), base);
    if (abs) out.push(abs);
  };
  // Pick the LARGEST URL out of a srcset / “url 1x, url 2x” list (not just the
  // last entry) — see largestFromSrcset.
  const fromSrcset = (set) => largestFromSrcset(set);

  // <img> and friends — including the lazy-load attributes builder sites use
  // (data-src, data-srcset, data-srcsetlazy, data-srclazy, data-original). When
  // a tag declares an intrinsic WIDTH below the photo floor, skip it: an <img
  // width="80"> is a logo/thumb no matter what its src looks like.
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const declaredW = Number(attr(tag, 'width')) || 0;
    if (declaredW && declaredW < 200) continue; // intrinsic thumbnail → skip
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

// Skip logos, icons, sprites, tracking pixels, SVGs — keep real photos. Broadened
// over the original to catch more decoration: social-share glyphs, payment-card
// art, stars/ratings, emoji/flags, base64 data URIs, and 1×1 spacers.
const IMG_REJECT =
  /(logo|icon|sprite|favicon|badge|avatar|placeholder|pixel|spinner|loader|\bsvg\b|\.svg(\?|$)|\.gif(\?|$)|social|share|payment|visa|mastercard|paypal|stars?[-_]?rating|rating|emoji|flag|spacer|blank|transparent|1x1)/i;

// A size token in the URL (…-150x150., …_300x200., …/w_120/…, …?w=80) lets us
// reject obvious thumbnails BEFORE downloading — a cheap pre-filter so the
// downloader's byte budget is spent on candidates that can clear the photo floor.
const MIN_URL_DIM = 400;

function urlTooSmall(u) {
  // WxH token right before the extension: name-1200x800.jpg
  const wh = u.match(/[-_/](\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+($|\?))/i);
  if (wh && (Number(wh[1]) < MIN_URL_DIM || Number(wh[2]) < MIN_URL_DIM)) return true;
  // Builder width segment/param: /w_120/  or  ?w=80  or  ?width=120
  const w = u.match(/[/?&](?:w|width)[=_](\d{2,4})\b/i);
  if (w && Number(w[1]) < MIN_URL_DIM) return true;
  return false;
}

function usefulImages(urls) {
  return dedupe(
    urls.filter((u) => {
      if (!u || !/^https?:/i.test(u) || IMG_REJECT.test(u)) return false;
      if (urlTooSmall(u)) return false; // URL says it's a thumbnail → skip
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

function findPhone(html) {
  const tel = html.match(/href\s*=\s*["']tel:([^"']+)["']/i);
  if (tel) return clean(tel[1]);
  const text = stripTags(html);
  const m = text.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
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
    address: ld.address || '',
    city: ld.city || '',
    state: ld.state || '',
    established: ld.established || findEstablished(text),
    hours: ld.hours?.length ? ld.hours : [],
    rating: ld.rating,
    reviewCount: ld.reviewCount,
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

// Pull the largest image URLs declared in JSON-LD (the business's OWN structured
// data — `image`/`photo`/`logo` on the LocalBusiness node, plus any ImageObject
// `contentUrl`). Authoritative and usually full-resolution. Logo is included on
// purpose so usefulImages' name filter can drop it (it's named "logo").
function imagesFromJsonLd(html, base) {
  const out = [];
  const visit = (n) => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!n || typeof n !== 'object') return;
    for (const key of ['image', 'photo', 'logo', 'contentUrl', 'thumbnailUrl']) {
      const v = n[key];
      if (typeof v === 'string') out.push(v);
      else if (v && typeof v === 'object') {
        if (typeof v.url === 'string') out.push(v.url);
        else if (typeof v.contentUrl === 'string') out.push(v.contentUrl);
      } else if (Array.isArray(v)) {
        for (const i of v) {
          if (typeof i === 'string') out.push(i);
          else if (i && typeof i === 'object' && typeof (i.url || i.contentUrl) === 'string') {
            out.push(i.url || i.contentUrl);
          }
        }
      }
    }
  };
  parseJsonLd(html).forEach(visit);
  return out.map((u) => absolutize(cleanImageUrl(u), base)).filter(Boolean);
}

// Size-agnostic identity for one image URL: collapse "same photo at many widths"
// (hero.jpg, hero-1024x768.jpg, hero-scaled.jpg, hero@2x.jpg) so a list de-dupes
// to DISTINCT photos. Mirrors images.mjs' baseIdentity; a URL-stage perceptual
// de-dupe that needs no pixel decode (byte-level dHash de-dup still runs later in
// images.mjs on what we actually download).
function photoIdentity(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.toLowerCase();
    p = p.replace(/[-_@](?:\d{2,4}x\d{2,4}|\d{2,4}w|\dx|scaled|thumb(?:nail)?|small|medium|large)(?=\.[a-z0-9]+$)/g, '');
    return u.host + p;
  } catch {
    return url;
  }
}

/**
 * Collect real photo URLs from a site by scraping its homepage AND a few
 * photo-likely subpages (gallery/services/about). Key-free, best-effort.
 * Returns a deduped, logo-filtered list of absolute image URLs, ordered so the
 * business's intended hero (og/twitter/JSON-LD) leads.
 *
 * Hardening (the #1 "that's me" lever):
 *   • og:image / twitter:image / JSON-LD image|photo|contentUrl are followed and
 *     placed FIRST so the downloader prefers the business's own intended hero.
 *   • srcset is resolved to the LARGEST candidate and CDN resize tokens are
 *     stripped (largestFromSrcset + cleanImageUrl) so we fetch native-res frames.
 *   • obvious gallery/about/portfolio/services subpages are crawled for more.
 *   • icons/sprites/logos and sub-min-res thumbnails are dropped (usefulImages).
 *   • DISTINCT photos only: collapse size-variants of one shot to its largest URL
 *     (photoIdentity) so the candidate budget buys variety, not duplicates.
 */
export async function collectSiteImages(url, { maxPages = 4, timeoutMs = 12000 } = {}) {
  const home = await fetchHtml(url, timeoutMs);
  if (!home) return [];
  const base = home.finalUrl;
  // og:image / twitter:image is usually the business's intended hero — put it
  // first so the downloader can prefer it for the hero slot. JSON-LD image/photo
  // is the business's OWN structured data, so it leads too (right after og).
  const ogImages = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']
    .map((k) => absolutize(cleanImageUrl(metaContent(home.html, k)), base))
    .filter(Boolean);
  const ldImages = imagesFromJsonLd(home.html, base);
  let images = [...ogImages, ...ldImages, ...extractImages(home.html, base)];

  const links = findInternalPhotoLinks(home.html, base, maxPages);
  for (const link of links) {
    const page = await fetchHtml(link, timeoutMs);
    if (!page) continue;
    images = images.concat(
      imagesFromJsonLd(page.html, page.finalUrl),
      extractImages(page.html, page.finalUrl),
    );
  }

  // Filter to real photos, THEN collapse size-variants of the same shot to its
  // single largest URL — preserving first-seen order (og/JSON-LD hero stays
  // first). Among variants of one photo, keep the candidate with the longest
  // path/dimension signature (a heuristic for "biggest native frame").
  const useful = usefulImages(images);
  const bestByIdentity = new Map();
  const order = [];
  const sizeHint = (u) => {
    const wh = u.match(/[-_/](\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+($|\?))/i);
    if (wh) return Number(wh[1]) * Number(wh[2]);
    const w = u.match(/[/?&](?:w|width)[=_](\d{2,4})\b/i);
    return w ? Number(w[1]) : 0;
  };
  for (const u of useful) {
    const id = photoIdentity(u);
    const prev = bestByIdentity.get(id);
    if (prev == null) { bestByIdentity.set(id, u); order.push(id); continue; }
    // Same photo seen again: keep whichever URL advertises the larger size.
    if (sizeHint(u) > sizeHint(prev)) bestByIdentity.set(id, u);
  }
  return order.map((id) => bestByIdentity.get(id));
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

export { stripTags, decodeEntities, parseJsonLd, scoreRichness };
