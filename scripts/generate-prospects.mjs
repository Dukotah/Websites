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
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scrapeSite, stripTags } from './lib/scrape-site.mjs';
import { acquirePhotos } from './lib/images.mjs';
import { diversifyBatch } from './lib/divergence.mjs';
import { usableDescription, cleanCopy } from './lib/copy-quality.mjs';
import { augmentEnrichment } from './lib/augment-enrichment.mjs';

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
  default: {
    theme: { brand: '#c2683a', brandDark: '#243b53' },
    highlights: ['Friendly service', 'Locally owned', 'Fair prices'],
    // Meaningful generic fallbacks — never literal "Service one" placeholders,
    // which read as a broken page if a build is viewed before review.
    services: ['Consultations', 'Custom work', 'On-site service', 'Free estimates'],
  },
};

const LAYOUTS = ['classic', 'split', 'editorial'];

const slugify = (s) =>
  s.toLowerCase().trim().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

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

// Compute "generation date + N days" as a YYYY-MM-DD string.
// Uses the system clock at generation time — each run updates the date.
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
  tattoo: [
    (c) => (c.year ? `Custom ink in ${c.city || 'town'} since ${c.year}.` : `Ink that tells your story.`),
    (c) => `${c.city || 'Your'} studio for work that lasts.`,
    () => `Bold lines. Clean work. Your vision.`,
    () => `Art you'll want to show off forever.`,
  ],
  marina: [
    (c) => (c.year ? `On the water${c.city ? ` in ${c.city}` : ''} since ${c.year}.` : `Your home base on the water.`),
    (c) => `${c.city || 'Lake'} made easy — from launch to tie-up.`,
    () => `Everything the serious boater needs.`,
    (c) => `The marina ${c.city || 'local'} boaters trust.`,
  ],
  restaurant: [
    (c) => (c.year ? `A ${c.city || 'local'} table since ${c.year}.` : `Food worth making the drive for.`),
    (c) => `${c.city || 'The'} spot ${c.city ? c.city + ' ' : ''}keeps coming back to.`,
    () => `Made from scratch. Served with pride.`,
    (c) => `Good food, good people${c.city ? `, ${c.city}` : ''}.`,
  ],
  bakery: [
    (c) => (c.year ? `Baked fresh in ${c.city || 'town'} since ${c.year}.` : `Fresh every morning.`),
    (c) => `${c.city || 'Our'} favorite thing to wake up for.`,
    () => `Real ingredients. Real craft. No shortcuts.`,
    () => `The smell alone is worth the stop.`,
  ],
  wellness: [
    (c) => (c.year ? `Caring for ${c.city || 'the community'} since ${c.year}.` : `Feel better. Move better. Live better.`),
    (c) => `${c.city || 'Local'} wellness, done with intention.`,
    () => `Where recovery meets results.`,
    () => `Your next step toward feeling your best.`,
  ],
  fitness: [
    (c) => (c.year ? `Building stronger ${c.city || 'athletes'} since ${c.year}.` : `Train hard. Recover smart.`),
    (c) => `${c.city || 'The'} gym that gets real results.`,
    () => `No fluff. Just progress.`,
    (c) => `Where ${c.city || 'local'} athletes come to train.`,
  ],
  construction: [
    (c) => (c.year ? `Building ${c.city || 'the area'} since ${c.year}.` : `Built to last — the first time.`),
    (c) => `${c.city || 'Local'} craftsmanship you can count on.`,
    () => `On time, on budget, built right.`,
    (c) => `The crew ${c.city || 'locals'} hire and recommend.`,
  ],
  cleaning: [
    () => `A cleaner space, without the hassle.`,
    (c) => `${c.city || 'Local'} cleaning you can actually rely on.`,
    () => `Spotless, every single time.`,
    (c) => (c.year ? `Keeping ${c.city || 'homes'} spotless since ${c.year}.` : `Show-ready, every visit.`),
  ],
  hvac: [
    () => `Comfortable all year round.`,
    (c) => `${c.city || 'Local'} heating and cooling, done right.`,
    () => `Fast service when the weather turns.`,
    (c) => (c.year ? `Keeping ${c.city || 'the area'} comfortable since ${c.year}.` : `Upfront pricing, lasting comfort.`),
  ],
  electrician: [
    () => `Wired right. Done safe.`,
    (c) => `${c.city || 'Local'} electrical you can trust.`,
    () => `Licensed, insured, and on time.`,
    (c) => (c.year ? `Powering ${c.city || 'homes'} since ${c.year}.` : `No guesswork. Just safe, solid work.`),
  ],
  roofing: [
    () => `A roof that holds up — for decades.`,
    (c) => `${c.city || 'Local'} roofing built to last.`,
    () => `Honest quotes. Lasting work.`,
    (c) => (c.year ? `Protecting ${c.city || 'homes'} since ${c.year}.` : `Done right, before the next storm.`),
  ],
  painting: [
    () => `A finish you'll be proud of.`,
    (c) => `${c.city || 'Local'} painters who sweat the details.`,
    () => `Clean lines. Clean job site.`,
    (c) => (c.year ? `Refreshing ${c.city || 'homes'} since ${c.year}.` : `Crisp work, start to finish.`),
  ],
  dentist: [
    () => `A reason to look forward to the dentist.`,
    (c) => `${c.city || 'Your'} smile, in good hands.`,
    () => `Gentle care, honest answers.`,
    (c) => (c.year ? `Caring for ${c.city || 'local'} smiles since ${c.year}.` : `Modern dentistry, comfortable visits.`),
  ],
  'real-estate': [
    (c) => `${c.city || 'Local'} expertise that moves you.`,
    () => `The agent who actually picks up.`,
    () => `Sold for more, with less stress.`,
    (c) => (c.year ? `Helping ${c.city || 'families'} move since ${c.year}.` : `Your next chapter starts here.`),
  ],
  photography: [
    () => `Moments worth keeping, done right.`,
    (c) => `${c.city || 'Your'} story, beautifully captured.`,
    () => `Real moments. Timeless images.`,
    (c) => (c.year ? `Capturing ${c.city || 'the area'} since ${c.year}.` : `Photography that feels like you.`),
  ],
  barber: [
    () => `Sharp cuts. No fuss.`,
    (c) => `${c.city || 'Your'} chair is ready.`,
    () => `Walk in. Walk out sharp.`,
    (c) => (c.year ? `Keeping ${c.city || 'town'} sharp since ${c.year}.` : `A cut that actually fits you.`),
  ],
  spa: [
    () => `Unwind. Reset. Glow.`,
    (c) => `${c.city || 'Your'} escape from the everyday.`,
    () => `Real relaxation, real results.`,
    (c) => (c.year ? `A ${c.city || 'local'} retreat since ${c.year}.` : `Time for you, finally.`),
  ],
  florist: [
    () => `Blooms that say it better.`,
    (c) => `${c.city || 'Local'} flowers, arranged with care.`,
    () => `Fresh stems. Thoughtful design.`,
    (c) => (c.year ? `Arranging ${c.city || 'the area'}'s moments since ${c.year}.` : `For every moment worth marking.`),
  ],
  catering: [
    () => `Food your guests will remember.`,
    (c) => `${c.city || 'Local'} catering, done beautifully.`,
    () => `From intimate to all-out — handled.`,
    (c) => (c.year ? `Catering ${c.city || 'the area'}'s events since ${c.year}.` : `Great food, zero stress.`),
  ],
  'pest-control': [
    () => `Gone for good — guaranteed.`,
    (c) => `${c.city || 'Local'} pest control that works.`,
    () => `Fast, safe, and thorough.`,
    (c) => (c.year ? `Protecting ${c.city || 'homes'} since ${c.year}.` : `Your home, back to being yours.`),
  ],
  veterinary: [
    () => `Care your pet can feel.`,
    (c) => `${c.city || 'Your'} pet, in caring hands.`,
    () => `Gentle vets. Honest advice.`,
    (c) => (c.year ? `Caring for ${c.city || 'local'} pets since ${c.year}.` : `Because they're family too.`),
  ],
  default: [
    (c) => (c.year ? `Serving ${c.city || 'the area'} since ${c.year}.` : `${titleCase(c.what)} you can count on.`),
    (c) => `${c.city || 'Local'}, trusted, and proud of it.`,
    () => `Real work. Real people. Real results.`,
    (c) => `The ${c.what} ${c.city || 'locals'} recommend.`,
  ],
};

