/**
 * images.mjs — get REAL, business-specific photos onto each prospect page.
 *
 * The single biggest "looks like AI slop" tell is every site sharing the same
 * stock SVG. This module fixes that by trying, strongest source first:
 *
 *   1. The business's OWN photos, scraped from their existing website
 *      (enrichment.images from scrape-site.mjs). Authentic, free, no key.
 *   2. AI-generated, business-specific images to fill any remaining slot
 *      — OPTIONAL, only if an image-gen key is set (IMAGE_API_KEY). Graceful:
 *      with no key it's simply skipped.
 *   3. Wikimedia Commons (free, no key) — town/area shots. (photos.mjs)
 *   4. The built-in category SVG library — handled by the caller when this
 *      returns nothing, so a page always renders.
 *
 * Real photos are filtered by actual pixel dimensions (decoded from the file
 * header, no image library) so logos/icons/thumbnails don't become heroes.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getRealPhotos } from './photos.mjs';
import { scorePhoto, dhash, hamming, NEAR_DUP_DISTANCE } from './photo-score.mjs';
import { getOpenversePhotos } from './openverse.mjs';

const UA =
  'Mozilla/5.0 (compatible; websites-outreach/1.0; +https://github.com/dukotah/websites)';

const MIN_W = 600; // below this an image is almost certainly a logo/icon/thumb
const MIN_H = 360;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/avif': 'avif',
};

// --- decode width/height from the file header (no dependencies) -------------

function imageSize(buf) {
  if (buf.length < 24) return null;
  // PNG: 8-byte sig, then IHDR with width/height as big-endian uint32.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // JPEG: walk the marker segments to the start-of-frame.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length - 8) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      // SOF0..SOF15 (skip DHT/DAC/RST/SOS): height/width follow the precision byte.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      o += 2 + len;
    }
  }
  // WebP (RIFF/WEBP): VP8X, VP8L, and lossy VP8 carry dimensions differently.
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8X') return { w: 1 + (buf.readUIntLE(24, 3) & 0xffffff), h: 1 + (buf.readUIntLE(27, 3) & 0xffffff) };
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) };
    }
    if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return null; // unknown — caller treats as "accept" rather than reject
}

async function fetchImage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
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

const nameFor = (i, ext) =>
  `${i === 0 ? 'hero' : i === 1 ? 'story' : `photo-${i}`}.${ext}`;

// --- tier 1: the business's own scraped photos -----------------------------

/**
 * Reduce a photo URL to a size-agnostic identity so the same image served at
 * many widths (hero.jpg, hero-1024x768.jpg, hero-scaled.jpg, hero@2x.jpg, plus
 * any ?ver= query) counts once. Lets us pull MORE *distinct* real photos into a
 * gallery instead of the same shot repeated at different resolutions.
 */
function baseIdentity(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.toLowerCase();
    // Strip a trailing size/density/variant token right before the extension.
    p = p.replace(/[-_@](?:\d{2,4}x\d{2,4}|\d{2,4}w|\dx|scaled|thumb(?:nail)?|small|medium|large)(?=\.[a-z0-9]+$)/g, '');
    return u.host + p;
  } catch {
    return url;
  }
}

/**
 * Download the real photos found on the business's site, keeping only ones big
 * enough to be a hero/story (filters logos, icons, thumbnails) and DISTINCT
 * (de-duped by size-agnostic URL identity and by exact bytes). Returns saved
 * media descriptors. Best-effort; network failures just yield fewer results.
 */
