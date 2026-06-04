#!/usr/bin/env node
/**
 * media-sweep.mjs — make sure EVERY prospect site has real photos.
 *
 * Tiered, key-free, idempotent. For each prospect JSON it ensures a real hero +
 * gallery, strongest source first:
 *   1. THEIR OWN SITE   — scrape config.website (or a site derived from their
 *      email domain) and download their real photos. (scrape-site + images)
 *   2. WIKIMEDIA COMMONS — category- and location-relevant freely-licensed
 *      photos to fill any remaining slots. Real photos, credited, but NOT the
 *      business's own — so the prospect is flagged to swap them before sending.
 *   3. (caller leaves the SVG library in place if even Commons yields nothing.)
 *
 * The v2 design engine then upgrades each page automatically (real hero →
 * cinematic/collage hero, gallery section unlocks, dashboard score rises).
 *
 * Usage:
 *   node scripts/media-sweep.mjs                 # sweep all prospects
 *   node scripts/media-sweep.mjs <slug> [<slug>] # only these
 *   node scripts/media-sweep.mjs --force         # re-fetch even ones that already have real photos
 *   node scripts/media-sweep.mjs --target N      # photos per site (default 4)
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSiteImages } from './lib/scrape-site.mjs';
import { downloadScrapedPhotos } from './lib/images.mjs';
import { getOpenversePhotos } from './lib/openverse.mjs';
import { getRealPhotos } from './lib/photos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
const PUBLIC_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'public', 'images');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const tIdx = argv.indexOf('--target');
const TARGET = tIdx >= 0 ? Number(argv[tIdx + 1]) : 4;
const onlySlugs = argv.filter((a) => !a.startsWith('--') && a !== String(TARGET));

// Category → photogenic Wikimedia search terms (real, on-theme photos).
const CATEGORY_QUERIES = {
  winery: ['vineyard landscape', 'wine cellar barrels', 'wine tasting glasses', 'vineyard rows grapes'],
  cafe: ['coffee shop interior', 'espresso coffee cup', 'cafe pastries counter', 'barista latte'],
  towing: ['tow truck', 'flatbed tow truck', 'wrecker recovery truck'],
  plumbing: ['plumber pipes work', 'plumbing tools wrench', 'copper pipes plumbing'],
  'auto-repair': ['auto repair garage', 'car mechanic engine', 'automotive workshop'],
  salon: ['hair salon interior', 'salon styling chair', 'beauty salon'],
  landscaping: ['landscaped garden yard', 'lawn care mowing', 'garden design plants'],
  tattoo: ['tattoo studio interior', 'tattoo artist working', 'tattoo machine art'],
  default: ['small business storefront', 'main street shop'],
};

// Keyword → category inference (mirrors the site's art-direction engine).
const KW = {
  winery: ['winery', 'vineyard', 'wine', 'cellar', 'tasting'],
  cafe: ['cafe', 'coffee', 'bakery', 'espresso', 'roaster', 'bistro'],
  towing: ['tow', 'towing', 'recovery', 'roadside', 'wrecker'],
  plumbing: ['plumb', 'drain', 'sewer', 'pipe', 'water heater', 'rooter'],
  'auto-repair': ['auto', 'mechanic', 'brake', 'transmission', 'tire', 'collision'],
  salon: ['salon', 'hair', 'spa', 'barber', 'nail', 'lash'],
  landscaping: ['landscap', 'lawn', 'garden', 'tree', 'irrigation'],
  tattoo: ['tattoo', 'pierc', 'ink', 'body art'],
};

const GENERIC_EMAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|proton|me)\./i;

function inferCategory(config) {
  if (config.category) return config.category;
  const hay = [
    config.name, config.tagline, config.servicesHeading,
    ...(config.services ?? []).map((s) => `${s.title} ${s.description}`),
  ].join(' ').toLowerCase();
  for (const [cat, words] of Object.entries(KW)) if (words.some((w) => hay.includes(w))) return cat;
  return 'default';
}

// Derive a likely website from a real (non-generic, non-placeholder) email domain.
function deriveSite(config, slug) {
  if (config.website) return config.website;
  const email = config.contact?.email ?? '';
  if (!email || GENERIC_EMAIL.test(email)) return '';
  const domain = email.split('@')[1];
  // Skip the generator's placeholder hello@<slug>.com
  if (!domain || domain === `${slug}.com`) return '';
  return `https://${domain}`;
}

const isStock = (src) => !src || src.includes('/images/library/') || src.endsWith('.svg');

function hasRealPhotos(config) {
  const heroReal = !isStock(config.images?.hero ?? '');
  const gallery = (config.galleryImages ?? []).filter((g) => !isStock(g.src));
  return heroReal && gallery.length >= 1;
}

async function sweepOne(file) {
  const slug = basename(file, '.json');
  const path = join(PROSPECTS, file);
  const config = JSON.parse(await readFile(path, 'utf8'));
  const category = inferCategory(config);
  const area = config.area || '';

  if (hasRealPhotos(config) && !FORCE) {
    console.log(`  · ${slug.padEnd(26)} already has real photos — skip (use --force to refetch)`);
    return { slug, status: 'skip' };
  }

  let media = [];
  let sources = [];

  // Tier 1 — their own site (homepage + gallery/services/about subpages).
  const site = deriveSite(config, slug);
  if (site) {
    try {
      const imgs = await collectSiteImages(site, { maxPages: 5 });
      if (imgs.length) {
        const got = await downloadScrapedPhotos(imgs, { destDir: PUBLIC_IMAGES, slug, max: TARGET, maxCandidates: 36 });
        if (got.length) { media = got; sources.push(`their site (${got.length})`); }
      }
    } catch { /* fall through to stock */ }
  }

  const queries = [...(CATEGORY_QUERIES[category] ?? CATEGORY_QUERIES.default), area].filter(Boolean);
  let usedStock = false;

  // Tier 2 — Openverse (large free CC library; more relevant than Wikimedia).
  if (media.length < TARGET) {
    try {
      const ov = await getOpenversePhotos(queries, { destDir: PUBLIC_IMAGES, slug, max: TARGET - media.length, startIndex: media.length });
      if (ov.length) { media = media.concat(ov); usedStock = true; sources.push(`Openverse (${ov.length})`); }
    } catch { /* fall through */ }
  }

  // Tier 3 — Wikimedia Commons (last-resort stock).
  if (media.length < TARGET) {
    try {
      const wiki = await getRealPhotos(
        { name: config.name, category, city: config.contact?.city, state: '' },
        { destDir: PUBLIC_IMAGES, slug, max: TARGET - media.length, startIndex: media.length, width: 1600, queries },
      );
      if (wiki.length) { media = media.concat(wiki); usedStock = true; sources.push(`Wikimedia (${wiki.length})`); }
    } catch { /* leave SVG library */ }
  }
  const usedWikimedia = usedStock; // (kept var name below for flag logic)

  if (!media.length) {
    console.log(`  · ${slug.padEnd(26)} no photos found anywhere — left on library art`);
    return { slug, status: 'none' };
  }

  // Patch the v2 schema.
  const altFor = (i) => `${config.name}${area ? ` in ${area}` : ''} — photo ${i + 1}`;
  config.images = config.images || {};
  config.images.hero = media[0].path;
  config.images.heroAlt = `${config.name}${area ? ` in ${area}` : ''}`;
  config.images.placeholder = config.images.placeholder || media[0].path;
  if (media[1]) { config.images.story = media[1].path; config.images.storyAlt = `Inside ${config.name}`; }
  const credit = media.find((m) => m.credit)?.credit;
  if (credit) config.images.storyCredit = `Photo: ${credit}`;
  config.galleryImages = media.slice(1).map((m, i) => ({ src: m.path, alt: altFor(i + 1) }));

  // Honest flagging.
  const flags = (config.flags ?? []).filter((f) => !/stock art|no real|real photo|area\/stock|wikimedia/i.test(f));
  if (usedWikimedia) {
    flags.push('Includes area/stock photos from Wikimedia (credited) — replace with the business’s own before sending');
  }
  config.flags = flags;

  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  console.log(`  ✓ ${slug.padEnd(26)} ${media.length} photo(s) [${sources.join(' + ')}]  (${category})`);
  return { slug, status: 'ok', count: media.length, usedWikimedia };
}

async function main() {
  let files = (await readdir(PROSPECTS)).filter((f) => f.endsWith('.json'));
  if (onlySlugs.length) files = files.filter((f) => onlySlugs.includes(basename(f, '.json')));
  console.log(`Media sweep over ${files.length} prospect(s) — target ${TARGET} photos each.\n`);

  const results = [];
  for (const f of files) {
    try { results.push(await sweepOne(f)); }
    catch (err) { console.log(`  ! ${f}: ${err.message}`); results.push({ slug: f, status: 'error' }); }
  }

  const ok = results.filter((r) => r.status === 'ok');
  const wiki = ok.filter((r) => r.usedWikimedia).length;
  console.log(`\nDone. ${ok.length} updated, ${results.filter((r) => r.status === 'skip').length} already had photos, ` +
    `${results.filter((r) => r.status === 'none').length} found none.`);
  if (wiki) console.log(`${wiki} use Wikimedia area/stock photos (flagged needs-review — swap for the business's own).`);
  console.log('\nNext: cd sites/demo-gallery && npm run build');
}

main();
