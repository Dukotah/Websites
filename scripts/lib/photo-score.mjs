/**
 * photo-score.mjs — key-free photo-quality judgment for the scrape pipeline.
 *
 * The size filter in images.mjs (≥600×360) drops obvious icons, but plenty of
 * junk slips through at full size: logos on a white card, UI screenshots, flat
 * illustrations, banner graphics. Only LOOKING at the pixels can tell those from
 * a real photograph — and we have no vision API (Pro plan, no key). So we use
 * Sharp's cheap pixel statistics as a photographic-ness proxy:
 *
 *   • entropy        — flat graphics/logos have low histogram entropy; photos high
 *   • channel stdev  — real photos carry rich tonal variation; UI/flat art doesn't
 *   • transparency   — a real photo is never transparent; logos/icons usually are
 *   • aspect ratio   — extreme banners are decoration, not photography
 *
 * It ALSO judges FADE/WASH — a real photograph whose source was exported
 * low-contrast (the Joon/Petaluma failure) is high-entropy (so the graphic gate
 * passes it) but lives in a compressed tonal band: narrow dynamic range + low
 * contrast + everything clustered near mid-grey. Those photos read washed-out in
 * a gallery and must NEVER headline. We detect that from the SAME pixel stats
 * (no extra Sharp pass) and penalise it independently of the entropy rescue.
 *
 * It ALSO judges SHARPNESS — a real photograph can be in-frame, congruent and
 * vivid yet still FUZZY: shot out of focus, motion-blurred, or (the common web
 * case) a tiny thumbnail upscaled by the source CMS to look "big". A blurry hero
 * ruins the page worse than no photo at all (owner vision: NEVER ship a bad
 * photo). We detect fuzziness key-free from a Laplacian-variance proxy — the
 * high-frequency energy in the luminance channel. A sharp photo has crisp edges
 * → high Laplacian variance; a fuzzy/upscaled one has soft edges → low variance.
 * We pair that with a hard MIN-RESOLUTION floor (a real hero/gallery photo must
 * carry enough true pixels) so an upscaled-and-soft frame can never headline.
 *
 * Plus a perceptual dHash so the same shot at a different size/crop/recompression
 * is caught as a duplicate (exact byte-hash in images.mjs only catches identical
 * files). All thresholds calibrated against the real prospect photo set.
 */
import sharp from 'sharp';

// ── fade/wash thresholds (key-free, calibrated; tunable) ─────────────────────
// A vivid photo spans ~0.85-1.0 of the 0..255 range across RGB; a faded export
// lives in a compressed band (e.g. 60-200) → ~0.55-0.72.
const FADED_DR = 0.72; // dynamicRange below this is suspect
// Slightly UNDER the existing flat-tones gate (38) so `faded` is a distinct,
// stricter signal than `isGraphic`'s tonal floor.
const FADED_STDEV = 34; // meanStdev below this is suspect

// ── sharpness / resolution thresholds (key-free, calibrated; tunable) ────────
// SHARPNESS is measured as the VARIANCE of a 3×3 Laplacian over a fixed-size
// grayscale raster (normalized 0..1 luminance). A crisp photo carries strong
// high-frequency edge energy (variance well above the floor); a fuzzy/out-of-
// focus/upscaled frame is soft → low variance. Measured on a FIXED 256px raster
// so the threshold is resolution-independent (a small sharp photo and a large
// sharp photo both clear it; an upscaled-soft one fails regardless of its
// nominal size). Calibrated against the real prospect set: genuine storefront/
// product photos land ~0.0009–0.01; blurred/upscaled frames sit below ~0.0006.
const SHARP_RASTER = 256;   // fixed analysis raster (px per side)
const SHARP_MIN = 0.0006;   // Laplacian variance below this reads FUZZY
// MIN RESOLUTION floor (hard): a real photograph that's eligible to headline or
// fill a gallery tile must carry at least this many TRUE source pixels. Below it
// the image is a thumbnail/icon that would upscale and blur — independent of the
// per-slot SLOT_CONTRACT floors in photo-art.mjs (those gate the RENDER box; this
// gates ELIGIBILITY at score time so a fuzzy thumb never even enters the pool).
const MIN_PHOTO_W = 640;
const MIN_PHOTO_H = 360;

/**
 * Assess one image buffer.
 * @returns {Promise<{ok:boolean, score:number, isGraphic:boolean, reason:string,
 *   entropy:number, meanStdev:number, w:number, h:number, ar:number, hasAlpha:boolean,
 *   dynamicRange:number, faded:boolean, satSpread:number, sharpness:number,
 *   fuzzy:boolean, lowRes:boolean}>}
 *   score is 0..1 (higher = better photo); isGraphic flags logo/screenshot/art;
 *   faded flags a washed/low-contrast photo (never headlines; sinks in ranking);
 *   fuzzy flags a soft/out-of-focus/upscaled photo (NEVER eligible for a slot);
 *   lowRes flags a below-floor source (too few true pixels to ship sharp).
 */
