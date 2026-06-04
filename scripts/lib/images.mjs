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
import { getRealPhotos } from './photos.mjs';

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
 * Download the real photos found on the business's site, keeping only ones big
 * enough to be a hero/story (filters logos, icons, thumbnails). Returns saved
 * media descriptors. Best-effort; network failures just yield fewer results.
 */
export async function downloadScrapedPhotos(urls, { destDir, slug, max = 2, maxCandidates = 8, heroHint } = {}) {
  if (!urls?.length) return [];
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  // Download a handful of candidates, keep the ones big enough to be a hero,
  // THEN rank — so a wide storefront beats a square logo for the hero slot.
  const kept = [];
  for (const url of urls.slice(0, maxCandidates)) {
    const got = await fetchImage(url);
    if (!got) continue;
    const ext = EXT_BY_MIME[got.mime];
    if (!ext) continue; // not a (supported) image
    const dims = imageSize(got.buf);
    if (dims && (dims.w < MIN_W || dims.h < MIN_H)) continue; // too small → skip
    if (!dims && got.buf.length < 18000) continue; // tiny file, dims unknown → skip
    kept.push({ buf: got.buf, ext, url, w: dims?.w, h: dims?.h });
  }

  // Rank by aspect-ratio tier first (a wide storefront makes a better hero than
  // a square logo or a portrait), then by pixel area as a tiebreak.
  const tier = (img) => {
    if (!img.w || !img.h) return 1; // unknown dims → middle
    const ar = img.w / img.h;
    if (ar >= 1.3) return 2; // clearly landscape — ideal hero
    if (ar >= 0.9) return 1; // square-ish
    return 0; // portrait
  };
  kept.sort((a, b) => tier(b) - tier(a) || (b.w ?? 0) * (b.h ?? 0) - (a.w ?? 0) * (a.h ?? 0));

  // Honor an explicit hero hint (e.g. the site's og:image / full-bleed hero) —
  // it's almost always the business's intended money shot. If it survived the
  // size filter and is landscape-ish, force it into the hero slot.
  if (heroHint) {
    const i = kept.findIndex((k) => k.url === heroHint && (!k.w || !k.h || k.w / k.h >= 1.1));
    if (i > 0) {
      const [h] = kept.splice(i, 1);
      kept.unshift(h);
    }
  }

  const saved = [];
  for (const img of kept.slice(0, max)) {
    const fileName = nameFor(saved.length, img.ext);
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
export async function acquirePhotos(row, enrichment, { destDir, slug, max = 2, skipWikimedia = false } = {}) {
  const facts = {
    name: row.name,
    category: row.category,
    area: [row.city, row.state].filter(Boolean).join(', '),
    city: row.city,
  };

  // Tier 1: their own scraped photos.
  let media = await downloadScrapedPhotos(enrichment?.images, { destDir, slug, max });
  if (media.length >= max) return { media, source: 'business-site' };
  let source = media.length ? 'business-site' : '';

  // Tier 2: AI-generate the remaining slots (only if a key is configured).
  const gap = max - media.length;
  const generated = await generateImages(facts, { destDir, slug, startIndex: media.length, need: gap });
  if (generated.length) {
    media = media.concat(generated);
    source = source ? `${source}+ai` : 'ai-generated';
    if (media.length >= max) return { media, source };
  }

  // Tier 3: Wikimedia Commons (free).
  if (media.length < max && !skipWikimedia) {
    try {
      const wiki = await getRealPhotos(row, { destDir, slug, max: max - media.length });
      if (wiki.length) {
        // Re-key filenames so they don't collide with hero/story already saved.
        media = media.concat(wiki);
        source = source ? `${source}+wikimedia` : 'wikimedia';
      }
    } catch {
      /* fall through to library */
    }
  }

  return { media, source: source || 'library' };
}