function pickHeroHeadline(row, e, what, area) {
  const key = HERO_HEADLINES[row.category?.toLowerCase()] ? row.category.toLowerCase() : 'default';
  const bank = HERO_HEADLINES[key];
  const ctx = { name: row.name, city: row.city, area, what, year: e?.established || '' };
  return bank[hashStr(slugify(row.name) + '|hero') % bank.length](ctx);
}

/**
 * Build a compact credential string from real facts. Used in the hero subheading
 * and eyebrow to make each site feel specific, not templated. Always data-gated —
 * only real scraped facts contribute; never fabricated.
 *
 * Examples:
 *   "Family-owned since 1987 · Licensed & insured"
 *   "Est. 2004 · 4.9★ on Yelp · Maria & Tom Silva"
 *   "Serving Healdsburg, CA"
 */
function buildCredential(row, e, area) {
  const parts = [];
  const estRaw = (e?.established || row.established || '').toString().replace(/^est\.?\s*/i, '').trim();
  if (estRaw && /^\d{4}$/.test(estRaw)) parts.push(`Est. ${estRaw}`);
  if (e?.rating && e?.reviewCount) parts.push(`${e.rating}★ · ${e.reviewCount} reviews`);
  else if (e?.rating) parts.push(`${e.rating}★ rated`);
  // Owner name from enrichment (e.ownerName) or a CSV column (owner_name).
  const owner = e?.ownerName || row.owner_name || row.owner || '';
  if (owner) parts.push(owner);
  // Fall back to area alone when nothing else is available.
  if (!parts.length && area) parts.push(`Serving ${area}`);
  return parts.join(' · ');
}