export async function downloadScrapedPhotos(urls, { destDir, slug, max = 2, maxCandidates = 8, heroHint, startIndex = 0 } = {}) {
  if (!urls?.length) return [];
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  // Collapse size-variants of the same photo up front, so the candidate budget
  // is spent on distinct images rather than re-fetching one shot many times.
  const seenBase = new Set();
  const distinctUrls = [];
  for (const url of urls) {
    const b = baseIdentity(url);
    if (seenBase.has(b)) continue;
    seenBase.add(b);
    distinctUrls.push(url);
  }

  // Download candidates, keep the ones big enough to be a hero and not byte-for-
  // byte duplicates, THEN rank — so a wide storefront beats a square logo.
  const kept = [];
  const seenHash = new Set();
  const seenPhash = []; // perceptual hashes of survivors, for near-dup detection
  for (const url of distinctUrls.slice(0, maxCandidates)) {
    const got = await fetchImage(url);
    if (!got) continue;
    const ext = EXT_BY_MIME[got.mime];
    if (!ext) continue; // not a (supported) image
    const dims = imageSize(got.buf);
    if (dims && (dims.w < MIN_W || dims.h < MIN_H)) continue; // too small → skip
    if (!dims && got.buf.length < 18000) continue; // tiny file, dims unknown → skip
    const hash = createHash('sha1').update(got.buf).digest('hex');
    if (seenHash.has(hash)) continue; // exact duplicate bytes → skip
    seenHash.add(hash);
    // Content judgment: drop logos / screenshots / flat illustrations that pass
    // the size filter — only real photographs earn a slot (key-free, pixel stats).
    const q = await scorePhoto(got.buf);
    if (q.isGraphic) continue;
    // Formats imageSize() can't measure from the header (e.g. AVIF) skip the
    // dimension gate above and fall through on the byte-floor alone — use Sharp's
    // decoded dimensions from scorePhoto so a small logo can't sneak in that way.
    if (!dims && q.w && q.h && (q.w < MIN_W || q.h < MIN_H)) continue;
    // Perceptual near-dup: the same shot at a different size/crop already kept.
    const ph = await dhash(got.buf);
    if (ph != null && seenPhash.some((p) => hamming(p, ph) <= NEAR_DUP_DISTANCE)) continue;
    if (ph != null) seenPhash.push(ph);
    kept.push({ buf: got.buf, ext, url, w: dims?.w ?? q.w, h: dims?.h ?? q.h, score: q.score });
  }

  // Rank survivors by photographic quality (entropy + tonal richness + landscape
  // + area) — this is the GALLERY order, best-first.
  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Choose the HERO deliberately — it carries the whole page, so "best photo" is
  // the wrong default (a striking portrait crops badly full-bleed). Preference:
  //   1. the business's OWN og:image/hero hint, when it survived as a real photo
  //      (graphics were already dropped, so a surviving hint is trustworthy);
  //   2. else the best-scored LANDSCAPE shot (wide reads as intentional);
  //   3. else the best overall.
  const isLandscape = (k) => k.w && k.h && k.w / k.h >= 1.2;
  let heroIdx = heroHint ? kept.findIndex((k) => k.url === heroHint) : -1;
  if (heroIdx < 0) heroIdx = kept.findIndex(isLandscape);
  if (heroIdx < 0) heroIdx = 0;
  if (heroIdx > 0) {
    const [h] = kept.splice(heroIdx, 1);
    kept.unshift(h);
  }

  const saved = [];
  for (const img of kept.slice(0, max)) {
    const fileName = nameFor(startIndex + saved.length, img.ext);
    await writeFile(join(outDir, fileName), img.buf);
    saved.push({ path: `/images/${slug}/${fileName}`, credit: '', source: img.url, alt: '', w: img.w, h: img.h });
  }
  return saved;
}

// --- tier 2: AI-generated, business-specific images (optional, key-gated) ---

/**
 * Build a concrete, photographic prompt for one slot from the business facts —
 * specific enough to look bespoke, never generic "business stock photo" filler.
 */
function imagePrompt(facts, slot) {
  const what = facts.category ? facts.category.replace(/-/g, ' ') : 'local business';
  const where = facts.area || facts.city || 'a small American town';
  const subject =
    slot === 'hero'
      ? `the storefront / on-the-job scene of a ${what} called "${facts.name}"`
      : `a warm, candid behind-the-scenes moment at a ${what} ("${facts.name}")`;
  return (
    `Editorial, photorealistic photograph: ${subject} in ${where}. ` +
    `Natural daylight, shallow depth of field, authentic and lived-in — NOT a stock photo, ` +
    `no text, no logos, no watermarks, no people staring at the camera. ` +
    `Documentary local-business feel.`
  );
}

/**
 * Generate up to `need` images via an OpenAI-compatible images endpoint. Only
 * runs when IMAGE_API_KEY is set; otherwise returns [] so the chain falls
 * through to Wikimedia/library. Override endpoint/model with IMAGE_API_URL /
 * IMAGE_API_MODEL. Designed to fail soft — any error → [].
 */
export async function generateImages(facts, { destDir, slug, startIndex = 0, need = 1 } = {}) {
  const key = process.env.IMAGE_API_KEY;
  if (!key || need <= 0) return [];

  const endpoint = process.env.IMAGE_API_URL || 'https://api.openai.com/v1/images/generations';
  const model = process.env.IMAGE_API_MODEL || 'gpt-image-1';
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  for (let k = 0; k < need; k++) {
    const idx = startIndex + k;
    const slot = idx === 0 ? 'hero' : 'story';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          prompt: imagePrompt(facts, slot),
          size: '1536x1024',
          n: 1,
        }),
      });
      if (!res.ok) {
        console.warn(`  ! image-gen HTTP ${res.status} for ${facts.name} (${slot}); skipping`);
        break; // a hard failure (bad key/quota) won't fix itself across slots
      }
      const data = await res.json();
      const item = data?.data?.[0];
      let buf;
      if (item?.b64_json) buf = Buffer.from(item.b64_json, 'base64');
      else if (item?.url) {
        const img = await fetchImage(item.url);
        buf = img?.buf;
      }
      if (!buf) continue;
      const fileName = nameFor(idx, 'png');
      await writeFile(join(outDir, fileName), buf);
      saved.push({ path: `/images/${slug}/${fileName}`, credit: '', source: 'ai-generated', alt: '' });
    } catch (err) {
      console.warn(`  ! image-gen failed for ${facts.name} (${err.message}); skipping`);
      break;
    }
  }
  return saved;
}

// --- orchestrator: try every tier in order ----------------------------------

