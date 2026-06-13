/**
 * photo-art.mjs — deterministic, key-free "art direction" for hero photos.
 *
 * Scraped photos are honest but rarely *composed*: a wide shot cropped dead-
 * centre buries the subject, and raw frames clash with the page's palette. This
 * module fixes both, with no vision API and no network — only Sharp pixel ops:
 *
 *   • focalCrop()  — recompose to a target aspect using Sharp's content-aware
 *     crop (attention/entropy strategy) so the SUBJECT lands in frame, not an
 *     arbitrary middle slice. This is the same `position: 'attention'` trick the
 *     thumbnail maker uses, generalised to any aspect.
 *   • applyGrade() — lay a subtle, palette-derived dark scrim + duotone tint so
 *     the hero reads as deliberately graded (and overlaid white text stays
 *     legible) instead of a bare stock frame.
 *   • gradeForCategory() — pick a gentle tint from the business category alone,
 *     so the grade is deterministic and matches the page's brand temperature
 *     WITHOUT importing the build-time palette (a different module, owned
 *     elsewhere). Generation-time code has only facts (category/name), so we
 *     derive from those.
 *
 * Everything here is pure given its inputs (buffer in → buffer out) and fully
 * deterministic — same photo + same facts → byte-identical output every run.
 */
import sharp from 'sharp';

/**
 * Recompose `buf` to `aspect` (w/h) at up to `width`px using a content-aware
 * crop so the photo's subject — not a centred slice — fills the hero. Sharp's
 * `attention` strategy favours regions of high luminance/saturation/skin-tone;
 * `entropy` favours the busiest region. Best-effort: any failure returns the
 * original bytes unchanged so the pipeline never loses a usable photo.
 *
 * @param {Buffer} buf
 * @param {{aspect?:number, width?:number, strategy?:'attention'|'entropy', format?:'jpeg'|'webp'|'png'}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function focalCrop(buf, { aspect = 16 / 9, width = 1600, strategy = 'attention', format } = {}) {
  try {
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    const srcW = meta.width || 0;
    const srcH = meta.height || 0;
    if (!srcW || !srcH) return buf;

    // Never upscale: a hero source smaller than the target reads fuzzy when
    // blown up. Cap the output at the source width so we only ever down-sample.
    const outW = Math.min(width, srcW);
    const outH = Math.max(1, Math.round(outW / aspect));

    // `position: strategy` makes resize(cover) pick the crop window by content
    // instead of centring — that's the focal-point crop.
    const pos = strategy === 'entropy' ? sharp.strategy.entropy : sharp.strategy.attention;
    let pipeline = img.resize(outW, outH, { fit: 'cover', position: pos });

    // Preserve the source codec by default (JPEG photos stay JPEG); callers that
    // want a specific output can force it. Re-encode deterministically.
    const fmt = format || (meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg');
    if (fmt === 'png') pipeline = pipeline.png();
    else if (fmt === 'webp') pipeline = pipeline.webp({ quality: 82 });
    else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });

    return await pipeline.toBuffer();
  } catch {
    return buf; // fail soft — original photo is still better than nothing
  }
}

// Gentle duotone tints keyed to the brand temperature each category reads as.
// Kept SUBTLE on purpose (low strength): the photo must stay a photo, the tint
// just nudges it toward the page's palette and unifies a mixed-source gallery.
// Shadow = the deep tone pushed into darks; highlight = the warm/cool cast on
// lights. RGB triplets, 0..255. Deterministic lookup, no palette import.
const TINTS = {
  warm:    { shadow: [38, 24, 16], highlight: [255, 246, 232] }, // amber/sepia — food, hospitality, craft
  cool:    { shadow: [16, 24, 38], highlight: [232, 242, 255] }, // steel/blue — trades, auto, marine
  green:   { shadow: [16, 30, 20], highlight: [236, 248, 238] }, // foliage — landscaping, outdoors
  neutral: { shadow: [22, 22, 26], highlight: [244, 244, 248] }, // graphite — default / clean kits
};

// Category → temperature. Mirrors the design kits' intent (bold/cool trades vs
// elegant/warm hospitality) so the photo grade agrees with the page chrome,
// derived purely from the category string available at generation time.
const TEMP_BY_CATEGORY = {
  cafe: 'warm', restaurant: 'warm', winery: 'warm', bakery: 'warm', salon: 'warm', spa: 'warm', barber: 'warm',
  plumbing: 'cool', electrician: 'cool', hvac: 'cool', roofing: 'cool', contractor: 'cool',
  'auto-repair': 'cool', towing: 'cool', marina: 'cool', cleaning: 'cool',
  landscaping: 'green',
};

/**
 * Pick a subtle duotone grade for a business category (deterministic). Unknown
 * categories fall back to a neutral graphite grade. Returns the tint plus a
 * default scrim/strength tuned for hero legibility.
 *
 * @param {string} [category]
 * @returns {{shadow:number[], highlight:number[], scrim:number, strength:number}}
 */
