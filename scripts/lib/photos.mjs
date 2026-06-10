/**
 * photos.mjs — best-effort REAL photos for a prospect, free and key-free.
 *
 * Searches Wikimedia Commons (no API key) for freely-licensed images matching
 * the business / its town / its category, and downloads the best couple into
 * the gallery's public images. Returns [] on any failure so the caller falls
 * back to the built-in library art. Network-dependent: if the environment
 * can't reach Commons, it simply returns [] and the library is used.
 *
 * NOTE on the photo priority chain: the strongest source — the business's OWN
 * photos already online — is found by the AGENT via web search (a judgment
 * task), not here. This module is the automated middle tier between that and
 * the generated library.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scorePhoto, dhash, hamming, NEAR_DUP_DISTANCE } from './photo-score.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'websites-repo outreach factory (https://github.com/dukotah/websites)';

// Category → a concrete, ON-TOPIC Commons search term. The old fallback searched
// the TOWN NAME alone, which returned landmarks/postcards (a vintage church
// postcard once became a dentist's hero). Anchoring every query to the trade
// keeps results relevant; the town is only ever an optional qualifier.
// Terms are SPECIFIC on purpose: the relevance gate matches these words against
// Commons file titles, so a generic word like "home" would let a home-goods or
// flower-shop photo through. Keep every word trade-distinctive.
const CATEGORY_TERMS = {
  cafe: 'cafe espresso barista', restaurant: 'restaurant dining cuisine',
  plumbing: 'plumber plumbing pipe', electrician: 'electrician electrical wiring',
  hvac: 'hvac furnace ductwork', roofing: 'roofing shingle rooftop', landscaping: 'landscaping gardening lawn',
  salon: 'hairdresser haircut salon', spa: 'massage spa facial', barber: 'barber barbershop',
  cleaning: 'housekeeping janitorial cleaning', contractor: 'construction remodeling carpentry',
  'auto-repair': 'automobile mechanic garage', towing: 'towing tow-truck wrecker', winery: 'winery vineyard cellar',
  marina: 'marina harbor boating',
};

// Below this photographic-quality score (0..1) a Commons result isn't worth
// shipping — better to fall through to clean, on-topic category art.
const MIN_PHOTO_SCORE = 0.45;

const strip = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  return res.json();
}

// Search Commons (File namespace) and return candidate {title, info} with image
// info already attached, biggest-first-ish. Best-effort: returns [] on error.
async function searchCommons(query, width) {
  try {
    const data = await api({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6', // File:
      gsrlimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime',
      iiurlwidth: String(width),
    });
    const pages = Object.values(data?.query?.pages ?? {});
    return pages
      .map((p) => ({ title: p.title, info: p.imageinfo?.[0] }))
      .filter((c) => c.info && /image\/(jpe?g|png)/.test(c.info.mime || ''));
  } catch {
    return [];
  }
}

/**
 * Try to get up to `max` real photos for a row. Builds a few queries from the
 * available CSV fields (name → category+town → town) and uses the first that
 * yields enough usable images.
 *
 * @returns {Promise<Array<{path,credit,license,source,alt}>>}
 */
export async function getRealPhotos(row, { destDir, slug, max = 2, width = 1600, startIndex = 0, queries: queryOverride } = {}) {
  const cat = (row.category || '').toLowerCase().trim();
  const term = CATEGORY_TERMS[cat] || cat.replace(/[-_]+/g, ' ').trim() || 'local business storefront';
  const town = [row.city, row.state].filter(Boolean).join(', ');
  // Every query is anchored to the trade — NEVER the bare town (the off-topic
  // source). Order: exact business → trade + city → trade alone (still on-topic).
  const queries = (queryOverride?.length
    ? queryOverride
    : [
        [row.name, town].filter(Boolean).join(' '),
        `${term}${row.city ? ` ${row.city}` : ''}`,
        term,
      ]
  ).filter((q) => q && q.trim().length > 1);

  // Subject-relevance keywords: the trade term words + the business-name words
  // (4+ chars). Commons full-text search is fuzzy — a query like "remodel Santa
  // Rosa" can return a flower-market photo taken IN Santa Rosa. scorePhoto can't
  // judge subject (no vision API), so we require the file's TITLE to mention the
  // trade or business — a cheap, key-free relevance gate. The off-topic photo's
  // title won't contain a trade word, so it's dropped and we fall to clean art.
  const relWords = [...term.split(/\s+/), ...(row.name || '').split(/\s+/)]
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 4 && w !== (row.city || '').toLowerCase());
  const relevant = (title) => {
    const t = (title || '').toLowerCase();
    return relWords.length === 0 || relWords.some((w) => t.includes(w));
  };

  // Pool candidates across queries (don't stop at the first hit — gather enough
  // to actually rank by quality). Keep only subject-relevant titles.
  const pool = [];
  const seenTitles = new Set();
  for (const q of queries) {
    for (const c of await searchCommons(q, width)) {
      if (c.title && !seenTitles.has(c.title) && relevant(c.title)) { seenTitles.add(c.title); pool.push(c); }
    }
    if (pool.length >= 12) break;
  }
  if (pool.length === 0) return [];

  // Download + SCORE each candidate; reject graphics/logos/low-quality so a
  // postcard or map tile never ships. Keep only genuine photographs.
  const scored = [];
  const hashes = [];
  for (const { title, info } of pool) {
    if (scored.length >= max * 3) break; // enough survivors to choose from
    try {
      const src = info.thumburl ?? info.url;
      const img = await fetch(src, { headers: { 'User-Agent': UA } });
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      const q = await scorePhoto(buf);
      if (!q.ok || q.isGraphic || q.score < MIN_PHOTO_SCORE) continue;
      const dh = await dhash(buf);
      if (dh != null && hashes.some((h) => hamming(h, dh) <= NEAR_DUP_DISTANCE)) continue; // near-dup
      if (dh != null) hashes.push(dh);
      const meta = info.extmetadata ?? {};
      scored.push({
        buf, score: q.score, ext: (info.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg'),
        credit: strip(meta.Artist?.value) || 'Wikimedia Commons',
        license: strip(meta.LicenseShortName?.value) || 'See source',
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      });
    } catch { /* skip */ }
  }
  if (scored.length === 0) return []; // nothing good → caller uses clean category art

  scored.sort((a, b) => b.score - a.score); // best photo wins the hero slot
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  for (let i = 0; i < scored.length && saved.length < max; i++) {
    const s = scored[i];
    const idx = startIndex + saved.length;
    const fileName = `${idx === 0 ? 'hero' : idx === 1 ? 'story' : `photo-${idx}`}.${s.ext}`;
    try {
      await writeFile(join(outDir, fileName), s.buf);
      saved.push({ path: `/images/${slug}/${fileName}`, credit: s.credit, license: s.license, source: s.source, alt: '' });
    } catch { /* skip */ }
  }
  return saved;
}
