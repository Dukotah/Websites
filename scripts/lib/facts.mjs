#!/usr/bin/env node
/**
 * facts.mjs — the SHARED facts + photo layer for the website factory.
 *
 * This is the reusable core that used to live in scripts/generate-prospects.mjs
 * (the legacy single-page /p builder). When the factory cut over to the PREMIUM
 * multi-page /s system, the single-page builder was retired but its facts/photo
 * machinery is still the foundation every entry point stands on:
 *
 *   • scripts/generate.mjs       — the premium pipeline (CSV → /s sites)
 *   • scripts/author-premium.mjs — the deterministic premium author
 *   • scripts/build-research.mjs — the deep-research bridge (slugify)
 *   • scripts/verify-research.mjs — research clean/promote (copy + categories)
 *   • scripts/lib/scraper-csv.mjs — scraper CSV → builder CSV (parseCsv/normCat)
 *
 * Nothing here renders a page; it only turns a CSV row + a website/research file
 * into verified facts (`enrichmentFromResearch`), acquires the real photos
 * (`acquireMediaFor`), and derives the ready/needs-review status (`deriveStatus`).
 * Key-free by default; ANTHROPIC_API_KEY only ever UPGRADES copy.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeSite, stripTags, scoreRichness } from './scrape-site.mjs';
import { acquirePhotos, processDroppedPhotos } from './images.mjs';
import { scorePhoto } from './photo-score.mjs';
import { sanitizeProse, sanitizeTestimonials } from './copy-sanity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Photos land in src/assets/prospects/<slug>/ so astro:assets optimizes them.
const PUBLIC_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'src', 'assets', 'prospects');
const RESEARCH_DIR = join(ROOT, 'data', 'research');

// ---------------------------------------------------------------------------
// Per-category presets: theme colors + the kind of services/highlights a
// business in that category typically offers. Used only as a LAST-RESORT
// fallback when scraping/research turned up nothing usable, and by
// verify-research.mjs as the preset feed into the Claude copy upgrade.
// ---------------------------------------------------------------------------
const CATEGORIES = {
  towing: {
    theme: { brand: '#d4452a', brandDark: '#1f2933' },
    highlights: ['24/7 dispatch', 'Fast response', 'Fully insured'],
    services: ['Light & heavy-duty towing', 'Roadside assistance', 'Jump starts & lockouts', 'Accident recovery'],
  },
  cafe: {
    theme: { brand: '#c2683a', brandDark: '#3b2f2a' },
    highlights: ['Locally roasted', 'Fresh daily', 'Cozy atmosphere'],
    services: ['Espresso & pour-over', 'Fresh-baked pastries', 'Breakfast & lunch', 'Catering & to-go'],
  },
  plumbing: {
    theme: { brand: '#1f6feb', brandDark: '#16324f' },
    highlights: ['Licensed & insured', 'Upfront pricing', 'Emergency service'],
    services: ['Leak detection & repair', 'Drain cleaning', 'Water heaters', 'Repipes & remodels'],
  },
  salon: {
    theme: { brand: '#b5557f', brandDark: '#2e2230' },
    highlights: ['Walk-ins welcome', 'Experienced stylists', 'Relaxed setting'],
    services: ['Cuts & styling', 'Color & highlights', 'Treatments', 'Special occasions'],
  },
  landscaping: {
    theme: { brand: '#2f8f3e', brandDark: '#22321f' },
    highlights: ['Free estimates', 'Reliable crews', 'Locally owned'],
    services: ['Lawn care & mowing', 'Design & planting', 'Cleanups & hauling', 'Seasonal maintenance'],
  },
  'auto-repair': {
    theme: { brand: '#e08a1e', brandDark: '#23272e' },
    highlights: ['ASE-certified', 'Honest quotes', 'Warranty on work'],
    services: ['Diagnostics', 'Brakes & suspension', 'Oil & maintenance', 'Engine repair'],
  },
  winery: {
    theme: { brand: '#6b2737', brandDark: '#2b1a1f' },
    highlights: ['Estate-grown', 'Tasting room open', 'Family-owned'],
    services: ['Wine tastings', 'Wine club', 'Vineyard tours', 'Private events'],
  },
  marina: {
    theme: { brand: '#1f5f8b', brandDark: '#15324a' },
    highlights: ['On the water', 'Boater-friendly', 'Seasonal hours'],
    services: ['Slip rentals', 'Launch ramp', 'Fuel dock', 'Boat & gear storage'],
  },
  restaurant: {
    theme: { brand: '#b5462f', brandDark: '#2c1d18' },
    highlights: ['Made fresh', 'Dine-in & takeout', 'Local favorite'],
    services: ['Dine-in', 'Takeout & to-go', 'Catering', 'Private dining'],
  },
  roofing: {
    theme: { brand: '#9c3b2e', brandDark: '#21262b' },
    highlights: ['Licensed & insured', 'Free estimates', 'Workmanship warranty'],
    services: ['Roof replacement', 'Repairs & leak fixes', 'Inspections', 'Gutters & flashing'],
  },
  electrician: {
    theme: { brand: '#e0a11e', brandDark: '#1c2733' },
    highlights: ['Licensed & insured', 'Upfront pricing', 'Emergency service'],
    services: ['Panel upgrades', 'Wiring & rewires', 'Lighting & fixtures', 'Troubleshooting & repair'],
  },
  hvac: {
    theme: { brand: '#1f8a8a', brandDark: '#17323a' },
    highlights: ['Licensed & insured', 'Upfront pricing', '24/7 service'],
    services: ['AC repair & install', 'Heating & furnaces', 'Maintenance plans', 'Indoor air quality'],
  },
  spa: {
    theme: { brand: '#8a6bb0', brandDark: '#2a2433' },
    highlights: ['Licensed therapists', 'Relaxed setting', 'By appointment'],
    services: ['Massage therapy', 'Facials & skincare', 'Body treatments', 'Wellness packages'],
  },
  barber: {
    theme: { brand: '#3a4a5a', brandDark: '#1c232b' },
    highlights: ['Walk-ins welcome', 'Skilled barbers', 'Classic & modern'],
    services: ['Haircuts', 'Beard trims & shaves', 'Fades & styling', 'Kids cuts'],
  },
  cleaning: {
    theme: { brand: '#2f9e8f', brandDark: '#1d3330' },
    highlights: ['Insured & bonded', 'Reliable & thorough', 'Flexible scheduling'],
    services: ['Home cleaning', 'Deep cleaning', 'Move-in / move-out', 'Recurring service'],
  },
  contractor: {
    theme: { brand: '#c77d2a', brandDark: '#26211b' },
    highlights: ['Licensed & insured', 'Free estimates', 'On time & on budget'],
    services: ['Remodels & additions', 'Kitchens & baths', 'Decks & framing', 'Repairs & maintenance'],
  },
  default: {
    theme: { brand: '#c2683a', brandDark: '#243b53' },
    highlights: ['Friendly service', 'Locally owned', 'Fair prices'],
    services: ['Service one', 'Service two', 'Service three', 'Service four'],
  },
};

// ---------------------------------------------------------------------------
// String helpers.
// ---------------------------------------------------------------------------
const slugify = (s) =>
  s.toLowerCase().trim().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Humanize a category slug for prose, keeping trade acronyms uppercased so a
// headline reads "HVAC" not "Hvac". Hyphens AND underscores both become spaces.
const CAT_ACRONYMS = { hvac: 'HVAC', ac: 'AC', llc: 'LLC' };
function humanizeCategory(cat) {
  const s = (cat || '').replace(/[-_]+/g, ' ').trim();
  if (!s) return 'local business';
  return s.split(/\s+/).map((w) => CAT_ACRONYMS[w.toLowerCase()] || w).join(' ');
}

// Format a phone number for HUMAN display: "(NNN) NNN-NNNN" for a US 10-digit
// (or 11-digit leading-1) number; otherwise return the original untouched. Never
// used for a tel: href — that keeps the raw digits (telHref in author-premium).
function formatPhone(s) {
  if (!s) return '';
  const d = String(s).replace(/[^\d]/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : '';
  if (!ten) return String(s);
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

// Stable string hash (FNV-ish, 32-bit) — drives deterministic per-slug picks so
// a batch gets variety while each site stays identical across re-runs.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// Trim a long string to a sentence boundary near `max` chars, falling back to
// a word boundary. Drops dangling conjunctions/prepositions and trailing
// punctuation so a clipped line never ends on "… in Santa Barbara CA and".
const ORPHANS = new Set(['and', 'or', 'the', 'a', 'an', 'in', 'of', 'to', 'with', 'for', 'at', 'on', '&']);
function clip(s, max) {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  let out = stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '');
  // Strip a trailing orphan word + any trailing punctuation/ellipsis.
  const words = out.trim().replace(/[\s,;:.!?&-]+$/, '').split(' ');
  if (words.length > 1 && ORPHANS.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(' ').replace(/[\s,;:&-]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// Minimal CSV parser: handles quoted fields and commas inside quotes.
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// ---------------------------------------------------------------------------
// name ↔ website sanity check (shared with build-research.mjs).
// Guards the inline-scrape path against a CSV that pairs a business with the
// WRONG site (another company's services/photos). Logic kept identical to
// build-research.mjs so both paths agree.
// ---------------------------------------------------------------------------
const NAME_STOP = new Set(['the', 'and', 'inc', 'llc', 'co', 'company', 'corp', 'ltd', 'services', 'service', 'group']);
const sigTokens = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 4 && !NAME_STOP.has(t));

// Returns { ok, siteName }. ok=false ⇒ likely wrong website. Keys on the
// DISTINCTIVE brand token (the first significant word of the business name)
// rather than generic category words. Biased toward flagging — building from
// the wrong site (then emailing it) is far worse than a quick re-check.
function nameMatchesSite(leadName, e) {
  const tokens = sigTokens(leadName);
  if (!tokens.length || !e) return { ok: true, siteName: e?.name || '' };
  const hay = [e.name, e.description, e.sourceUrl].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
  const brand = tokens[0]; // distinctive lead word
  const brandHit = hay.includes(brand);
  const allHit = tokens.every((t) => hay.includes(t));
  return { ok: brandHit || allHit, siteName: e.name || '' };
}

// ---------------------------------------------------------------------------
// Copy generation via Claude (rich real-fact prompt). Imported by
// verify-research.mjs's --promote path; the premium author has its own copy
// upgrade. Only ever runs when ANTHROPIC_API_KEY is set.
// ---------------------------------------------------------------------------
async function generateCopyWithClaude(row, preset, e) {
  const system = [
    {
      type: 'text',
      text:
        'You are a copywriter for small local-business websites. Given a business ' +
        'and the REAL facts scraped from its current site, return ONLY valid ' +
        'minified JSON (no markdown fences) with this exact shape:\n' +
        '{"tagline":string,"seoDescription":string,"heroHeading":string,' +
        '"heroSubheading":string,"highlights":string[3],"aboutHeading":string,' +
        '"aboutBody":string[2],"servicesHeading":string,' +
        '"services":[{"title":string,"description":string}] (3-5)}\n' +
        'Use ONLY the real facts provided — never invent awards, numbers, or ' +
        'services not implied by them. Voice: warm, trustworthy, concrete, local. ' +
        'No hype, no emoji. heroHeading is a short promise (<=8 words). ' +
        'seoDescription <=150 chars and must name the town for local SEO.',
      cache_control: { type: 'ephemeral' },
    },
  ];

  const realFacts = e
    ? `\nReal facts scraped from their current website (use these, don't invent beyond them):` +
      (e.description ? `\n- Self-description: ${clip(e.description, 300)}` : '') +
      (e.about?.length ? `\n- About text: ${clip(e.about.join(' '), 600)}` : '') +
      (e.services?.length ? `\n- Real services listed: ${e.services.join('; ')}` : '') +
      (e.established ? `\n- Established: ${e.established}` : '') +
      (e.rating ? `\n- Rating: ${e.rating}/5 from ${e.reviewCount ?? 'many'} reviews` : '')
    : '\n(No website was reachable — write careful, generic-but-plausible copy and keep claims modest.)';

  const user =
    `Business: ${row.name}\nCategory: ${row.category || 'local business'}\n` +
    `Town/area: ${row.city}${row.state ? ', ' + row.state : ''}\n` +
    `Typical services for this category: ${preset.services.join(', ')}` +
    realFacts;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content?.map((b) => b.text ?? '').join('').trim();
  const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  return { ...json, _templated: [] }; // Claude wrote it all from real facts
}

// ---------------------------------------------------------------------------
// Verified-research path. A human/agent research pass can drop a hand-checked
// fact file at data/research/<slug>.json. When present it is the AUTHORITATIVE
// source (confirmed:true) or a CACHED SCRAPE (confirmed:false). Either way it is
// shaped into the same `enrichment` (e) object the rest of the pipeline expects.
// ---------------------------------------------------------------------------
async function loadResearch(slug) {
  try {
    const raw = await readFile(join(RESEARCH_DIR, `${slug}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null; // no research file (or unreadable/invalid) — fall back to scrape
  }
}

function enrichmentFromResearch(r, row, { authoritative = true } = {}) {
  const year = (r.established || '').toString().replace(/^est\.?\s*/i, '').match(/\d{4}/)?.[0] || '';
  const e = {
    // Scraped prose can carry e-comm/nav junk ("Notify me…", "Add to cart") and
    // duplicated-phrase artifacts; sanitizeProse drops those so junk never seeds
    // a tagline/about line from either the research or the inline-scrape path.
    description: sanitizeProse(r.tagline || r.seoDescription || ''),
    about: (Array.isArray(r.aboutBody) ? r.aboutBody : []).map(sanitizeProse).filter(Boolean),
    services: (r.services ?? []).map((s) => s.title).filter(Boolean),
    established: year,
    rating: r.rating?.value,
    reviewCount: r.rating?.count,
    hours: Array.isArray(r.hours) ? r.hours : [],
    testimonials: sanitizeTestimonials(Array.isArray(r.testimonials) ? r.testimonials : []),
    social: r.social ?? {},
    // Real named people (owner/founder/chef) when the research file carries them.
    // The premium author builds a Team section ONLY from real people, never faked.
    team: Array.isArray(r.team) ? r.team.filter((m) => m && m.name) : [],
    // Contact facts come from the verified CSV row, not the research blob —
    // research `notes` flag any phone/email/address that couldn't be confirmed.
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || '',
    images: Array.isArray(r.realPhotoUrls) ? r.realPhotoUrls : [],
    // OWN-SITE VALIDATION: carried from build-research so the aggregator-host
    // flag fires on the research-file path too (not only a live scrape).
    ...(r.aggregatorHost ? { aggregatorHost: r.aggregatorHost } : {}),
    _fromResearch: true,
  };
  // A confirmed:true file is human-verified prose → trusted by construction.
  // An auto file (confirmed:false) is a CACHED SCRAPE: keep its honest richness
  // so a thin extraction still flags needs-review instead of shipping silently.
  e.richness = authoritative ? 100 : (r._richness ?? scoreRichness(e));
  // Carry the confirmed/authoritative signal so deriveStatus can tell a
  // human-verified lead (confirmed:true research) apart from a thin auto-scrape.
  e.confirmed = authoritative;
  return e;
}

