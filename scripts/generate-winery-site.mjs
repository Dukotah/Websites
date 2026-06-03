#!/usr/bin/env node
/**
 * generate-winery-site.mjs — scaffold a fully-populated winery site from wineries.json.
 *
 * Usage:
 *   node scripts/generate-winery-site.mjs <slug>
 *   # e.g.
 *   node scripts/generate-winery-site.mjs dry-creek-estate-winery
 *
 * Steps:
 *   1. Read data/wineries.json, find the entry with the matching slug
 *   2. Copy sites/_winery-template/ to sites/<slug>/
 *   3. Generate and write sites/<slug>/src/config.ts with all real data
 *   4. Write sites/<slug>/photos.json with wine bottle + vineyard image requests
 *   5. Update package.json with the slug as the package name
 */

import { cp, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── CLI ─────────────────────────────────────────────────────────────────────

const slug = process.argv[2];

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: node scripts/generate-winery-site.mjs <slug>');
  console.error('  <slug> must be lowercase words separated by dashes, e.g. dry-creek-estate-winery');
  process.exit(1);
}

// ─── Load winery data ─────────────────────────────────────────────────────────

const wineriesPath = join(ROOT, 'data', 'wineries.json');
let wineries;
try {
  wineries = JSON.parse(await readFile(wineriesPath, 'utf8'));
} catch {
  console.error(`Could not read ${wineriesPath} — make sure data/wineries.json exists.`);
  process.exit(1);
}

const winery = wineries.find((w) => w.slug === slug);
if (!winery) {
  console.error(`No winery with slug "${slug}" found in data/wineries.json.`);
  console.error(`Available slugs: ${wineries.map((w) => w.slug).join(', ')}`);
  process.exit(1);
}

// ─── Guard: destination must not already exist ────────────────────────────────

const dest = join(ROOT, 'sites', slug);
const exists = await access(dest).then(() => true).catch(() => false);
if (exists) {
  console.error(`sites/${slug} already exists — pick another name or delete it first.`);
  process.exit(1);
}

// ─── Copy template ────────────────────────────────────────────────────────────

const src = join(ROOT, 'sites', '_winery-template');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vercel']);

