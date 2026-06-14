#!/usr/bin/env node
/**
 * generate-prospects.mjs — turn CRM rows into demo-gallery prospect sites,
 * built from the business's REAL information, not generic template copy.
 *
 * Reads a CSV of businesses and writes one JSON per row into
 * sites/demo-gallery/src/data/prospects/<slug>.json (schema = src/types.ts),
 * so the gallery renders each at /p/<slug> for outreach.
 *
 * PIPELINE PER ROW (this is what kills the "AI slop / cookie-cutter" problem):
 *   1. SCRAPE their existing website (CSV `website` column) for real facts —
 *      name, phone, address, hours, their actual story, services, reviews, and
 *      their own photos. Key-free. (scripts/lib/scrape-site.mjs)
 *   2. COPY from those real facts. With ANTHROPIC_API_KEY, Claude writes it;
 *      without, we reuse their real about-text + real services verbatim and
 *      flag anything templated for a human/agent polish pass.
 *   3. PHOTOS, strongest source first: their scraped photos → AI-generated
 *      gaps (only if IMAGE_API_KEY) → Wikimedia → built-in SVG library.
 *      (scripts/lib/images.mjs)
 *   4. LAYOUT varies per business (classic / split / editorial) so a batch
 *      doesn't share one silhouette, and depth sections (stats, testimonials)
 *      are emitted from the real data.
 *   5. QUALITY GATE: a site with thin research or no real photos is marked
 *      `needs-review` with explicit flags — template output is never silently
 *      shipped as a finished deliverable.
 *
 * Usage:
 *   node scripts/generate-prospects.mjs [path/to/file.csv] [--no-photos]
 *
 * CSV columns (header row required; only `name` is required, rest optional):
 *   name, website, category, city, state, phone, email, address, established
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scrapeSite, stripTags, scoreRichness } from './lib/scrape-site.mjs';
import { acquirePhotos, processDroppedPhotos, imageSize } from './lib/images.mjs';
import { diversifyBatch } from './lib/divergence.mjs';
import { scorePhoto } from './lib/photo-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
// Photos land in src/assets/prospects/<slug>/ so astro:assets optimizes them.
const PUBLIC_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'src', 'assets', 'prospects');
const csvPath = resolve(ROOT, process.argv[2] ?? 'data/prospects.sample.csv');

// ---------------------------------------------------------------------------
// Per-category presets: theme colors + the kind of services/highlights a
// business in that category typically offers. Used only as a LAST-RESORT
// fallback when scraping/research turned up nothing usable.
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

const LAYOUTS = ['classic', 'split', 'editorial'];

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

// Stable string hash (FNV-ish, 32-bit) — drives deterministic per-slug picks so
// a batch gets variety while each site stays identical across re-runs.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// Stable per-slug hash → a layout.
function layoutFor(slug) {
  return LAYOUTS[hashStr(slug) % LAYOUTS.length];
}

// ---------------------------------------------------------------------------
// Hero headline bank — per-category, "earned"-feeling promises instead of the
// old formulaic "<Category> done right." Each entry is a function of a small
// context so missing facts (year/city) degrade gracefully. A seed-based pick
// keeps the same slug on the same headline across re-runs.
// ---------------------------------------------------------------------------
const HERO_HEADLINES = {
  towing: [
    (c) => `On the road for ${c.city || 'you'}, day or night.`,
    () => `Fast. Honest. On the way.`,
    (c) => (c.year ? `${c.city || 'Local'} towing since ${c.year}.` : `Reliable towing when you need it.`),
    () => `Stuck? Consider it handled.`,
  ],
  winery: [
    (c) => `${c.name}: the pour you'll come back for.`,
    (c) => (c.year ? `Pouring with purpose since ${c.year}.` : `Wine the way it's meant to be.`),
    (c) => `${c.city || 'Our'} favorite glass.`,
    () => `Small batches. Big character.`,
  ],
  cafe: [
    () => `Your new favorite morning.`,
    (c) => (c.year ? `Pulling shots since ${c.year}.` : `Good coffee, made with care.`),
    (c) => `A corner of ${c.city || 'town'} worth slowing down for.`,
    () => `Fresh daily. Worth the trip.`,
  ],
  plumbing: [
    () => `Done right. The first time.`,
    (c) => `${c.city || 'Local'} plumbing you can count on.`,
    () => `Upfront pricing. No surprises.`,
    (c) => (c.year ? `Keeping ${c.city || 'homes'} running since ${c.year}.` : `Fast fixes, lasting work.`),
  ],
  salon: [
    () => `Leave looking like the best you.`,
    (c) => `${c.city || 'Your'} chair is ready.`,
    () => `Style that fits your life.`,
    (c) => (c.year ? `Making people feel good since ${c.year}.` : `Honest advice, beautiful results.`),
  ],
  landscaping: [
    () => `Yards worth coming home to.`,
    (c) => `${c.city || 'Local'} landscapes, done right.`,
    () => `From overgrown to outstanding.`,
    (c) => (c.year ? `Growing with ${c.city || 'the area'} since ${c.year}.` : `Reliable crews, lasting curb appeal.`),
  ],
  'auto-repair': [
    () => `Honest work. Fair price.`,
    (c) => `${c.city || 'The'} shop that tells you straight.`,
    () => `Back on the road, fast.`,
    (c) => (c.year ? `Trusted under the hood since ${c.year}.` : `Repairs done right, guaranteed.`),
  ],
  electrician: [
    () => `Wired right. Done safely.`,
    (c) => `${c.city || 'Local'} electrical you can trust.`,
    (c) => (c.year ? `Powering ${c.city || 'the North Bay'} since ${c.year}.` : `Licensed electricians, code-correct work.`),
    () => `Done correctly the first time.`,
  ],
  hvac: [
    () => `Comfortable, all year round.`,
    (c) => `${c.city || 'Local'} heating & cooling, done right.`,
    () => `Fixed today, not next week.`,
    (c) => (c.year ? `Keeping ${c.city || 'homes'} comfortable since ${c.year}.` : `Fast, honest HVAC service.`),
  ],
  roofing: [
    (c) => `${c.city || 'Local'} roofing you can stand behind.`,
    () => `A roof done right, the first time.`,
    () => `Quality you can see from the street.`,
    (c) => (c.year ? `Protecting ${c.city || 'homes'} since ${c.year}.` : `Licensed, insured, and on time.`),
  ],
  spa: [
    () => `Time to feel like yourself again.`,
    (c) => `${c.city || 'Your'} place to unwind.`,
    () => `Relax — you're in good hands.`,
    (c) => (c.year ? `Caring for ${c.city || 'the area'} since ${c.year}.` : `Skilled, licensed, and gentle.`),
  ],
  barber: [
    () => `A cut above the rest.`,
    (c) => `${c.city || 'Your'} chair is ready.`,
    () => `Classic cuts, modern style.`,
    (c) => (c.year ? `Keeping ${c.city || 'town'} sharp since ${c.year}.` : `Walk in. Look sharp.`),
  ],
  cleaning: [
    () => `A cleaner home, every time.`,
    (c) => `${c.city || 'Local'} cleaning you can trust.`,
    () => `Spotless, dependable, done.`,
    (c) => (c.year ? `Trusted in ${c.city || 'the area'} since ${c.year}.` : `Insured, thorough, reliable.`),
  ],
  contractor: [
    () => `Built right. On time. On budget.`,
    (c) => `${c.city || 'Local'} building & remodeling, done right.`,
    () => `From plan to finish, handled.`,
    (c) => (c.year ? `Building in ${c.city || 'the area'} since ${c.year}.` : `Licensed, insured craftsmanship.`),
  ],
  restaurant: [
    () => `A local favorite for a reason.`,
    (c) => `${c.city || 'Your'} table is waiting.`,
    () => `Made fresh. Served with care.`,
    (c) => (c.year ? `Feeding ${c.city || 'the neighborhood'} since ${c.year}.` : `Real food, real welcome.`),
  ],
  default: [
    (c) => (c.year ? `Serving ${c.city || 'the area'} since ${c.year}.` : `${titleCase(c.what)} you can count on.`),
    (c) => `${c.city || 'Local'}, trusted, and proud of it.`,
    () => `Local service you can count on.`,
    (c) => `${titleCase(c.city || 'Local')}'s trusted ${c.what}.`,
    () => `Quality work, honest prices.`,
    (c) => `Proudly serving ${c.city || 'the community'}.`,
    (c) => `${titleCase(c.what)}, done the right way.`,
    () => `Real work. Real people. Real results.`,
  ],
};

// Pick a hero headline from the per-category bank. Routes through normCat so
// aliased/new categories (electrician, med-spa…) hit the right bank instead of
// the generic default. When `used` is supplied, walks the bank from the seeded
// start to the first headline NOT already used in this batch — kills the
// "three sites all say 'Real work. Real people.'" cookie-cutter tell.
function pickHeroHeadline(row, e, what, area, used = null) {
  const norm = normCat(row.category);
  const key = HERO_HEADLINES[norm] ? norm : 'default';
  const bank = HERO_HEADLINES[key];
  const ctx = { name: row.name, city: row.city, area, what, year: e?.established || '' };
  const start = hashStr(slugify(row.name) + '|hero') % bank.length;
  if (used) {
    for (let i = 0; i < bank.length; i++) {
      const cand = bank[(start + i) % bank.length](ctx);
      if (!used.has(cand)) return cand;
    }
  }
  return bank[start](ctx);
}

// ---------------------------------------------------------------------------
// Service-description derivation (key-free path). The old fallback wrote
// "<Title> for <city> and the surrounding community." for every service — pure
// filler. Instead: pull a real sentence from the business's about copy that
// mentions the service, and only if none exists fall back to one of several
// varied, concrete templates (rotated by seed so siblings don't all match).
// ---------------------------------------------------------------------------
const SERVICE_DESC_TEMPLATES = [
  (t, city) => `We handle ${t.toLowerCase()} with care${city ? ` for ${city}` : ''} — and we do it right the first time.`,
  (t, city) => `Count on our team for ${t.toLowerCase()}${city ? ` across ${city}` : ''}, start to finish.`,
  (t) => `Real experience behind every ${t.toLowerCase()} job, big or small.`,
  (t, city) => `${t} you can trust${city ? `, right here in ${city}` : ''}.`,
];

function deriveServiceDesc(title, aboutText, city, seed, used) {
  // 1) A real sentence from their own copy that names this service — but NOT one
  //    already used for another service (two services often share a keyword, and
  //    repeating one sentence verbatim across cards looks worse than a template).
  const key = title.toLowerCase().split(/\s+/).find((w) => /[a-z]{4,}/i.test(w));
  if (key && aboutText) {
    const hit = aboutText
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .find(
        (s) =>
          s.toLowerCase().includes(key) &&
          s.length >= 40 &&
          s.length <= 220 &&
          !(used && used.has(s)),
      );
    if (hit) {
      used?.add(hit);
      return clip(hit, 200);
    }
  }
  // 2) Varied, concrete fallback (action verb + the service noun phrase).
  const tpl = SERVICE_DESC_TEMPLATES[seed % SERVICE_DESC_TEMPLATES.length];
  return tpl(titleCase(title), city);
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

// Minimal CSV parser: handles quoted fields and commas inside quotes.
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
// name ↔ website sanity check (ported from build-research.mjs).
// build-research.mjs guards its deep-scrape path against a scraper CSV that pairs
// a business with the WRONG site (another company's services/photos). The INLINE
// scrape path here (when no research file exists and we scrape row.website live)
// needs the SAME guard — otherwise a wrong-site scrape leaks straight onto the
// page. Logic is kept identical to build-research.mjs so both paths agree.
// ---------------------------------------------------------------------------
const NAME_STOP = new Set(['the', 'and', 'inc', 'llc', 'co', 'company', 'corp', 'ltd', 'services', 'service', 'group']);
const sigTokens = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 4 && !NAME_STOP.has(t));

// Returns { ok, siteName }. ok=false ⇒ likely wrong website. We key on the
// DISTINCTIVE brand token (the first significant word of the business name, e.g.
// "lysell", "guardian") rather than generic category words — otherwise any
// plumber's site "matches" any other plumber. Bias toward flagging: building
// from the wrong site (then emailing it) is far worse than a quick re-check, and
// a flagged lead is recoverable (thin file + note), never silently wrong.
function nameMatchesSite(leadName, e) {
  const tokens = sigTokens(leadName);
  if (!tokens.length || !e) return { ok: true, siteName: e?.name || '' };
  const hay = [e.name, e.description, e.sourceUrl].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
  const brand = tokens[0]; // distinctive lead word
  // Pass if the brand appears, OR if ALL remaining tokens hit (strong overlap).
  const brandHit = hay.includes(brand);
  const allHit = tokens.every((t) => hay.includes(t));
  return { ok: brandHit || allHit, siteName: e.name || '' };
}

// ---------------------------------------------------------------------------
// Copy generation. Tries Claude (rich real-fact prompt); otherwise reuses the
// business's own scraped prose + services, falling back to template only for
// fields with no real source (those get flagged for a polish pass).
// ---------------------------------------------------------------------------
async function generateCopy(row, preset, e, usedHeadlines = null) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await generateCopyWithClaude(row, preset, e);
    } catch (err) {
      console.warn(`  ! Claude copy failed for ${row.name} (${err.message}); using research/template`);
    }
  }
  return researchCopy(row, preset, e, usedHeadlines);
}

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

// Key-free copy built from scraped facts. Tracks which fields fell back to
// template (in `_templated`) so the caller can flag the site for polish.
function researchCopy(row, preset, e, usedHeadlines = null) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  // Humanize the category slug for prose: hyphen/underscore → space, acronyms
  // (HVAC, AC) kept uppercase, so a raw or mis-cased token never lands in copy.
  const what = humanizeCategory(row.category);
  const templated = [];

  // About: their OWN words (cleaned) beat anything we'd write.
  let aboutBody;
  const realParas = (e?.about ?? []).map((p) => stripTags(p)).filter((p) => p.length > 60);
  if (realParas.length) {
    aboutBody = realParas.slice(0, 2);
  } else if (e?.description && e.description.length > 80) {
    aboutBody = [clip(e.description, 320)];
  } else {
    templated.push('about');
    aboutBody = [
      `${row.name} is a locally owned ${what} proudly serving ${area || 'the area'}. ` +
        `We treat every customer like a neighbor — because most of them are.`,
      'Reliable work, fair prices, and people who pick up the phone. ' +
        "That's what's kept folks coming back to us.",
    ];
  }

  // Services: real scraped service names beat generic presets. We only have
  // their titles, so descriptions are derived from their own about copy where
  // possible (a sentence that names the service), else a varied concrete line.
  let services;
  if (e?.services?.length >= 3) {
    const aboutText = realParas.join(' ') || e?.description || '';
    const sseed = hashStr(slugify(row.name));
    const usedDescs = new Set();
    services = e.services.slice(0, 5).map((title, i) => ({
      title: titleCase(title),
      description: deriveServiceDesc(title, aboutText, row.city, sseed + i, usedDescs),
    }));
    // No longer flagged 'service-descriptions': derived from real copy or a
    // concrete, non-filler template — not the old "<Title> for <city>…" stub.
  } else {
    templated.push('services');
    services = preset.services.map((title) => ({
      title,
      description: `Professional ${title.toLowerCase()} for ${row.city || 'the local area'} and nearby.`,
    }));
  }

  // Highlights: prefer concrete real facts over generic adjectives.
  const highlights = [];
  if (e?.established) highlights.push(`Serving since ${e.established}`);
  if (e?.rating) highlights.push(`${e.rating}★${e.reviewCount ? ` · ${e.reviewCount} reviews` : ''}`);
  while (highlights.length < 3) {
    const next = preset.highlights[highlights.length] ?? preset.highlights[0];
    if (!highlights.includes(next)) highlights.push(next);
    else break;
  }

  const tagline = e?.description
    ? clip(e.description, 110)
    : `${titleCase(what)} you can count on in ${row.city || 'town'}.`;
  if (!e?.description) templated.push('tagline');

  const seoDescription = clip(
    e?.description ||
      `${row.name} — trusted ${what} serving ${area || 'the local area'}. Call today for friendly, reliable service.`,
    150,
  );

  // Hero: a per-category headline bank (earned-feeling, seeded) — not the old
  // formulaic "<Category> done right."
  const heroHeading = pickHeroHeadline(row, e, what, area, usedHeadlines);

  const heroSubheading = e?.description
    ? clip(e.description, 170)
    : `Serving ${area || 'the local community'} with honest work and a friendly face.`;

  return {
    tagline,
    seoDescription,
    heroHeading,
    heroSubheading,
    highlights: highlights.slice(0, 3),
    aboutHeading: realParas.length ? `About ${row.name}` : 'About us',
    aboutBody,
    servicesHeading: 'What we do',
    services,
    _templated: templated,
  };
}

// Back-compat alias for the previous export name.
function fallbackCopy(row, preset) {
  return researchCopy(row, preset, null);
}

// ---------------------------------------------------------------------------
// Verified-research path. A human/agent research pass can drop a hand-checked
// fact file at data/research/<slug>.json (schema below). When present it is the
// AUTHORITATIVE source — it bypasses both the live scrape AND the Claude copy
// step, because its facts are already verified (with `notes` recording anything
// that couldn't be confirmed). This is the highest-fidelity input the factory
// accepts; the scrape is the best-effort fallback when no research file exists.
//
//   { slug, confirmed, established, tagline, seoDescription, heroHeading,
//     heroSubheading, highlights[], aboutHeading, aboutBody[],
//     servicesHeading?, services:[{title,description}], hours:[{day,hours}],
//     testimonials:[{quote,author}], rating:{value,count,source}, priceRange?,
//     servesCuisine?[], social:{facebook,instagram,google}, realPhotoUrls[],
//     notes }
// ---------------------------------------------------------------------------
const RESEARCH_DIR = join(ROOT, 'data', 'research');

async function loadResearch(slug) {
  try {
    const raw = await readFile(join(RESEARCH_DIR, `${slug}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null; // no research file (or unreadable/invalid) — fall back to scrape
  }
}

// Shape a research file into the `enrichment` (e) object the rest of the
// pipeline expects from scrapeSite — so buildSections / buildConfig / photos /
// deriveStatus all consume verified facts through the SAME code paths as a scrape.
function enrichmentFromResearch(r, row, { authoritative = true } = {}) {
  const year = (r.established || '').toString().replace(/^est\.?\s*/i, '').match(/\d{4}/)?.[0] || '';
  const e = {
    description: r.tagline || r.seoDescription || '',
    about: Array.isArray(r.aboutBody) ? r.aboutBody : [],
    services: (r.services ?? []).map((s) => s.title).filter(Boolean),
    established: year,
    rating: r.rating?.value,
    reviewCount: r.rating?.count,
    hours: Array.isArray(r.hours) ? r.hours : [],
    testimonials: Array.isArray(r.testimonials) ? r.testimonials : [],
    social: r.social ?? {},
    // Contact facts come from the verified CSV row, not the research blob —
    // research `notes` flag any phone/email/address that couldn't be confirmed.
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || '',
    images: Array.isArray(r.realPhotoUrls) ? r.realPhotoUrls : [],
    _fromResearch: true,
  };
  // A confirmed:true file is human-verified prose → trusted by construction
  // (never trips the "thin research" gate). An auto file (confirmed:false, from
  // build-research.mjs) is a CACHED SCRAPE: keep its honest richness so a thin
  // extraction still flags needs-review instead of shipping silently.
  e.richness = authoritative ? 100 : (r._richness ?? scoreRichness(e));
  return e;
}