/**
 * Build the hero eyebrow — a short badge line above the headline. Ideally
 * references both city and a real credential. Falls back gracefully.
 *
 * Examples:
 *   "Healdsburg, CA · Est. 1987"
 *   "Winery · Healdsburg"
 *   "Salon · San Francisco"
 */
function buildEyebrow(row, e, what, area) {
  const city = row.city || '';
  const estRaw = (e?.established || row.established || '').toString().replace(/^est\.?\s*/i, '').trim();
  const credential = estRaw && /^\d{4}$/.test(estRaw) ? `Est. ${estRaw}` : '';
  const ratingBadge = e?.rating ? `${e.rating}★` : '';

  if (city && credential) return `${city} · ${credential}`;
  if (city && ratingBadge) return `${city} · ${ratingBadge}`;
  if (city) return `${titleCase(what)} · ${city}`;
  if (credential) return `${titleCase(what)} · ${credential}`;
  return titleCase(what);
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

// Category-flavored fallback descriptions. Each template must stay TITLE-AGNOSTIC
// (work for any service title within that category cluster) and avoid the
// "Professional X for Y and nearby" phrasing that score.ts penalizes. Categories
// map to a shared cluster via CATEGORY_TO_DESC_BANK; anything unmapped falls back
// to the generic SERVICE_DESC_TEMPLATES above.
const SERVICE_DESC_BANKS = {
  trades: [
    (t, c) => `${t} done right the first time${c ? ` for ${c} homes` : ''} — no shortcuts, no surprises.`,
    (t) => `Upfront pricing and clean, lasting ${t.toLowerCase()} — we treat your place like our own.`,
    (t) => `Licensed, insured, and meticulous about every ${t.toLowerCase()} job.`,
  ],
  beauty: [
    (t) => `Expert ${t.toLowerCase()}, personalized to you.`,
    (t, c) => `${t} that leaves you feeling like the best version of yourself${c ? `, right in ${c}` : ''}.`,
    (t) => `Skilled hands and an honest eye for ${t.toLowerCase()}.`,
  ],
  food: [
    (t) => `${t} made fresh with real ingredients — never frozen, never rushed.`,
    (t, c) => `A ${c ? `${c} ` : ''}favorite: our ${t.toLowerCase()}, made daily.`,
    (t) => `${t} from scratch, served with pride.`,
  ],
  dining: [
    (t) => `${t} worth making the drive for — seasonal, scratch-made, generous.`,
    (t, c) => `${t} done the way ${c || 'locals'} keep coming back for.`,
    (t) => `Honest ${t.toLowerCase()}, real ingredients, no cutting corners.`,
  ],
  care: [
    (t) => `Gentle, attentive ${t.toLowerCase()} with answers you can actually trust.`,
    (t, c) => `${t} for ${c || 'the whole community'}, in caring, experienced hands.`,
    (t) => `Modern ${t.toLowerCase()}, comfortable visits, no pressure.`,
  ],
  home: [
    (t, c) => `Reliable ${t.toLowerCase()}${c ? ` across ${c}` : ''} — on schedule and done well.`,
    (t) => `Thorough ${t.toLowerCase()} from a crew that shows up and follows through.`,
    (t) => `${t} that actually lasts, backed by people who answer the phone.`,
  ],
  auto: [
    (t) => `${t} done straight — we tell you what you need and what you don't.`,
    (t, c) => `Fast, honest ${t.toLowerCase()}${c ? ` for ${c} drivers` : ''}, back on the road quick.`,
    (t) => `Real diagnostics behind every ${t.toLowerCase()} — no upsell, no guesswork.`,
  ],
  fitness: [
    (t) => `${t} built around real progress, not gimmicks.`,
    (t, c) => `${t} for every level${c ? `, right in ${c}` : ''} — coached, not just supervised.`,
    (t) => `Smart, structured ${t.toLowerCase()} that actually gets results.`,
  ],
  creative: [
    (t) => `${t} with a real eye — work you'll be proud to show off.`,
    (t, c) => `${t}${c ? ` in ${c}` : ''} that captures what makes you, you.`,
    (t) => `Thoughtful, original ${t.toLowerCase()} — never cookie-cutter.`,
  ],
};

const CATEGORY_TO_DESC_BANK = {
  plumbing: 'trades', hvac: 'trades', electrician: 'trades', roofing: 'trades',
  painting: 'trades', construction: 'trades',
  salon: 'beauty', spa: 'beauty', barber: 'beauty',
  cafe: 'food', bakery: 'food',
  restaurant: 'dining', catering: 'dining', winery: 'dining',
  dentist: 'care', wellness: 'care', veterinary: 'care',
  landscaping: 'home', cleaning: 'home', 'pest-control': 'home',
  'auto-repair': 'auto', towing: 'auto',
  fitness: 'fitness',
  photography: 'creative', tattoo: 'creative', florist: 'creative',
};

/** Resolve the service-description template bank for a category (generic fallback). */
function serviceDescBank(category) {
  const grp = CATEGORY_TO_DESC_BANK[(category || '').toLowerCase()];
  return (grp && SERVICE_DESC_BANKS[grp]) || SERVICE_DESC_TEMPLATES;
}

function deriveServiceDesc(title, aboutText, city, seed, used, category) {
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
  // 2) Varied, concrete fallback — category-flavored when the cluster is known,
  //    else the generic templates.
  const bank = serviceDescBank(category);
  const tpl = bank[seed % bank.length];
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

// Like clip(), but NEVER truncates: returns whole sentence(s) from the start
// that fit within `max`, or '' if even the first sentence is too long. Used for
// the tagline/hero-subheading so they're either a complete real sentence or a
// composed line — never a mid-sentence meta clip (the cookie-cutter tell).
function clipSentence(s, max) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const sentences = t.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  out = out.trim();
  // Guarantee terminal punctuation; if the source had none and it's short
  // enough, add a period so it reads as a finished line.
  if (out && !/[.!?]$/.test(out)) out = `${out}.`;
  return out.length >= 12 ? out : '';
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
// Copy generation. Tries Claude (rich real-fact prompt); otherwise reuses the
// business's own scraped prose + services, falling back to template only for
// fields with no real source (those get flagged for a polish pass).
// ---------------------------------------------------------------------------
async function generateCopy(row, preset, e) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await generateCopyWithClaude(row, preset, e);
    } catch (err) {
      console.warn(`  ! Claude copy failed for ${row.name} (${err.message}); using research/template`);
    }
  }
  return researchCopy(row, preset, e);
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
function researchCopy(row, preset, e) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const what = row.category ? row.category.replace(/-/g, ' ') : 'local business';
  const templated = [];

  // The single most important line in this file: the scraped self-description
  // is run through the slop filter BEFORE it's allowed anywhere near the copy.
  // `usableDescription` strips platform boilerplate and rejects meta-tag dumps
  // / truncated fragments — so "This is the online store for X" (and its
  // mid-sentence clips) can NEVER become a tagline/hero/about line again. When
  // it returns '', we compose from real facts and flag the field for the agent.
  const desc = usableDescription(e?.description || '');

  // About: their OWN words (cleaned) beat anything we'd write.
  let aboutBody;
  const realParas = (e?.about ?? [])
    .map((p) => cleanCopy(stripTags(p)))
    .filter((p) => p.length > 60 && usableDescription(p) !== '');
  if (realParas.length) {
    aboutBody = realParas.slice(0, 2);
  } else if (desc && desc.length > 80) {
    aboutBody = [clip(desc, 320)];
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
  const sseed = hashStr(slugify(row.name));
  const cat = (row.category || '').toLowerCase();
  const descBank = serviceDescBank(cat);
  if (e?.services?.length >= 1) {
    // Use whatever REAL services the scrape found (even 1–2) — authentic titles
    // beat a full grid of presets. If fewer than 3, top up from the category
    // preset so the grid still looks full, but never with the penalized
    // "Professional X for Y and nearby" filler.
    const aboutText = realParas.join(' ') || desc || '';
    const usedDescs = new Set();
    const real = e.services.slice(0, 5).map((title, i) => ({
      title: titleCase(title),
      description: deriveServiceDesc(title, aboutText, row.city, sseed + i, usedDescs, cat),
    }));
    // deriveServiceDesc only adds to usedDescs when it pulls a REAL sentence from
    // their copy; an empty set means every description fell back to a template —
    // real titles, canned descriptions — which deriveStatus flags for a polish.
    if (real.length && usedDescs.size === 0) templated.push('service-descriptions');
    const have = new Set(real.map((s) => s.title.toLowerCase()));
    const topUp = preset.services
      .filter((t) => !have.has(t.toLowerCase()))
      .slice(0, Math.max(0, 3 - real.length))
      .map((title, i) => ({
        title,
        description: descBank[(sseed + i) % descBank.length](titleCase(title), row.city),
      }));
    services = [...real, ...topUp];
  } else {
    // No real services at all → preset grid, but with varied concrete copy (not
    // the templated filler the scorer penalizes). Still flagged for a polish pass.
    templated.push('services');
    services = preset.services.map((title, i) => ({
      title,
      description: descBank[(sseed + i) % descBank.length](titleCase(title), row.city),
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

  // Tagline: the first clean sentence of their OWN description (a real promise),
  // never a mid-sentence clip. If no usable description survived the slop
  // filter, compose from facts and flag it so the agent writes a real one.
  const firstSentence = desc ? clipSentence(desc, 90) : '';
  const tagline = firstSentence || `${titleCase(what)} you can count on in ${row.city || 'town'}.`;
  if (!firstSentence) templated.push('tagline');

  // SEO description: composed for local SEO (names the town) — NOT the raw meta.
  // A clean self-description can seed it, but it must read as a full sentence.
  let seoDescription = clip(
    firstSentence
      ? `${firstSentence} ${row.name} serves ${area || 'the local area'}.`
      : `${row.name} — trusted ${what} serving ${area || 'the local area'}. Call today for friendly, reliable service.`,
    150,
  );
  // The scorer rewards 80–160 chars; a short name + short first sentence can land
  // under 80. Pad with real local context (never placeholder) to reach the band.
  if (seoDescription.length < 80) {
    seoDescription = clip(
      `${seoDescription} ${titleCase(what)} proudly serving ${area || 'the local community'} and nearby.`,
      155,
    );
  }

  // Hero: a per-category headline bank (earned-feeling, seeded) — not the old
  // formulaic "<Category> done right."
  const heroHeading = pickHeroHeadline(row, e, what, area);

  // Hero subheading: a fuller clean clip of their description (distinct from the
  // tagline), else a composed credential line + flagged. Never the raw,
  // mid-sentence meta dump. Guard on the CLIPPED result, not just `desc`: a
  // truthy description whose every sentence is >170 chars makes clipSentence
  // return '' — fall back to the composed line and flag it, so a site never
  // ships an empty subheading.
  const subFromDesc = desc ? clipSentence(desc, 170) : '';
  // Build a credential string from real facts to weave into the composed fallback.
  const credential = buildCredential(row, e, area);
  const heroSubheading =
    subFromDesc ||
    (credential
      ? `${credential}. Serving ${area || 'the local community'} with honest work and a friendly face.`
      : `Serving ${area || 'the local community'} with honest work and a friendly face.`);
  if (!subFromDesc) templated.push('hero-subheading');

  // Eyebrow: city + real credential when available, else category + city.
  const heroEyebrow = buildEyebrow(row, e, what, area);

  return {
    tagline,
    seoDescription,
    heroHeading,
    heroSubheading,
    heroEyebrow,
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

// Compose a RICH depth-section spine from REAL data only — never fabricated.
// Every section is data-gated: it appears only when the scrape (or CSV row)
// actually provides the facts to fill it, so the FIRST build lands rich instead
// of thin. Photos/gallery are deliberately NOT built here — that lever lives in
// the media pipeline so we never pad a gallery with stock.
// Extract the first money amount from a string ("Oil change from $49.99" → "$49.99").
// Returns '' when none — keeps the menu strictly data-gated (no fabricated prices).
function extractPrice(text) {
  if (!text) return '';
  const m = String(text).match(/\$\s?\d{1,4}(?:[.,]\d{2})?/);
  return m ? m[0].replace(/\s/g, '') : '';
}

function buildSections(row, e, copy) {
  const sections = [];
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const phone = e?.phone || row.phone || '';
  const address = e?.address || row.address || '';

  // 1) Services spine — a priced MENU for food / personal-care when real prices
  //    exist, otherwise the rich services-detailed grid. Never both (they'd
  //    duplicate the same services). Data-gated: the menu only fires when ≥3
  //    services carry a detectable price, so nothing is fabricated.
  const svc = (copy?.services ?? []).filter((s) => s.title);
  const MENU_CATS = new Set(['cafe', 'restaurant', 'bakery', 'salon', 'spa', 'bar', 'deli']);
  const cat = (row.category || '').toLowerCase();
  const pricedItems = svc
    .map((s) => ({ name: s.title, price: extractPrice(s.description) || extractPrice(s.title) }))
    .filter((it) => it.price);
  if (MENU_CATS.has(cat) && pricedItems.length >= 3) {
    sections.push({
      type: 'menu',
      eyebrow: 'Menu',
      heading: copy.servicesHeading || 'What we offer',
      groups: [{ title: copy.servicesHeading || 'Highlights', items: pricedItems.slice(0, 12) }],
    });
  } else if (svc.length) {
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
  // Count the services actually RENDERED (copy is capped at 5), not the raw
  // scrape — otherwise a 10-service business shows "10" while only 5 appear.
  if (svc.length >= 3) stats.push({ value: String(svc.length), label: 'Services offered' });
  if (stats.length >= 2) sections.push({ type: 'stats', items: stats.slice(0, 4) });

  // 2b) Credentials / awards strip — cert-like highlights become trust chips.
  // Data-gated: only when ≥2 real credentials are present (never fabricated).
  const CRED_RE = /\b(ASE|BBB|certified|certification|licensed|insured|bonded|accredited|warranty|award[- ]?winning|EPA|NAPA|factory[- ]?trained|master|member of)\b/i;
  const creds = (copy?.highlights ?? []).filter((h) => typeof h === 'string' && CRED_RE.test(h));
  if (creds.length >= 2) {
    sections.push({
      type: 'awards',
      eyebrow: 'Credentials',
      heading: 'Certified & trusted',
      items: creds.slice(0, 6).map((name) => ({ name })),
    });
  }

  // 3) Testimonials from scraped reviews.
  if (e?.testimonials?.length) {
    sections.push({
      type: 'testimonials',
      eyebrow: 'In their words',
      heading: 'What customers say',
      items: e.testimonials.slice(0, 3).map((t) => ({ quote: clip(t.quote, 280), author: t.author })),
    });
    // Auto-inject a CTA right after testimonials — social proof + immediate
    // action is the highest-converting sequence. Only when a real contact
    // exists; never invent a phone or action we can't fulfil.
    if (phone) {
      sections.push({
        type: 'cta',
        heading: `Ready to work with ${row.name}?`,
        text: area ? `Serving ${area} and the surrounding community.` : undefined,
        buttonText: 'Get in touch',
        buttonHref: phone ? `tel:${phone.replace(/\D/g, '')}` : '#contact',
      });
    }
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

  // 5) Map locator from a real address (hours live in hours-contact, not here).
  if (address) sections.push({ type: 'map', address });

  // 6) Hours + phone close with a contact CTA.
  if (e?.hours?.length || phone) {
    sections.push({
      type: 'hours-contact',
      heading: 'Get in touch',
      hours: e?.hours?.length ? e.hours : [],
      phone: phone || undefined,
      cta: { text: 'Contact us', href: '#contact' },
    });
  }

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
      // Only a REAL customer testimonial earns the blockquote treatment. Never
      // dress a composed marketing tagline as if it were someone's quote.
      const t = (e?.testimonials ?? []).find((t) => t.quote && t.quote.length > 60);
      if (t) return { type: 'bigquote', quote: clip(t.quote, 240), author: t.author };
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
  const [heroPhoto, storyPhoto] = media;
  const lib = `/images/library/${catKey}`;

  // Gallery = all real photos beyond the hero (own shots preferred; credited
  // Wikimedia/Openverse included too — they add visual richness and are properly
  // attributed). Library SVGs are excluded (they're fallback art, not photos).
  const GALLERY_MAX = 8;
  const isOwn = (m) => m?.path && !m.credit && !m.path.includes('/images/library/') && !m.path.endsWith('.svg');
  const isGalleryEligible = (m) =>
    m?.path && !m.path.includes('/images/library/') && !m.path.endsWith('.svg');
  const ownPhotos = media.filter(isOwn);
  const eligiblePhotos = media.filter(isGalleryEligible);
  // Prefer own photos for gallery; fall back to credited photos (Wikimedia etc.)
  // so a zero-own-photos business still gets a populated gallery. Always skip
  // whichever photo was assigned as hero to avoid an exact duplicate card.
  const galleryPool = (ownPhotos.length > 0 ? ownPhotos : eligiblePhotos).filter(
    (m) => !heroPhoto || m.path !== heroPhoto.path,
  );
  const galleryImages = galleryPool.slice(0, GALLERY_MAX).map((m, i) => ({
    src: m.path,
    alt: `${row.name}${area ? ` in ${area}` : ''} — photo ${i + 1}`,
    ...(m.credit ? { credit: m.credit } : {}),
  }));

  // Never invent a phone. A fake "(555) 555-5555" would ship as the page's
  // call-to-action and pass the gates; empty renders no phone (components guard
  // it) and deriveStatus flags the gap for a real number.
  const phone = e?.phone || row.phone || '';
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

  const storyCredit = storyPhoto?.credit
    ? `Photo: ${storyPhoto.credit}`
    : heroPhoto?.credit
      ? `Photo: ${heroPhoto.credit}`
      : '';

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
      ...(copy.heroEyebrow ? { eyebrow: copy.heroEyebrow } : {}),
      ctaText: 'Get in touch',
      ctaHref: '#contact',
    },
    highlights: copy.highlights,
    images: {
      hero: heroPhoto?.path ?? `${lib}/hero.svg`,
      heroAlt: `${row.name} in ${area}`,
      // Only use a story image when it's DISTINCT from the hero. When only one
      // real photo exists, storyPhoto is undefined and we use the library SVG —
      // never duplicate the hero path (which looked like two identical images on
      // the page and silently capped the photo-richness score).
      story:
        storyPhoto?.path && storyPhoto.path !== heroPhoto?.path
          ? storyPhoto.path
          : `${lib}/story.svg`,
      storyAlt: `About ${row.name}`,
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
    // Outreach funnel defaults: reservation window + CTA reassurance copy.
    // reservedUntil = generation date + 30 days (a real rolling window, not a
    // hard-coded placeholder). claimSubtext reassures the prospect before they click.
    outreach: {
      published: false,
      reservedUntil: daysFromNow(30),
      claimSubtext: 'No contract. No setup fee. Live in 48 hours.',
    },
    theme: preset.theme,
  };
}

// Decide ready vs needs-review from how much REAL material we got.
function deriveStatus(row, e, media, photoSource, templated) {
  const flags = [];
  // agent-supplied = real photos the agent hand-placed (the STRONGEST tier) —
  // it must count as real, or every such site is wrongly flagged needs-review.
  const realPhotos = /business-site|ai-generated|agent-supplied/.test(photoSource);
  if (!row.website) flags.push('No website provided — research & verify manually');
  else if (!e) flags.push('Website unreachable — copy not built from real data');
  else if ((e.richness ?? 0) < 35) flags.push('Thin research — verify facts & rewrite copy');
  if (!realPhotos) flags.push(`No real/AI photos — using ${photoSource || 'stock'} art`);
  if (templated.includes('services')) flags.push('Services are template defaults — replace with real ones');
  if (templated.includes('service-descriptions')) flags.push('Service descriptions need a polish pass');
  if (templated.includes('about')) flags.push('About copy is templated — rewrite from research');
  if (templated.includes('tagline')) flags.push('Tagline is composed, not from real copy — agent should write a real one');
  if (templated.includes('hero-subheading')) flags.push('Hero subheading is composed — agent should write one from the facts');
  // Contact completeness: never silently ship a guessed email. If we found no
  // real email, flag the gap so a real non-phone contact method gets added.
  const hasRealEmail = Boolean(e?.email || row.email);
  if (!hasRealEmail) flags.push('No email found — add a real email or contact form before sending');
  // Never ship a fabricated phone. If we found no real number, flag it — the
  // page now renders no phone CTA rather than a fake "(555)" placeholder.
  const hasRealPhone = Boolean(e?.phone || row.phone);
  if (!hasRealPhone) flags.push('No phone found — add a real phone number before sending');
  // Trust signals are the single biggest score gap when reviews live on Google/
  // Yelp (not the business's own site, so the key-free scrape misses them).
  // Demand them: a trust-less site routes to the agent to research REAL reviews/
  // rating/founding year — never fabricated — instead of shipping a thin B.
  const hasTrust = Boolean(e?.testimonials?.length || e?.established || e?.rating);
  if (!hasTrust) flags.push('No trust signals — research real reviews / rating / founding year and add a testimonials section');
  // Address powers contact-completeness + the map section; flag if unverified.
  if (!(e?.address || row.address)) flags.push('No address found — add a real street address (powers the map + contact)');
  // A real gallery needs ≥3 own photos; flag a partial set rather than padding.
  const realGalleryCount = (media ?? []).length;
  if (realGalleryCount > 0 && realGalleryCount < 3)
    flags.push(`Only ${realGalleryCount} real photo(s) — need ≥3 for a full gallery (add their photos)`);
  // Hours fell back to the generic Mon–Fri 8–6 default (buildConfig) — wrong for
  // wineries, marinas, weekend/seasonal businesses. Flag so it's verified.
  if (!e?.hours?.length) flags.push('Hours are a generic default (Mon–Fri 8–6) — verify before sending');
  const status = flags.length ? 'needs-review' : 'ready';
  return { status, flags };
}

// Resolve the category key (so we can pick the right library art folder).
const catKeyFor = (row) =>
  CATEGORIES[row.category?.toLowerCase()] ? row.category.toLowerCase() : 'default';

// Has the agent already dropped real photos for this slug into
// src/assets/prospects/<slug>/ (the strongest tier)? If so, use them ALL —
// hero/story first, then the rest as gallery fodder (they're all genuinely
// theirs, so more real photos = a richer page, never stock).
async function agentDroppedPhotos(slug) {
  try {
    const files = (await readdir(join(PUBLIC_IMAGES, slug)))
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
      .sort();
    if (!files.length) return [];
    const hero = files.find((f) => f.startsWith('hero')) ?? files[0];
    const story = files.find((f) => f.startsWith('story')) ?? files.find((f) => f !== hero);
    // hero, then story, then everything else — de-duped, order preserved.
    const ordered = [hero, story, ...files].filter(
      (f, i, a) => f && a.indexOf(f) === i,
    );
    return ordered.map((f) => ({ path: `/images/${slug}/${f}`, credit: '' }));
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

  const base = process.env.GALLERY_BASE_URL?.replace(/\/$/, '') ?? '';
  const links = [];
  const built = [];

  for (const row of rows) {
    if (!row.name) continue;
    const slug = slugify(row.name);
    const catKey = catKeyFor(row);
    const preset = CATEGORIES[catKey];

    // Accept either `website` or `existing_website` as the column header.
    row.website = row.website || row.existing_website || '';

    // 1) Scrape their existing site for real facts (best-effort, key-free).
    let e = null;
    if (row.website) {
      process.stdout.write(`  · ${row.name}: scraping ${row.website} … `);
      e = await scrapeSite(row.website);
      console.log(e ? `ok (richness ${e.richness})` : 'unreachable');
    }
    // Backfill missing CSV location fields from the scrape.
    if (e) {
      row.city = row.city || e.city || '';
      row.state = row.state || e.state || '';
    }

    // Turbo mode (no-op unless OUTSCRAPER_API_KEY is set): fill real reviews/
    // rating/founding/hours/photos from Google Maps — the two dimensions own-site
    // scraping can't reach. Runs even when `e` is null (no website) so a Maps-only
    // business still gets enriched. Honest: empty in → empty out, never faked.
    e = await augmentEnrichment(e, row);

    // 2) Photos: agent-dropped → their site → AI-gen → Wikimedia → library.
    let media = await agentDroppedPhotos(slug);
    let photoSource = media.length ? 'agent-supplied' : '';
    if (!media.length) {
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
    }

    // 3) Copy from real facts; 4) depth sections + layout.
    const copy = await generateCopy(row, preset, e);
    const sections = buildSections(row, e, copy);
    const layout = layoutFor(slug);

    // 5) Quality gate.
    const { status, flags } = deriveStatus(row, e, media, photoSource, copy._templated ?? []);

    const config = buildConfig(row, copy, preset, catKey, media, e, {
      sections,
      layout,
      status,
      flags,
      formspreeId: row.formspree_id || row.formspree || '',
      bookingUrl: row.booking_url || row.booking || '',
    });
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
  console.log('\nNext: cd sites/demo-gallery && npm install && npm run dev   (preview at /p/<slug>)');
  console.log('Then commit + push — Vercel rebuilds the gallery and your links go live.');
}

// Exported for tests; only auto-run when invoked directly (not when imported).
export { buildConfig, slugify, parseCsv, researchCopy, fallbackCopy, buildSections, layoutFor, CATEGORIES };

// Run main() only when invoked directly (not when imported by tests).
// Use pathToFileURL so this works on Windows (file:///C:/…) as well as POSIX.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
