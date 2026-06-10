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
 * Relevance is enforced in three cheap layers, strongest-first so we never waste
 * a download on junk: (1) a URL filter that rejects logos, map pins, payment /
 * award badges, app-store buttons, tracking pixels, and third-party STOCK CDNs,
 * and prefers the business's OWN domain; (2) pixel-dimension minimums decoded
 * from the file header (no image library); (3) the pixel-stats scorer
 * (photo-score.mjs) that separates real photographs from logos / screenshots /
 * flat art. The hero is then chosen for a sane full-bleed aspect ratio, not just
 * the top score, so a portrait or banner sliver never lands behind the headline.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getRealPhotos } from './photos.mjs';
import { collectSiteImages } from './scrape-site.mjs';
import { scorePhoto, dhash, hamming, NEAR_DUP_DISTANCE } from './photo-score.mjs';

const UA =
  'Mozilla/5.0 (compatible; websites-outreach/1.0; +https://github.com/dukotah/websites)';

const MIN_W = 600; // below this an image is almost certainly a logo/icon/thumb
const MIN_H = 360;

// Hero aspect sanity: a full-bleed hero crops cleanly from a moderately wide
// shot, but extreme banners/slivers (sliced site headers, ribbon graphics) and
// tall portraits read as broken backgrounds. Used only to GATE hero candidates,
// not to drop a photo from the gallery.
const HERO_AR_MIN = 1.15; // narrower than this is portrait-ish → poor full-bleed hero
const HERO_AR_MAX = 3.2; // wider than this is a banner sliver, not a scene

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/avif': 'avif',
};

// --- URL-level relevance filter (cheap, runs before any download) -----------

/**
 * Reject by URL path/host the assets that are never a business PHOTO, even when
 * they'd survive the size + pixel-stats gates: social-icon sprites, map-pin /
 * marker tiles, payment / badge / award / app-store logos, tracking pixels, and
 * anything whose path strongly implies a logo / icon / UI sprite. This catches
 * junk *before* we spend a download + decode on it, and complements scrape-site's
 * IMG_REJECT (which only saw a coarser pattern).
 */
const URL_REJECT =
  /(?:^|[/_-])(?:logo|logos|icon|icons|favicon|sprite|sprites|symbol|glyph|badge|seal|award|cert|emblem|watermark|placeholder|pixel|spacer|blank|loader|spinner|avatar|profile-pic|map[-_]?pin|marker|pin|google[-_]?map|staticmap|payment|payments|visa|mastercard|amex|paypal|stripe|app[-_]?store|google[-_]?play|play[-_]?store|social|facebook|instagram|twitter|x[-_]logo|tiktok|yelp|tripadvisor|powered[-_]?by|theme|plugin|wp-includes|wp-content\/themes|assets\/ui|\/ui\/|button|btn|arrow|chevron|bullet|divider|pattern|texture|bg-pattern)(?:[/_.-]|$)/i;

// Third-party stock-photo CDN host fragments. Photos served from these are
// generic stock, not the business's own work — drop them so a stock shot can't
// masquerade as authentic in a gallery (only OWN photos may fill the gallery).
const STOCK_HOST =
  /(?:images\.unsplash\.com|unsplash\.com|images\.pexels\.com|pexels\.com|pixabay\.com|istockphoto\.com|shutterstock\.com|gettyimages\.com|stock\.adobe\.com|fbcdn\.net|gstatic\.com|googleusercontent\.com\/.*=s\d|depositphotos\.com|dreamstime\.com|123rf\.com|freepik\.com)/i;

/** True when the URL is obviously a non-photo asset or third-party stock. */
function isJunkUrl(url) {
  let path = url;
  let host = '';
  try {
    const u = new URL(url);
    path = u.pathname;
    host = u.host;
  } catch {
    /* keep the raw string */
  }
  if (STOCK_HOST.test(host) || STOCK_HOST.test(url)) return true;
  return URL_REJECT.test(path);
}

/**
 * Registrable-ish host for "is this the business's own domain?" comparison —
 * drop a leading www. and keep the last two labels (foo.com from img.foo.com,
 * cdn-host bridged via the site's own subdomain). Best-effort; '' on failure.
 */
