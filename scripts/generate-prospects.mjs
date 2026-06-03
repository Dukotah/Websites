#!/usr/bin/env node
/**
 * generate-prospects.mjs — turn CRM rows into demo-gallery prospect sites.
 *
 * Reads a CSV of businesses and writes one JSON per row into
 * sites/demo-gallery/src/data/prospects/<slug>.json. Each JSON matches the
 * ProspectConfig schema, so the gallery renders it at /p/<slug> and you can
 * paste that link into an outreach email.
 *
 * No API keys required. Marketing copy uses a built-in per-category template by
 * default (the agent personalizes it per business when run conversationally —
 * see CLAUDE.md). An optional ANTHROPIC_API_KEY, if present, will have Claude
 * write the copy, but nothing requires it.
 *
 * Photos are free and key-free, tried in this order per row:
 *   1. (agent tier) the business's OWN photos found online — done by the agent
 *      via web search before/after this script, dropped into public/images/<slug>/
 *   2. Wikimedia Commons match (no key) — see scripts/lib/photos.mjs
 *   3. the built-in category library art (always works, no network)
 *
 * Usage:
 *   node scripts/generate-prospects.mjs [path/to/file.csv]
 *   # defaults to data/prospects.sample.csv
 *
 * CSV columns (header row required; only `name` is required, rest optional):
 *   name, category, city, state, phone, email, address, established
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRealPhotos } from './lib/photos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
const PUBLIC_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'public', 'images');
const csvPath = resolve(ROOT, process.argv[2] ?? 'data/prospects.sample.csv');

// ---------------------------------------------------------------------------
// Per-category presets: theme colors + the kind of services/highlights a
// business in that category typically offers. Used as the deterministic
// fallback and as hints for the Claude prompt.
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
  default: {
    theme: { brand: '#c2683a', brandDark: '#243b53' },
    highlights: ['Friendly service', 'Locally owned', 'Fair prices'],
    services: ['Service one', 'Service two', 'Service three', 'Service four'],
  },
};

const slugify = (s) =>
  s.toLowerCase().trim().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

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
// Copy generation. Tries Claude; falls back to deterministic templates.
// ---------------------------------------------------------------------------
async function generateCopy(row, preset) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await generateCopyWithClaude(row, preset);
    } catch (err) {
      console.warn(`  ! Claude copy failed for ${row.name} (${err.message}); using fallback`);
    }
  }
  return fallbackCopy(row, preset);
}

async function generateCopyWithClaude(row, preset) {
  const system = [
    {
      type: 'text',
      text:
        'You are a copywriter for small local-business websites. Given a business, ' +
        'return ONLY valid minified JSON (no markdown fences) with this exact shape:\n' +
        '{"tagline":string,"seoDescription":string,"heroHeading":string,' +
        '"heroSubheading":string,"highlights":string[3],"aboutHeading":string,' +
        '"aboutBody":string[2],"servicesHeading":string,' +
        '"services":[{"title":string,"description":string}] (exactly 4)}\n' +
        'Voice: warm, trustworthy, concrete, local. No hype, no emoji. ' +
        'heroHeading is a short promise (<=8 words). seoDescription <=150 chars ' +
        'and must name the town for local SEO.',
      // Cache the instructions so repeated rows only pay for the small user turn.
      cache_control: { type: 'ephemeral' },
    },
  ];

  const e = row._enrichment;
  const googleContext = e
    ? `\nGoogle data (use for accuracy, don't invent beyond it):` +
      (e.primaryType ? `\n- Type: ${e.primaryType}` : '') +
      (e.editorialSummary ? `\n- Google summary: ${e.editorialSummary}` : '') +
      (e.rating ? `\n- Rating: ${e.rating}/5 from ${e.userRatingCount} reviews` : '') +
      (e.formattedAddress ? `\n- Address: ${e.formattedAddress}` : '')
    : '';

  const user =
    `Business: ${row.name}\nCategory: ${row.category || 'local business'}\n` +
    `Town/area: ${row.city}${row.state ? ', ' + row.state : ''}\n` +
    `Typical services for this category: ${preset.services.join(', ')}` +
    googleContext;

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
  return {
    tagline: json.tagline,
    seoDescription: json.seoDescription,
    heroHeading: json.heroHeading,
    heroSubheading: json.heroSubheading,
    highlights: json.highlights,
    aboutHeading: json.aboutHeading,
    aboutBody: json.aboutBody,
    servicesHeading: json.servicesHeading,
    services: json.services,
  };
}

function fallbackCopy(row, preset) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const what = row.category ? row.category.replace(/-/g, ' ') : 'local business';
  return {
    tagline: `${titleCase(what)} you can count on in ${row.city || 'town'}.`,
    seoDescription:
      `${row.name} — trusted ${what} serving ${area || 'the local area'}. ` +
      `Call today for friendly, reliable service.`.slice(0, 150),
    heroHeading: `${titleCase(what)} done right.`,
    heroSubheading: `Serving ${area || 'the local community'} with honest work and a friendly face.`,
    highlights: preset.highlights,
    aboutHeading: 'About us',
    aboutBody: [
      `${row.name} is a locally owned ${what} proudly serving ${area || 'the area'}. ` +
        `We treat every customer like a neighbor — because most of them are.`,
      'Reliable work, fair prices, and people who pick up the phone. ' +
        "That's what's kept folks coming back to us.",
    ],
    servicesHeading: 'What we offer',
    services: preset.services.map((title) => ({
      title,
      description: `Professional ${title.toLowerCase()} for ${row.city || 'the local area'} and nearby.`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Build a full ProspectConfig from a row + generated copy. `media` is any real
// photos found (Wikimedia or agent-sourced); when empty, the category's
// built-in library art is used so the page always looks finished.
// ---------------------------------------------------------------------------
function buildConfig(row, copy, preset, catKey, media = []) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const [heroPhoto, storyPhoto] = media;
  const lib = `/images/library/${catKey}`;

  const phone = row.phone || '(555) 555-5555';
  const address = row.address || area;

  const hours = [
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
    tagline: copy.tagline,
    seoDescription: copy.seoDescription,
    area,
    established: row.established || '',
    contact: {
      phone,
      email: row.email || `hello@${slugify(row.name)}.com`,
      address,
    },
    social: { facebook: '', instagram: '', google: '' },
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
    about: { heading: copy.aboutHeading, body: copy.aboutBody, signature: '' },
    servicesHeading: copy.servicesHeading,
    services: copy.services,
    hours,
    hoursNote: '',
    theme: preset.theme,
  };
}

// Resolve the category key (so we can pick the right library art folder).
const catKeyFor = (row) =>
  CATEGORIES[row.category?.toLowerCase()] ? row.category.toLowerCase() : 'default';

// Has the agent already dropped real photos for this slug into
// public/images/<slug>/ (the strongest tier)? If so, use them as-is.
async function agentDroppedPhotos(slug) {
  try {
    const files = (await readdir(join(PUBLIC_IMAGES, slug)))
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
      .sort();
    const pick = (base) => files.find((f) => f.startsWith(base));
    const hero = pick('hero') ?? files[0];
    const story = pick('story') ?? files[1] ?? hero;
    if (!hero) return [];
    const media = [{ path: `/images/${slug}/${hero}`, credit: '' }];
    if (story && story !== hero) media.push({ path: `/images/${slug}/${story}`, credit: '' });
    return media;
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
  const skipWikimedia = process.argv.includes('--no-photos');
  console.log(
    `Generating ${rows.length} prospect site(s) — copy via ${usingClaude ? 'Claude API' : 'built-in template'}; ` +
      `photos: agent-supplied → ${skipWikimedia ? '(Wikimedia skipped)' : 'Wikimedia'} → library.\n`,
  );

  const base = process.env.GALLERY_BASE_URL?.replace(/\/$/, '') ?? '';
  const links = [];

  for (const row of rows) {
    if (!row.name) continue;
    const slug = slugify(row.name);
    const catKey = catKeyFor(row);
    const preset = CATEGORIES[catKey];

    // Photo priority: 1) photos the agent already dropped in, 2) Wikimedia,
    // 3) built-in library (handled by buildConfig when media is empty).
    let media = await agentDroppedPhotos(slug);
    let source = media.length ? 'agent-supplied' : 'library';
    if (!media.length && !skipWikimedia) {
      try {
        media = await getRealPhotos(row, { destDir: PUBLIC_IMAGES, slug, max: 2 });
        if (media.length) source = 'wikimedia';
      } catch {
        /* best-effort; fall through to library */
      }
    }

    const copy = await generateCopy(row, preset);
    const config = buildConfig(row, copy, preset, catKey, media);
    await writeFile(join(OUT_DIR, `${slug}.json`), JSON.stringify(config, null, 2) + '\n');

    const link = `${base}/p/${slug}`;
    links.push({ name: row.name, email: row.email || '', link, photos: media.length, photoSource: source });
    console.log(`  ✓ ${row.name}  →  ${link}   [photos: ${source}]`);
  }

  // Write a links manifest you can mail-merge or paste back into the CRM.
  await writeFile(join(ROOT, 'data', 'outreach-links.json'), JSON.stringify(links, null, 2) + '\n');
  console.log(`\nWrote ${links.length} site(s) to sites/demo-gallery/src/data/prospects/`);
  console.log('Links manifest: data/outreach-links.json');
  console.log('\nNext: cd sites/demo-gallery && npm install && npm run dev   (preview at /p/<slug>)');
  console.log('Then commit + push — Vercel rebuilds the gallery and your links go live.');
}

// Exported for tests; only auto-run when invoked directly (not when imported).
export { buildConfig, slugify, parseCsv, fallbackCopy, CATEGORIES };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