console.log(`Copying _winery-template → sites/${slug} …`);
await cp(src, dest, {
  recursive: true,
  filter: (source) => !SKIP.has(basename(source)),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert "Some Wine Name" → "some-wine-name" */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Escape single-quote characters for use inside TypeScript single-quoted strings. */
function esc(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Serialize a JS value to a compact TypeScript literal (single-quoted strings). */
function toTS(value, indent = 2) {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);

  if (value === null || value === undefined) return 'undefined';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${esc(value)}'`;

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${innerPad}${toTS(v, indent + 2)}`).join(',\n');
    return `[\n${items},\n${pad}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => `${innerPad}${k}: ${toTS(v, indent + 2)}`)
      .join(',\n');
    return `{\n${entries},\n${pad}}`;
  }

  return String(value);
}

// ─── Build wine list with auto-generated image file names ────────────────────

const winesWithImages = (winery.wines ?? []).map((wine) => ({
  ...wine,
  image: `wine-${slugify(wine.name)}.jpg`,
}));

// ─── Generate config.ts ───────────────────────────────────────────────────────

/**
 * Build an hours array — the tastingRoom.hours field from JSON may already be an
 * array of {day, hours} objects; pass it through as-is.
 */
function buildHoursTS(hours) {
  if (!Array.isArray(hours) || hours.length === 0) {
    return `[] as BusinessHours[]`;
  }
  const innerPad = '      ';
  const rows = hours
    .map((h) => `${innerPad}{ day: '${esc(h.day)}', hours: '${esc(h.hours)}' }`)
    .join(',\n');
  return `[\n${rows},\n    ] as BusinessHours[]`;
}

function buildWinesTS(wines) {
  if (!wines || wines.length === 0) return '[] satisfies Wine[]';
  const inner = wines
    .map((w) => {
      return `    {
      name: '${esc(w.name)}',
      varietal: '${esc(w.varietal)}',
      type: '${esc(w.type)}' as const,
      image: '${esc(w.image)}',
      notes: '${esc(w.notes)}',
    }`;
    })
    .join(',\n');
  return `[\n${inner},\n  ] satisfies Wine[]`;
}

const configSource = `/**
 * Site configuration for ${winery.name}.
 * Generated by scripts/generate-winery-site.mjs — edit freely.
 *
 * All pages pull their content from this single source of truth.
 * Brand colors, wines, story, contact, and more — all here.
 */

export interface Wine {
  name: string;
  varietal: string;
  type: 'Red' | 'White' | 'Rosé' | 'Blend' | 'Sparkling' | 'Dessert';
  image: string;
  notes: string;
}

export interface BusinessHours {
  day: string;
  hours: string;
}

export const config = {
  name: '${esc(winery.name)}',
  tagline: '${esc(winery.tagline)}',
  seoDescription: '${esc(winery.seoDescription)}',
  area: '${esc(winery.area)}',
  established: '${esc(winery.established)}',

  contact: {
    phone: '${esc(winery.contact.phone)}',
    email: '${esc(winery.contact.email ?? '')}',
    address: '${esc(winery.contact.address)}',
    note: '${esc(winery.contact.note ?? 'Call or email us — we love talking wine.')}',
  },

  social: {
    facebook: '${esc(winery.social?.facebook ?? '')}',
    instagram: '${esc(winery.social?.instagram ?? '')}',
    yelp: '${esc(winery.social?.yelp ?? '')}',
  },

  /** Primary navigation links — shared across every page. */
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Our Wines', href: '/wines/' },
    { label: 'Our Story', href: '/story/' },
    { label: 'Visit', href: '/visit/' },
  ],

  hero: {
    kicker: '${esc(winery.hero.kicker)}',
    heading: '${esc(winery.hero.heading)}',
    subheading: '${esc(winery.hero.subheading)}',
    ctaText: '${esc(winery.hero.ctaText)}',
    ctaHref: '${esc(winery.hero.ctaHref)}',
  },

  story: {
    heading: '${esc(winery.story.heading)}',
    paragraphs: ${toTS(winery.story.paragraphs, 4)},
    signoff: '${esc(winery.story.signoff)}',
  },

  highlights: ${toTS(winery.highlights, 2)},

  wines: ${buildWinesTS(winesWithImages)},

  tastingRoom: {
    available: ${!!winery.tastingRoom?.available},
    note: '${esc(winery.tastingRoom?.note ?? '')}',
    hours: ${buildHoursTS(winery.tastingRoom?.hours)},
    reservationRequired: ${!!winery.tastingRoom?.reservationRequired},
    reservationLink: '${esc(winery.tastingRoom?.reservationLink ?? '')}',
  },

  awards: ${toTS(winery.awards ?? [], 2)},

  /** Brand colors injected as CSS custom properties in BaseLayout. */
  theme: {
    brand: '${esc(winery.theme.brand)}',
    brandDark: '${esc(winery.theme.brandDark)}',
  },
};

export type SiteConfig = typeof config;
`;

// ─── Build photos.json ────────────────────────────────────────────────────────

/**
 * Map common wine varietals to real Wikimedia Commons file names.
 * These are actual files that exist on Wikimedia Commons.
 */
const WINE_COMMONS_FILES = {
  'Zinfandel':          'Zinfandel wine.jpg',
  'Petite Sirah':       'Petite sirah wine.jpg',
  'Cabernet Sauvignon': 'Cabernet sauvignon wine bottle.jpg',
  'Cabernet Franc':     'Cabernet franc wine bottle.jpg',
  'Merlot':             'Merlot wine bottle.jpg',
  'Pinot Noir':         'Pinot noir wine bottle.jpg',
  'Syrah':              'Syrah wine bottle.jpg',
  'Grenache':           'Grenache wine.jpg',
  'Barbera':            'Barbera wine bottle.jpg',
  'Tempranillo':        'Tempranillo wine bottle.jpg',
  'Sangiovese':         'Sangiovese wine bottle.jpg',
  'Chardonnay':         'Chardonnay wine bottle.jpg',
  'Sauvignon Blanc':    'Sauvignon blanc wine bottle.jpg',
  'Semillon':           'Semillon wine bottle.jpg',
  'Vermentino':         'Vermentino wine bottle.jpg',
  'Grenache Blanc':     'Grenache blanc wine bottle.jpg',
  'Viognier':           'Viognier wine bottle.jpg',
  'Riesling':           'Riesling wine bottle.jpg',
};

const sources = [];

// Hero/landscape image source
sources.push({
  file: 'Vineyard in Northern California.jpg',
  as: 'hero.jpg',
});

// Wine bottle images for each wine
for (const wine of winesWithImages) {
  const commonsFile = WINE_COMMONS_FILES[wine.varietal];
  if (commonsFile) {
    sources.push({ file: commonsFile, as: wine.image });
  }
}

const photosJson = {
  outDir: 'public/images',
  width: 1600,
  sources,
  categories: [
    {
      name: winery.wikimediaCategory,
      limit: 4,
    },
  ],
};

// ─── Write files ──────────────────────────────────────────────────────────────

console.log('Writing src/config.ts …');
await writeFile(join(dest, 'src', 'config.ts'), configSource, 'utf8');

console.log('Writing photos.json …');
await writeFile(join(dest, 'photos.json'), JSON.stringify(photosJson, null, 2) + '\n', 'utf8');

// Update package.json name
const pkgPath = join(dest, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
pkg.name = slug;
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Updated package.json name …');

// ─── Success message ──────────────────────────────────────────────────────────

console.log(`
✅  Created sites/${slug} for "${winery.name}"

Next steps:
  1. Install dependencies:
       cd sites/${slug} && npm install

  2. (Optional) Download vineyard & wine photos:
       cd ../..
       node scripts/fetch-photos.mjs sites/${slug}/photos.json

  3. Start the dev server:
       npm run dev        # http://localhost:4321

  4. Deploy a preview to Vercel:
       vercel deploy --yes

  5. Tweak any details in:
       sites/${slug}/src/config.ts
`);
