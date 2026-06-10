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
import { validateProspectConfig } from '../sites/demo-gallery/src/lib/contract.mjs';

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
    services: ['Service one', 'Service two', 'Service three', 'Service four'],
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

// ---------------------------------------------------------------------------
// Service-description derivation (key-free, hard-gated). We ONLY describe a
// service from the business's OWN words — a real sentence in their about/scrape
// copy that names the service. If none exists we return '' rather than invent a
// generic line: an undescribed service is still surfaced honestly as a
// "what we do" label (feature-grid) — it just won't claim specifics we can't
// back up. (The old "<Title> for <city>…" / "We handle X with care" templates
// were filler and are gone.)
// ---------------------------------------------------------------------------
function deriveServiceDesc(title, aboutText, city, seed, used) {
  // A real sentence from their own copy that names this service — but NOT one
  // already used for another service (two services often share a keyword, and
  // repeating one sentence verbatim across cards reads worse than no copy).
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
  // No real source sentence — honest empty description (gated downstream).
  return '';
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

  // About: their OWN words (cleaned) beat anything we'd write.
  let aboutBody;
  const realParas = (e?.about ?? []).map((p) => stripTags(p)).filter((p) => p.length > 60);
  if (realParas.length) {
    aboutBody = realParas.slice(0, 2);
  } else if (e?.description && e.description.length > 80) {
    aboutBody = [clip(e.description, 320)];
  } else {
    // No real about/story text — gate rather than fabricate a neighborly origin
    // story. The About region still renders the heading, photo, and highlights;
    // it just won't invent a history we can't verify. Flagged needs-review.
    templated.push('about');
    aboutBody = [];
  }

  // Services: real scraped service names beat generic presets. We only have
  // their titles, so descriptions are derived from their own about copy where
  // possible (a sentence that names the service), else a varied concrete line.
  // Services: ONLY the business's real, scraped service names — never the generic
  // category preset (that was the "Service one/two/three" slop). Descriptions are
  // pulled from their own copy where a real sentence names the service, else left
  // empty (the service still lists as an honest label, just without invented prose).
  let services = [];
  if (e?.services?.length) {
    const aboutText = realParas.join(' ') || e?.description || '';
    const sseed = hashStr(slugify(row.name));
    const usedDescs = new Set();
    services = e.services.slice(0, 6).map((title, i) => ({
      title: titleCase(title),
      description: deriveServiceDesc(title, aboutText, row.city, sseed + i, usedDescs),
    }));
  }
  if (!services.length) templated.push('services');

  // Highlights: ONLY concrete, verifiable facts (founding year, real rating). The
  // old code padded to three with generic category adjectives ("24/7 dispatch",
  // "Licensed & insured") — claims that can be FALSE for this specific business.
  // Per the hard-gate rule we assert nothing we can't back up; fewer is fine.
  const highlights = [];
  if (e?.established) highlights.push(`Serving since ${e.established}`);
  if (e?.rating) highlights.push(`${e.rating}★${e.reviewCount ? ` · ${e.reviewCount} reviews` : ''}`);

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
  const heroHeading = pickHeroHeadline(row, e, what, area);

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

// The business's OWN photos beyond the hero, as gallery items (never stock). A
// media item is "own" when it carries no credit and isn't library/SVG art. Pulled
// out of buildConfig so buildSections (the structure owner) can emit the gallery
// section from the same source the config field uses.
const GALLERY_MAX = 8;
function computeGalleryImages(row, media = []) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const heroPhoto = media[0];
  const isOwn = (m) => m?.path && !m.credit && !m.path.includes('/images/library/');
  const ownPhotos = media.filter(isOwn);
  if (ownPhotos[0] && heroPhoto && ownPhotos[0].path === heroPhoto.path) {
    return ownPhotos.slice(1, 1 + GALLERY_MAX).map((m, i) => ({
      src: m.path,
      alt: `${row.name}${area ? ` in ${area}` : ''} — photo ${i + 1}`,
    }));
  }
  return [];
}

// A conversion CTA section. Honest by nature (it asks the visitor to reach out —
// it asserts no facts), so it's the one section that's always allowed.
function ctaSection(row, phone, kind) {
  return {
    type: 'cta',
    heading: kind === 'mid' ? 'Ready when you are' : `Get in touch with ${row.name}`,
    text: phone
      ? `Call ${phone} or send a message — we'll get right back to you.`
      : "Send a message and we'll get right back to you.",
    buttonText: 'Get in touch',
    buttonHref: '#contact',
  };
}