export async function scorePhoto(buf) {
  let meta;
  let stats;
  try {
    const img = sharp(buf, { failOn: 'none' });
    meta = await img.metadata();
    stats = await img.stats();
  } catch {
    return { ok: false, score: 0, isGraphic: true, reason: 'undecodable', entropy: 0, meanStdev: 0, w: 0, h: 0, ar: 1, hasAlpha: false, dynamicRange: 0, faded: false, satSpread: 0, sharpness: 0, fuzzy: true, lowRes: true };
  }

  const w = meta.width || 0;
  const h = meta.height || 0;
  const ar = w && h ? w / h : 1;
  const entropy = stats.entropy ?? 0; // ~0..8; photos high, flat graphics low
  const hasAlpha = Boolean(meta.hasAlpha) || stats.isOpaque === false;

  // SHARPNESS (Laplacian variance over a fixed-size luminance raster) + the hard
  // MIN-RESOLUTION floor. A fuzzy OR below-floor photo is barred from any slot.
  const sharpness = await laplacianVariance(buf);
  const fuzzy = sharpness < SHARP_MIN;
  const lowRes = w > 0 && h > 0 && (w < MIN_PHOTO_W || h < MIN_PHOTO_H);

  const rgb = stats.channels.slice(0, 3);
  const meanStdev = rgb.reduce((a, c) => a + c.stdev, 0) / (rgb.length || 1);

  // --- fade/wash signals (reuse the per-channel min/max/mean already on `stats`) ---
  // dynamicRange: how much of the 0..255 range the pixels actually span, averaged
  // over RGB. A vivid photo ~0.85-1.0; a washed export sits in a narrow band.
  const dynamicRange = rgb.reduce((a, c) => a + ((c.max - c.min) / 255), 0) / (rgb.length || 1);
  // midBias: how close the channel means cling to mid-grey (128). A washed image
  // pulls every channel toward 128. 1 = dead-centre grey, 0 = pushed to an extreme.
  const midBias = rgb.reduce((a, c) => a + (1 - clamp01(Math.abs(c.mean - 128) / 128)), 0) / (rgb.length || 1);
  // satSpread: a key-free saturation PROXY — the spread between the brightest and
  // darkest channel MEANS. Weak on its own (a grey scene and a B&W photo both read
  // low), so it is ONLY ever a tie-breaker, never a gate. This is what keeps
  // intentional B&W safe: B&W has near-zero satSpread but HIGH stdev + wide DR.
  const meanR = rgb[0]?.mean ?? 0, meanG = rgb[1]?.mean ?? 0, meanB = rgb[2]?.mean ?? 0;
  const satSpread = (Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB)) / 255;
  // FADED verdict — narrow dynamic range AND low contrast must BOTH hold. The
  // conjunction is deliberate: it lets a high-contrast B&W photo (low sat, but
  // wide DR + high stdev) PASS while catching a genuinely washed colour export.
  // High midBias reinforces it but isn't required (a faded photo skewed warm
  // still fails on DR+stdev). Computed INDEPENDENTLY of the entropy rescue below:
  // a faded photo is high-entropy by definition (that IS the Joon/Petaluma mode),
  // so entropy must never override this.
  const faded = dynamicRange < FADED_DR && meanStdev < FADED_STDEV;

  // --- classify: is this decoration (logo / screenshot / flat art) not a photo? ---
  const reasons = [];
  if (hasAlpha) reasons.push('transparent');
  if (entropy < 4.2) reasons.push('low-entropy');
  if (meanStdev < 38) reasons.push('flat-tones');
  if (ar >= 4 || ar <= 0.32) reasons.push('banner-aspect');
  if (fuzzy) reasons.push('fuzzy');
  // NB: lowRes is reported on the return but deliberately NOT pushed into
  // `reasons` — it must not contribute to the isGraphic 2-signal stack (see below),
  // since this score also runs on legitimately-small cropped OUTPUT files.
  // High entropy means real photographic detail even when contrast is low (fog,
  // night, monochrome), so the "flat" signals must NOT veto a high-entropy image.
  const photographic = entropy >= 5.5;
  // isGraphic now ALSO rejects FUZZY frames: a soft/out-of-focus image is not
  // slot-eligible no matter how photographic it reads (a high-entropy but out-of-
  // focus storefront is still a bad hero). Every caller that gates on
  // `!q.isGraphic` (downloadScrapedPhotos, downloadOsmPhotos) drops fuzzy photos
  // for free, and the photographic rescue can NEVER override a fuzzy verdict.
  //
  // `lowRes` is INTENTIONALLY NOT folded into isGraphic: this score runs on both
  // raw SOURCE buffers (where small = "would upscale, reject") AND on already-
  // CROPPED OUTPUT files (where a portrait gallery/hero-split tile is legitimately
  // ~600-1000px wide — it cleared the per-slot SLOT_CONTRACT minW at SOURCE time
  // and was downscaled to its box). Folding lowRes here would re-reject those
  // valid small outputs. So the resolution floor is enforced where it MEANS
  // "source too small" — at download time in images.mjs, which checks q.lowRes on
  // the raw bytes — while isGraphic stays output-safe (fuzz + graphic only).
  const isGraphic =
    fuzzy || // STRICT PHOTO GATE: soft → never a slot photo (source OR output)
    (!photographic &&
      ((hasAlpha && entropy < 5.2) || // transparent + not richly detailed → logo/icon
        entropy < 3.6 || // extremely flat → illustration/logo
        meanStdev < 26 || // almost no tonal variation → UI/flat fill
        reasons.length >= 2)); // multiple weak signals stack into a verdict

  // --- photographic quality score (0..1) for ranking the survivors ---
  const area = w * h;
  const entropyScore = clamp01(entropy / 6.5);
  const tonalScore = clamp01(meanStdev / 70);
  const arScore = ar >= 1.3 && ar <= 2.2 ? 1 : ar >= 0.9 ? 0.7 : ar >= 0.55 ? 0.5 : 0.25;
  const areaScore = clamp01(area / (1600 * 1000));
  // drScore folds dynamic range into ranking so a vivid photo always outranks a
  // washed one even among non-faded survivors (DR 0.5 → 0, DR 0.9+ → 1).
  const drScore = clamp01((dynamicRange - 0.5) / 0.4);
  // entropy/area trimmed slightly to make room for drScore (weights sum to 1) —
  // no new Sharp work, all from the same `stats`.
  let score = 0.38 * entropyScore + 0.16 * tonalScore + 0.14 * drScore + 0.16 * arScore + 0.16 * areaScore;
  if (isGraphic) score *= 0.15; // heavy penalty, but keep > 0 as a last-resort fallback
  // A faded photo still beats nothing (last-resort), but sinks below every vivid
  // one — same philosophy as the isGraphic penalty. Independent of `isGraphic`.
  if (faded) score *= 0.35;
  // A FUZZY photo is the WORST kind to ship (the owner-vision red line), so its
  // score is crushed even harder than a graphic — it must lose to every sharp
  // alternative AND read as "last resort, prefer nothing" in any ranking. (lowRes
  // is NOT crushed here: at SOURCE time images.mjs drops it outright; at OUTPUT
  // time a small-but-sharp cropped tile is fine and shouldn't be sunk.)
  if (fuzzy) score *= 0.1;

  return { ok: true, score, isGraphic, reason: reasons.join(',') || 'photo', entropy, meanStdev, w, h, ar, hasAlpha, dynamicRange, faded, satSpread, sharpness, fuzzy, lowRes };
}

