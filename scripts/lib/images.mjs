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
 *   3. OSM / Wikidata REAL photos OF THE PLACE (osm.mjs) — key-free: Wikidata
 *      P18, OSM image tags (image=/wikimedia_commons=/panoramax=), and Panoramax
 *      street-level. Still genuinely "theirs", so it sits above generic stock.
 *   4. Wikimedia Commons (free, no key) — town/area shots. (photos.mjs)
 *   5. The built-in category SVG library — handled by the caller when this
 *      returns nothing, so a page always renders.
 *
 * Real photos are filtered by actual pixel dimensions (decoded from the file
 * header, no image library) so logos/icons/thumbnails don't become heroes.
 */

import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getRealPhotos } from './photos.mjs';
import { enrichFromOSM } from './osm.mjs';
import { scorePhoto, dhash, hamming, NEAR_DUP_DISTANCE } from './photo-score.mjs';
import { processSlot, heroTierForWidth, HERO_SLOT_BY_TIER } from './photo-art.mjs';

const UA =
  'Mozilla/5.0 (compatible; websites-outreach/1.0; +https://github.com/dukotah/websites)';

// Default assets root (where per-prospect photos live), so processDroppedPhotos
// works without an explicit destDir. Mirrors generate-prospects.mjs PUBLIC_IMAGES
// (scripts/lib/ → repo root → sites/demo-gallery/src/assets/prospects).
const PUBLIC_IMAGES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'sites', 'demo-gallery', 'src', 'assets', 'prospects',
);

const MIN_W = 600; // below this an image is almost certainly a logo/icon/thumb
const MIN_H = 360;

// QUALITY FLOOR for the hero slot. Below this photographic-quality score (0..1)
// the best surviving photo isn't good enough to carry a full-bleed hero — better
// to ship a clean TEXT hero than a muddy/off scraped frame. Surfaced via the
// acquirePhotos return (`heroUsable`) so the generator can fall back without
// this module needing to know about layouts. Tuned just under typical real-
// storefront scores so genuine photos pass and weak filler is flagged.
const MIN_HERO_SCORE = 0.4;

// Target aspect for a full-bleed hero (matches the gallery's 16:9-ish fold).
const HERO_ASPECT = 16 / 9;

// Map a saved-photo INDEX to its LOCKED-CONTRACT slot. Index 0 is the hero
// (full-bleed), index 1 is the About/story side image, everything after is a
// gallery tile. This is the one place the factory's "hero / story / gallery"
// ordering becomes a contract slot, so every photo is processed for the box it
// will actually render in (the cutoff bug was story/gallery shipping raw).
const slotForIndex = (i) => (i === 0 ? 'hero-fullbleed' : i === 1 ? 'story' : 'gallery');

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/avif': 'avif',
};

// --- decode width/height from the file header (no dependencies) -------------

