#!/usr/bin/env node
/**
 * fetch-photos.mjs — download real, freely-licensed photos for a site.
 *
 * Usage:
 *   node scripts/fetch-photos.mjs <site-folder>
 *   # e.g.
 *   node scripts/fetch-photos.mjs bodega-country-store
 *
 * It reads `sites/<site-folder>/photos.json`, downloads each image from
 * Wikimedia Commons into the site's `public/images/`, and writes a
 * `CREDITS.md` next to them with author + license for attribution.
 *
 * Why a script? The build/preview sandbox can't reach image hosts, so photos
 * are fetched on a machine with normal internet access and committed.
 *
 * photos.json shape:
 * {
 *   "outDir": "public/images",                 // where files land (default: public/images)
 *   "sources": [                                 // explicit Commons files
 *     { "file": "Some File On Commons.jpg", "as": "schoolhouse.jpg" }
 *   ],
 *   "categories": [                              // or crawl a Commons category
 *     { "name": "Bodega, California", "limit": 6 }
 *   ],
 *   "width": 1600                                // max width to download (default 1600)
 * }
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'websites-repo photo fetcher (https://github.com/dukotah/websites)';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/fetch-photos.mjs <site-folder>');
  process.exit(1);
}

const siteDir = join(ROOT, 'sites', slug);
const manifestPath = join(siteDir, 'photos.json');

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  console.error(`No photos.json found at sites/${slug}/photos.json`);
  process.exit(1);
}

const width = manifest.width ?? 1600;
const outDir = join(siteDir, manifest.outDir ?? 'public/images');
await mkdir(outDir, { recursive: true });

const api = async (params) => {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`API ${res.status} for ${url}`);
  return res.json();
};

const slugify = (name) =>
  name
    .replace(/^File:/i, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

// Build the list of { title, as } to fetch.
const targets = [];
for (const s of manifest.sources ?? []) {
  targets.push({ title: `File:${s.file.replace(/^File:/i, '')}`, as: s.as });
}
for (const cat of manifest.categories ?? []) {
  const data = await api({
    action: 'query',
    list: 'categorymembers',
    cmtitle: `Category:${cat.name}`,
    cmtype: 'file',
    cmlimit: String(cat.limit ?? 6),
  });
  for (const m of data?.query?.categorymembers ?? []) {
    targets.push({ title: m.title, as: null });
  }
}

if (targets.length === 0) {
  console.error('photos.json has no `sources` or `categories` to fetch.');
  process.exit(1);
}

const strip = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const credits = [];
let ok = 0;

for (const t of targets) {
  try {
    const data = await api({
      action: 'query',
      titles: t.title,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime',
      iiurlwidth: String(width),
    });
    const page = Object.values(data?.query?.pages ?? {})[0];
    const info = page?.imageinfo?.[0];
    if (!info) {
      console.warn(`  skip (not found): ${t.title}`);
      continue;
    }
    const meta = info.extmetadata ?? {};
    const ext = (info.mime?.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
    const filename = t.as ?? `${slugify(t.title)}.${ext}`;
    const srcUrl = info.thumburl ?? info.url;

    const img = await fetch(srcUrl, { headers: { 'User-Agent': UA } });
    if (!img.ok) throw new Error(`download ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    await writeFile(join(outDir, filename), buf);

    credits.push({
      filename,
      author: strip(meta.Artist?.value) || 'Unknown',
      license: strip(meta.LicenseShortName?.value) || 'See source',
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(t.title)}`,
    });
    ok++;
    console.log(`  ✓ ${filename}  (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(`  skip (${err.message}): ${t.title}`);
  }
}

if (credits.length) {
  const lines = [
    '# Photo credits',
    '',
    'Images downloaded from Wikimedia Commons. Keep attribution when you use them.',
    '',
    ...credits.flatMap((c) => [
      `## ${c.filename}`,
      `- Author: ${c.author}`,
      `- License: ${c.license}`,
      `- Source: ${c.source}`,
      '',
    ]),
  ];
  await writeFile(join(outDir, 'CREDITS.md'), lines.join('\n'));
}

console.log(`\nDone: ${ok}/${targets.length} image(s) into sites/${slug}/${manifest.outDir ?? 'public/images'}`);
if (ok > 0) {
  console.log('Next: point the image paths in src/config.ts at the downloaded files, then rebuild.');
}
