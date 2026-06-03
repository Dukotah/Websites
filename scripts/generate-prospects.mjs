#!/usr/bin/env node
/**
 * generate-prospects.mjs — turn CRM rows into demo-gallery prospect sites.
 *
 * Reads a CSV of businesses and writes one JSON per row into
 * sites/demo-gallery/src/data/prospects/<slug>.json. Each JSON matches the
 * ProspectConfig schema, so the gallery renders it at /p/<slug> and you can
 * paste that link into an outreach email.
 *
 * Marketing copy (tagline, hero, about, services) is written by the Claude API
 * when ANTHROPIC_API_KEY is set; otherwise a deterministic per-category
 * fallback is used so the script always produces a complete, finished page.
 *
 * Usage:
 *   node scripts/generate-prospects.mjs [path/to/file.csv]
 *   # defaults to data/prospects.sample.csv
 *
 * CSV columns (header row required; extra columns are ignored):
 *   name, category, city, state, phone, email, address, existing_website
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
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

  const user =
    `Business: ${row.name}\nCategory: ${row.category || 'local business'}\n` +
    `Town/area: ${row.city}${row.state ? ', ' + row.state : ''}\n` +
    `Typical services for this category: ${preset.services.join(', ')}`;

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
// Build a full ProspectConfig from a row + generated copy.
// ---------------------------------------------------------------------------
function buildConfig(row, copy, preset) {
  const area = [row.city, row.state].filter(Boolean).join(', ');
  return {
    name: row.name,
    tagline: copy.tagline,
    seoDescription: copy.seoDescription,
    area,
    established: row.established || '',
    contact: {
      phone: row.phone || '(555) 555-5555',
      email: row.email || `hello@${slugify(row.name)}.com`,
      address: row.address || area,
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
      hero: '/images/hero.svg',
      heroAlt: `${row.name} in ${area}`,
      story: '/images/about.svg',
      storyAlt: `About ${row.name}`,
      storyCaption: '',
      storyCredit: '',
      placeholder: '/images/hero.svg',
    },
    about: { heading: copy.aboutHeading, body: copy.aboutBody, signature: '' },
    servicesHeading: copy.servicesHeading,
    services: copy.services,
    hours: [
      { day: 'Mon – Fri', hours: '8:00 AM – 6:00 PM' },
      { day: 'Saturday', hours: '9:00 AM – 2:00 PM' },
      { day: 'Sunday', hours: 'Closed' },
    ],
    hoursNote: '',
    theme: preset.theme,
  };
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
  console.log(`Generating ${rows.length} prospect site(s) — copy via ${usingClaude ? 'Claude API' : 'built-in fallback'}.\n`);

  const base = process.env.GALLERY_BASE_URL?.replace(/\/$/, '') ?? '';
  const links = [];

  for (const row of rows) {
    if (!row.name) continue;
    const slug = slugify(row.name);
    const preset = CATEGORIES[row.category?.toLowerCase()] ?? CATEGORIES.default;
    const copy = await generateCopy(row, preset);
    const config = buildConfig(row, copy, preset);
    await writeFile(join(OUT_DIR, `${slug}.json`), JSON.stringify(config, null, 2) + '\n');
    const link = `${base}/p/${slug}`;
    links.push({ name: row.name, email: row.email || '', link });
    console.log(`  ✓ ${row.name}  →  ${link}`);
  }

  // Write a links manifest you can mail-merge or paste back into the CRM.
  await writeFile(join(ROOT, 'data', 'outreach-links.json'), JSON.stringify(links, null, 2) + '\n');
  console.log(`\nWrote ${links.length} site(s) to sites/demo-gallery/src/data/prospects/`);
  console.log('Links manifest: data/outreach-links.json');
  console.log('\nNext: cd sites/demo-gallery && npm install && npm run dev   (preview at /p/<slug>)');
  console.log('Then commit + push — Vercel rebuilds the gallery and your links go live.');
}

main();