export function imageSize(buf) {
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
export async function downloadScrapedPhotos(urls, { destDir, slug, max = 2, maxCandidates = 24, heroHint, category } = {}) {
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
    // Perceptual near-dup: the same shot at a different size/crop already kept.
    const ph = await dhash(got.buf);
    if (ph != null && seenPhash.some((p) => hamming(p, ph) <= NEAR_DUP_DISTANCE)) continue;
    if (ph != null) seenPhash.push(ph);
    // Carry `faded` so a washed photo can still fill a gallery slot (its low score
    // already sinks it) but is BARRED from the hero — a washed image must never
    // headline. We do NOT hard-`continue` on faded: that would empty thin galleries.
    kept.push({ buf: got.buf, ext, url, w: dims?.w ?? q.w, h: dims?.h ?? q.h, score: q.score, faded: q.faded });
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
  // A hero is full-bleed (rendered ~1600px+ wide); a smaller source upscales and
  // looks fuzzy/blown out. So PREFER a hero-sized landscape — their hint, then the
  // best big landscape, then any big shot — before falling back to the old prefs.
  // When nothing is big enough, the small shot is still kept (for the gallery) but
  // buildConfig swaps in clean library art for the hero rather than upscaling it.
  const HERO_MIN_W = 1200;
  const bigEnough = (k) => (k.w ?? 0) >= HERO_MIN_W;
  // A faded/washed photo is barred from the HERO (it headlines the page) — but it
  // stays in `kept` for the gallery, where its low score sinks it to the bottom.
  const heroOk = (k) => bigEnough(k) && !k.faded;
  let heroIdx = heroHint ? kept.findIndex((k) => k.url === heroHint && heroOk(k)) : -1;
  if (heroIdx < 0) heroIdx = kept.findIndex((k) => heroOk(k) && isLandscape(k));
  if (heroIdx < 0) heroIdx = kept.findIndex(heroOk);
  if (heroIdx < 0) heroIdx = heroHint ? kept.findIndex((k) => k.url === heroHint && !k.faded) : -1;
  if (heroIdx < 0) heroIdx = kept.findIndex((k) => isLandscape(k) && !k.faded);
  // Last resort only: if literally every candidate is faded, fall through to the
  // old prefs so a page still has a hero (the author-time gate + tier still apply).
  if (heroIdx < 0) heroIdx = heroHint ? kept.findIndex((k) => k.url === heroHint && bigEnough(k)) : -1;
  if (heroIdx < 0) heroIdx = kept.findIndex(bigEnough);
  if (heroIdx < 0) heroIdx = kept.findIndex(isLandscape);
  if (heroIdx < 0) heroIdx = 0;
  if (heroIdx > 0) {
    const [h] = kept.splice(heroIdx, 1);
    kept.unshift(h);
  }

  // HERO TIER (LOCKED CONTRACT): the chosen hero is kept[0]. Its SOURCE width
  // decides how we SHOW the real photo — the "that's my business" hook — without
  // ever upscaling:
  //   • 'fullbleed' (≥1600) → crop hero-fullbleed (16/9), any hero incl. cinematic.
  //   • 'side'      (≥1000) → KEEP the photo but crop hero-split (4/5) for a
  //                           side-column hero where it shows smaller + sharp.
  //   • 'none'      (<1000) → genuinely too small → DROP the hero photo (text hero).
  const heroTier = kept.length ? heroTierForWidth(kept[0].w) : 'none';

  // ART DIRECTION for EVERY slot (the cutoff fix): route the hero AND the
  // story/gallery shots through the LOCKED CONTRACT via processSlot — each photo
  // is focal-cropped to the box it will render in (hero 16:9 or 4:5 by tier +
  // graded, story 4:5, gallery 4:3), never upscaled. A non-hero photo below its
  // slot's floor comes back unusable; we DROP it from that slot so a blurry frame
  // never ships. processSlot fails soft (returns the original) on any Sharp hiccup.
  const saved = [];
  const slice = kept.slice(0, max);
  for (let i = 0; i < slice.length; i++) {
    const img = slice[i];
    // Slot by render-index. Index 0 is the hero: its slot is the tier's slot, and
    // tier 'none' drops it (no hero photo → text hero) while everything from
    // index 1 still ships as story/gallery.
    let slot;
    if (i === 0) {
      if (heroTier === 'none') continue; // too small → drop the hero photo
      slot = HERO_SLOT_BY_TIER[heroTier];
    } else {
      slot = slotForIndex(i);
    }
    const ext = img.ext;
    const res = await processSlot(img.buf, {
      slot,
      category,
      // Keep the source codec; processSlot re-encodes deterministically (and
      // promotes a photographic PNG to WebP so the file never balloons).
      format: ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg',
    });
    // A non-hero below its slot's resolution floor → skip rather than upscale.
    // (The hero already cleared its tier floor by construction, so it's kept.)
    if (!res.usable || !res.buf) continue;
    // processSlot may have changed the codec (PNG → WebP): use the ext it reports
    // so the saved filename + descriptor path match the bytes on disk.
    const outExt = res.ext || ext;
    const fileName = nameFor(i, outExt);
    await writeFile(join(outDir, fileName), res.buf);
    // FOCAL POINT (LOCKED CONTRACT): processSlot computed it on the cropped/graded
    // OUTPUT, so it matches the rendered pixels. Default to centre when unknown.
    // srcW = the true source width (pre-crop); slotUsable true by construction
    // (below-floor candidates were dropped via `continue` above). The generator
    // reads srcW to gate the story/gallery render slots against the same floors.
    saved.push({ path: `/images/${slug}/${fileName}`, credit: '', source: img.url, alt: '', w: img.w, h: img.h, srcW: img.w, srcH: img.h, slotUsable: true, score: img.score ?? 0, focal: res.focal ?? { fx: 0.5, fy: 0.5 }, focalCss: res.focalCss ?? '50% 50%' });
  }
  // Surface the hero TIER without changing the array return shape (fetch-media /
  // media-sweep consume this as a plain array): a non-enumerable property survives
  // indexing/.length/.slice but is dropped by .concat — acquirePhotos reads it
  // before any concat. Reflects the chosen hero's source width even when the hero
  // was dropped (tier 'none'), so the caller never mistakes a story photo for it.
  Object.defineProperty(saved, 'heroTier', { value: heroTier, enumerable: false });
  return saved;
}

// --- shared: route already-on-disk photos through the LOCKED CONTRACT --------

// Turn a JSON-style `/images/<slug>/<file>` path into the real on-disk file
// under `destDir` (the assets root). Returns null if the path isn't shaped that
// way (so we leave anything unexpected untouched rather than corrupt it).
function diskPathFor(jsonPath, destDir) {
  const m = /^\/images\/([^/]+)\/(.+)$/.exec(jsonPath || '');
  if (!m) return null;
  return join(destDir, m[1], m[2]);
}

const extOf = (p) => {
  const m = /\.([a-z0-9]+)$/i.exec(p || '');
  return (m ? m[1] : 'jpg').toLowerCase();
};
const fmtForExt = (ext) => (ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg');

// Swap the extension on a JSON `/images/<slug>/<file>` path (used when the codec
// changes during processing, e.g. a photographic PNG promoted to WebP).
const withExt = (jsonPath, ext) => (jsonPath || '').replace(/\.[a-z0-9]+$/i, `.${ext}`);

/**
 * Reprocess ONE already-saved photo file in place for a given contract slot:
 * read it, run processSlot (focal-crop to the slot box + grade if hero), and —
 * only when processSlot returns a usable buffer — rewrite the file. Returns the
 * processSlot result PLUS `path` (the JSON path to use going forward — unchanged
 * unless the codec changed) and `srcW` (true source width, for tier decisions).
 *
 * PNG BLOAT FIX: when processSlot promotes a photographic PNG to WebP, the file
 * is saved under the new .webp name, the stale .png is removed, and the returned
 * `path` reflects the new extension so the descriptor never dangles.
 *
 * Fails soft: an unreadable/odd file is left exactly as-is and reported usable
 * so we never delete a photo that's already shipped.
 */
async function reprocessFileInPlace(jsonPath, { destDir, slot, category }) {
  const file = diskPathFor(jsonPath, destDir);
  // FOCAL default for the leave-alone paths (unparseable/unreadable) — centre.
  const defFocal = { focal: { fx: 0.5, fy: 0.5 }, focalCss: '50% 50%' };
  if (!file) return { usable: true, width: 0, height: 0, path: jsonPath, srcW: 0, ...defFocal };
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    return { usable: true, width: 0, height: 0, path: jsonPath, srcW: 0, ...defFocal }; // can't read → leave alone
  }
  // True source width + height up front (header decode, no Sharp) so callers can
  // decide the hero tier and the per-slot EFFECTIVE width (a landscape source
  // cropped to a tall slot narrows below its source width) before/independently
  // of the crop result.
  const srcDim = imageSize(buf) ?? {};
  const srcW = srcDim.w ?? 0;
  const srcH = srcDim.h ?? 0;
  const res = await processSlot(buf, { slot, category, format: fmtForExt(extOf(file)) });
  // Only overwrite when we got real bytes back. A below-floor (unusable) photo
  // is left on disk untouched — the DESCRIPTOR-level gate decides whether the
  // caller keeps using it; we don't destroy the original.
  let outPath = jsonPath;
  if (res.usable && res.buf && res.buf.length) {
    const oldExt = extOf(file);
    const newExt = res.ext || oldExt;
    if (newExt !== oldExt) {
      // Codec changed (PNG → WebP): write the new file, drop the stale original so
      // nothing dangles, and report the new path.
      const newFile = withExt(file, newExt);
      try {
        await writeFile(newFile, res.buf);
        if (newFile !== file) { try { await unlink(file); } catch { /* best effort */ } }
        outPath = withExt(jsonPath, newExt);
      } catch { /* leave original on write error */ }
    } else {
      try { await writeFile(file, res.buf); } catch { /* leave original on write error */ }
    }
  }
  return { ...res, path: outPath, srcW: srcW || res.width || 0, srcH: srcH || res.height || 0 };
}

/**
 * Run already-on-disk, AGENT-DROPPED photos (descriptors that carry a local
 * `/images/<slug>/<file>` path) through the LOCKED CONTRACT and rewrite the
 * files in place. The agent drops genuine business photos straight into the
 * assets dir; until now those shipped raw (the cutoff bug for the strongest
 * tier). Slot assignment mirrors the factory ordering:
 *   • index 0 → hero-fullbleed, UNLESS it's clearly a PORTRAIT (taller than
 *     wide), in which case it's a side-photo hero → 'hero-split' (a portrait
 *     focal-cropped to 16:9 loses the subject; 4:5 keeps it);
 *   • index 1 → story;
 *   • the rest → gallery.
 *
 * HERO TIER (LOCKED CONTRACT) governs index 0 by the photo's SOURCE width:
 *   • 'fullbleed' (≥1600) → crop hero-fullbleed (16/9). A PORTRAIT at this width
 *     still buries its subject full-bleed, so a tall fullbleed-tier frame is
 *     routed to hero-split (4/5) instead — the photo stays, just side-column.
 *   • 'side'      (≥1000) → KEEP the photo but crop hero-split (4/5) for a
 *     smaller, sharp side-column hero. NEVER cinematic. (1000–1599 is NOT dropped.)
 *   • 'none'      (<1000) → DROP the hero photo; index 1+ still ship story/gallery.
 *
 * Returns { media, heroResOk, heroTier }:
 *   • media     — the same descriptors (files rewritten; a PNG promoted to WebP
 *                 has its `.path` updated to the new .webp file).
 *   • heroTier  — the hero's LOCKED tier (see above).
 *   • heroResOk — back-compat alias === (heroTier === 'fullbleed').
 *
 * @param {Array<{path:string, w?:number, h?:number}>} media
 * @param {{category?:string, destDir?:string}} opts  destDir = assets root
 */
export async function processDroppedPhotos(media, { category, destDir = PUBLIC_IMAGES } = {}) {
  if (!media?.length) return { media: media ?? [], heroResOk: false, heroTier: 'none' };

  // Decide the hero TIER from the hero's TRUE source width (header decode, no
  // Sharp). Prefer the on-disk file; fall back to a width already on the
  // descriptor so we still tier when the file can't be read.
  const heroFile = diskPathFor(media[0].path, destDir);
  let heroSrcW = media[0].w ?? 0;
  if (heroFile) {
    try { heroSrcW = imageSize(await readFile(heroFile))?.w ?? heroSrcW; } catch { /* keep descriptor width */ }
  }
  const heroTier = heroTierForWidth(heroSrcW);

  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    // Pick the slot. Index 0 is the hero — its slot is the tier's slot.
    let slot;
    if (i === 0) {
      if (heroTier === 'none') {
        // Too small → drop the hero photo (text hero). Still stamp a default
        // focal so the descriptor carries the contract fields.
        if (m.focal == null) m.focal = { fx: 0.5, fy: 0.5 };
        if (m.focalCss == null) m.focalCss = '50% 50%';
        continue;
      }
      slot = HERO_SLOT_BY_TIER[heroTier];
      // Portrait guard: a tall frame can't fill a 16:9 full-bleed without burying
      // the subject, so a fullbleed-tier PORTRAIT renders side-column (4:5) too.
      if (slot === 'hero-fullbleed' && m.w && m.h && m.h > m.w) slot = 'hero-split';
    } else if (i === 1) {
      slot = 'story';
    } else {
      slot = 'gallery';
    }
    const res = await reprocessFileInPlace(m.path, { destDir, slot, category });
    // Codec may have changed (PNG → WebP): adopt the new path so the descriptor
    // points at the file that actually exists on disk.
    if (res.path) m.path = res.path;
    // Stamp the TRUE source width (header decode, pre-crop) so the generator can
    // gate each render slot against the LOCKED CONTRACT floor. m.w is about to be
    // overwritten with the cropped OUTPUT width below, which loses the source
    // width the story/gallery floors are defined against — keep it here.
    if (typeof res.srcW === 'number' && res.srcW > 0) m.srcW = res.srcW;
    if (typeof res.srcH === 'number' && res.srcH > 0) m.srcH = res.srcH;
    // `false` only when processSlot judged the source too small for this slot (no
    // rewrite happened). The generator drops a below-floor story/gallery photo so
    // a blurry secondary frame never ships (image-qa enforces the same floors).
    m.slotUsable = res.usable !== false;
    // Carry the post-process box dimensions back onto the descriptor when we got
    // a real crop (so downstream sizing sees the actual rendered dimensions).
    if (res.usable && res.width && res.height) {
      m.w = res.width;
      m.h = res.height;
    }
    // FOCAL POINT (LOCKED CONTRACT): stamp the focal computed on the rewritten
    // OUTPUT onto the descriptor. Default to centre when reprocess couldn't
    // compute one (left-alone / below-floor file).
    m.focal = res.focal ?? { fx: 0.5, fy: 0.5 };
    m.focalCss = res.focalCss ?? '50% 50%';
  }
  return { media, heroResOk: heroTier === 'fullbleed', heroTier };
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
      // AI renders aren't routed through processSlot, so we don't have a computed
      // focal — default to centre to satisfy the contract (focalCss "50% 50%").
      saved.push({ path: `/images/${slug}/${fileName}`, credit: '', source: 'ai-generated', alt: '', focal: { fx: 0.5, fy: 0.5 }, focalCss: '50% 50%' });
    } catch (err) {
      console.warn(`  ! image-gen failed for ${facts.name} (${err.message}); skipping`);
      break;
    }
  }
  return saved;
}