// ---------------------------------------------------------------------------
// OSM/Wikidata fact backfill. The photo tier looks a business up in
// OpenStreetMap/Wikidata to find a photo; that lookup also yields public
// CONTACT FACTS (hours, phone, address) for free. When the live scrape (or thin
// research) left those blank, we fill them in from OSM. Conservative: only fills
// EMPTY fields, never on a confirmed:true file, every fact is attributed.
// Returns the list of field names filled (for the note/flag), or [].
// ---------------------------------------------------------------------------
function backfillFromOsm(row, e, facts) {
  if (!facts || typeof facts !== 'object' || !e) return [];
  const filled = [];

  if (!e.hours?.length) {
    const raw = facts.hours ?? facts.openingHours ?? facts.opening_hours;
    if (Array.isArray(raw) && raw.length) {
      e.hours = raw.filter((h) => h && h.day && h.hours);
      if (e.hours.length) filled.push('hours');
      else delete e.hours;
    } else if (typeof raw === 'string' && raw.trim()) {
      e.hours = [{ day: 'Hours', hours: clip(raw.trim(), 160) }];
      filled.push('hours');
    }
  }

  if (!e.phone && !row.phone) {
    const ph = (facts.phone ?? facts.telephone ?? facts.tel ?? '').toString().trim();
    if (ph) { e.phone = ph; row.phone = ph; filled.push('phone'); }
  }

  if (!e.address && !row.address) {
    const addr = (facts.address ?? facts.addr ?? '').toString().trim();
    if (addr) { e.address = addr; row.address = addr; filled.push('address'); }
  }

  if (filled.length) e._osmBackfilled = filled;
  return filled;
}

