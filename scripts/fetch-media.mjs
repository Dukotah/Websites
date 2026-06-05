#!/usr/bin/env node
/**
 * fetch-media.mjs — pull a prospect's REAL photos off their live website and
 * wire them into the v2 prospect JSON, so the design engine upgrades the page
 * automatically (real hero → cinematic/collage hero, gallery section unlocks,
 * dashboard score jumps toward A).
 *
 * Key-free, dependency-free. Reuses the existing scrape + download pipeline:
 *   scrapeSite()           → finds real image URLs (img/srcset/data-src/bg-image,
 *                            og:image, JSON-LD), filtering out logos/icons.
 *   downloadScrapedPhotos()→ downloads candidates, keeps only ones big enough to
 *                            be a real photo (decoded pixel dims), ranks
 *                            landscape-first, saves to public/images/<slug>/.
 *
 * Usage:
 *   node scripts/fetch-media.mjs <slug> [url] [--max N]
 *   - <slug>  the prospect file (src/data/prospects/<slug>.json)
 *   - [url]   their website; if omitted, uses the JSON's `website` field
 *   - --max   how many photos to keep (default 6: hero + story + gallery)
 *
 * Example:
 *   node scripts/fetch-media.mjs the-hole-thing https://holething.net/
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeSite } from './lib/scrape-site.mjs';
import { downloadScrapedPhotos } from './lib/images.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
// Photos land in src/assets/prospects/<slug>/ so astro:assets optimizes them.
const PUBLIC_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'src', 'assets', 'prospects');

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--') && !/^https?:/i.test(a));
const urlArg = args.find((a) => /^https?:/i.test(a));
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 6;

if (!slug) {
  console.error('Usage: node scripts/fetch-media.mjs <slug> [url] [--max N]');
  process.exit(1);
}

const jsonPath = join(PROSPECTS, `${slug}.json`);

async function main() {
  let config;
  try {
    config = JSON.parse(await readFile(jsonPath, 'utf8'));
  } catch {
    console.error(`Cannot read prospect JSON: ${jsonPath}`);
    process.exitCode = 1;
    return;
  }

  const url = urlArg || config.website || config.social?.website;
  if (!url) {
    console.error('No URL given and no `website` field in the JSON. Pass the site URL as an argument.');
    process.exitCode = 1;
    return;
  }

  console.log(`· Scraping ${url} for ${config.name} …`);
  const e = await scrapeSite(url);
  if (!e) {
    console.error('  Site unreachable. Nothing changed.');
    process.exitCode = 1;
    return;
  }
  console.log(`  Found ${e.images.length} candidate image URL(s) (logos/icons already filtered).`);
  if (!e.images.length) {
    console.error('  No usable images found on the page (likely a builder site that lazy-loads). Nothing changed.');
    process.exitCode = 1;
    return;
  }

  console.log(`  Downloading + dimension-filtering up to ${MAX} (keeping real photos ≥600×360) …`);
  const media = await downloadScrapedPhotos(e.images, {
    destDir: PUBLIC_IMAGES,
    slug,
    max: MAX,
    maxCandidates: Math.max(24, MAX * 4),
  });

  if (!media.length) {
    console.error('  No images passed the size filter (all too small / not real photos). Nothing changed.');
    process.exitCode = 1;
    return;
  }

  // Patch the v2 schema: hero, story, and galleryImages from the real photos.
  const area = config.area || '';
  const altFor = (i) => `${config.name}${area ? ` in ${area}` : ''} — photo ${i + 1}`;

  config.images = config.images || {};
  config.images.hero = media[0].path;
  config.images.heroAlt = `${config.name}${area ? ` in ${area}` : ''}`;
  config.images.placeholder = config.images.placeholder || media[0].path;
  if (media[1]) {
    config.images.story = media[1].path;
    config.images.storyAlt = `Inside ${config.name}`;
  }

  // gallery = everything after the hero (story + extra photos). ≥3 real images
  // unlocks the gallery section + photo-forward hero in the engine.
  config.galleryImages = media.slice(1).map((m, i) => ({ src: m.path, alt: altFor(i + 1) }));

  // Remember the source URL for easy re-runs.
  config.website = url;

  // Drop the stale "stock art" flag if present.
  if (Array.isArray(config.flags)) {
    config.flags = config.flags.filter((f) => !/stock art|real photo/i.test(f));
  }

  await writeFile(jsonPath, JSON.stringify(config, null, 2) + '\n');

  console.log(`  ✓ Saved ${media.length} photo(s) to public/images/${slug}/ and patched ${slug}.json`);
  media.forEach((m, i) =>
    console.log(`     ${i === 0 ? 'hero ' : i === 1 ? 'story' : 'gal  '} ${m.w ?? '?'}×${m.h ?? '?'}  ${m.path}`),
  );
  console.log('\nNext: cd sites/demo-gallery && npm run build  (the engine will upgrade the page)');
}

main();