/**
 * Get up to `max` photos for a prospect, strongest source first. Returns
 * { media, source } where source is the tier that satisfied it. When media is
 * empty, the caller uses the built-in category SVG library.
 *
 * @param {object} row        CSV row (name, category, city, state, ...)
 * @param {object|null} enrichment  scrape-site.mjs output (may be null)
 */
// --- tier: Mapillary street-level imagery (free token, last resort) ----------
// Geocodes the most specific location we have (full address > city) via keyless
// Nominatim, then pulls street-level photos near it from Mapillary. Used ONLY to
// give a photoless business a real-place hero instead of a blank SVG — credited
// and flagged "swap before sending", never gallery padding. No-op without token.
async function mapillaryUrls(location, { limit = 4 } = {}) {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token || !location) return [];
  try {
    const geo = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'website-factory/1.0 (demo generator)' } },
    ).then((r) => (r.ok ? r.json() : []));
    const pt = geo?.[0];
    if (!pt) return [];
    const lat = Number(pt.lat);
    const lon = Number(pt.lon);
    const d = 0.0012; // ~130m box around the point
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    const data = await fetch(
      `https://graph.mapillary.com/images?access_token=${token}&fields=thumb_2048_url&bbox=${bbox}&limit=${limit}`,
    ).then((r) => (r.ok ? r.json() : null));
    return (data?.data ?? []).map((i) => i.thumb_2048_url).filter(Boolean);
  } catch {
    return [];
  }
}

export async function acquirePhotos(
  row,
  enrichment,
  { destDir, slug, ownMax = 9, min = 2, skipWikimedia = false, heroHint } = {},
) {
  const facts = {
    name: row.name,
    category: row.category,
    area: [row.city, row.state].filter(Boolean).join(', '),
    city: row.city,
  };

  // Tier 1: their own scraped photos — pulled GENEROUSLY (up to ownMax). Every
  // one is genuinely theirs, so a richer real-photo gallery is pure upside.
  let media = await downloadScrapedPhotos(enrichment?.images, {
    destDir,
    slug,
    max: ownMax,
    maxCandidates: 60,
    heroHint,
  });
  // If we have at least the essential slots from their OWN photos, stop here —
  // stock must NEVER pad a gallery (that's the "looks like a template" tell).
  if (media.length >= min) return { media, source: 'business-site' };
  let source = media.length ? 'business-site' : '';

  // Below the essentials (≤1 own photo): backfill ONLY the hero/story slots
  // (`min`) with AI/Wikimedia — never a full gallery's worth of stock.
  const gap = min - media.length;
  const generated = await generateImages(facts, { destDir, slug, startIndex: media.length, need: gap });
  if (generated.length) {
    media = media.concat(generated);
    source = source ? `${source}+ai` : 'ai-generated';
    if (media.length >= min) return { media, source };
  }

  // Tier 3: Wikimedia Commons (free) — still only up to the essentials.
  if (media.length < min && !skipWikimedia) {
    try {
      const wiki = await getRealPhotos(row, { destDir, slug, max: min - media.length });
      if (wiki.length) {
        // Re-key filenames so they don't collide with hero/story already saved.
        media = media.concat(wiki);
        source = source ? `${source}+wikimedia` : 'wikimedia';
      }
    } catch {
      /* fall through to library */
    }
  }

  // Tier 3b: Openverse — freely-licensed photos (CC/PD, no key) covering a much
  // broader visual index than Wikimedia alone. Tried ONLY when we're still below
  // the minimum — never used to pad a gallery that already has real own-photos.
  // Capped to ~5 requests per site to respect the ~100/hr anonymous rate limit.
  if (media.length < min) {
    try {
      const category = (facts.category || '').replace(/-/g, ' ');
      const area = facts.area || facts.city || '';
      // Two queries: brand+category first (more specific), then area+category.
      const queries = [
        category ? `${facts.name} ${category}` : facts.name,
        area && category ? `${area} ${category}` : '',
      ].filter(Boolean).slice(0, 2); // at most 2 search calls → ≤2 API round-trips + downloads

      const ov = await getOpenversePhotos(queries, {
        destDir,
        slug,
        max: min - media.length,
        startIndex: media.length,
        aspect: 'wide',
      });
      if (ov.length) {
        media = media.concat(ov);
        source = source ? `${source}+openverse` : 'openverse';
      }
    } catch {
      /* fall through to mapillary */
    }
  }

  // Tier 4: Mapillary street-level imagery near the real address (free token;
  // last resort before the SVG library) — a real place beats a blank placeholder.
  if (media.length < min) {
    const urls = await mapillaryUrls(enrichment?.address || facts.area);
    if (urls.length) {
      const shots = await downloadScrapedPhotos(urls, {
        destDir,
        slug,
        max: min - media.length,
        maxCandidates: 8,
        startIndex: media.length,
      });
      if (shots.length) {
        media = media.concat(
          shots.map((m) => ({ ...m, credit: 'Street view via Mapillary — swap before sending' })),
        );
        source = source ? `${source}+mapillary` : 'mapillary';
      }
    }
  }

  return { media, source: source || 'library' };
}
