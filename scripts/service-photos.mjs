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
import { getOpenversePhotos } from './lib/openverse.mjs';

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
  marina: ['marina', 'boat', 'kayak', 'pontoon', 'jet ski', 'lake'],
};
// A photogenic generic term per category, used to bias the search.
const CAT_TERM = {
  winery: 'winery', cafe: 'cafe', towing: 'truck', plumbing: 'plumbing',
  'auto-repair': 'auto repair', salon: 'salon', landscaping: 'garden', tattoo: 'tattoo',
  marina: 'boat lake',
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

  // REAL photos only. Per-service generic stock looks like a template ("six
  // near-identical boats"), so we only assign a photo when the business has its
  // OWN distinct real photo for every service. Otherwise services render as
  // clean numbered cards. Stock per-service is intentionally gone.
  const realPool = (config.galleryImages ?? [])
    .map((g) => g.src)
    .filter((s) => s && !s.includes('/images/library/'));

  // Drop any previously-assigned STOCK service images (photo-1xx from old runs).
  let cleared = 0;
  for (const it of items) {
    if (it.image && /\/photo-1\d\d\./.test(it.image)) { delete it.image; cleared++; }
  }

  let added = 0;
  if (realPool.length >= items.length) {
    items.forEach((it, i) => {
      if (!it.image || FORCE) { it.image = realPool[i]; added++; }
    });
  }

  if (added || cleared) {
    await writeFile(path, JSON.stringify(config, null, 2) + '\n');
    console.log(`  ✓ ${slug.padEnd(26)} ${added} real service photo(s)${cleared ? `, cleared ${cleared} stock` : ''}  (${cat || '—'})`);
  } else {
    console.log(`  · ${slug.padEnd(26)} clean numbered cards (no distinct real per-service photos)`);
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