// ---------------------------------------------------------------------------
// OSM/Wikidata fact backfill. The photo tier (images.mjs/acquirePhotos) looks a
// business up in OpenStreetMap/Wikidata to find a photo; that lookup also yields
// public CONTACT FACTS (opening hours, phone, address) for free. When the live
// scrape (or thin research) left those blank, we fill them in from OSM so the
// page isn't missing hours/phone/address it could honestly show.
//
// GUARD RAILS (deliberately conservative — OSM is community data, not verified):
//   • Only fills a field that is currently EMPTY. Never overwrites a value the
//     scrape/research already found (a confirmed value always wins).
//   • Never runs against a confirmed:true research file — that's human-verified
//     and authoritative; OSM must not touch it. (Caller gates on `authoritative`.)
//   • Every backfilled fact is ATTRIBUTED via a needs-review note so a human
//     re-checks the OSM data before it's emailed out, and `e._osmBackfilled`
//     records exactly which fields came from OSM.
// Returns the list of field names that were filled (for the note/flag), or [].
//
// `facts` is shape-tolerant (the photo agent may name fields loosely): we accept
// `hours` as either an [{day,hours}] array or a raw string, and read phone/
// address/openingHours under a few common aliases.
function backfillFromOsm(row, e, facts) {
  if (!facts || typeof facts !== 'object' || !e) return [];
  const filled = [];

  // Hours: enrichment uses [{day, hours}]; accept that, or a raw OSM
  // opening_hours string we keep verbatim under a single "Hours" row.
  if (!e.hours?.length) {
    const raw = facts.hours ?? facts.openingHours ?? facts.opening_hours;
    if (Array.isArray(raw) && raw.length) {
      e.hours = raw.filter((h) => h && h.day && h.hours);
      if (e.hours.length) filled.push('hours');
      else delete e.hours; // nothing usable in the array → leave it blank
    } else if (typeof raw === 'string' && raw.trim()) {
      e.hours = [{ day: 'Hours', hours: clip(raw.trim(), 160) }];
      filled.push('hours');
    }
  }

  // Phone: backfill both the enrichment and the row so buildConfig (which reads
  // e?.phone || row.phone) and downstream consumers agree.
  if (!e.phone && !row.phone) {
    const ph = (facts.phone ?? facts.telephone ?? facts.tel ?? '').toString().trim();
    if (ph) { e.phone = ph; row.phone = ph; filled.push('phone'); }
  }

  // Address: same dual backfill so the contact block + FAQ pick it up.
  if (!e.address && !row.address) {
    const addr = (facts.address ?? facts.addr ?? '').toString().trim();
    if (addr) { e.address = addr; row.address = addr; filled.push('address'); }
  }

  if (filled.length) {
    // Record provenance on the enrichment so it's never mistaken for a confirmed
    // scrape, and downgrade richness-derived trust is left alone (OSM facts are
    // contact-only, they don't make thin prose rich).
    e._osmBackfilled = filled;
  }
  return filled;
}