/**
 * Laplacian variance — a key-free SHARPNESS / focus proxy. Resize to a fixed
 * SHARP_RASTER grayscale raster (so the measure is resolution-independent), then
 * convolve a 3×3 Laplacian (the discrete second derivative) and return the
 * VARIANCE of the response normalized to 0..1 luminance. High variance = crisp
 * edges (in focus); low variance = soft/blurred/upscaled. Fails soft to 0
 * (treated as fuzzy) on any decode/convolve error.
 *
 * @param {Buffer} buf
 * @returns {Promise<number>} Laplacian-response variance (≈0..0.05 in practice)
 */
async function laplacianVariance(buf) {
  try {
    const { data, info } = await sharp(buf, { failOn: 'none' })
      .grayscale()
      .resize(SHARP_RASTER, SHARP_RASTER, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width || 0;
    const h = info.height || 0;
    const ch = info.channels || 1;
    if (w < 3 || h < 3) return 0;
    // Luminance at (x,y), normalized 0..1 (first channel of the grayscale raster).
    const lum = (x, y) => data[(y * w + x) * ch] / 255;
    // 3×3 Laplacian kernel (4-neighbour): center*4 - up - down - left - right.
    // Accumulate the response and its square over the interior so we never index
    // out of bounds, then take variance = E[r²] - E[r]².
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const r =
          4 * lum(x, y) - lum(x - 1, y) - lum(x + 1, y) - lum(x, y - 1) - lum(x, y + 1);
        sum += r;
        sumSq += r * r;
        n++;
      }
    }
    if (n === 0) return 0;
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return variance > 0 ? variance : 0;
  } catch {
    return 0; // fail soft → reads as fuzzy (the safe direction: omit over ship-bad)
  }
}

/**
 * Perceptual difference hash (64-bit). Resize to 9×8 grayscale and compare each
 * pixel to its right neighbour → one bit per comparison. Robust to scaling and
 * recompression, so resized variants of one photo collide.
 */
export async function dhash(buf) {
  try {
    const raw = await sharp(buf, { failOn: 'none' })
      .grayscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer();
    let bits = 0n;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const i = row * 9 + col;
        bits = (bits << 1n) | (raw[i] < raw[i + 1] ? 1n : 0n);
      }
    }
    return bits;
  } catch {
    return null;
  }
}

/** Hamming distance between two dHashes (0 = identical, 64 = opposite). */
export function hamming(a, b) {
  if (a == null || b == null) return 64;
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Two images are "the same shot" when their dHashes are within this distance. */
export const NEAR_DUP_DISTANCE = 8;

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
