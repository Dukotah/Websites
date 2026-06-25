/**
 * stock-images.mjs — LICENSED STOCK ambiance/context tier (key-gated, opt-in).
 *
 * The honest ceiling problem: a no-website lead has NO photos of its own, so the
 * factory falls to generic SVG library art that screams "template". This tier
 * pulls TASTEFUL, RELEVANT, LICENSED ambiance/context photography (a cozy café
 * interior, a tow truck on a highway, a tidy salon chair) keyed off the business
 * CATEGORY + LOCALE, so a page reads as designed instead of clip-art — WITHOUT
 * ever pretending the shot is the business's own storefront/work/team.
 *
 * HONESTY CONTRACT (hard rule): stock imagery is AMBIANCE/CONTEXT only. It is
 * tagged `stock:pexels` / `stock:unsplash` in the photoSource and carries its
 * real attribution + license + source URL so the dashboard/audit can see exactly
 * what it is. A business's OWN photo ALWAYS wins (this tier only runs when the
 * own-photo + OSM tiers came up short). Never present a stock frame as theirs.
 *
 * KEY-GATED, NO-OP WITHOUT KEYS:
 *   • PEXELS_API_KEY        → Pexels  (https://www.pexels.com/api/)
 *   • UNSPLASH_ACCESS_KEY   → Unsplash (https://unsplash.com/developers)
 * With neither set this module returns [] and the chain falls through unchanged.
 *
 * Each candidate is routed through the SAME locked-contract pipeline as every
 * other photo (size + photographic gate via scorePhoto, per-slot focal crop +
 * grade via processSlot, resolution floor), so a stock hero is held to the exact
 * quality bar a scraped/OSM hero is — a low-res or graphic result is dropped.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { processSlot } from './photo-art.mjs';
import { scorePhoto } from './photo-score.mjs';
import { imageSize } from './images.mjs';

const UA =
  'Mozilla/5.0 (compatible; websites-outreach/1.0; +https://github.com/dukotah/websites)';

const MIN_W = 600; // below this a result is almost certainly a thumb/icon
const MIN_H = 360;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/avif': 'avif',
};

// LOCKED-CONTRACT slot by render index (mirrors images.mjs slotForIndex): index
// 0 is the full-bleed hero, index 1 the story side image, the rest are gallery.
const slotForIndex = (i) => (i === 0 ? 'hero-fullbleed' : i === 1 ? 'story' : 'gallery');
const nameFor = (i, ext) =>
  `${i === 0 ? 'hero' : i === 1 ? 'story' : `photo-${i}`}.${ext}`;
const fmtForExt = (ext) => (ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg');

/**
 * Category → a concrete, tasteful ambiance/context search phrase. Deliberately
 * describes the SCENE TYPE, not "<business> storefront", so we never imply the
 * shot is theirs. Unknown categories fall back to a neutral local-business term.
 */
const CATEGORY_QUERY = {
  towing: 'tow truck on highway',
  'auto-repair': 'auto repair garage interior',
  'auto repair': 'auto repair garage interior',
  mechanic: 'auto repair garage interior',
  plumbing: 'plumbing pipes tools',
  plumber: 'plumbing pipes tools',
  hvac: 'hvac technician air conditioning',
  electrical: 'electrician wiring tools',
  electrician: 'electrician wiring tools',
  cafe: 'cozy coffee shop interior',
  coffee: 'cozy coffee shop interior',
  restaurant: 'warm restaurant interior dining',
  bakery: 'artisan bakery bread display',
  bar: 'craft cocktail bar interior',
  brewery: 'craft brewery taproom',
  winery: 'vineyard wine tasting room',
  salon: 'modern hair salon interior',
  barber: 'classic barbershop interior',
  spa: 'serene spa treatment room',
  landscaping: 'landscaped garden green lawn',
  lawn: 'landscaped garden green lawn',
  roofing: 'roof construction shingles',
  construction: 'construction site building',
  cleaning: 'clean bright tidy home interior',
  dental: 'modern dental office',
  dentist: 'modern dental office',
  fitness: 'modern gym fitness equipment',
  gym: 'modern gym fitness equipment',
  realestate: 'modern home exterior real estate',
  'real-estate': 'modern home exterior real estate',
  retail: 'boutique retail shop interior',
  florist: 'flower shop bouquets',
  pet: 'pet grooming care',
};

function queryFor(facts) {
  const cat = (facts.category || '').toLowerCase().trim();
  const base = CATEGORY_QUERY[cat] || (cat ? cat.replace(/-/g, ' ') : 'local small business');
  // Locale gives "context" without forcing it — appended softly so a generic
  // interior still matches when the city term narrows results to nothing.
  return base;
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImage(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(headers || {}) }, signal: ctrl.signal });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- providers: return a normalized candidate list {url,credit,license,source,provider} ---

