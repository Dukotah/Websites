#!/usr/bin/env node
/**
 * service-photos.mjs — give every service card its OWN photo (the bear-flag
 * look). For each prospect's `services-detailed` section, fetch one relevant
 * Wikimedia Commons photo per service (queried by the service title + category)
 * and set item.image, so ServicesDetailed renders a photo-card grid.
 *
 * Key-free, idempotent (skips items that already have an image).
 *
 * Usage: node scripts/service-photos.mjs [slug ...] [--force]
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRealPhotos } from './lib/photos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
const PUBLIC_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'public', 'images');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const only = argv.filter((a) => !a.startsWith('--'));

const KW = {
  winery: ['winery', 'vineyard', 'wine', 'cellar', 'tasting'],
  cafe: ['cafe', 'coffee', 'bakery', 'espresso'],
  towing: ['tow', 'towing', 'recovery', 'roadside', 'wrecker'],
  plumbing: ['plumb', 'drain', 'sewer', 'pipe', 'water heater'],
  'auto-repair': ['auto', 'mechanic', 'brake', 'tire'],
  salon: ['salon', 'hair', 'spa', 'barber', 'nail'],
  landscaping: ['landscap', 'lawn', 'garden', 'tree'],
  tattoo: ['tattoo', 'pierc', 'ink'],
};
// A photogenic generic term per category, used to bias the search.
const CAT_TERM = {
  winery: 'winery', cafe: 'cafe', towing: 'truck', plumbing: 'plumbing',
  'auto-repair': 'auto repair', salon: 'salon', landscaping: 'garden', tattoo: 'tattoo',
};

function inferCategory(config) {
  if (config.category) return config.category;
  const hay = [config.name, config.tagline, ...(config.services ?? []).map((s) => s.title)].join(' ').toLowerCase();
  for (const [cat, words] of Object.entries(KW)) if (words.some((w) => hay.includes(w))) return cat;
  return '';
}

async function doOne(file) {
  const slug = basename(file, '.json');
  const path = join(PROSPECTS, file);
  const config = JSON.parse(await readFile(path, 'utf8'));
  const cat = inferCategory(config);
  const term = CAT_TERM[cat] || cat || '';

  // Prefer an authored services-detailed section; otherwise populate the
  // top-level services list (the engine injects a grid from it).
  const sd = (config.sections ?? []).find((s) => s.type === 'services-detailed');
  const items = sd?.items?.length ? sd.items : config.services;
  if (!items?.length) {
    console.log(`  · ${slug.padEnd(26)} no services — skip`);
    return;
  }

  let added = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.image && !FORCE) continue;
    // Query by the service title, biased toward the category, then category term.
    const queries = [
      `${it.title} ${term}`.trim(),
      it.title,
      term,
    ].filter(Boolean);
    try {
      const got = await getRealPhotos(
        { name: '', category: cat },
        { destDir: PUBLIC_IMAGES, slug, max: 1, startIndex: 100 + i, width: 1200, queries },
      );
      if (got[0]?.path) { it.image = got[0].path; added++; }
    } catch { /* leave without image (component falls back to a branded card) */ }
  }

  if (added) {
    await writeFile(path, JSON.stringify(config, null, 2) + '\n');
    console.log(`  ✓ ${slug.padEnd(26)} ${added}/${items.length} service photo(s) added  (${cat || '—'})`);
  } else {
    console.log(`  · ${slug.padEnd(26)} no new service photos`);
  }
}

async function main() {
  let files = (await readdir(PROSPECTS)).filter((f) => f.endsWith('.json'));
  if (only.length) files = files.filter((f) => only.includes(basename(f, '.json')));
  console.log(`Service-photo pass over ${files.length} prospect(s).\n`);
  for (const f of files) {
    try { await doOne(f); } catch (e) { console.log(`  ! ${f}: ${e.message}`); }
  }
  console.log('\nNext: cd sites/demo-gallery && npm run build');
}

main();