// ---------------------------------------------------------------------------
// Category normalization. Synonyms → a canonical CATEGORIES key. Lets messy
// real-world labels (esp. from the lead-scraper) resolve to a themed preset.
// ---------------------------------------------------------------------------
const CATEGORY_ALIASES = {
  // food & drink
  coffee: 'cafe', 'coffee-shop': 'cafe', coffeehouse: 'cafe', espresso: 'cafe', bakery: 'cafe',
  restaurants: 'restaurant', eatery: 'restaurant', diner: 'restaurant', bistro: 'restaurant',
  grill: 'restaurant', taqueria: 'restaurant', pizzeria: 'restaurant', pizza: 'restaurant',
  // beauty & wellness
  hair: 'salon', hairdresser: 'salon', 'hair-salon': 'salon', beauty: 'salon',
  'beauty-salon': 'salon', nail: 'salon', nails: 'salon', 'nail-salon': 'salon',
  massage: 'spa', 'medical-spa': 'spa', 'med-spa': 'spa', medspa: 'spa', 'day-spa': 'spa',
  wellness: 'spa', esthetician: 'spa', skincare: 'spa', 'medical-aesthetics': 'spa', aesthetics: 'spa',
  barbershop: 'barber', 'barber-shop': 'barber',
  // trades
  plumber: 'plumbing', 'plumbing-heating': 'plumbing',
  electrical: 'electrician', electric: 'electrician', electricians: 'electrician',
  heating: 'hvac', cooling: 'hvac', 'air-conditioning': 'hvac', ac: 'hvac', 'hvac-contractor': 'hvac',
  roof: 'roofing', roofer: 'roofing', 'roofing-contractor': 'roofing',
  'general-contractor': 'contractor', builder: 'contractor', construction: 'contractor',
  remodeling: 'contractor', remodeler: 'contractor', handyman: 'contractor',
  // home services
  landscaper: 'landscaping', landscape: 'landscaping', lawn: 'landscaping',
  'lawn-care': 'landscaping', gardening: 'landscaping', yard: 'landscaping',
  'house-cleaning': 'cleaning', housekeeping: 'cleaning', janitorial: 'cleaning', maid: 'cleaning',
  // auto & misc
  auto: 'auto-repair', 'auto-repair': 'auto-repair', auto_repair: 'auto-repair',
  mechanic: 'auto-repair', 'car-repair': 'auto-repair', automotive: 'auto-repair',
  'auto-body': 'auto-repair', 'body-shop': 'auto-repair',
  tow: 'towing', 'tow-truck': 'towing', 'towing-service': 'towing',
  wineries: 'winery', vineyard: 'winery', 'tasting-room': 'winery',
  marinas: 'marina', harbor: 'marina',
};