export function gradeForCategory(category) {
  const key = (category || '').toLowerCase().trim();
  const temp = TEMP_BY_CATEGORY[key] || 'neutral';
  const tint = TINTS[temp] || TINTS.neutral;
  return {
    shadow: tint.shadow,
    highlight: tint.highlight,
    // scrim: opacity of a bottom-weighted dark gradient (0..1) so overlaid white
    // hero text stays readable. strength: how far to pull the photo toward the
    // duotone (0 = untouched, 1 = full duotone). Both kept low = subtle.
    scrim: 0.28,
    strength: 0.18,
  };
}

const clampByte = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

/**
 * Apply a subtle palette-derived grade to a hero photo: a light duotone tint
 * (blend toward shadow/highlight tones by `strength`) plus a bottom-weighted
 * dark scrim for text legibility. Pure + deterministic; fails soft to `buf`.
 *
 * @param {Buffer} buf
 * @param {{shadow:number[], highlight:number[], scrim?:number, strength?:number, format?:'jpeg'|'webp'|'png'}} grade
 * @returns {Promise<Buffer>}
 */
export async function applyGrade(buf, grade) {
  if (!grade) return buf;
  const { shadow = [22, 22, 26], highlight = [244, 244, 248], scrim = 0.28, strength = 0.18 } = grade;
  try {
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (!w || !h) return buf;

    const composites = [];

    // Duotone tint: a flat highlight-coloured layer at low opacity warms/cools
    // the whole frame toward the brand tone (cheap, deterministic, no per-pixel
    // LUT). `strength` keeps it subtle so the photo stays photographic.
    if (strength > 0) {
      const tintLayer = await sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: {
            r: clampByte(highlight[0]),
            g: clampByte(highlight[1]),
            b: clampByte(highlight[2]),
            alpha: clamp01(strength),
          },
        },
      }).png().toBuffer();
      composites.push({ input: tintLayer, blend: 'soft-light' });
    }

    // Scrim: a vertical gradient from transparent (top) to the shadow tone
    // (bottom) so headline/CTA text over the hero stays legible. Built as an SVG
    // so the gradient is exact and deterministic.
    if (scrim > 0) {
      const [sr, sg, sb] = shadow.map(clampByte);
      const a = clamp01(scrim).toFixed(3);
      const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(${sr},${sg},${sb})" stop-opacity="0"/>
      <stop offset="55%" stop-color="rgb(${sr},${sg},${sb})" stop-opacity="${(a * 0.4).toFixed(3)}"/>
      <stop offset="100%" stop-color="rgb(${sr},${sg},${sb})" stop-opacity="${a}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>`;
      composites.push({ input: Buffer.from(svg) });
    }

    if (composites.length === 0) return buf;

    let pipeline = img.composite(composites);
    const fmt = grade.format || (meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg');
    if (fmt === 'png') pipeline = pipeline.png();
    else if (fmt === 'webp') pipeline = pipeline.webp({ quality: 82 });
    else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });

    return await pipeline.toBuffer();
  } catch {
    return buf; // fail soft
  }
}

/**
 * Convenience: focal-crop a hero to a target aspect AND apply the category grade
 * in one deterministic pass. Either step fails soft to the prior buffer.
 *
 * @param {Buffer} buf
 * @param {{category?:string, aspect?:number, width?:number, strategy?:'attention'|'entropy', format?:'jpeg'|'webp'|'png', grade?:object}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function composeHero(buf, { category, aspect = 16 / 9, width = 1600, strategy = 'attention', format, grade } = {}) {
  const cropped = await focalCrop(buf, { aspect, width, strategy, format });
  const g = grade || gradeForCategory(category);
  return applyGrade(cropped, { ...g, format });
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