function rootHost(url) {
  try {
    const h = new URL(url).host.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : h;
  } catch {
    return '';
  }
}

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
export async function downloadScrapedPhotos(urls, { destDir, slug, max = 2, maxCandidates = 8, heroHint } = {}) {
  if (!urls?.length) return [];
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  // The business's OWN domain — inferred from the hero hint (their og:image, on
  // their own site) or, failing that, the most common host among the candidates.
  // Photos served from this domain are preferred over third-party hosts, which
  // are more likely to be embedded stock / widgets than the business's own work.
  let ownHost = rootHost(heroHint || '');
  if (!ownHost) {
    const tally = new Map();
    for (const u of urls) {
      const r = rootHost(u);
      if (r) tally.set(r, (tally.get(r) || 0) + 1);
    }
    ownHost = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }
  const isOwnHost = (url) => Boolean(ownHost) && rootHost(url) === ownHost;

  // Drop obvious non-photo assets and third-party stock by URL BEFORE downloading
  // (cheap), while preserving the incoming order (which is hero-hint-first). The
  // hero hint is always kept even if its path trips a pattern — it's the
  // business's declared hero and gets re-validated by the pixel scorer below.
  const filtered = urls.filter((u) => u === heroHint || !isJunkUrl(u));

  // Collapse size-variants of the same photo up front, so the candidate budget
  // is spent on distinct images rather than re-fetching one shot many times.
  const seenBase = new Set();
  const distinctUrls = [];
  for (const url of filtered) {
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
    const w = dims?.w ?? q.w;
    const h = dims?.h ?? q.h;
    // Prefer the business's own-domain photos: a small score nudge so a genuine
    // own-site shot outranks an equally-pretty third-party one, without letting
    // a poor own photo beat a clearly better one.
    const score = (q.score ?? 0) + (isOwnHost(url) ? 0.06 : 0);
    kept.push({ buf: got.buf, ext, url, w, h, score, own: isOwnHost(url) });
  }

  // Rank survivors by photographic quality (entropy + tonal richness + landscape
  // + area, plus the own-domain nudge) — this is the GALLERY order, best-first.
  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Choose the HERO deliberately — it carries the whole page, so "best photo" is
  // the wrong default (a striking portrait crops badly full-bleed). Preference:
  //   1. the business's OWN og:image/hero hint, when it survived as a real photo
  //      (graphics were already dropped, so a surviving hint is trustworthy) AND
  //      it crops sanely full-bleed (not a portrait/banner sliver);
  //   2. else the best-scored shot with a HERO-SANE aspect ratio (wide-ish,
  //      neither portrait nor banner) — that reads as an intentional full-bleed;
  //   3. else the best overall (better a square hero than no hero).
  const heroSaneAr = (k) => k.w && k.h && k.w / k.h >= HERO_AR_MIN && k.w / k.h <= HERO_AR_MAX;
  let heroIdx = heroHint ? kept.findIndex((k) => k.url === heroHint && heroSaneAr(k)) : -1;
  if (heroIdx < 0) heroIdx = kept.findIndex(heroSaneAr);
  if (heroIdx < 0) heroIdx = 0;
  if (heroIdx > 0) {
    const [h] = kept.splice(heroIdx, 1);
    kept.unshift(h);
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
export async function acquirePhotos(
  row,
  enrichment,
  { destDir, slug, ownMax = 12, min = 2, skipWikimedia = false, heroHint, siteUrl, deepCrawlPages = 10 } = {},
) {
  const facts = {
    name: row.name,
    category: row.category,
    area: [row.city, row.state].filter(Boolean).join(', '),
    city: row.city,
  };

  // Tier 1: their OWN photos. Source the candidate pool from BOTH the homepage
  // scrape (enrichment.images — which carries the og:image / intended hero) AND a
  // DEEP CRAWL of their gallery / portfolio / menu / about subpages, where the
  // strongest shots usually live. Both come from the business's own domain, so
  // the pool stays "genuinely theirs" (never random web stock) while
  // autonomously surfacing far more real photos than the homepage alone.
  let ownUrls = [...(enrichment?.images ?? [])];
  if (siteUrl) {
    try {
      const deep = await collectSiteImages(siteUrl, { maxPages: deepCrawlPages });
      // enrichment.images first (hero intent), then the deep finds. The downloader
      // de-dupes by size-agnostic identity + exact bytes + perceptual hash, so the
      // same shot served across pages/sizes still counts once.
      ownUrls = [...ownUrls, ...deep];
    } catch {
      /* deep crawl is best-effort — homepage photos still apply on failure */
    }
  }

  let media = await downloadScrapedPhotos(ownUrls, {
    destDir,
    slug,
    max: ownMax,
    // Consider a large candidate pool from the deep crawl, then keep the best
    // `ownMax` after scoring/relevance/dedup — "as many of THEIR real photos as
    // we can find," without ever padding with stock.
    maxCandidates: 160,
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

  return { media, source: source || 'library' };
}
