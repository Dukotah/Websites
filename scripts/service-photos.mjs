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

  // JUDGMENT, key-free: a service earns a photo ONLY when the evidence
  // (filename + alt) says that photo depicts that service. Assigning real photos
  // by index manufactures false "this photo = this service" claims (a snack
  // shelf labeled "Fishing boats"); generic stock per service reads as a
  // template ("six near-identical boats"). Neither is acceptable. When there's
  // no confident match the service renders as a clean NUMBERED card — which the
  // renderer makes look intentional. Principle: fewer real beats more stock;
  // never guess by index; never pad with stock.
  const realPool = (config.galleryImages ?? [])
    .filter((g) => g.src && !g.src.includes('/images/library/'))
    .map((g) => ({ src: g.src, text: `${g.src} ${g.alt ?? ''}`.toLowerCase() }));

  // Distinctive keywords from a service title: drop stopwords and the
  // category-generic terms (so "fishing boats" in a marina can't match every
  // boat photo, and a bare "service" never matches anything).
  const STOP = new Set([
    'and', 'the', 'for', 'with', 'our', 'your', 'from', 'full', 'all',
    'services', 'service', 'repair', 'repairs', 'custom', 'premium',
  ]);
  const generic = new Set((KW[cat] ?? []).flatMap((w) => w.split(/\s+/)));
  const keywords = (title) =>
    (title.toLowerCase().match(/[a-z]+/g) ?? []).filter(
      (w) => w.length > 2 && !STOP.has(w) && !generic.has(w),
    );

  const isStock = (src) => /\/photo-1\d\d\./.test(src);
  const used = new Set();
  let added = 0;
  let cleared = 0;

  for (const it of items) {
    const words = keywords(it.title);
    const match = realPool.find(
      (p) => !used.has(p.src) && words.some((w) => p.text.includes(w)),
    );

    if (match) {
      used.add(match.src);
      if (it.image !== match.src && (!it.image || FORCE || isStock(it.image))) {
        it.image = match.src;
        added++;
      }
      continue;
    }

    // No confident match → strip stock always; strip any non-matching image on --force.
    if (it.image && (isStock(it.image) || FORCE)) {
      delete it.image;
      cleared++;
    }
  }

  if (added || cleared) {
    await writeFile(path, JSON.stringify(config, null, 2) + '\n');
    console.log(`  ✓ ${slug.padEnd(26)} ${added} matched photo(s)${cleared ? `, cleared ${cleared} mismatched` : ''}  (${cat || '—'})`);
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
