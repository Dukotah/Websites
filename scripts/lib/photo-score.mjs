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
 *   • channel spread — logos/badges are dominated by one hue (wide R/G/B mean gap)
 *                      or sit on the black/white rails (masks/plates); photos don't
 *   • transparency   — a real photo is never transparent; logos/icons usually are
 *   • aspect ratio   — extreme banners are decoration, not photography
 *
 * Plus a perceptual dHash so the same shot at a different size/crop/recompression
 * is caught as a duplicate (exact byte-hash in images.mjs only catches identical
 * files). All thresholds calibrated against the real prospect photo set.
 */
import sharp from 'sharp';

/**
 * Assess one image buffer.
 * @returns {Promise<{ok:boolean, score:number, isGraphic:boolean, reason:string,
 *   entropy:number, meanStdev:number, w:number, h:number, ar:number, hasAlpha:boolean}>}
 *   score is 0..1 (higher = better photo); isGraphic flags logo/screenshot/art.
 */
export async function scorePhoto(buf) {
  let meta;
  let stats;
  try {
    const img = sharp(buf, { failOn: 'none' });
    meta = await img.metadata();
    stats = await img.stats();
  } catch {
    return { ok: false, score: 0, isGraphic: true, reason: 'undecodable', entropy: 0, meanStdev: 0, w: 0, h: 0, ar: 1, hasAlpha: false };
  }

  const w = meta.width || 0;
  const h = meta.height || 0;
  const ar = w && h ? w / h : 1;
  const entropy = stats.entropy ?? 0; // ~0..8; photos high, flat graphics low
  const hasAlpha = Boolean(meta.hasAlpha) || stats.isOpaque === false;

  const rgb = stats.channels.slice(0, 3);
  const meanStdev = rgb.reduce((a, c) => a + c.stdev, 0) / (rgb.length || 1);

  // Channel-balance signal: a real photograph carries correlated, varied colour
  // across R/G/B, so the per-channel means spread out and no single channel sits
  // pinned at an extreme. Logos / flat UI / single-hue badges are dominated by
  // one channel (or pure black/white), which shows up as a very wide gap between
  // the channels' means or a mean parked at the 0/255 rails. Cheap, no extra work.
  const means = rgb.map((c) => c.mean);
  const meanSpread = means.length ? Math.max(...means) - Math.min(...means) : 0;
  const railed = means.every((m) => m < 14 || m > 241); // every channel at a rail → solid fill / mask

  // --- classify: is this decoration (logo / screenshot / flat art) not a photo? ---
  const reasons = [];
  if (hasAlpha) reasons.push('transparent');
  if (entropy < 4.2) reasons.push('low-entropy');
  if (meanStdev < 38) reasons.push('flat-tones');
  if (ar >= 4 || ar <= 0.32) reasons.push('banner-aspect');
  if (meanSpread > 110) reasons.push('channel-skew'); // one hue dominates → brand graphic
  if (railed) reasons.push('railed-fill');
  // High entropy means real photographic detail even when contrast is low (fog,
  // night, monochrome), so the "flat" signals must NOT veto a high-entropy image.
  const photographic = entropy >= 5.5;
  const isGraphic =
    !photographic &&
    (railed || // a flat black/white/solid plate is never a photo
      (hasAlpha && entropy < 5.2) || // transparent + not richly detailed → logo/icon
      entropy < 3.6 || // extremely flat → illustration/logo
      meanStdev < 26 || // almost no tonal variation → UI/flat fill
      (meanSpread > 110 && entropy < 5.2) || // one-hue brand art that isn't richly detailed
      reasons.length >= 2); // multiple weak signals stack into a verdict

  // --- photographic quality score (0..1) for ranking the survivors ---
  const area = w * h;
  const entropyScore = clamp01(entropy / 6.5);
  const tonalScore = clamp01(meanStdev / 70);
  const arScore = ar >= 1.3 && ar <= 2.2 ? 1 : ar >= 0.9 ? 0.7 : ar >= 0.55 ? 0.5 : 0.25;
  const areaScore = clamp01(area / (1600 * 1000));
  let score = 0.42 * entropyScore + 0.2 * tonalScore + 0.2 * arScore + 0.18 * areaScore;
  if (isGraphic) score *= 0.15; // heavy penalty, but keep > 0 as a last-resort fallback

  return { ok: true, score, isGraphic, reason: reasons.join(',') || 'photo', entropy, meanStdev, w, h, ar, hasAlpha };
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