// --- tier 3: OSM / Wikidata real photos OF THE PLACE (key-free) -------------

/**
 * Download already-resolved OSM/Wikidata photo descriptors (each
 * { url, credit, license, source } from osm.mjs), keep only ones that are big
 * enough + genuinely photographic + distinct, route each through the LOCKED
 * CONTRACT (processSlot) for the slot it lands in, and save them. Mirrors the
 * own-site path's gates (size floor, graphic rejection, byte + perceptual de-dup)
 * so an OSM photo gets the SAME quality bar as a scraped one. ATTRIBUTION is
 * carried onto every descriptor (credit/license/source) — OSM/Commons/Panoramax
 * imagery is licensed and must be credited where shown.
 *
 * @param {Array<{url,credit,license,source}>} photos  osm.mjs results
 * @param {{destDir, slug, startIndex?:number, max?:number, category?:string}} opts
 * @returns {Promise<Array>} saved media descriptors (best-first)
 */
export async function downloadOsmPhotos(photos, { destDir, slug, startIndex = 0, max = 2, category } = {}) {
  if (!photos?.length || max <= 0) return [];
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  // Download + gate each candidate (same bar as own-site photos).
  const kept = [];
  const seenHash = new Set();
  const seenPhash = [];
  for (const p of photos) {
    if (!p?.url) continue;
    const got = await fetchImage(p.url);
    if (!got) continue;
    const ext = EXT_BY_MIME[got.mime];
    if (!ext) continue;
    const dims = imageSize(got.buf);
    if (dims && (dims.w < MIN_W || dims.h < MIN_H)) continue; // too small → skip
    if (!dims && got.buf.length < 18000) continue;
    const hash = createHash('sha1').update(got.buf).digest('hex');
    if (seenHash.has(hash)) continue; // exact duplicate bytes
    seenHash.add(hash);
    const q = await scorePhoto(got.buf);
    if (q.isGraphic) continue; // logos/screenshots/flat art → skip
    const ph = await dhash(got.buf);
    if (ph != null && seenPhash.some((x) => hamming(x, ph) <= NEAR_DUP_DISTANCE)) continue;
    if (ph != null) seenPhash.push(ph);
    kept.push({
      buf: got.buf, ext, w: dims?.w ?? q.w, h: dims?.h ?? q.h, score: q.score,
      // ATTRIBUTION (carried through to the descriptor) — these sources are
      // licensed (CC-BY-SA etc.) and must be credited where displayed.
      credit: p.credit || '', license: p.license || '', source: p.source || p.url,
    });
  }
  if (!kept.length) return [];

  // Best photo first (same ranking as own-site).
  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Route each through the LOCKED CONTRACT for the slot it lands in. The on-disk
  // index continues after whatever the caller already saved (startIndex), so OSM
  // filenames never clobber an existing scraped hero/story.
  const saved = [];
  for (let i = 0; i < kept.length && saved.length < max; i++) {
    const img = kept[i];
    const idx = startIndex + saved.length;
    const slot = slotForIndex(idx);
    const res = await processSlot(img.buf, {
      slot,
      category,
      format: img.ext === 'png' ? 'png' : img.ext === 'webp' ? 'webp' : 'jpeg',
    });
    if (!res.usable || !res.buf) continue; // below the slot floor → skip
    const outExt = res.ext || img.ext;
    const fileName = nameFor(idx, outExt);
    await writeFile(join(outDir, fileName), res.buf);
    saved.push({
      path: `/images/${slug}/${fileName}`,
      credit: img.credit, license: img.license, source: img.source,
      alt: '', w: img.w, h: img.h, score: img.score ?? 0,
      // FOCAL POINT (LOCKED CONTRACT): computed on the cropped/graded output.
      focal: res.focal ?? { fx: 0.5, fy: 0.5 },
      focalCss: res.focalCss ?? '50% 50%',
    });
  }
  return saved;
}

