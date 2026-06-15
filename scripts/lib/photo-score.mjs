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

/**
 * Assess one image buffer.
 * @returns {Promise<{ok:boolean, score:number, isGraphic:boolean, reason:string,
 *   entropy:number, meanStdev:number, w:number, h:number, ar:number, hasAlpha:boolean,
 *   dynamicRange:number, faded:boolean, satSpread:number}>}
 *   score is 0..1 (higher = better photo); isGraphic flags logo/screenshot/art;
 *   faded flags a washed/low-contrast photo (never headlines; sinks in ranking).
 */
export async function scorePhoto(buf) {
  let meta;
  let stats;
  try {
    const img = sharp(buf, { failOn: 'none' });
    meta = await img.metadata();
    stats = await img.stats();
  } catch {
    return { ok: false, score: 0, isGraphic: true, reason: 'undecodable', entropy: 0, meanStdev: 0, w: 0, h: 0, ar: 1, hasAlpha: false, dynamicRange: 0, faded: false, satSpread: 0 };
  }

  const w = meta.width || 0;
  const h = meta.height || 0;
  const ar = w && h ? w / h : 1;
  const entropy = stats.entropy ?? 0; // ~0..8; photos high, flat graphics low
  const hasAlpha = Boolean(meta.hasAlpha) || stats.isOpaque === false;

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
  // High entropy means real photographic detail even when contrast is low (fog,
  // night, monochrome), so the "flat" signals must NOT veto a high-entropy image.
  const photographic = entropy >= 5.5;
  const isGraphic =
    !photographic &&
    ((hasAlpha && entropy < 5.2) || // transparent + not richly detailed → logo/icon
      entropy < 3.6 || // extremely flat → illustration/logo
      meanStdev < 26 || // almost no tonal variation → UI/flat fill
      reasons.length >= 2); // multiple weak signals stack into a verdict

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

  return { ok: true, score, isGraphic, reason: reasons.join(',') || 'photo', entropy, meanStdev, w, h, ar, hasAlpha, dynamicRange, faded, satSpread };
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
