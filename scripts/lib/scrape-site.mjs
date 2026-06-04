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
    testimonials: ld.testimonials ?? [],
    images: usefulImages([...(ld.images ?? []), ...heuristicImages]),
    social: mergeSocial(ld.social, findSocial(html)),
  };

  // Signal of how much real material we actually got — the caller uses this to
  // decide ready vs needs-review.
  enrichment.richness = scoreRichness(enrichment);
  return enrichment;
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

/**
 * Collect real photo URLs from a site by scraping its homepage AND a few
 * photo-likely subpages (gallery/services/about). Key-free, best-effort.
 * Returns a deduped, logo-filtered list of absolute image URLs.
 */
export async function collectSiteImages(url, { maxPages = 4, timeoutMs = 12000 } = {}) {
  const home = await fetchHtml(url, timeoutMs);
  if (!home) return [];
  const base = home.finalUrl;
  let images = extractImages(home.html, base);

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
