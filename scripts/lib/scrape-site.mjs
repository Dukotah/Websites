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
  // Reviews appear both as standalone Review nodes AND nested under the business
  // node's `review` property — collect both so we don't miss real author names.
  const review = nodes.filter((n) => /Review/i.test(typeOf(n)));
  if (biz && biz.review) review.push(...[].concat(biz.review).filter((r) => r && typeof r === 'object'));

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
    // Services from structured offers — the most trustworthy source, since the
    // business explicitly catalogued these (vs. us guessing from <li>s).
    const services = servicesFromJsonLd(biz);
    if (services.length) out.services = services;
  }

  // Reviews → testimonials. KEEP the real author name when the source carries
  // one; mark missing names with '' so the HTML-merge step can decide whether a
  // rotating generic attribution is warranted (it never overwrites a real name).
  const testimonials = review
    .map((rv) => {
      const body = clean(String(rv.reviewBody ?? rv.description ?? ''));
      const a = rv.author;
      const author =
        a && typeof a === 'object'
          ? clean(String(a.name ?? a['@name'] ?? ''))
          : clean(String(a ?? ''));
      return body ? { quote: body, author } : null;
    })
    .filter(Boolean);
  if (testimonials.length) out.testimonials = testimonials.slice(0, 6);

  return out;
}