// --- orchestrator: try every tier in order ----------------------------------

/**
 * Get up to `max` photos for a prospect, strongest source first. Returns
 * { media, source, heroUsable, heroScore, heroResOk }:
 *   • media      — saved photo descriptors (best-first; [0] is the hero).
 *   • source     — the tier(s) that satisfied it.
 *   • heroUsable — QUALITY FLOOR signal: false when no candidate cleared
 *                  MIN_HERO_SCORE, so the generator can fall back to a TEXT hero
 *                  instead of shipping a weak photo. (Exposed only — this module
 *                  does NOT choose the layout.)
 *   • heroScore  — the hero photo's 0..1 score (0 when no photo / library).
 *   • heroResOk  — RESOLUTION floor signal (separate from quality): true when the
 *                  hero SOURCE cleared the hero slot's contract minW after
 *                  processing, so the generator can drop a blurry-but-otherwise-
 *                  fine hero. False when no media or the hero is below floor.
 *                  Back-compat alias: heroResOk === (heroTier === 'fullbleed').
 *   • heroTier   — LOCKED HERO-PHOTO TIER from the hero SOURCE width:
 *                  'fullbleed' (≥1600, any hero incl. cinematic), 'side' (≥1000,
 *                  KEEP the photo in a smaller side-column hero), or 'none'
 *                  (<1000 → drop the photo → text hero). The generator copies this
 *                  to config.artDirection.heroPhotoTier so compose/divergence obey
 *                  it; this module only REPORTS the tier, it doesn't pick layout.
 *   • osm        — KEY-FREE OSM/Wikidata FACTS harvested while sourcing photos
 *                  (only when the OSM tier ran): { facts:{hours,phone,address,
 *                  category,website}, coord, attribution }, or null. The generator
 *                  can MERGE facts (hours/phone/address) over its own when missing.
 *                  Exposed only — this module never edits the enrichment object.
 * When media is empty, the caller uses the built-in category SVG library.
 *
 * @param {object} row        CSV row (name, category, city, state, ...)
 * @param {object|null} enrichment  scrape-site.mjs output (may be null)
 */