// Library art folders that actually exist on disk (public/images/library/<k>).
const ART_CATEGORIES = new Set([
  'auto-repair', 'cafe', 'default', 'landscaping', 'plumbing', 'salon', 'tattoo', 'towing', 'winery',
]);

// Normalize any raw category label → a canonical CATEGORIES key (or 'default').
function normCat(raw) {
  const c = (raw || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (CATEGORIES[c]) return c;
  if (CATEGORY_ALIASES[c]) return CATEGORY_ALIASES[c];
  return 'default';
}

// Resolve the category key for THEME/services (rich preset).
const catKeyFor = (row) => normCat(row.category);

// Resolve the category key for LIBRARY ART (only folders that exist).
const artKeyFor = (catKey) => (ART_CATEGORIES.has(catKey) ? catKey : 'default');

// ---------------------------------------------------------------------------
// Has the agent already dropped real photos for this slug into
// src/assets/prospects/<slug>/ (the strongest tier)? If so, use them ALL —
// hero/story first, then the rest as gallery fodder.
// ---------------------------------------------------------------------------
async function agentDroppedPhotos(slug) {
  try {
    const dir = join(PUBLIC_IMAGES, slug);
    const files = (await readdir(dir))
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
      .sort();
    if (!files.length) return [];

    // Score every curated photo so the BEST frame wins the hero slot — not
    // whatever file was literally named "hero". Key-free: photo-score.mjs judges
    // entropy/tonal richness/aspect and flags logos/flat graphics.
    const scored = [];
    for (const f of files) {
      let score = 0;
      let w = 0;
      let h = 0;
      let graphic = false;
      try {
        const q = await scorePhoto(await readFile(join(dir, f)));
        score = q?.score ?? 0;
        graphic = Boolean(q?.isGraphic);
        w = q?.w ?? 0;
        h = q?.h ?? 0;
      } catch { /* unreadable → leave at score 0 */ }
      const landscape = w && h ? w >= h * 1.1 : false;
      scored.push({ f, score, landscape, graphic, w, h });
    }

    // Hero: a full-bleed photo must be wide AND big (>=1200px), or it upscales
    // blurry. Prefer a big landscape non-graphic frame; fall back to best overall.
    const HERO_MIN_W = 1200;
    const byScore = [...scored].sort((a, b) => b.score - a.score);
    const heroPick =
      byScore.find((s) => s.landscape && !s.graphic && s.w >= HERO_MIN_W) ??
      byScore.find((s) => !s.graphic && s.w >= HERO_MIN_W) ??
      byScore.find((s) => s.landscape && !s.graphic) ??
      byScore.find((s) => !s.graphic) ??
      byScore[0];
    const hero = heroPick.f;
    const story = (byScore.find((s) => s.f !== hero) ?? heroPick).f;
    const ordered = [hero, story, ...byScore.map((s) => s.f)].filter(
      (f, i, a) => f && a.indexOf(f) === i,
    );
    const dimOf = (f) => scored.find((s) => s.f === f) ?? {};
    return ordered.map((f) => ({ path: `/images/${slug}/${f}`, credit: '', w: dimOf(f).w, h: dimOf(f).h }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route-AGNOSTIC media pipeline: agent-dropped → their site → AI-gen → Wikimedia
// → library, with the LOCKED resolution/quality tier contract and the free
// OSM/Wikidata contact backfill. Both the (now-retired) single-page builder and
// the premium author consume photos through this identical logic.
// Returns { media, photoSource, photoFlags, heroPhotoTierToSet }.
// ---------------------------------------------------------------------------
async function acquireMediaFor(slug, row, e, catKey, { authoritative = false, skipWikimedia = false, skipOsm = false } = {}) {
  const photoFlags = [];
  let osmFacts = null;
  let media = await agentDroppedPhotos(slug);
  let photoSource = media.length ? 'agent-supplied' : '';
  let heroResOk = true;
  let heroUsable = true;
  // LOCKED hero-photo TIER (by hero SOURCE width; never upscale):
  //   'fullbleed' (>=1600w) → any hero incl. cinematic full-bleed is allowed.
  //   'side'      (1000-1599) → KEEP the real photo in a smaller SIDE-COLUMN hero.
  //   'none'      (<1000w)    → too small → DROP photo → clean TEXT hero.
  let heroTier = 'fullbleed';
  if (media.length) {
    const dropped = await processDroppedPhotos(media, { category: catKey });
    media = dropped.media ?? media;
    heroResOk = dropped.heroResOk !== false;
    heroUsable = dropped.usable !== false;
    if (dropped.heroTier) heroTier = dropped.heroTier;
  } else {
    const got = await acquirePhotos(row, e, {
      destDir: PUBLIC_IMAGES,
      slug,
      // Keep MORE of the business's own photos so a vision agent has real options
      // to pick the hero/gallery from (the scraper often grabs the wrong/limited
      // shot first). Junk is still filtered; this only widens the GOOD-candidate set.
      ownMax: 16,
      min: 2,
      skipWikimedia,
      skipOsm,
      heroHint: e?.images?.[0],
    });
    media = got.media;
    photoSource = got.source;
    heroResOk = got.heroResOk !== false;
    heroUsable = got.heroUsable !== false && got.usable !== false;
    if (got.heroTier) heroTier = got.heroTier;
    osmFacts = got.facts ?? got.osm ?? got.osmFacts ?? null;
    if (got.heroUsable === false && media.length) {
      console.log(`    ↳ hero photo below quality floor (score ${got.heroScore?.toFixed?.(2) ?? '0'}) → text hero`);
      media = [];
      photoSource = got.source ? `${got.source}:below-floor` : 'below-floor';
    }
  }
  // RESOLUTION TIER (locked contract): show real photos sharp; only text-hero when
  // they'd actually be blurry.
  let heroPhotoTierToSet = '';
  if (media.length && (!heroUsable || heroTier === 'none')) {
    const why = !heroUsable ? 'below quality floor' : 'below resolution floor';
    console.log(`    ↳ hero photo ${why} → text hero`);
    media = [];
    photoSource = photoSource ? `${photoSource}:below-floor` : 'below-floor';
    photoFlags.push(`hero photo ${why} — text hero used`);
  } else if (media.length && heroTier === 'side') {
    heroPhotoTierToSet = 'side';
    console.log(`    ↳ hero photo medium-res → side-column hero (kept sharp)`);
  } else if (media.length) {
    heroPhotoTierToSet = 'fullbleed';
  }

  // RELEVANCE / PROVENANCE FLAG: any NON-OWNED hero (Wikimedia/Openverse generic
  // stock, the licensed stock:* ambiance tier, or the ai:illustrative tier) is
  // real/curated but NOT the business's own photo — never auto-send; flag for a
  // human relevance check. The photoSource carries the exact provenance tag.
  if (media.length && /wikimedia|openverse|commons/i.test(photoSource)) {
    photoFlags.push('hero is generic stock (not the business’s own photo) — verify relevance or replace before sending');
  } else if (media.length && /(?:^|[+:])stock:/i.test(photoSource)) {
    photoFlags.push('hero is LICENSED STOCK ambiance (not the business’s own photo) — illustrative/context only; verify relevance or replace before sending');
  } else if (media.length && /(?:^|[+:])ai:illustrative/i.test(photoSource)) {
    photoFlags.push('hero is AI ILLUSTRATIVE ambiance (synthetic, not a photo of the business) — backdrop only; verify before sending');
  }

  // OWN-SITE VALIDATION FLAG: the lead `website` resolved to an aggregator /
  // booking / listing / gov page (e.g. facebook.com, squareup.com, dca.ca.gov),
  // not the business's own site — so the scrape (facts AND photos) is likely
  // thin and may not be genuinely theirs. Surface it so the author/vision pass
  // verifies everything and leans on research/fallbacks before sending.
  if (e?.aggregatorHost) {
    photoFlags.push(`Lead website is an aggregator/listing page (${e.aggregatorHost}) — scrape may be thin; verify facts & source the business’s own photos before sending`);
  }

  // Backfill missing CONTACT facts from the free OSM/Wikidata lookup. Gap-fill
  // ONLY: never on a confirmed:true file, never over an existing value.
  if (!authoritative && e && osmFacts) {
    const filled = backfillFromOsm(row, e, osmFacts);
    if (filled.length) {
      console.log(`    ↳ backfilled ${filled.join(', ')} from OpenStreetMap/Wikidata`);
      photoFlags.push(`Backfilled ${filled.join(', ')} from OpenStreetMap/Wikidata — community data, verify before sending`);
    }
  }

  return { media, photoSource, photoFlags, heroPhotoTierToSet };
}

// ---------------------------------------------------------------------------
// Decide ready vs needs-review from how much REAL material we got.
// ---------------------------------------------------------------------------
function deriveStatus(row, e, media, photoSource, templated, mismatchName = '') {
  const flags = [];
  // A confirmed:true research file IS the "research & verify manually" step, so a
  // human-verified lead is never gated on having no prior website — that's the
  // whole point of these no-website/bad-website outreach targets.
  if (!row.website && !e?.confirmed) flags.push('No website provided — research & verify manually');
  else if (mismatchName) flags.push(`Website mismatch — ${row.website} identifies as "${mismatchName}", not ${row.name}; scraped facts/photos discarded. Verify the correct URL.`);
  else if (!e) flags.push('Website unreachable — copy not built from real data');
  else if ((e.richness ?? 0) < 35) flags.push('Thin research — verify facts & rewrite copy');
  // NOTE: the photo decision is NOT made here. Photo-light is a first-class
  // outcome (owner vision: the SITE carries quality, not photos — copperbaytech /
  // AVISP are the bar). The audit's photoLightVerdict (scripts/audit.mjs) is the
  // single source of truth: it passes a well-composed, trust-bearing zero-photo
  // home (info) and flags a thin/trust-less one (critical). authorPremium folds
  // that critical into `flags`, so a weak photo-light page still gates correctly
  // while a strong one auto-promotes to ready — without faking imagery.
  if (templated.includes('services')) flags.push('Services are template defaults — replace with real ones');
  if (templated.includes('service-descriptions')) flags.push('Service descriptions need a polish pass');
  if (templated.includes('about')) flags.push('About copy is templated — rewrite from research');
  const hasRealEmail = Boolean(e?.email || row.email);
  // Confirmed leads ship with a verified phone + the site's own contact form,
  // which is exactly the "or contact form" the flag accepts — so a human-verified
  // phone-first business (common for trades) isn't blocked on a missing email.
  if (!hasRealEmail && !e?.confirmed) flags.push('No email found — add a real email or contact form before sending');
  // Only flag missing hours for unverified leads. A confirmed:true build hides
  // hours it couldn't verify (the author sets showHours:false), so it never
  // displays a fake default — no need to gate a human-verified lead on it.
  if (!e?.hours?.length && !e?.confirmed) flags.push('Hours are a generic default (Mon–Fri 8–6) — verify before sending');
  const status = flags.length ? 'needs-review' : 'ready';
  return { status, flags };
}

// re-export scrapeSite/stripTags/scoreRichness so the previous one-stop import
// surface keeps working for any caller that reached through this module.
export {
  // paths
  ROOT, PUBLIC_IMAGES, RESEARCH_DIR,
  // presets
  CATEGORIES, CATEGORY_ALIASES, ART_CATEGORIES,
  // string helpers
  slugify, titleCase, humanizeCategory, hashStr, clip, parseCsv, formatPhone,
  // facts
  loadResearch, enrichmentFromResearch, backfillFromOsm,
  normCat, catKeyFor, artKeyFor, nameMatchesSite,
  generateCopyWithClaude,
  // photos
  agentDroppedPhotos, acquireMediaFor,
  // status
  deriveStatus,
  // passthrough from scrape-site (kept for import convenience)
  scrapeSite, stripTags, scoreRichness,
};