// Pull service names out of JSON-LD offer structures. Handles the common shapes:
//   hasOfferCatalog.itemListElement[].itemOffered.name
//   makesOffer[].itemOffered.name  /  makesOffer[].name
//   <node @type=Service>.name elsewhere in the graph
// Returns clean, title-like, deduped names (no prices, no fabrication).
function servicesFromJsonLd(biz) {
  const names = [];
  const pushName = (v) => {
    if (!v) return;
    const n = clean(String(v));
    if (n) names.push(n);
  };
  const fromOffer = (offer) => {
    if (!offer || typeof offer !== 'object') return;
    const item = offer.itemOffered ?? offer.item ?? null;
    if (item && typeof item === 'object') pushName(item.name ?? item['@name']);
    else if (typeof item === 'string') pushName(item);
    else pushName(offer.name);
  };
  // hasOfferCatalog → itemListElement → (Offer | OfferCatalog | Service)
  const catalogs = [].concat(biz.hasOfferCatalog ?? []);
  for (const cat of catalogs) {
    if (!cat || typeof cat !== 'object') continue;
    for (const el of [].concat(cat.itemListElement ?? [])) {
      if (!el || typeof el !== 'object') continue;
      // A nested catalog (category → its own items).
      if (Array.isArray(el.itemListElement)) {
        for (const sub of el.itemListElement) fromOffer(sub);
      } else if (el.itemOffered || el['@type'] === 'Offer') {
        fromOffer(el);
      } else {
        pushName(el.name);
      }
    }
  }
  for (const offer of [].concat(biz.makesOffer ?? [])) fromOffer(offer);
  // Direct service array some schemas use.
  for (const svc of [].concat(biz.makesOffer ?? [], biz.serviceType ?? [])) {
    if (typeof svc === 'string') pushName(svc);
  }
  return dedupeCI(names.filter(isServiceLike)).slice(0, 8);
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
  /\b(service|repair|install|cleaning|towing|recovery|catering|styling|color|maintenance|detailing|design|estimate|delivery|grooming|tasting|tour|menu|treatment|landscap|plumb|electric|roof|hvac|paint|wash|haul|excavat|remodel|inspect|wax|trim|massage|facial|manicure|pedicure|brew|espresso|wine|pizza|grill|bbq)/i;

// Navigation / footer / legal / CTA noise that masquerades as a service.
const SERVICE_NOISE =
  /\b(home|about(?:\s+us)?|contact(?:\s+us)?|privacy|terms|cookie|login|log in|sign in|sign up|register|cart|checkout|account|©|copyright|all rights reserved|read more|learn more|view all|see all|click here|follow us|newsletter|subscribe|faq|blog|news|gallery|careers|jobs|sitemap|directions|reviews?|testimonials?|our team|meet the team|hours|location)\b/i;

// Leading CTA verbs we strip ("Book Oil Change" → "Oil Change") or, if the line
// is *only* a CTA, reject entirely.
const CTA_LEAD =
  /^(call|request|rate|review|book|schedule|get(?:\s+a)?|view|see|shop|order|buy|find|learn|read|click|contact|explore|discover|start|try)\b[\s:–-]*/i;

const GENERIC_SINGLE =
  /^(services?|products?|menu|info|information|details|more|options|solutions|quality|welcome|overview|pricing|prices|specials?|offers?|deals?)$/i;

// Is this string a plausible, human-recognizable service NAME (not a sentence,
// price, phone number, nav item, or single generic word)?
function isServiceLike(raw) {
  let t = clean(raw).replace(CTA_LEAD, '').trim();
  // Strip a leading or trailing price ("$49 Oil Change", "Oil Change – $49").
  t = t.replace(/^[\s–—-]*\$\s?\d[\d.,]*\+?\s*[–—-]?\s*/i, '')
       .replace(/\s*[–—:-]?\s*\$\s?\d[\d.,]*\+?\s*$/i, '')
       .replace(/\s*[–—:-]\s*(?:from\s+)?\$?\d[\d.,]*\+?$/i, '')
       .trim();
  if (!t || t.length < 4 || t.length > 60) return false;
  if (SERVICE_NOISE.test(t)) return false;
  if (CTA_LEAD.test(t)) return false; // was *only* a CTA verb
  if (GENERIC_SINGLE.test(t)) return false;
  // Phone numbers / digit-heavy strings aren't services.
  if (/\d{3}[\s.-]?\d{3,4}/.test(t)) return false;
  // Reject full sentences (services are phrases, not prose).
  const words = t.split(/\s+/);
  if (words.length > 7) return false;
  if (/[.!?]\s/.test(t)) return false; // sentence punctuation mid-string
  // Reject a lone generic word with no service signal.
  if (words.length === 1 && !SERVICE_HINT.test(t)) return false;
  return true;
}

// Tidy a raw candidate into its clean service name (mirrors isServiceLike's
// stripping). Assumes isServiceLike already passed.
function cleanServiceName(raw) {
  return clean(raw)
    .replace(CTA_LEAD, '')
    .replace(/^[\s–—-]*\$\s?\d[\d.,]*\+?\s*[–—-]?\s*/i, '')
    .replace(/\s*[–—:-]?\s*\$\s?\d[\d.,]*\+?\s*$/i, '')
    .replace(/\s*[–—:-]\s*(?:from\s+)?\$?\d[\d.,]*\+?$/i, '')
    .trim();
}

// Find HTML blocks that are explicitly about services (heading text or container
// class mentions services/what-we-do/menu/offerings). Returns their inner HTML.
function serviceSections(html) {
  const blocks = [];
  const SECTION_HINT =
    /(our[-\s]?services|what[-\s]?we[-\s]?(?:do|offer)|services?|offerings?|specialties|menu|treatments?)/i;
  // Sections / divs whose class hints at services.
  for (const m of html.matchAll(
    /<(?:section|div|ul)\b[^>]*class\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/(?:section|div|ul)>/gi,
  )) {
    if (SECTION_HINT.test(m[1])) blocks.push(m[2]);
  }
  // Region following a heading whose text mentions services (grab ~4kB after it).
  for (const m of html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const heading = stripTags(m[1]);
    if (/\b(services?|what we (?:do|offer)|our offerings?|menu|specialties|treatments?)\b/i.test(heading)) {
      const start = m.index + m[0].length;
      blocks.push(html.slice(start, start + 4000));
    }
  }
  return blocks;
}

function extractServices(html) {
  // Tier 1: items that live inside an explicit services section/heading region.
  const scoped = [];
  for (const block of serviceSections(html)) {
    for (const item of [...matchAll(block, 'li'), ...matchAll(block, 'h3'), ...matchAll(block, 'h4')]) {
      const t = stripTags(item);
      if (isServiceLike(t)) scoped.push(cleanServiceName(t));
    }
  }
  if (dedupeCI(scoped).length >= 3) return dedupeCI(scoped).slice(0, 8);

  // Tier 2 fallback: any short, service-flavored <li>/<h3>/<h4> on the page that
  // also passes the precision filter. (Merge in whatever the scoped pass found.)
  const loose = [...matchAll(html, 'li'), ...matchAll(html, 'h3'), ...matchAll(html, 'h4')]
    .map(stripTags)
    .filter((t) => SERVICE_HINT.test(t) && isServiceLike(t))
    .map(cleanServiceName);
  return dedupeCI([...scoped, ...loose]).slice(0, 8);
}

// Boilerplate that masquerades as an about paragraph.
const ABOUT_NOISE =
  /(cookie|privacy policy|all rights reserved|terms of service|terms and conditions|©|copyright|subscribe to our|sign up for|enable javascript|your browser|404|page not found)/i;

// SEO keyword-stuffing heuristic: a "paragraph" that's really a comma/pipe list
// of locations or keywords (few sentences, many short comma-separated chunks).
function looksKeywordStuffed(t) {
  const commaChunks = t.split(/[,|·•]/).length;
  const sentences = (t.match(/[.!?](?:\s|$)/g) || []).length;
  return commaChunks >= 6 && sentences <= 1;
}

// Score a paragraph by how "about-the-business" it reads: first-person plural,
// brand mention, founding/story language all raise it; generic marketing lowers.
function aboutScore(t, brand) {
  let s = 0;
  if (/\b(we|our|us|i'?m|i've|my|family[- ]owned|locally owned)\b/i.test(t)) s += 3;
  if (/\b(founded|established|since \d{4}|started|began|years? of|generations?|history|story|proud|serving)\b/i.test(t)) s += 2;
  if (brand && t.toLowerCase().includes(brand.toLowerCase())) s += 2;
  if (t.length >= 140 && t.length <= 480) s += 1; // a real paragraph, not a blurb
  return s;
}

// Inner HTML of containers/regions whose class or preceding heading marks them
// as about/story/history. Used to prefer truly on-topic paragraphs.
function aboutRegions(html) {
  const regions = [];
  for (const m of html.matchAll(
    /<(?:section|div|article)\b[^>]*(?:class|id)\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/(?:section|div|article)>/gi,
  )) {
    if (/\b(about|our[-\s]?story|story|history|who[-\s]?we[-\s]?are|mission)\b/i.test(m[1])) regions.push(m[2]);
  }
  for (const m of html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    if (/\b(about|our story|our history|who we are|why choose|the story)\b/i.test(stripTags(m[1]))) {
      const start = m.index + m[0].length;
      regions.push(html.slice(start, start + 3000));
    }
  }
  return regions;
}

// Prefer paragraphs inside an about/story region and those that read like real
// brand prose; fall back to any clean body paragraph. Returns the best 2–4.
function extractParagraphs(html, brand = '') {
  const valid = (t) => t.length >= 80 && t.length <= 600 && !ABOUT_NOISE.test(t) && !looksKeywordStuffed(t);

  // 1) Paragraphs that live inside an explicit about/story region.
  const regionParas = [];
  for (const region of aboutRegions(html)) {
    for (const p of matchAll(region, 'p')) {
      const t = stripTags(p);
      if (valid(t)) regionParas.push(t);
    }
  }

  // 2) Everything else on the page, as a backstop.
  const pageParas = matchAll(html, 'p').map(stripTags).filter(valid);

  // Merge (region paras first, deduped), then rank by about-ness so the strongest
  // prose floats to the top. Stable order within equal scores via index.
  const merged = dedupeCI([...regionParas, ...pageParas]);
  return merged
    .map((t, i) => ({ t, k: aboutScore(t, brand) * 100 - i }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.t)
    .slice(0, 4);
}

// Pull customer-review text from visible HTML (most small-business reviews live
// as plain text, not JSON-LD): <blockquote>s, and elements whose class mentions
// review/testimonial/quote. Key-free, best-effort. We KEEP a real author name
// when an adjacent <cite>/author element supplies one, and only fall back to a
// rotating generic attribution when none exists — never overwriting a real name.
const REVIEW_NOISE =
  /(leave a review|write a review|read more|view all|see all|powered by|©|copyright|star rating|out of 5|rate us|click to rate|based on \d+ review)/i;

// A plausible person/handle name for an attribution (not a sentence/CTA).
function looksLikeAuthor(s) {
  const t = clean(s).replace(/^[-–—\s~]+/, '').trim(); // strip leading "— "
  if (!t || t.length > 60) return false;
  // Names may carry an initial's period ("Mark T.", "J. Smith") but not sentence
  // punctuation (a period FOLLOWED by a space+word, or any ? / !).
  if (/[?!]/.test(t) || /\.\s+\S/.test(t)) return false;
  if (REVIEW_NOISE.test(t) || SERVICE_NOISE.test(t)) return false;
  // Should read like a name/handle: letters dominate, not a digit-led string.
  if (!/[A-Za-z]/.test(t) || /^\d/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 1 && words.length <= 5;
}

// Find an author name adjacent to a review's inner HTML: a <cite>, or an element
// whose class mentions author/name/by/reviewer, or a leading "— Name" line.
function authorFrom(rawInner) {
  const cite = matchAll(rawInner, 'cite')[0];
  if (cite) {
    const n = stripTags(cite);
    if (looksLikeAuthor(n)) return n.replace(/^[-–—\s~]+/, '').trim();
  }
  const m = rawInner.match(
    /<(?:span|p|div|h[3-6]|footer|small)\b[^>]*class\s*=\s*["'][^"']*(?:author|reviewer|name|byline|by|attribution)[^"']*["'][^>]*>([\s\S]*?)<\//i,
  );
  if (m) {
    const n = stripTags(m[1]);
    if (looksLikeAuthor(n)) return n.replace(/^[-–—\s~]+/, '').trim();
  }
  // Trailing "— Jane D." emdash attribution in plain text.
  const tail = stripTags(rawInner).match(/[—–-]{1,2}\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s*$/);
  if (tail && looksLikeAuthor(tail[1])) return tail[1].trim();
  return '';
}

function extractTestimonials(html) {
  const found = []; // { quote, author }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const consider = (raw) => {
    let q = stripTags(raw);
    const author = authorFrom(raw);
    // Drop a trailing attribution (with or without an emdash separator) so the
    // author name isn't duplicated inside the quote text.
    if (author) {
      q = q.replace(new RegExp(`\\s*[—–-]{0,2}\\s*${esc(author)}\\s*$`), '').trim();
    }
    if (q.length >= 40 && q.length <= 400 && !REVIEW_NOISE.test(q)) found.push({ quote: q, author });
  };
  for (const bq of matchAll(html, 'blockquote')) consider(bq);
  // Elements explicitly classed as a review/testimonial/quote (non-greedy, so a
  // deeply-nested card may truncate — acceptable for a best-effort heuristic).
  for (const m of html.matchAll(
    /<(?:div|li|article|figure)\b[^>]*class\s*=\s*["'][^"']*(?:review|testimonial|quote)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|article|figure)>/gi,
  )) {
    consider(m[1]);
  }
  // Dedupe by quote text, but PREFER the variant that carries a real author —
  // the same review often appears both as a bare <blockquote> and inside a
  // testimonial card with a <cite>. Also collapse one quote being a prefix of
  // another (card text = blockquote text + trailing author leftovers).
  const byKey = new Map();
  for (const t of found) {
    const k = t.quote.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, t);
    else if (!prev.author && t.author) byKey.set(k, t); // upgrade to the named one
  }
  let list = [...byKey.values()];
  // Prefix-merge: if quote A starts with quote B (or vice versa), keep the one
  // with an author (or the shorter, cleaner one) and drop the duplicate.
  list = list.filter((a, i) =>
    !list.some((b, j) => {
      if (i === j) return false;
      const an = a.quote.toLowerCase(), bn = b.quote.toLowerCase();
      if (an === bn) return false;
      if (!bn.startsWith(an) && !an.startsWith(bn)) return false;
      // `a` is dropped if `b` is the better representative.
      if (b.author && !a.author) return true;
      if (a.author && !b.author) return false;
      return a.quote.length > b.quote.length; // keep the shorter (cleaner) one
    }),
  );
  return finalizeTestimonials(list).slice(0, 4);
}

// Rotate generic attributions ONLY for quotes that lack a real name — four
// identical "Verified customer" lines read as fabricated; real names are kept
// verbatim. Honest (no invented names), just less template-looking.
const GENERIC_ATTRIB = ['Local customer', 'Happy customer', 'Returning customer', 'Satisfied customer'];
function finalizeTestimonials(list) {
  let g = 0;
  return list.map((t) => ({
    quote: t.quote,
    author: t.author && t.author.trim() ? t.author.trim() : GENERIC_ATTRIB[g++ % GENERIC_ATTRIB.length],
  }));
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

// Resolve a founding YEAR from prose. Strongest signals first; the "for over N
// years" / "celebrating N years" forms are derived relative to the current year;
// a copyright-range start is a weak last resort. Years are sanity-bounded.
function findEstablished(text, nowYear = new Date().getFullYear()) {
  const sane = (y) => (y >= 1850 && y <= nowYear ? String(y) : '');

  // 1) Explicit "since/established/founded YYYY" — most trustworthy.
  let m = text.match(/\b(?:since|est(?:ablished)?\.?|founded(?:\s+in)?|serving\s+[\w\s]+?\s+since|in\s+business\s+since)\s*(\d{4})/i);
  if (m && sane(+m[1])) return m[1];

  // 2) Relative "for over 20 years" / "20+ years" / "celebrating 35 years".
  m = text.match(/\b(?:for\s+(?:over|more than|nearly|almost)?\s*|celebrating\s+(?:over\s+)?|proudly\s+serving[\w\s]*?for\s+(?:over\s+)?)(\d{1,3})\+?\s+years\b/i)
    || text.match(/\b(\d{1,3})\+?\s+years\s+(?:of\s+(?:experience|service|business)|in\s+business|serving)\b/i);
  if (m) {
    const n = +m[1];
    if (n >= 3 && n <= 150) return sane(nowYear - n);
  }

  // 3) Weak last resort: a copyright RANGE whose start year looks like founding
  //    ("© 1998–2026"). A lone "© 2026" is just this year, so we ignore it.
  m = text.match(/(?:©|copyright|\(c\))\s*(\d{4})\s*[–—-]\s*(?:\d{4}|present)/i);
  if (m && sane(+m[1]) && nowYear - +m[1] >= 3) return m[1];

  return '';
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

// --- schema.org MICRODATA fallback (when JSON-LD is absent) ------------------
// Reads itemprop-tagged values from visible HTML. Best-effort: a value can live
// in an attribute (content="", href="tel:") or as the element's text.
function microdataValue(html, prop) {
  // Element carrying itemprop="prop": prefer content=, then tel/mailto href, then text.
  const re = new RegExp(
    `<([a-z0-9]+)\\b[^>]*\\bitemprop\\s*=\\s*["'][^"']*\\b${prop}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  );
  const m = html.match(re);
  if (!m) {
    // Self-closing / void element (e.g. <meta itemprop="..." content="...">).
    const re2 = new RegExp(`<[a-z0-9]+\\b[^>]*\\bitemprop\\s*=\\s*["'][^"']*\\b${prop}\\b[^"']*["'][^>]*>`, 'i');
    const tag = html.match(re2)?.[0];
    if (!tag) return '';
    return attr(tag, 'content') || clean(attr(tag, 'href').replace(/^(?:tel:|mailto:)/i, ''));
  }
  const openTag = m[0].match(/^<[^>]*>/)?.[0] ?? '';
  return (
    attr(openTag, 'content') ||
    clean(attr(openTag, 'href').replace(/^(?:tel:|mailto:)/i, '')) ||
    stripTags(m[2])
  );
}

function fromMicrodata(html) {
  const out = {};
  const name = microdataValue(html, 'name');
  if (name && name.length <= 80) out.name = name;
  const tel = microdataValue(html, 'telephone');
  if (tel) out.phone = tel;
  const email = microdataValue(html, 'email');
  if (email && /@/.test(email)) out.email = email;
  // Address: prefer a composed PostalAddress, else a flat streetAddress/address.
  const street = microdataValue(html, 'streetAddress');
  const locality = microdataValue(html, 'addressLocality');
  const region = microdataValue(html, 'addressRegion');
  const postal = microdataValue(html, 'postalCode');
  const parts = [street, locality, region, postal].filter(Boolean);
  if (parts.length) out.address = parts.join(', ');
  else {
    const addr = microdataValue(html, 'address');
    if (addr && addr.length <= 160) out.address = addr;
  }
  if (locality) out.city = locality;
  if (region) out.state = region;
  return out;
}

// --- visible HOURS parsing (when JSON-LD openingHoursSpecification is absent) -
// Scans for "Day: 9:00 AM – 5:00 PM" lines in a hours table/list. Conservative:
// only emits a row when both a day token and a time range (or "Closed") parse.
// Non-capturing so it can be interpolated into parseHoursLine's regex without
// shifting that regex's own capture-group indices.
const DAY_WORDS =
  /\b(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i;
const DAY_NORM = {
  mon: 'Mon', monday: 'Mon', tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
  wed: 'Wed', wednesday: 'Wed', thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  fri: 'Fri', friday: 'Fri', sat: 'Sat', saturday: 'Sat', sun: 'Sun', sunday: 'Sun',
};
const normDay = (d) => DAY_NORM[String(d).toLowerCase()] ?? clean(d);

// Matches a "9", "9am", "9:30 AM", "17:00" time token.
const TIME_TOK = /\b(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\b/i;

function parseHoursLine(line) {
  const dayM = line.match(
    new RegExp(`^\\s*(${DAY_WORDS.source})(?:\\s*[-–—]\\s*(${DAY_WORDS.source}))?\\s*[:\\u2013\\u2014-]?\\s*(.+)$`, 'i'),
  );
  if (!dayM) return null;
  const d1 = normDay(dayM[1]);
  const d2 = dayM[2] ? normDay(dayM[2]) : '';
  const label = d2 ? `${d1} – ${d2}` : d1;
  const rest = dayM[3] || '';
  if (/closed/i.test(rest)) return { day: label, hours: 'Closed' };
  if (/24\s*(?:hours|hrs|\/7)/i.test(rest)) return { day: label, hours: 'Open 24 hours' };
  // Find two time tokens forming a range.
  const times = [...rest.matchAll(new RegExp(TIME_TOK.source, 'gi'))].map((t) => t[1].trim());
  if (times.length >= 2) {
    return { day: label, hours: `${fmtVisibleTime(times[0])} – ${fmtVisibleTime(times[1])}` };
  }
  return null;
}

// Normalize a loose visible time ("9", "9am", "5:00 PM") to "9:00 AM".
function fmtVisibleTime(t) {
  const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (m) {
    let h = +m[1] % 12 || 12;
    const ap = m[3].toUpperCase() + 'M';
    return `${h}:${m[2] ?? '00'} ${ap}`;
  }
  // 24h form.
  const h24 = String(t).match(/^(\d{1,2}):?(\d{2})?$/);
  if (h24) return fmtTime(`${h24[1]}:${h24[2] ?? '00'}`);
  return clean(t);
}

function extractHours(html) {
  // Look line-by-line through stripped text limited to hours-flavored regions to
  // avoid catching random times. We slice ~600 chars after a "hours" cue.
  const out = [];
  const seen = new Set();
  const lower = html.toLowerCase();
  const regions = [];
  for (const cue of ['hours', 'opening hours', 'business hours', 'we are open', 'open hours']) {
    let idx = lower.indexOf(cue);
    while (idx !== -1 && regions.length < 6) {
      regions.push(html.slice(idx, idx + 700));
      idx = lower.indexOf(cue, idx + cue.length);
    }
  }
  // Also consider any <table>/<ul> that contains day words (a hours widget).
  for (const block of [...matchAll(html, 'table'), ...matchAll(html, 'ul')]) {
    if (DAY_WORDS.test(stripTags(block))) regions.push(block);
  }
  for (const region of regions) {
    // Break a region into candidate lines on tags and common separators.
    const lines = stripTags(region.replace(/<\/(?:li|tr|td|th|p|div|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n'))
      .split(/\n|(?=\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))/i);
    for (const line of lines) {
      const row = parseHoursLine(line);
      if (row && !seen.has(row.day)) {
        seen.add(row.day);
        out.push(row);
      }
    }
    if (out.length >= 7) break;
  }
  return out.slice(0, 7);
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
  // schema.org microdata fills gaps when JSON-LD is absent (weaker than LD,
  // stronger than raw title/regex), so it sits between the two in precedence.
  const md = fromMicrodata(html);

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

  const brand = ld.name || md.name || ogTitle || title.split(/[|\-–—]/)[0].trim() || '';

  // Prefer JSON-LD services; else mine the HTML with the precision filter.
  const services = (ld.services?.length ? ld.services : extractServices(html));

  // Testimonials: JSON-LD reviews are authoritative (real names kept), topped up
  // from visible HTML when thin. Run BOTH lists through finalizeTestimonials so
  // any LD review missing a name gets a generic attribution (never overwriting a
  // real one), matching the HTML path's behavior.
  const ldTestimonials = finalizeTestimonials(ld.testimonials ?? []);
  const testimonials = (ldTestimonials.length >= 2
    ? ldTestimonials
    : [...ldTestimonials, ...extractTestimonials(html)]
  ).slice(0, 4);

  const enrichment = {
    sourceUrl: finalUrl,
    name: brand,
    description: ld.description || ogDesc || metaDesc || '',
    phone: ld.phone || md.phone || findPhone(html),
    email: ld.email || md.email || findEmail(html),
    address: ld.address || md.address || '',
    city: ld.city || md.city || '',
    state: ld.state || md.state || '',
    established: ld.established || findEstablished(text),
    // Visible hours table/list is the fallback when LD has no opening spec.
    hours: ld.hours?.length ? ld.hours : extractHours(html),
    rating: ld.rating,
    reviewCount: ld.reviewCount,
    services,
    about: extractParagraphs(html, brand).slice(0, 4),
    testimonials,
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

// 0–100 score: how confidently can we build a CUSTOM site from this? Weighted
// toward the signals that actually make a site feel bespoke — real descriptive
// prose (description + about), recognizable services, and real photos. Refined
// to NOT inflate: it rewards depth (a paragraph or two of real about text, a few
// real services) but caps each bucket so one noisy field can't fake confidence.
function scoreRichness(e) {
  let s = 0;
  // Self-description / meta blurb — table stakes.
  if (e.description && e.description.length > 60) s += 15;
  // About prose: the strongest "this is a real, specific business" signal.
  // Reward length of real copy, not just count of paragraphs.
  const aboutChars = (e.about || []).join(' ').length;
  if (aboutChars > 120) s += Math.min(25, Math.round(aboutChars / 40));
  // Services: real, recognizable names. 3+ is the threshold the generator uses.
  if (e.services.length >= 3) s += 20;
  else if (e.services.length) s += e.services.length * 4;
  // Photos: their own imagery is what sells the demo.
  if (e.images.length) s += Math.min(20, e.images.length * 5);
  // Contact + trust facts — each a small, capped bump.
  if (e.phone) s += 4;
  if (e.address) s += 4;
  if (e.hours.length) s += 4;
  if (e.established) s += 4;
  // Testimonials weigh more when they carry a REAL author name (not generic).
  if (e.testimonials.length) {
    const named = e.testimonials.some((t) => t.author && !GENERIC_ATTRIB.includes(t.author));
    s += named ? 6 : 3;
  }
  return Math.min(100, s);
}

export { stripTags, decodeEntities, parseJsonLd };