// Compose the COMPLETE, ordered page structure from REAL data only — this is now
// the SINGLE owner of page structure (the render-time composer just passes it
// through). Every section is hard-gated: it appears only when the scrape (or CSV
// row) actually provides the facts to fill it, so a thin business yields a
// shorter honest page rather than a padded fabricated one. Gallery is built here
// (from the business's own photos), never padded with stock.
function buildSections(row, e, copy, galleryImages = []) {
  const sections = [];
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const phone = e?.phone || row.phone || '';
  const address = e?.address || row.address || '';

  const describedSvc = (copy?.services ?? []).filter(
    (s) => s.title && s.description && s.description.trim().length > 20,
  );
  const allSvc = (copy?.services ?? []).filter((s) => s.title);
  const highlights = (copy?.highlights ?? []).filter(Boolean);

  // 1) Feature grid — honest, scannable labels of their REAL services. Used only
  //    when we have ≥3 real service TITLES but couldn't describe them (so it never
  //    duplicates the rich grid below). Built from real titles, NOT generic
  //    category claims — a business with no real services gets no grid (gated).
  if (!describedSvc.length && allSvc.length >= 3) {
    const items = allSvc.slice(0, 6).map((s) => ({ label: s.title }));
    sections.push({ type: 'feature-grid', eyebrow: 'What we do', heading: 'How we can help', items });
  }

  // 2) Services as the rich grid — ONLY services with a REAL description (the
  //    visible spine when we have real prose to back each card).
  if (describedSvc.length) {
    sections.push({
      type: 'services-detailed',
      eyebrow: 'Services',
      heading: copy.servicesHeading || 'What we do',
      items: describedSvc.map((s) => ({ title: s.title, description: s.description })),
    });
  }

  // 3) Their REAL photos. ≥3 of their own → a gallery; otherwise, if there's a
  //    story photo's worth of described services, ONE editorial feature-split band
  //    so a 2-image site still gets an image break instead of a blank gap.
  if (galleryImages.length >= 3) {
    sections.push({
      type: 'gallery',
      eyebrow: 'Gallery',
      heading: 'A look around',
      images: galleryImages.slice(0, GALLERY_MAX).map((g) => ({ src: g.src, alt: g.alt })),
    });
  } else if (describedSvc.length) {
    sections.push({
      type: 'feature-split',
      eyebrow: 'What sets us apart',
      heading: copy.servicesHeading || 'What we do',
      rows: describedSvc.slice(0, 3).map((s) => ({ heading: s.title, body: s.description })),
    });
  }

  // 4) Stats from real numbers only.
  const stats = [];
  if (e?.established) {
    const yrs = new Date().getFullYear() - Number(e.established);
    if (yrs > 0 && yrs < 200) stats.push({ value: `${yrs}+`, label: 'Years in business' });
    else stats.push({ value: String(e.established), label: 'Serving since' });
  }
  if (e?.rating) stats.push({ value: `${e.rating}★`, label: e.reviewCount ? `${e.reviewCount} reviews` : 'Customer rating' });
  if (e?.services?.length >= 3) stats.push({ value: `${e.services.length}`, label: 'Services offered' });
  if (stats.length >= 2) sections.push({ type: 'stats', items: stats.slice(0, 4) });

  // 5) Testimonials from scraped reviews — then a mid-page CTA at the credibility
  //    peak (the CRO move the composer used to inject; now owned here).
  if (e?.testimonials?.length) {
    sections.push({
      type: 'testimonials',
      eyebrow: 'In their words',
      heading: 'What customers say',
      items: e.testimonials.slice(0, 3).map((t) => ({ quote: clip(t.quote, 280), author: t.author })),
    });
    sections.push(ctaSection(row, phone, 'mid'));
  }

  // 6) FAQ — every answer comes straight from a REAL scraped fact (location,
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

  // 7) Map locator from a real address (hours live in hours-contact, not here).
  if (address) sections.push({ type: 'map', address });

  // 8) Hours + phone contact band.
  if (e?.hours?.length || phone) {
    sections.push({
      type: 'hours-contact',
      heading: 'Get in touch',
      hours: e?.hours?.length ? e.hours : [],
      phone: phone || undefined,
      cta: { text: 'Contact us', href: '#contact' },
    });
  }

  // 9) Closing CTA — always (a conversion close, not fabricated content).
  sections.push(ctaSection(row, phone, 'close'));

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
  const [heroPhoto, storyPhoto] = media;
  const lib = `/images/library/${catKey}`;

  // Gallery = the business's OWN photos beyond the hero (computed once in main
  // and threaded through extras so buildSections and the config field agree).
  const galleryImages = extras.galleryImages ?? [];

  // No fabricated contact facts. A guessed phone/address reads as fake to the
  // prospect and the audit flags it; empty values render nothing (the components
  // guard them) and deriveStatus/the contract flag the gap for a real one.
  const phone = e?.phone || row.phone || '';
  const address = e?.address || row.address || '';
  const established = (e?.established || row.established || '').toString().replace(/^est\.?\s*/i, '');

  // Hours: real scraped hours ONLY — no generic Mon–Fri 8–6 default (it's wrong
  // for wineries/marinas/weekend & seasonal businesses). Empty when unknown; the
  // contact band falls back to phone-only and the site is flagged needs-review.
  const hours = e?.hours?.length ? e.hours : [];

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
      ctaText: 'Get in touch',
      ctaHref: '#contact',
    },
    highlights: copy.highlights,
    images: {
      hero: heroPhoto?.path ?? `${lib}/hero.svg`,
      heroAlt: `${row.name} in ${area}`,
      story: storyPhoto?.path ?? heroPhoto?.path ?? `${lib}/story.svg`,
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
    theme: preset.theme,
  };
}