// Map a research file straight into the `copy` object (no Claude call needed —
// the prose is already written and verified).
function copyFromResearch(r, row) {
  return {
    tagline: r.tagline ?? '',
    seoDescription: r.seoDescription ?? '',
    heroHeading: r.heroHeading ?? '',
    heroSubheading: r.heroSubheading ?? '',
    highlights: Array.isArray(r.highlights) ? r.highlights : [],
    aboutHeading: r.aboutHeading || `About ${row.name}`,
    aboutBody: Array.isArray(r.aboutBody) ? r.aboutBody : [],
    servicesHeading: r.servicesHeading || 'What we do',
    services: Array.isArray(r.services) ? r.services : [],
    _templated: [], // fully authored from verified facts
  };
}

// Compose a RICH depth-section spine from REAL data only — never fabricated.
// Every section is data-gated: it appears only when the scrape (or CSV row)
// actually provides the facts to fill it, so the FIRST build lands rich instead
// of thin. Photos/gallery are deliberately NOT built here — that lever lives in
// the media pipeline so we never pad a gallery with stock.
function buildSections(row, e, copy) {
  const sections = [];
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const phone = e?.phone || row.phone || '';
  const address = e?.address || row.address || '';

  // 1) Services as the rich grid — the visible spine of the page.
  const svc = (copy?.services ?? []).filter((s) => s.title);
  if (svc.length) {
    sections.push({
      type: 'services-detailed',
      eyebrow: 'Services',
      heading: copy.servicesHeading || 'What we do',
      items: svc.map((s) => ({ title: s.title, description: s.description })),
    });
  }

  // 2) Stats from real numbers only.
  const stats = [];
  if (e?.established) {
    const yrs = new Date().getFullYear() - Number(e.established);
    if (yrs > 0 && yrs < 200) stats.push({ value: `${yrs}+`, label: 'Years in business' });
    else stats.push({ value: String(e.established), label: 'Serving since' });
  }
  if (e?.rating) stats.push({ value: `${e.rating}★`, label: e.reviewCount ? `${e.reviewCount} reviews` : 'Customer rating' });
  if (e?.services?.length >= 3) stats.push({ value: `${e.services.length}`, label: 'Services offered' });
  if (stats.length >= 2) sections.push({ type: 'stats', items: stats.slice(0, 4) });

  // 3) Testimonials from scraped reviews.
  if (e?.testimonials?.length) {
    sections.push({
      type: 'testimonials',
      eyebrow: 'In their words',
      heading: 'What customers say',
      items: e.testimonials.slice(0, 3).map((t) => ({ quote: clip(t.quote, 280), author: t.author })),
    });
  }

  // 4) FAQ — every answer comes straight from a REAL scraped fact (location,
  //    hours, phone, area). Honest by construction; adds depth + local SEO.
  const faq = [];
  if (address) faq.push({ q: 'Where are you located?', a: `You'll find us at ${address}.` });
  if (e?.hours?.length) {
    faq.push({ q: 'What are your hours?', a: e.hours.map((h) => `${h.day}: ${h.hours}`).join('; ') + '.' });
  } else if (row.hours_note || row.hoursnote) {
    faq.push({ q: 'What are your hours?', a: clip(row.hours_note || row.hoursnote, 160) });
  } else if (phone) {
    // No published hours — an honest "call us" answer keeps the FAQ from going sparse.
    faq.push({ q: 'What are your hours?', a: `Hours can vary — give us a call at ${phone} and we'll let you know when we're open.` });
  }
  if (area) faq.push({ q: 'What areas do you serve?', a: `We proudly serve ${area} and the surrounding community.` });
  if (phone) faq.push({ q: 'How do I get in touch?', a: `Call us at ${phone} — we're glad to help.` });
  if (faq.length >= 2) {
    sections.push({ type: 'faq', eyebrow: 'Good to know', heading: 'Common questions', items: faq.slice(0, 4) });
  }

  // NOTE: we deliberately do NOT emit `map` or `hours-contact` sections here.
  // The page template (pages/p/[slug].astro) always renders <Contact>, which is
  // the canonical address + embedded map + hours table + contact form. Authoring
  // those sections too is what produced the double-map / triplicate-hours pages.
  // (compose.ts also strips them defensively for any config that still has them.)

  return sections;
}