export async function acquirePhotos(
  row,
  enrichment,
  { destDir, slug, ownMax = 16, min = 2, skipWikimedia = false, skipOsm = false, heroHint } = {},
) {
  const facts = {
    name: row.name,
    category: row.category,
    area: [row.city, row.state].filter(Boolean).join(', '),
    city: row.city,
  };

  // QUALITY FLOOR helper. The hero is media[0]. A scraped photo carries its own
  // 0..1 score; Wikimedia/Openverse heroes already passed their own MIN_PHOTO_
  // SCORE gate (≥0.45, above our floor) so they count as usable; AI-generated is
  // a bespoke render so it's deliberately usable. Library (no media) is text-only
  // territory, so heroUsable is false there. Pure read of the chosen hero.
  const heroQuality = (m, src) => {
    if (!m.length) return { heroUsable: false, heroScore: 0 };
    const top = m[0];
    if (typeof top.score === 'number') return { heroUsable: top.score >= MIN_HERO_SCORE, heroScore: top.score };
    // No score on the descriptor → it came from a pre-gated source (ai/wiki/
    // openverse), which only ships photos it already judged good enough.
    return { heroUsable: src !== 'library', heroScore: 0 };
  };

  // RESOLUTION floor for the hero is now encoded in the LOCKED TIER CONTRACT
  // (heroTierForWidth): tier 'fullbleed' means the source cleared the hero-fullbleed
  // minW, so heroResOk === (heroTier === 'fullbleed'). No separate floor needed.

  // Tier 1: their own scraped photos — pulled GENEROUSLY (up to ownMax). Every
  // one is genuinely theirs, so a richer real-photo gallery is pure upside. Each
  // photo was already routed through processSlot (per-slot crop + grade + floor),
  // so a surviving media[0] cleared the hero floor → heroResOk true.
  let media = await downloadScrapedPhotos(enrichment?.images, {
    destDir,
    slug,
    max: ownMax,
    // Evaluate a GENEROUS candidate budget so a vision agent gets options to
    // choose from: pixel-stat ranking picks an order, but the scraper often grabs
    // the wrong/limited hero, so we keep every decent-resolution distinct frame
    // the site offers (junk — logos/icons/sprites — is still filtered) rather than
    // discarding good shots early. Cost is bounded by the URL-stage de-dupe.
    maxCandidates: 120,
    heroHint,
    category: row.category, // drives the deterministic hero grade
  });
  // The hero TIER for the scraped hero (LOCKED CONTRACT). downloadScrapedPhotos
  // computed it from the hero candidate's SOURCE width and attached it as a
  // non-enumerable property, so it's correct even when the hero was dropped
  // ('none'). heroResOk is the back-compat alias: true only at the 'fullbleed'
  // tier (≥1600), since only then does the hero fill a full-bleed 16:9 box.
  const scrapedTier = media.heroTier || (media.length ? heroTierForWidth(media[0].w) : 'none');

  // If we have at least the essential slots from their OWN photos, stop here —
  // stock must NEVER pad a gallery (that's the "looks like a template" tell).
  if (media.length >= min) {
    return {
      media,
      source: 'business-site',
      ...heroQuality(media, 'business-site'),
      heroTier: scrapedTier,
      heroResOk: scrapedTier === 'fullbleed',
      osm: null, // OSM tier didn't run — own photos were enough
    };
  }
  let source = media.length ? 'business-site' : '';
  // KEY-FREE OSM/Wikidata facts harvested if the OSM tier runs below; exposed on
  // the return so the generator can fill missing hours/phone/address. null until
  // then so callers can tell "OSM didn't run" from "OSM ran, found nothing".
  let osm = null;

  // Below the essentials (≤1 own photo): backfill ONLY the hero/story slots
  // (`min`) with AI/Wikimedia — never a full gallery's worth of stock.
  const gap = min - media.length;
  const generated = await generateImages(facts, { destDir, slug, startIndex: media.length, need: gap });
  if (generated.length) {
    media = media.concat(generated);
    source = source ? `${source}+ai` : 'ai-generated';
    // AI renders are produced at the requested hero size (≥1600), so the hero is
    // 'fullbleed' tier and res-ok. If a scraped photo already won the hero slot,
    // honor ITS tier instead (the AI image only backfilled story/gallery).
    if (media.length >= min) {
      const tier = media.length && media[0].score != null ? scrapedTier : 'fullbleed';
      return { media, source, ...heroQuality(media, source), heroTier: tier, heroResOk: tier === 'fullbleed', osm };
    }
  }

  // Tier 3: OSM / Wikidata REAL photos OF THE PLACE (key-free, fail-soft). Still
  // genuinely "theirs", so it sits ABOVE generic Wikimedia town shots. Runs only
  // when we still lack the essentials. The same call also harvests verified facts
  // (hours/phone/address) which we expose on the return for the generator. Wrapped
  // so any failure (offline, no match) just falls through to Wikimedia.
  if (media.length < min && !skipOsm) {
    try {
      const enriched = await enrichFromOSM(
        {
          name: row.name,
          address: enrichment?.address || row.address,
          city: row.city,
          state: row.state,
          category: row.category,
          // A Wikidata QID the scrape/research may have surfaced lets us jump
          // straight to a curated P18 photo for a notable business.
          wikidata: enrichment?.wikidata,
        },
        { maxPhotos: (min - media.length) + 2 },
      );
      osm = enriched; // expose the facts/attribution regardless of photo outcome
      if (enriched.photos?.length) {
        const got = await downloadOsmPhotos(enriched.photos, {
          destDir,
          slug,
          startIndex: media.length,
          max: min - media.length,
          category: row.category,
        });
        if (got.length) {
          media = media.concat(got);
          source = source ? `${source}+osm` : 'osm';
        }
      }
    } catch {
      /* fall through to Wikimedia */
    }
  }

  // Tier 4: Wikimedia Commons (free) — still only up to the essentials. These
  // shipped RAW until now (part of the cutoff bug): route each result through the
  // LOCKED CONTRACT for the slot it lands in (its on-disk index continues after
  // whatever we already have). startIndex keeps wiki filenames from clobbering an
  // already-saved scraped hero/story.
  if (media.length < min && !skipWikimedia) {
    try {
      const wiki = await getRealPhotos(row, { destDir, slug, max: min - media.length, startIndex: media.length });
      if (wiki.length) {
        // Reprocess each wiki photo in place for its contract slot (index counts
        // from where the existing media leaves off). Drop any that come back
        // unusable (below the slot floor) so a blurry frame never ships.
        const start = media.length;
        const kept = [];
        for (let i = 0; i < wiki.length; i++) {
          const slot = slotForIndex(start + i);
          const res = await reprocessFileInPlace(wiki[i].path, { destDir, slot, category: row.category });
          if (!res.usable) continue; // below floor → skip this slot's wiki photo
          if (res.path) wiki[i].path = res.path; // PNG → WebP rename, if any
          if (res.width && res.height) { wiki[i].w = res.width; wiki[i].h = res.height; }
          // FOCAL POINT (LOCKED CONTRACT): focal computed on the reprocessed
          // OUTPUT; default to centre when unknown.
          wiki[i].focal = res.focal ?? { fx: 0.5, fy: 0.5 };
          wiki[i].focalCss = res.focalCss ?? '50% 50%';
          kept.push(wiki[i]);
        }
        if (kept.length) {
          media = media.concat(kept);
          source = source ? `${source}+wikimedia` : 'wikimedia';
        }
      }
    } catch {
      /* fall through to library */
    }
  }

  source = source || 'library';
  // Hero TIER for a mixed/osm/wiki/library hero. A SCRAPED hero (one existed
  // before any backfill) keeps its already-computed locked tier. An OSM hero also
  // carries a numeric `score` + true `w`, so when the scraped tier was 'none'
  // (no scraped photo to begin with) we derive the tier from the hero's SOURCE
  // width instead. Failing that, fall back to the pre-gated source signal — wiki
  // heroes passed their own quality gate AND processSlot's fullbleed floor (or
  // were dropped), so a surviving non-library hero is 'fullbleed'; library
  // (no media) is 'none'.
  let heroTier;
  if (!media.length) {
    heroTier = 'none';
  } else if (typeof media[0].score === 'number' && scrapedTier !== 'none') {
    heroTier = scrapedTier; // scraped hero kept its slot → its locked tier stands
  } else if (media[0].w != null) {
    heroTier = heroTierForWidth(media[0].w); // osm/scraped hero by true source width
  } else {
    heroTier = source !== 'library' ? 'fullbleed' : 'none';
  }
  return { media, source, ...heroQuality(media, source), heroTier, heroResOk: heroTier === 'fullbleed', osm };
}