// Decide ready vs needs-review from how much REAL material we got.
function deriveStatus(row, e, media, photoSource, templated) {
  const flags = [];
  const realPhotos = /business-site|ai-generated/.test(photoSource);
  if (!row.website) flags.push('No website provided — research & verify manually');
  else if (!e) flags.push('Website unreachable — copy not built from real data');
  else if ((e.richness ?? 0) < 35) flags.push('Thin research — verify facts & rewrite copy');
  if (!realPhotos) flags.push(`No real/AI photos — using ${photoSource || 'stock'} art`);
  if (templated.includes('services')) flags.push('No real services found — add the real ones before sending');
  if (templated.includes('about')) flags.push('No about/story copy found — write it from research');
  // Email, default/empty hours, templated copy and stock hero are detected by the
  // data contract (validateProspectConfig) and merged in by the caller — not
  // duplicated here.
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

    // 3) Copy from real facts; 4) gallery + the full page structure.
    const copy = await generateCopy(row, preset, e);
    const galleryImages = computeGalleryImages(row, media);
    const sections = buildSections(row, e, copy, galleryImages);
    const layout = layoutFor(slug);

    // 5) Research/photo flags (content-quality flags come from the contract below).
    const { status, flags } = deriveStatus(row, e, media, photoSource, copy._templated ?? []);

    const config = buildConfig(row, copy, preset, catKey, media, e, {
      sections,
      layout,
      status,
      flags,
      galleryImages,
      formspreeId: row.formspree_id || row.formspree || '',
      bookingUrl: row.booking_url || row.booking || '',
    });

    // 6) CONTRACT ENFORCEMENT. A structurally-invalid config is NEVER written
    //    (it would break the build at the render boundary); its quality warnings
    //    are folded into the dashboard flags and force needs-review, so nothing
    //    weak ships silently.
    const check = validateProspectConfig(config);
    if (!check.valid) {
      console.warn(`  ✗ ${row.name}: config violates the data contract — skipped.`);
      for (const err of check.errors) console.warn(`      • ${err}`);
      continue;
    }
    const mergedFlags = [...new Set([...flags, ...check.warnings])];
    config.flags = mergedFlags;
    config.status = mergedFlags.length ? 'needs-review' : 'ready';

    // Keep row/e/copy on the entry (not serialized) so the post-divergence pass
    // can build the depth section the divergence hint requests.
    built.push({ slug, catKey, config, row, e, copy, link: `${base}/p/${slug}`, status: config.status, photoSource, flags: mergedFlags });
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