// Build ONE distinctive "depth" section requested by the batch-divergence pass
// (divergence assigns config.artDirection.preferredDepthSection per same-category
// sibling so a batch can't share one identical section set). Data-gated: returns
// null when the real facts to fill it don't exist, so the hint stays advisory.
function buildDepthSection(type, row, e, copy) {
  switch (type) {
    case 'timeline': {
      const yr = (e?.established || row.established || '').toString().match(/\d{4}/)?.[0];
      if (!yr) return null;
      return {
        type: 'timeline',
        eyebrow: 'Our story',
        heading: 'How we got here',
        items: [
          {
            year: yr,
            title: `${row.name} opened its doors`,
            body: copy?.aboutBody?.[0] ? clip(copy.aboutBody[0], 160) : '',
          },
        ],
      };
    }
    case 'bigquote': {
      const t = (e?.testimonials ?? []).find((t) => t.quote && t.quote.length > 60);
      if (t) return { type: 'bigquote', quote: clip(t.quote, 240), author: t.author };
      const tagline = copy?.tagline || '';
      if (tagline.length > 40) return { type: 'bigquote', quote: tagline };
      return null;
    }
    case 'feature-split': {
      const svc = (copy?.services ?? []).filter((s) => s.description && s.description.length > 30);
      if (!svc.length) return null;
      return {
        type: 'feature-split',
        eyebrow: 'What sets us apart',
        heading: copy.servicesHeading || 'What we do',
        rows: svc.slice(0, 3).map((s) => ({ heading: s.title, body: s.description })),
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Build a full ProspectConfig from a row + copy + scraped enrichment + photos.
// ---------------------------------------------------------------------------
function buildConfig(row, copy, preset, catKey, media = [], e = null, extras = {}) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  // Authoritative category for the render-time art-direction engine. Without it,
  // inferCategory() re-guesses from name/service keywords (less reliable); with
  // it, the engine and batch-divergence grouping agree on one value.
  const rawCat = (row.category || '').toLowerCase().trim();
  const [heroPhoto, storyCandidate] = media;
  const lib = `/images/library/${artKeyFor(catKey)}`;

  // Whether a real photo is sharp enough to headline is now decided UPSTREAM by
  // the resolution-tier system (fullbleed >=1600 source / side 1000-1599 / drop
  // <1000), which crops a kept "side" hero into a small side column. So this gate
  // only needs the SIDE floor — the old 1200 value rejected legitimately-kept
  // side heroes (a 1489px stylist shot cropped to a 4:5 column) and fell back to
  // the stock SVG, the joon-hair regression. Keep accepting unknown-width
  // stock/AI heroes (w == null).
  // ── Render-slot resolution contract (mirrors image-qa's LOCKED CONTRACT) ──
  // A photo fills a slot sharply only if it can yield a `minW`-wide crop AT THE
  // SLOT'S ASPECT without upscaling. A LANDSCAPE source cropped to a TALL slot
  // (hero-split / story are 4:5) narrows BELOW its source width — so source width
  // alone isn't enough: the EFFECTIVE width after the slot crop is what ships and
  // what image-qa measures. effW = min(srcW, srcH × aspect).
  //   hero-split 4:5 (0.80)  minW 1000 — the floor to show ANY photo hero
  //   story      4:5 (0.80)  minW 900
  //   gallery    4:3 (1.333) minW 640
  // Unknown dimensions (stock/library art, w==null) are kept as-is so we never
  // over-drop. slotUsable===false means processSlot already judged it too small.
  const ASPECT = { heroSplit: 4 / 5, story: 4 / 5, gallery: 4 / 3 };
  const effW = (m, aspect) => {
    const sw = m?.srcW ?? m?.w ?? null;
    const sh = m?.srcH ?? m?.h ?? null;
    if (sw == null) return null; // unknown width → don't gate (stock/AI/library)
    if (sh == null) return sw; // height unknown → best-effort on width alone
    return Math.min(sw, Math.round(sh * aspect));
  };
  const clearsSlot = (m, aspect, minW) =>
    !!m && m.slotUsable !== false && (effW(m, aspect) == null || effW(m, aspect) >= minW);

  // HERO: a real photo can headline if it fills EITHER hero slot sharply — a 16:9
  // full-bleed (≥1600w) for a landscape source, OR a 4:5 side-column (≥1000w) for
  // a portrait. Tested against BOTH so a wide landscape isn't wrongly judged by
  // the portrait floor (and vice-versa); this mirrors image-qa, which picks the
  // hero slot by tier. Below both → no photo hero (a crisp text hero beats a
  // soft/upscaled one). Unknown-width stock/AI heroes (effW null) are kept.
  const FULLBLEED = 16 / 9;
  const heroOk = (m) => clearsSlot(m, FULLBLEED, 1600) || clearsSlot(m, ASPECT.heroSplit, 1000);
  const heroReach = (m) => Math.max(effW(m, FULLBLEED) ?? 0, effW(m, ASPECT.heroSplit) ?? 0);
  let usableHero = heroOk(heroPhoto) ? heroPhoto : null;
  // SAFETY NET: never ship a stock library hero when the business has a real photo
  // that clears a hero floor. If position-0 is missing/too-small but another OWN
  // photo qualifies, promote the one with the widest EFFECTIVE hero crop — a site
  // with great photos (e.g. joon-hair's 2486px shots) must never fall to library.
  if (!usableHero) {
    const ownBig = media.filter(
      (m) => m?.path && !m.credit && !m.path.includes('/images/library/') && heroOk(m),
    );
    if (ownBig.length) usableHero = ownBig.slice().sort((a, b) => heroReach(b) - heroReach(a))[0];
  }

  // SECONDARY-SLOT FLOORS — gate the story + gallery on the ACTUAL on-disk file
  // width (what image-qa measures), not the descriptor's source width. processSlot
  // can crop a source NARROWER than its width (a landscape cropped into a tall 4:5
  // story slot), and cross-run re-crops compound it, so only the rendered file is
  // truth. A file under its slot floor would upscale/blur → drop it. Unmeasurable
  // stock/library art (path not under /images/<slug>/) is kept, never over-dropped.
  const fileWidthOf = (m) => {
    const mm = /^\/images\/([^/]+)\/(.+)$/.exec(m?.path || '');
    if (!mm) return null;
    try { return imageSize(readFileSync(join(PUBLIC_IMAGES, mm[1], mm[2])))?.w ?? null; }
    catch { return null; }
  };
  const fileW = new Map();
  for (const m of media) if (m?.path) fileW.set(m, fileWidthOf(m));
  const clearsFileFloor = (m, minW) => !!m && (fileW.get(m) == null || fileW.get(m) >= minW);

  // The About side image must clear the story slot (≥900w) or it blurs; else null
  // → falls back to the hero/library image at render.
  const storyPhoto = clearsFileFloor(storyCandidate, 900) ? storyCandidate : null;

  // Gallery = the business's OWN photos beyond the hero (never stock). A media
  // item is "own" when it carries no credit and isn't library/SVG art; stock
  // tiers (Wikimedia/Openverse/library) are credited or live under /library/.
  const GALLERY_MAX = 8;
  const isOwn = (m) => m?.path && !m.credit && !m.path.includes('/images/library/');
  const ownPhotos = media.filter(isOwn);
  const galleryImages = ownPhotos
    .filter((m) => m.path !== usableHero?.path)
    // Drop gallery tiles whose rendered file is under the 640w gallery floor.
    .filter((m) => clearsFileFloor(m, 640))
    .slice(0, GALLERY_MAX)
    .map((m, i) => ({
      src: m.path,
      alt: `${row.name}${area ? ` in ${area}` : ''} — photo ${i + 1}`,
      // Per-image focal point (CSS object-position string) computed deterministically
      // from the photo's own pixels (media pipeline). Only real photos reach the
      // gallery (isOwn), so set it whenever present; absent → omitted (defaults
      // to "50% 50%" at render).
      ...(m.focalCss ? { focal: m.focalCss } : {}),
    }));

  const phone = e?.phone || row.phone || '(555) 555-5555';
  const address = e?.address || row.address || area;
  const established = (e?.established || row.established || '').toString().replace(/^est\.?\s*/i, '');

  // Hours: real scraped hours beat the generic default.
  const hours = e?.hours?.length
    ? e.hours
    : [
        { day: 'Mon – Fri', hours: '8:00 AM – 6:00 PM' },
        { day: 'Saturday', hours: '9:00 AM – 2:00 PM' },
        { day: 'Sunday', hours: 'Closed' },
      ];

  // Photo attribution. Stock/OSM/Wikidata/Panoramax tiers stamp `credit` (and may
  // also carry a `license`, e.g. "CC BY-SA 4.0") on the media descriptor; the
  // business's OWN scraped/agent-dropped photos carry no credit (none is owed).
  // We carry the credit straight into the config so CC-BY-SA images are properly
  // attributed on the page — a license requirement, not a nicety. Format once,
  // appending the license when present ("Photo: <author> (CC BY-SA 4.0)").
  const fmtCredit = (m) => {
    if (!m?.credit) return '';
    return m.license ? `Photo: ${m.credit} (${m.license})` : `Photo: ${m.credit}`;
  };
  // Hero credit: only the photo that actually renders as the hero (usableHero).
  const heroCredit = fmtCredit(usableHero);
  // Story credit: the story photo if there is one, else the hero (the story IMAGE
  // falls back to the hero source above, so the credit must follow the same source).
  const storyCredit = storyPhoto?.credit ? fmtCredit(storyPhoto) : fmtCredit(usableHero);

  return {
    name: row.name,
    ...(rawCat ? { category: rawCat } : {}),
    tagline: copy.tagline,
    seoDescription: copy.seoDescription,
    area,
    established: established ? `Est. ${established}` : '',
    contact: {
      phone,
      // Never invent an email. A guessed hello@… reads as fake to the prospect
      // and the scorer/audit flag it; empty renders no email line (Contact.astro
      // guards it), and deriveStatus flags the gap for a real contact method.
      email: e?.email || row.email || '',
      address,
    },
    social: {
      facebook: e?.social?.facebook || '',
      instagram: e?.social?.instagram || '',
      google: e?.social?.google || '',
    },
    hero: {
      heading: copy.heroHeading,
      subheading: copy.heroSubheading,
      ctaText: 'Get in touch',
      ctaHref: '#contact',
    },
    highlights: copy.highlights,
    images: {
      hero: usableHero?.path ?? `${lib}/hero.svg`,
      heroAlt: `${row.name} in ${area}`,
      // Focal point as a CSS object-position string ("X% Y%"), computed
      // deterministically from the hero photo's own pixels (media pipeline). Keeps
      // the subject in frame when object-fit:cover re-crops at off-build aspects.
      // Only real photos carry focalCss; library/SVG heroes fall to "50% 50%".
      heroFocal: usableHero?.focalCss ?? '50% 50%',
      // Attribution for the hero when it's a credited stock/OSM/Wikidata/Panoramax
      // photo (CC-BY-SA etc.). Empty for the business's own photos + library art,
      // where no credit is owed. Required for license compliance on the page.
      heroCredit,
      story: storyPhoto?.path ?? usableHero?.path ?? `${lib}/story.svg`,
      storyAlt: `About ${row.name}`,
      // Story focal follows the same source the story IMAGE resolves to
      // (story photo → else hero photo); library/SVG → "50% 50%".
      storyFocal: storyPhoto?.focalCss ?? usableHero?.focalCss ?? '50% 50%',
      storyCaption: '',
      storyCredit,
      placeholder: `${lib}/hero.svg`,
    },
    galleryImages,
    about: { heading: copy.aboutHeading, body: copy.aboutBody, signature: '' },
    servicesHeading: copy.servicesHeading,
    services: copy.services,
    hours,
    hoursNote: '',
    sections: extras.sections ?? [],
    layout: extras.layout ?? 'classic',
    status: extras.status,
    flags: extras.flags ?? [],
    // Optional conversion wiring from the CSV (booking_url / formspree_id):
    // a real form endpoint and/or external booking link, emitted only when given.
    ...(extras.formspreeId ? { formspreeId: extras.formspreeId } : {}),
    ...(extras.bookingUrl ? { bookingUrl: extras.bookingUrl } : {}),
    theme: preset.theme,
  };
}

// Decide ready vs needs-review from how much REAL material we got.
function deriveStatus(row, e, media, photoSource, templated, mismatchName = '') {
  const flags = [];
  // agent-supplied photos (dropped into src/assets/prospects/<slug>/) ARE real —
  // they only land there because someone curated genuine business photos.
  const realPhotos = /business-site|ai-generated|agent-supplied/.test(photoSource);
  if (!row.website) flags.push('No website provided — research & verify manually');
  // A wrong-site scrape (CSV `website` belongs to another business) had its facts
  // discarded — call it out explicitly instead of the generic "unreachable".
  else if (mismatchName) flags.push(`Website mismatch — ${row.website} identifies as "${mismatchName}", not ${row.name}; scraped facts/photos discarded. Verify the correct URL.`);
  else if (!e) flags.push('Website unreachable — copy not built from real data');
  else if ((e.richness ?? 0) < 35) flags.push('Thin research — verify facts & rewrite copy');
  if (!realPhotos) flags.push(`No real/AI photos — using ${photoSource || 'stock'} art`);
  if (templated.includes('services')) flags.push('Services are template defaults — replace with real ones');
  if (templated.includes('service-descriptions')) flags.push('Service descriptions need a polish pass');
  if (templated.includes('about')) flags.push('About copy is templated — rewrite from research');
  // Contact completeness: never silently ship a guessed email. If we found no
  // real email, flag the gap so a real non-phone contact method gets added.
  const hasRealEmail = Boolean(e?.email || row.email);
  if (!hasRealEmail) flags.push('No email found — add a real email or contact form before sending');
  // Hours fell back to the generic Mon–Fri 8–6 default (buildConfig) — wrong for
  // wineries, marinas, weekend/seasonal businesses. Flag so it's verified.
  if (!e?.hours?.length) flags.push('Hours are a generic default (Mon–Fri 8–6) — verify before sending');
  const status = flags.length ? 'needs-review' : 'ready';
  return { status, flags };
}

// Synonyms → a canonical CATEGORIES key. Lets messy real-world category labels
// (esp. from the lead-scraper: "electrical", "med spa", "auto_repair", "general
// contractor") resolve to a themed preset instead of falling to neutral default.
// Keys are lowercased + hyphen-collapsed before lookup.
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
// Themed presets without their own art (marina, restaurant, the new trades…)
// fall back to the default art folder so the SVG placeholder never 404s.
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

// Has the agent already dropped real photos for this slug into
// src/assets/prospects/<slug>/ (the strongest tier)? If so, use them ALL —
// hero/story first, then the rest as gallery fodder (they're all genuinely
// theirs, so more real photos = a richer page, never stock).
async function agentDroppedPhotos(slug) {
  try {
    const dir = join(PUBLIC_IMAGES, slug);
    const files = (await readdir(dir))
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
      .sort();
    if (!files.length) return [];

    // Score every curated photo so the BEST frame wins the hero slot — not
    // whatever file was literally named "hero". (The Jun 9 batch had to hand-
    // override hero=story.jpg because the literal hero.jpg wasn't the strongest
    // shot; scoring removes that manual step.) Key-free: photo-score.mjs judges
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
    // Story: next best. Remaining files: gallery fodder, score order. Dimensions
    // ride along on each item so buildConfig's hero-resolution gate can swap in
    // clean library art when even the best frame is too small.
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
async function main() {
  let csv;
  try {
    csv = await readFile(csvPath, 'utf8');
  } catch {
    console.error(`Could not read CSV: ${csvPath}`);
    console.error('Pass a path or create data/prospects.sample.csv (see docs/outreach-pipeline.md).');
    process.exit(1);
  }

  const rows = parseCsv(csv);
  if (!rows.length) {
    console.error('No data rows found in CSV.');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const usingClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  const canGenImages = Boolean(process.env.IMAGE_API_KEY);
  const skipWikimedia = process.argv.includes('--no-photos');
  console.log(
    `Generating ${rows.length} prospect site(s).\n` +
      `  Copy:   ${usingClaude ? 'Claude (from scraped real facts)' : 'scraped real facts + template fallback'}\n` +
      `  Photos: their site → ${canGenImages ? 'AI-gen gaps → ' : '(AI-gen off, no key) '}` +
      `${skipWikimedia ? '' : 'Wikimedia → '}library\n`,
  );

  // Default to the live custom domain so every batch's links look like ours
  // (demos.copperbaytech.com/p/<slug>) with no per-run config. Override with
  // GALLERY_BASE_URL if the gallery ever moves.
  const base = (process.env.GALLERY_BASE_URL || 'https://demos.copperbaytech.com').replace(/\/$/, '');
  const links = [];
  const built = [];
  // Tracks every hero headline already used this batch so the template path can
  // pick a DIFFERENT one for same-bank siblings (anti-cookie-cutter).
  const usedHeadlines = new Set();

  for (const row of rows) {
    if (!row.name) continue;
    const slug = slugify(row.name);
    const catKey = catKeyFor(row);
    const preset = CATEGORIES[catKey];

    // Accept either `website` or `existing_website` as the column header.
    row.website = row.website || row.existing_website || '';

    // 0) Verified research file wins. If data/research/<slug>.json exists it is
    //    authoritative (already fact-checked) — use it for BOTH enrichment and
    //    copy, and skip the best-effort live scrape entirely.
    const research = await loadResearch(slug);
    // confirmed:true = human-verified prose (authoritative). confirmed:false =
    // an auto file from build-research.mjs: a cached scrape, trusted for FACTS
    // but run through the normal (gated) copy path so thin ones still flag.
    const authoritative = research?.confirmed === true;

    // 1) Otherwise scrape their existing site for real facts (best-effort, key-free).
    let e = null;
    // Set when the live scrape clearly belongs to a DIFFERENT business (wrong
    // `website` in the CSV) — drives a needs-review flag so a wrong-site scrape
    // never ships silently. (The research-file path is already mismatch-guarded
    // upstream by build-research.mjs, so this only covers the inline scrape.)
    let mismatchName = '';
    if (research) {
      e = enrichmentFromResearch(research, row, { authoritative });
      console.log(`  · ${row.name}: using ${authoritative ? 'verified' : 'auto'} research (data/research/${slug}.json)`);
    } else if (row.website) {
      process.stdout.write(`  · ${row.name}: scraping ${row.website} … `);
      e = await scrapeSite(row.website);
      // Guard the #1 quality lever: if the scraped site identifies as a different
      // business, DISCARD its facts/photos rather than building from the wrong
      // one (e.g. "Lysell Plumbing" paired with a drilling company's site).
      const match = nameMatchesSite(row.name, e);
      if (e && !match.ok) {
        mismatchName = match.siteName || row.website;
        console.log(`⚠ wrong site? identifies as "${mismatchName}" — facts discarded`);
        e = null; // drop the foreign site's content entirely
      } else {
        console.log(e ? `ok (richness ${e.richness})` : 'unreachable');
      }
    }
    // Backfill missing CSV location fields from the scrape/research.
    if (e) {
      row.city = row.city || e.city || '';
      row.state = row.state || e.state || '';
    }

    // 2) Photos: agent-dropped → their site → AI-gen → Wikimedia → library.
    // Extra needs-review flags raised during the photo step (deriveStatus rebuilds
    // its own flag list from scratch, so we collect ours here and merge them in
    // after it runs — see the deriveStatus call below).
    const photoFlags = [];
    // OSM/Wikidata facts (hours/phone/address) that the photo tier may surface as
    // a free side-effect of looking the business up. Captured here from the
    // acquirePhotos return so the backfill step (below) can fill gaps the scrape
    // missed. Stays null when no photo lookup ran (agent-dropped path) or the
    // tier returned no facts — backfill is then a no-op. (Shape-tolerant: the
    // photo agent may name it `.facts`, `.osm`, or `.osmFacts`.)
    let osmFacts = null;
    let media = await agentDroppedPhotos(slug);
    let photoSource = media.length ? 'agent-supplied' : '';
    // Track whether the chosen hero clears the LOCKED resolution floor and is
    // otherwise usable. Defaults to true; the two acquisition paths below set it.
    // Below floor / not usable → drop the photo hero so the page renders a clean
    // TEXT hero instead of a blurry full-bleed photo (a crisp text hero beats a
    // soft photo). Agent-dropped REAL photos are still preferred — they only get
    // dropped here when genuinely too small to render sharp.
    let heroResOk = true;
    let heroUsable = true;
    // LOCKED hero-photo TIER (by hero SOURCE width, set by img-core; never upscale):
    //   'fullbleed' (>=1600w) → any hero incl. cinematic full-bleed is allowed.
    //   'side'      (1000-1599) → KEEP the real photo but render it in a smaller
    //                             SIDE-COLUMN hero so it stays sharp (never full-bleed).
    //   'none'      (<1000w)    → genuinely too small → DROP photo → clean TEXT hero.
    // Defaults to 'fullbleed' so a missing signal never needlessly shrinks a hero;
    // the real drop guard is heroUsable/'none' below.
    let heroTier = 'fullbleed';
    if (media.length) {
      // The user's REAL photos must get the SAME treatment as everything else —
      // attention-crop to the contract slots + resolution floor. Previously
      // agent-dropped media bypassed all of this (img-core's #1 fix): the sites
      // people actually look at use agent-dropped photos, so they're exactly the
      // ones that most need the crop/floor. processDroppedPhotos rewrites/crops
      // the files in place and reports usability per the LOCKED contract. Fails
      // soft (returns the originals) so a usable photo is never lost.
      const dropped = await processDroppedPhotos(media, { category: catKey });
      media = dropped.media ?? media;
      // heroResOk: hero source cleared the slot's minW floor (no upscale-blur).
      // usable: hero is renderable per the contract (floor + crop succeeded).
      heroResOk = dropped.heroResOk !== false;
      heroUsable = dropped.usable !== false;
      if (dropped.heroTier) heroTier = dropped.heroTier;
    } else {
      const got = await acquirePhotos(row, e, {
        destDir: PUBLIC_IMAGES,
        slug,
        ownMax: 9,
        min: 2,
        skipWikimedia,
        // Their og:image / primary structured image is usually their intended
        // hero — hand it to the downloader so it wins the hero slot over a
        // merely higher-scoring (but off-brand) photo.
        heroHint: e?.images?.[0],
      });
      media = got.media;
      photoSource = got.source;
      heroResOk = got.heroResOk !== false;
      // acquirePhotos' existing usability signal: heroUsable is the score gate;
      // fold in `usable` too if img-core now exports it.
      heroUsable = got.heroUsable !== false && got.usable !== false;
      if (got.heroTier) heroTier = got.heroTier;
      // Free OSM/Wikidata side-facts from the photo lookup (shape-tolerant). Used
      // ONLY to backfill hours/phone/address the scrape couldn't find — never to
      // overwrite a confirmed value. See the backfill step below.
      osmFacts = got.facts ?? got.osm ?? got.osmFacts ?? null;
      // QUALITY FLOOR (Fable item 1): if the best acquired photo scores below the
      // hero floor, don't headline a weak/off-brand image. Drop it so the page
      // falls back to a deliberate text/library hero (render-time pickHero makes
      // the swap when imageCount is 0) and record why — a sub-bar stock photo
      // never ships full-bleed, and deriveStatus flags it for a finishing pass.
      if (got.heroUsable === false && media.length) {
        console.log(`    ↳ hero photo below quality floor (score ${got.heroScore?.toFixed?.(2) ?? '0'}) → text hero`);
        media = [];
        photoSource = got.source ? `${got.source}:below-floor` : 'below-floor';
      }
    }
    // RESOLUTION TIER (locked contract): the real photo is the "that's my
    // business" hook — SHOW it sharp whenever we can; only fall back to text when
    // it would actually be blurry. Three outcomes, by hero SOURCE width:
    //   • heroUsable === false  → bad/off-brand hero → HARD DROP → clean TEXT hero.
    //   • tier 'none' (<1000w)  → genuinely too small → DROP → clean TEXT hero.
    //   • tier 'side' (1000-1599) → KEEP the real photo; render it in a smaller
    //       SIDE-COLUMN hero (sharp), NOT full-bleed cinematic. This is a GOOD
    //       outcome, so it does NOT raise a needs-review flag.
    //   • tier 'fullbleed' (>=1600w) → KEEP as today; any hero incl. cinematic.
    // Applies to agent-dropped REAL photos too. This is IN ADDITION to the
    // score-based drop above.
    // Resolved tier to stamp onto config.artDirection AFTER buildConfig runs
    // (config isn't constructed until below). '' = no photo hero / nothing to set.
    let heroPhotoTierToSet = '';
    if (media.length && (!heroUsable || heroTier === 'none')) {
      const why = !heroUsable ? 'below quality floor' : 'below resolution floor';
      console.log(`    ↳ hero photo ${why} → text hero`);
      media = [];
      photoSource = photoSource ? `${photoSource}:below-floor` : 'below-floor';
      photoFlags.push(`hero photo ${why} — text hero used`);
    } else if (media.length && heroTier === 'side') {
      // KEEP the real photo but tell the hero-variant picker (divergence/compose)
      // to use a side-column hero so it displays smaller and stays sharp — never
      // full-bleed cinematic for a 1000-1599w source. A sharp side-column real
      // photo is a GOOD result, so we deliberately do NOT flag needs-review.
      heroPhotoTierToSet = 'side';
      console.log(`    ↳ hero photo medium-res → side-column hero (kept sharp)`);
    } else if (media.length) {
      // tier 'fullbleed' (or unknown→default): surface the tier so the picker may
      // allow cinematic full-bleed. Keep as today.
      heroPhotoTierToSet = 'fullbleed';
    }

    // RELEVANCE FLAG: a GENERIC STOCK hero (Wikimedia/Openverse) is a real photo
    // but it's NOT the business's own — shipping it as "we built YOUR site" reads
    // as low-effort (and risks the off-topic "pears for a contractor" class). It's
    // fine as honest filler, but never auto-send it: flag needs-review so a human
    // confirms relevance or swaps in a real photo. Own-site/OSM/Wikidata/agent
    // photos are inherently theirs and are NOT flagged.
    if (media.length && /wikimedia|openverse|commons/i.test(photoSource)) {
      photoFlags.push('hero is generic stock (not the business’s own photo) — verify relevance or replace before sending');
    }

    // 2b) Backfill missing CONTACT facts (hours/phone/address) from the free
    //     OSM/Wikidata lookup the photo tier already did. Gap-fill ONLY: never on
    //     a confirmed:true research file (authoritative, human-verified), and
    //     never over a value the scrape/research already found. Each filled field
    //     gets a needs-review note so a human re-checks community data before it
    //     ships. Requires an enrichment to attach to (e) — when the site was
    //     unreachable we leave the "no real data" status honest rather than
    //     manufacturing an enrichment out of OSM alone.
    if (!authoritative && e && osmFacts) {
      const filled = backfillFromOsm(row, e, osmFacts);
      if (filled.length) {
        console.log(`    ↳ backfilled ${filled.join(', ')} from OpenStreetMap/Wikidata`);
        photoFlags.push(`Backfilled ${filled.join(', ')} from OpenStreetMap/Wikidata — community data, verify before sending`);
      }
    }

    // 3) Copy: verified research as-is, else Claude/scrape; 4) depth + layout.
    // Authoritative research → use its written prose as-is. Otherwise (auto
    // research OR a live scrape) write copy from the facts through the normal
    // path, so templated fields are tracked and weak sites flag needs-review.
    const copy = authoritative ? copyFromResearch(research, row) : await generateCopy(row, preset, e, usedHeadlines);
    // Reserve this headline so the next same-bank sibling picks a different one.
    if (copy?.heroHeading) usedHeadlines.add(copy.heroHeading);
    const sections = buildSections(row, e, copy);
    const layout = layoutFor(slug);

    // 5) Quality gate.
    const { status: baseStatus, flags } = deriveStatus(row, e, media, photoSource, copy._templated ?? [], mismatchName);
    // Merge in flags raised during the photo step (e.g. hero dropped below the
    // resolution floor). Any extra flag forces needs-review even if deriveStatus
    // alone said ready.
    flags.push(...photoFlags);
    const status = flags.length ? 'needs-review' : baseStatus;

    const config = buildConfig(row, copy, preset, catKey, media, e, {
      sections,
      layout,
      status,
      flags,
      formspreeId: row.formspree_id || row.formspree || '',
      bookingUrl: row.booking_url || row.booking || '',
    });
    // LOCKED tier contract: surface the resolved hero-photo tier so the
    // hero-variant picker (divergence / compose) obeys it — 'side' forces a
    // sharp side-column hero (never full-bleed cinematic) for 1000-1599w sources;
    // 'fullbleed' allows cinematic. Only set when a photo hero survived.
    if (heroPhotoTierToSet) {
      config.artDirection = { ...(config.artDirection || {}), heroPhotoTier: heroPhotoTierToSet };
    }
    // Verified structured-data extras (schema.org rich results) — only from a
    // research file, never guessed.
    if (research?.priceRange) config.priceRange = research.priceRange;
    if (research?.servesCuisine?.length) config.servesCuisine = research.servesCuisine;
    // Keep row/e/copy on the entry (not serialized) so the post-divergence pass
    // can build the depth section the divergence hint requests.
    built.push({ slug, catKey, config, row, e, copy, link: `${base}/p/${slug}`, status, photoSource, flags });
  }

  // Anti-cookie-cutter: hand same-category siblings DISTINCT font/hero/temp/order
  // — and now a DISTINCT depth section — so a batch of (say) five wineries can't
  // be mistaken for one template. Group by the authoritative category so unknown
  // categories (marina, restaurant) get their own pool instead of all-default.
  const divReport = diversifyBatch(
    built.map((b) => ({ slug: b.slug, category: b.config.category || b.catKey, config: b.config })),
  );
  if (divReport.length) {
    console.log(`\nDiversified ${divReport.length} same-category site(s) so none look alike:`);
    for (const r of divReport) console.log(`  · ${r.slug}: ${r.changes.join(', ')}`);
    console.log('');
  }

  // Compose the per-sibling depth section the divergence pass requested. This is
  // what breaks "100% identical section sets" across same-category siblings: it
  // runs AFTER divergence so the hint can actually change which sections exist.
  for (const b of built) {
    const want = b.config.artDirection?.preferredDepthSection;
    if (!want) continue;
    const arr = b.config.sections ?? [];
    if (arr.some((s) => s.type === want)) continue; // already present
    const sec = buildDepthSection(want, b.row, b.e, b.copy);
    if (!sec) continue;
    // Insert before the contact tail (map / hours-contact) so it reads as page
    // body, not an afterthought; otherwise just after the opening section.
    const tailIdx = arr.findIndex((s) => s.type === 'map' || s.type === 'hours-contact');
    const at = tailIdx > 0 ? tailIdx : Math.min(1, arr.length);
    arr.splice(at, 0, sec);
    b.config.sections = arr;
  }

  // Now write everything (post-divergence) + build the links manifest.
  for (const b of built) {
    await writeFile(join(OUT_DIR, `${b.slug}.json`), JSON.stringify(b.config, null, 2) + '\n');
    links.push({ name: b.config.name, slug: b.slug, email: b.config.contact.email, link: b.link, status: b.status, photoSource: b.photoSource, flags: b.flags, category: b.config.category ?? b.catKey, area: b.config.area, claimByDate: b.config.outreach?.claimByDate ?? '', thumbnailUrl: `/thumbnails/${b.slug}.png` });
    console.log(`  ✓ ${b.config.name}  →  ${b.link}   [photos: ${b.photoSource} · ${b.status}]`);
  }

  await writeFile(join(ROOT, 'data', 'outreach-links.json'), JSON.stringify(links, null, 2) + '\n');
  const review = links.filter((l) => l.status === 'needs-review').length;
  console.log(`\nWrote ${links.length} site(s) to sites/demo-gallery/src/data/prospects/`);
  if (review) console.log(`  ${review} flagged needs-review — open the dashboard (npm run dev → /) before sending.`);
  console.log('Links manifest: data/outreach-links.json');

  // Auto-sync the finished batch into the Duke CRM "New" tab — creates a lead +
  // attaches the demo (link + thumbnail + status) for each prospect, so
  // generating IS the push. Opt out with --no-crm-sync or CRM_SYNC=off. Runs the
  // Duke sync script (it has the Upstash creds); never fails the generate run.
  const noSync = process.argv.includes('--no-crm-sync') || process.env.CRM_SYNC === 'off';
  const dukeDir = process.env.DUKE_DIR || 'C:/Users/dukot/projects/Duke';
  const syncScript = join(dukeDir, 'scripts', 'sync-demos-to-crm.mjs');
  if (!noSync && existsSync(syncScript)) {
    console.log('\nSyncing the batch into the CRM New tab…');
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [syncScript, '--commit', '--websites', ROOT]);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    } catch (e) {
      console.warn(`  ⚠ CRM sync skipped (${(e.message || String(e)).split('\n')[0]}). Run it manually: node "${syncScript}" --commit`);
    }
  } else if (!noSync) {
    console.log(`\n(CRM auto-sync off — ${syncScript} not found. Set DUKE_DIR or run the sync manually.)`);
  }

  console.log('\nNext: cd sites/demo-gallery && npm install && npm run dev   (preview at /p/<slug>)');
  console.log('Then commit + push — Vercel rebuilds the gallery and your links go live.');
}

// Exported for tests; only auto-run when invoked directly (not when imported).
export { buildConfig, slugify, parseCsv, researchCopy, fallbackCopy, buildSections, layoutFor, CATEGORIES, loadResearch, enrichmentFromResearch, copyFromResearch, normCat, generateCopyWithClaude };

// Run main() only when invoked directly (not when imported by tests).
// Use pathToFileURL so this works on Windows (file:///C:/…) as well as POSIX.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