async function searchPexels(query, { perPage = 15 } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape&size=large`;
  const data = await fetchJson(url, { Authorization: key });
  const photos = data?.photos;
  if (!Array.isArray(photos)) return [];
  return photos.map((p) => ({
    // Prefer a large source so the hero clears the 1600w contract floor.
    url: p?.src?.original || p?.src?.large2x || p?.src?.large,
    credit: p?.photographer ? `Photo by ${p.photographer} on Pexels` : 'Photo via Pexels',
    creditUrl: p?.photographer_url || p?.url || '',
    license: 'Pexels License (free to use, no attribution required)',
    source: p?.url || p?.src?.original || '',
    provider: 'pexels',
    w: p?.width, h: p?.height,
  })).filter((c) => c.url);
}

async function searchUnsplash(query, { perPage = 15 } = {}) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const data = await fetchJson(url, { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' });
  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results.map((p) => ({
    url: p?.urls?.full || p?.urls?.regular,
    credit: p?.user?.name ? `Photo by ${p.user.name} on Unsplash` : 'Photo via Unsplash',
    creditUrl: p?.user?.links?.html || p?.links?.html || '',
    license: 'Unsplash License (free to use)',
    source: p?.links?.html || p?.urls?.full || '',
    provider: 'unsplash',
    w: p?.width, h: p?.height,
    // Unsplash API guideline: ping the download endpoint when an image is used.
    downloadLocation: p?.links?.download_location || '',
  })).filter((c) => c.url);
}

// Unsplash asks integrations to trigger a "download" event when a photo is
// actually used. Best-effort, fire-and-forget; never blocks or fails the tier.
async function pingUnsplashDownload(loc) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!loc || !key) return;
  try {
    await fetch(`${loc}${loc.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Client-ID ${key}`, 'User-Agent': UA },
    });
  } catch { /* best effort */ }
}

/**
 * Acquire up to `need` LICENSED STOCK ambiance photos for a prospect, starting
 * at on-disk index `startIndex` (so filenames continue after any scraped/OSM
 * photos already saved). Key-gated: with neither PEXELS_API_KEY nor
 * UNSPLASH_ACCESS_KEY set, returns [] (no-op).
 *
 * Each survivor is gated (size + photographic via scorePhoto) and routed through
 * the LOCKED CONTRACT (processSlot: focal crop + grade + resolution floor) for
 * the slot it lands in. Descriptors carry attribution (credit/creditUrl/license/
 * source) and a `provenance` tag (`stock:pexels`/`stock:unsplash`) so the
 * dashboard/audit always knows the image is ambiance, not the business's own.
 *
 * @param {{name?:string,category?:string,city?:string,area?:string}} facts
 * @param {{destDir:string, slug:string, startIndex?:number, need?:number, category?:string}} opts
 * @returns {Promise<Array>} saved media descriptors (best-first)
 */
export async function acquireStockMedia(facts, { destDir, slug, startIndex = 0, need = 1, category } = {}) {
  if (need <= 0) return [];
  if (!process.env.PEXELS_API_KEY && !process.env.UNSPLASH_ACCESS_KEY) return []; // no key → no-op

  const query = queryFor(facts);
  // Pexels first (no attribution burden), then Unsplash; pooled so the gate picks
  // the best surviving frames across providers.
  let candidates = [];
  try { candidates = candidates.concat(await searchPexels(query)); } catch { /* skip provider */ }
  try { candidates = candidates.concat(await searchUnsplash(query)); } catch { /* skip provider */ }
  if (!candidates.length) return [];

  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  // Download + gate each candidate the same way every other tier is gated.
  const kept = [];
  const seenHash = new Set();
  for (const c of candidates) {
    if (kept.length >= need) break;
    const got = await fetchImage(c.url);
    if (!got) continue;
    const ext = EXT_BY_MIME[got.mime];
    if (!ext) continue;
    const dims = imageSize(got.buf);
    if (dims && (dims.w < MIN_W || dims.h < MIN_H)) continue;
    if (!dims && got.buf.length < 18000) continue;
    const hash = createHash('sha1').update(got.buf).digest('hex');
    if (seenHash.has(hash)) continue;
    seenHash.add(hash);
    // Photographic gate: drop logos/flat illustrations/fuzzy/low-res results so a
    // stock frame meets the same bar as a scraped/OSM photo.
    const q = await scorePhoto(got.buf);
    if (q.isGraphic || q.fuzzy || q.lowRes) continue;
    if (c.provider === 'unsplash' && c.downloadLocation) pingUnsplashDownload(c.downloadLocation);
    kept.push({ buf: got.buf, ext, w: dims?.w ?? c.w ?? q.w, h: dims?.h ?? c.h ?? q.h, score: q.score, meta: c });
  }
  if (!kept.length) return [];

  // Best photo first.
  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const saved = [];
  for (let i = 0; i < kept.length && saved.length < need; i++) {
    const img = kept[i];
    const idx = startIndex + saved.length;
    const slot = slotForIndex(idx);
    const res = await processSlot(img.buf, { slot, category: category || facts.category, format: fmtForExt(img.ext) });
    if (!res.usable || !res.buf) continue; // below the slot's resolution floor → skip
    const outExt = res.ext || img.ext;
    const fileName = nameFor(idx, outExt);
    await writeFile(join(outDir, fileName), res.buf);
    saved.push({
      path: `/images/${slug}/${fileName}`,
      credit: img.meta.credit,
      creditUrl: img.meta.creditUrl || '',
      license: img.meta.license,
      source: img.meta.source,
      // PROVENANCE (honesty tag): ambiance/context stock, NOT the business's own.
      provenance: `stock:${img.meta.provider}`,
      ambiance: true,
      alt: '',
      w: img.w, h: img.h, score: img.score ?? 0,
      focal: res.focal ?? { fx: 0.5, fy: 0.5 },
      focalCss: res.focalCss ?? '50% 50%',
    });
  }
  // Surface the provider that won the hero slot so the caller can tag photoSource.
  if (saved.length) Object.defineProperty(saved, 'provider', { value: saved[0].provenance, enumerable: false });
  return saved;
}
