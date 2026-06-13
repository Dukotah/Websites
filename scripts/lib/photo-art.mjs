/**
 * photo-art.mjs — deterministic, key-free "art direction" for hero photos.
 *
 * Scraped photos are honest but rarely *composed*: a wide shot cropped dead-
 * centre buries the subject, and raw frames clash with the page's palette. This
 * module fixes both, with no vision API and no network — only local pixel ops:
 *
 *   • focalCrop()  — recompose to a target aspect using smartcrop (content-,
 *     face- and saturation-aware) to pick the best crop WINDOW, then Sharp
 *     extract()+resize() into the slot box. smartcrop keeps storefronts, faces
 *     and products in frame far better than an arbitrary middle slice or a raw
 *     edge-energy grid; it's the same family of heuristic the browser smartcrop
 *     demo uses, run server-side over Sharp. Local + deterministic (no model
 *     download, no network).
 *   • computeFocal() — derive the focal point {fx,fy} from the CENTRE of
 *     smartcrop's chosen region relative to the source, so the render-side
 *     object-position still tracks the subject when cover re-crops at a viewport
 *     whose aspect differs from the build crop. (A standalone edge-energy
 *     fallback is kept for buffers we crop without a smartcrop region.)
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
// smartcrop-sharp (MIT) — content/face/saturation-aware crop-window picker built
// on Sharp. `smartcrop.crop(buffer, { width, height })` analyses the source and
// returns `{ topCrop: { x, y, width, height } }`: the best source-pixel region
// whose w/h ratio matches the requested width/height. Pure, local, deterministic
// (no model download, no network call) — safe for the key-free factory.
import smartcrop from 'smartcrop-sharp';

/**
 * LOCKED IMAGE CONTRACT — the single source of truth shared by the build-crop
 * (here) and the render-box (the Astro <SiteImage> components) so a slot's
 * target aspect + resolution floor never drift between the two. Every agent and
 * every code path that touches a photo MUST read these EXACT values.
 *
 *   • aspect = width / height of the slot's render box (the crop target).
 *   • minW   = minimum SOURCE width to be usable. We never upscale, so a source
 *              below the floor reads fuzzy/blown-up → it's declared UNUSABLE and
 *              the caller falls back (library art / a text hero).
 *
 * Slots:
 *   hero-fullbleed — cinematic/statement/collage full-bleed hero (16:9, ≥1600).
 *   hero-split     — the side photo column in split/editorial heroes (4:5, ≥1000).
 *   story          — the About side image (4:5, ≥900).
 *   gallery        — gallery / feature tiles (4:3, ≥640).
 */
export const SLOT_CONTRACT = {
  'hero-fullbleed': { aspect: 16 / 9, minW: 1600 },
  'hero-split':     { aspect: 4 / 5,  minW: 1000 },
  story:            { aspect: 4 / 5,  minW: 900 },
  gallery:          { aspect: 4 / 3,  minW: 640 },
};

// Fallback contract for an unknown slot name — treat it as a gallery tile (the
// most permissive floor) so a typo never silently kills an otherwise-fine photo.
const DEFAULT_SLOT = SLOT_CONTRACT.gallery;

/**
 * LOCKED HERO-PHOTO TIER CONTRACT — map a hero SOURCE width to the tier that
 * decides HOW the real photo is shown (never upscaling). This is the single
 * source of truth both acquisition paths in images.mjs read, and the generator
 * surfaces as config.artDirection.heroPhotoTier so divergence/compose obey it.
 *
 *   • width >= 1600 → 'fullbleed' — big enough for any hero incl. cinematic
 *                     full-bleed; cropped 16/9 (hero-fullbleed slot).
 *   • width >= 1000 → 'side' — KEEP the real photo (it's the "that's my
 *                     business" hook) but render it in a side-column hero where
 *                     it displays smaller and stays sharp; cropped 4/5
 *                     (hero-split slot). NEVER cinematic/full-bleed.
 *   • else          → 'none' — genuinely too small; DROP the photo → text hero.
 *
 * @param {number} [srcW] hero source width in px (0/undefined → 'none')
 * @returns {'fullbleed'|'side'|'none'}
 */
export function heroTierForWidth(srcW) {
  const w = Number(srcW) || 0;
  if (w >= SLOT_CONTRACT['hero-fullbleed'].minW) return 'fullbleed';
  if (w >= SLOT_CONTRACT['hero-split'].minW) return 'side';
  return 'none';
}

// The processing slot a hero tier maps to. 'none' has no slot (the photo is
// dropped). Keeps the tier→slot mapping in one place next to the contract.
export const HERO_SLOT_BY_TIER = {
  fullbleed: 'hero-fullbleed',
  side: 'hero-split',
  none: null,
};

/**
 * Re-encode a Sharp pipeline deterministically to a chosen (or source-derived)
 * codec. Shared by the crop + grade paths so quality settings never drift.
 * Photographic PNG is intentionally NOT promoted here — that promotion belongs
 * to processSlot's PNG-bloat policy; this helper just honours what it's given.
 */
function encodeAs(pipeline, fmt) {
  if (fmt === 'png') return pipeline.png();
  if (fmt === 'webp') return pipeline.webp({ quality: 82 });
  return pipeline.jpeg({ quality: 82, mozjpeg: true });
}

/**
 * Core crop: pick the best crop WINDOW for `aspect` with smartcrop, extract it,
 * and resize into the slot box — returning BOTH the cropped buffer and the
 * focal point derived from the chosen region's centre. This is the single place
 * the smartcrop call lives; focalCrop() and processSlot() both route through it
 * so the shipped pixels and the focal point can never disagree.
 *
 * smartcrop is content-/face-/saturation-aware, so the window keeps storefronts,
 * faces and products in frame instead of an arbitrary middle slice. We ask it
 * for a region at the slot's OUTPUT aspect; smartcrop returns the best-matching
 * source region (its `topCrop`), which we extract and then downscale to the box.
 *
 * NEVER UPSCALES. The output is capped at BOTH the requested width AND the
 * extracted region's own width, so we only ever shrink the chosen pixels. That
 * matters when the target aspect can't fill the source (e.g. a portrait 4:5 slot
 * on a landscape source): smartcrop's region is then narrower than `width`, so
 * the true output is smaller — and we report those REAL dimensions back, because
 * the caller writes them as the image's intrinsic w/h and they must match the
 * actual pixels exactly.
 *
 * Best-effort — any failure (decode error, smartcrop throw) falls back to a
 * centred Sharp cover crop and a centre focal, so the pipeline never loses a
 * usable photo. Returns the cropped buffer, the focal point (region centre as a
 * 0..1 fraction of the SOURCE), and the ACTUAL output width/height.
 *
 * @param {Buffer} buf
 * @param {{aspect:number, width:number, format?:'jpeg'|'webp'|'png'}} opts
 * @returns {Promise<{buf:Buffer, focal:{fx:number,fy:number}, width:number, height:number}>}
 */
async function smartCropToSlot(buf, { aspect, width, format }) {
  try {
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    const srcW = meta.width || 0;
    const srcH = meta.height || 0;
    if (!srcW || !srcH) return { buf, focal: { ...DEFAULT_FOCAL }, width: srcW, height: srcH };

    // The largest box at the slot aspect we'd ASK for: capped at the source width
    // so we never request more than exists. The real output may be smaller still
    // (see below) when the chosen region is narrower than this.
    const reqW = Math.min(width, srcW);
    const reqH = Math.max(1, Math.round(reqW / aspect));

    const fmt = format || (meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg');

    // Ask smartcrop for the best region at the OUTPUT aspect. It returns a
    // source-pixel rectangle { x, y, width, height } whose ratio ≈ reqW/reqH.
    let region;
    try {
      const result = await smartcrop.crop(buf, { width: reqW, height: reqH });
      region = result?.topCrop;
    } catch {
      region = null; // smartcrop unhappy with this frame → centred fallback below
    }

    // The crop window in source pixels. Default to the full frame (centred) if
    // smartcrop declined. Clamp inside the source (defensive — a rounded edge
    // could otherwise spill a pixel over the bound and make Sharp's extract throw).
    let cropX = 0, cropY = 0, cropW = srcW, cropH = srcH, focal = { ...DEFAULT_FOCAL };
    if (region && region.width > 0 && region.height > 0) {
      cropW = Math.min(srcW, Math.max(1, Math.round(region.width)));
      cropH = Math.min(srcH, Math.max(1, Math.round(region.height)));
      cropX = Math.min(srcW - cropW, Math.max(0, Math.round(region.x)));
      cropY = Math.min(srcH - cropH, Math.max(0, Math.round(region.y)));
      // FOCAL POINT: the CENTRE of the chosen region as a 0..1 fraction of the
      // SOURCE. object-position uses this so the subject stays framed when cover
      // re-crops at a viewport aspect that differs from this build crop.
      focal = {
        fx: clamp01((cropX + cropW / 2) / srcW),
        fy: clamp01((cropY + cropH / 2) / srcH),
      };
    }

    // OUTPUT SIZE: never enlarge the extracted region. Cap the output width at the
    // region width (and the requested width), then derive height from the slot
    // aspect EXACTLY (so w/h is always the contract ratio, not the region's
    // rounding). resize(cover) shrinks the region into this box, trimming only the
    // tiny rounding slack — never upscaling.
    const outW = Math.max(1, Math.min(reqW, cropW));
    const outH = Math.max(1, Math.round(outW / aspect));

    const pipeline = img
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .resize(outW, outH, { fit: 'cover' });

    const out = await encodeAs(pipeline, fmt).toBuffer();
    return { buf: out, focal, width: outW, height: outH };
  } catch {
    // Total failure (decode/extract) → fall back to a plain centred cover crop
    // so we still ship a correctly-sized frame, with a neutral centre focal.
    try {
      const img = sharp(buf, { failOn: 'none' });
      const meta = await img.metadata();
      const srcW = meta.width || 0;
      const srcH = meta.height || 0;
      if (!srcW || !srcH) return { buf, focal: { ...DEFAULT_FOCAL }, width: srcW, height: srcH };
      // Centred cover crop. Cap height at the source too so a portrait box on a
      // landscape source still never upscales (mirror of the region cap above).
      let outW = Math.min(width, srcW);
      let outH = Math.max(1, Math.round(outW / aspect));
      if (outH > srcH) { outH = srcH; outW = Math.max(1, Math.round(outH * aspect)); }
      const fmt = format || (meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg');
      const out = await encodeAs(img.resize(outW, outH, { fit: 'cover' }), fmt).toBuffer();
      return { buf: out, focal: { ...DEFAULT_FOCAL }, width: outW, height: outH };
    } catch {
      return { buf, focal: { ...DEFAULT_FOCAL }, width: 0, height: 0 }; // original bytes
    }
  }
}

/**
 * Recompose `buf` to `aspect` (w/h) at up to `width`px using smartcrop's
 * content-aware crop so the photo's SUBJECT — not a centred slice — fills the
 * hero. Thin wrapper over smartCropToSlot that returns just the buffer, kept for
 * callers (e.g. composeHero) that only need the recomposed bytes. Best-effort:
 * any failure returns a centred crop or the original bytes — never drops a photo.
 *
 * The legacy `strategy` arg ('attention'|'entropy') is accepted for call-site
 * compatibility but no longer used: smartcrop's single content-aware heuristic
 * replaces the old Sharp attention/entropy strategies for every slot.
 *
 * @param {Buffer} buf
 * @param {{aspect?:number, width?:number, strategy?:'attention'|'entropy', format?:'jpeg'|'webp'|'png'}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function focalCrop(buf, { aspect = 16 / 9, width = 1600, format } = {}) {
  const { buf: out } = await smartCropToSlot(buf, { aspect, width, format });
  return out;
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

// Default focal point: dead centre. Used on any failure (fail soft) and as the
// neutral value for library/SVG/text heroes that have no photographic subject.
const DEFAULT_FOCAL = { fx: 0.5, fy: 0.5 };

/**
 * Turn a {fx,fy} focal point into a CSS object-position STRING "X% Y%" (whole
 * percents), e.g. {fx:0.52, fy:0.38} → "52% 38%". The render-side <SiteImage>
 * applies this as object-position so the SUBJECT stays in frame when
 * object-fit:cover re-crops at a viewport whose aspect differs from the build
 * crop. Defaults to "50% 50%" on a missing/invalid focal.
 *
 * @param {{fx?:number, fy?:number}} [focal]
 * @returns {string}
 */
export function focalToCss(focal) {
  const fx = Number(focal?.fx);
  const fy = Number(focal?.fy);
  const x = Number.isFinite(fx) ? clamp01(fx) : 0.5;
  const y = Number.isFinite(fy) ? clamp01(fy) : 0.5;
  return `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
}

/**
 * FOCAL-POINT FALLBACK — compute a deterministic, key-free focal point {fx,fy}
 * (0..1 fractions of width/height) marking where the SUBJECT sits in `buf`.
 *
 * The PRIMARY focal point now comes from smartcrop's chosen region centre (see
 * smartCropToSlot / processSlot), which agrees with the actual crop window. This
 * edge-energy estimate is kept as a standalone fallback for buffers that were
 * NOT produced by a smartcrop pass (or where the region was unavailable), so any
 * caller can still ask "where's the subject?" without a model or network.
 *
 *   1. Downscale to a tiny grayscale raster (Sharp, deterministic).
 *   2. Over an 8x8 grid of cells, measure per-cell EDGE/CONTRAST energy — the
 *      sum of absolute luminance differences to the right/down neighbours
 *      (a cheap Sobel-ish gradient). Busy, high-contrast regions (the subject)
 *      carry more energy than flat sky/wall.
 *   3. Take the energy-WEIGHTED CENTROID of the grid → {fx,fy}, the cell centre
 *      coordinates weighted by each cell's energy.
 *
 * Computed on whatever bytes are passed; pass the OUTPUT/cropped buffer so the
 * focal matches the rendered pixels. Fails soft to {0.5,0.5} on any
 * decode/processing error (or a flat image with zero total energy).
 *
 * @param {Buffer} buf
 * @returns {Promise<{fx:number, fy:number}>}
 */
export async function computeFocal(buf) {
  try {
    // Downscale to a small grayscale raster. The grid is 8x8; we sample at 64px
    // per side (8 px/cell) so each cell has interior pixels for gradient energy.
    const GRID = 8;
    const PX_PER_CELL = 8;
    const N = GRID * PX_PER_CELL; // 64
    const { data, info } = await sharp(buf, { failOn: 'none' })
      .resize(N, N, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width || 0;
    const h = info.height || 0;
    const ch = info.channels || 1;
    if (!w || !h) return { ...DEFAULT_FOCAL };

    // Luminance at (x,y) — first channel of the (grayscale) raw raster.
    const lum = (x, y) => data[(y * w + x) * ch];

    // Per-cell edge/contrast energy on the GRID x GRID grid.
    const cellW = w / GRID;
    const cellH = h / GRID;
    const energy = new Float64Array(GRID * GRID);
    for (let y = 0; y < h - 1; y++) {
      const cy = Math.min(GRID - 1, Math.floor(y / cellH));
      for (let x = 0; x < w - 1; x++) {
        const cx = Math.min(GRID - 1, Math.floor(x / cellW));
        const p = lum(x, y);
        // Absolute gradient to the right and down neighbours (edge strength).
        const dx = Math.abs(lum(x + 1, y) - p);
        const dy = Math.abs(lum(x, y + 1) - p);
        energy[cy * GRID + cx] += dx + dy;
      }
    }

    // Energy-weighted centroid over cell CENTRES, normalised to 0..1.
    let total = 0;
    let sx = 0;
    let sy = 0;
    for (let cy = 0; cy < GRID; cy++) {
      for (let cx = 0; cx < GRID; cx++) {
        const e = energy[cy * GRID + cx];
        if (e <= 0) continue;
        total += e;
        sx += e * ((cx + 0.5) / GRID);
        sy += e * ((cy + 0.5) / GRID);
      }
    }
    if (total <= 0) return { ...DEFAULT_FOCAL }; // flat image → centre

    return { fx: clamp01(sx / total), fy: clamp01(sy / total) };
  } catch {
    return { ...DEFAULT_FOCAL }; // fail soft
  }
}

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
 * Process ONE acquired photo for a named slot against the LOCKED CONTRACT — the
 * single entry point every caller routes a photo through, so build-crop never
 * drifts from the render-box. Steps:
 *
 *   1. Look up the slot's target aspect + minW (from SLOT_CONTRACT).
 *   2. RESOLUTION FLOOR: if the source width < minW, the photo would have to be
 *      upscaled to fill the box → it reads blurry. Return {buf:null, usable:false}
 *      so the caller falls back (library art / a clean text hero). The floor is
 *      what makes the no-blur guarantee permanent.
 *   3. Attention focal-crop to the slot aspect, capped at the source width
 *      (NEVER upscale) so we only ever down-sample a big source into the box.
 *   4. GRADE only when the slot is a hero ('hero*') — heroes carry overlaid text
 *      and want the deliberate duotone+scrim; story/gallery stay photographic.
 *
 * Fails soft like the rest of the module: any Sharp error returns the original
 * bytes (still usable) rather than dropping a good photo. The returned width/
 * height are the OUTPUT box dimensions when cropped, else the source dimensions.
 *
 * PNG BLOAT FIX: photos saved as PNG balloon (PNG is lossless — a re-encoded
 * photographic crop can be several times its JPEG/WebP source: taylor-lane
 * photo-2 went 1.7MB → 7.4MB). Every photo through this path is photographic, so
 * a PNG `format` (whether the source codec or an explicit request) is silently
 * promoted to WebP (quality 82) — far smaller at the same quality, with alpha
 * support. The chosen output format is returned as `format`/`ext` so callers can
 * rename the file + fix the descriptor path (a PNG source becomes a .webp file).
 *
 * FOCAL POINT (LOCKED CONTRACT): every usable result also carries `focal`
 * ({fx,fy} in 0..1) and a ready `focalCss` "X% Y%" string, computed on the
 * OUTPUT/cropped buffer so it matches the rendered pixels. <SiteImage> applies
 * focalCss as object-position so the subject stays in frame when cover re-crops
 * at a different viewport aspect. Defaults to {0.5,0.5} / "50% 50%" on failure.
 *
 * @param {Buffer} buf
 * @param {{slot:string, category?:string, strategy?:'attention'|'entropy', format?:'jpeg'|'webp'|'png'}} opts
 * @returns {Promise<{buf:Buffer|null, usable:boolean, width:number, height:number, format:string, ext:string, focal:{fx:number,fy:number}, focalCss:string}>}
 */
export async function processSlot(buf, { slot, category, strategy = 'attention', format } = {}) {
  const spec = SLOT_CONTRACT[slot] || DEFAULT_SLOT;
  const { aspect, minW } = spec;
  // Heroes get the grade; everything else stays a bare (but cropped) photo.
  const isHero = typeof slot === 'string' && slot.startsWith('hero');
  // PNG BLOAT FIX: never emit a photographic PNG — it's lossless and balloons.
  // Promote any PNG output to WebP (quality 82). outFmt is the codec actually
  // written; outExt is the matching file extension the caller saves under.
  const outFmt = format === 'png' ? 'webp' : format;
  const extFor = (f) => (f === 'webp' ? 'webp' : f === 'png' ? 'png' : 'jpg');

  // Read the true source dimensions. If Sharp can't decode it, fail SOFT — hand
  // the original bytes back as usable rather than discarding a photo on a hiccup.
  let srcW = 0;
  let srcH = 0;
  try {
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    srcW = meta.width || 0;
    srcH = meta.height || 0;
  } catch {
    // Original bytes handed back unchanged → report the requested (original) ext.
    // Undecodable here means computeFocal would also fail soft → default focal.
    return { buf, usable: true, width: 0, height: 0, format: format || 'jpeg', ext: extFor(format || 'jpeg'), focal: { ...DEFAULT_FOCAL }, focalCss: focalToCss(DEFAULT_FOCAL) };
  }
  if (!srcW || !srcH) return { buf, usable: true, width: srcW, height: srcH, format: format || 'jpeg', ext: extFor(format || 'jpeg'), focal: { ...DEFAULT_FOCAL }, focalCss: focalToCss(DEFAULT_FOCAL) };

  // RESOLUTION FLOOR: below minW the photo is too small for this slot — it would
  // upscale and blur. Declare it unusable so the caller can fall back.
  if (srcW < minW) return { buf: null, usable: false, width: srcW, height: srcH, format: outFmt || 'jpeg', ext: extFor(outFmt || 'jpeg'), focal: { ...DEFAULT_FOCAL }, focalCss: focalToCss(DEFAULT_FOCAL) };

  // Smart-crop to the slot aspect, capped at the source width (never upscale).
  // smartCropToSlot returns the cropped bytes, the focal point taken from the
  // chosen region's centre (so the focal always agrees with the actual crop), AND
  // the REAL output dimensions — which can be smaller than the slot box when the
  // target aspect can't fill the source (portrait slot on a landscape source).
  // Pass the PROMOTED format (PNG → WebP) so a photographic crop never re-encodes
  // as a bloated PNG.
  const { buf: cropped, focal: cropFocal, width: outW, height: outH } =
    await smartCropToSlot(buf, { aspect, width: srcW, format: outFmt });

  // Grade heroes only; story/gallery ship the cropped frame as-is. Grading keeps
  // the pixel dimensions (it only composites a tint+scrim over the same frame),
  // so outW/outH from the crop still describe the graded buffer.
  let out = cropped;
  if (isHero) {
    const g = gradeForCategory(category);
    out = await applyGrade(cropped, { ...g, format: outFmt });
  }

  // PNG BLOAT GUARANTEE: a re-encode must never be LARGER than its source. We
  // down-sample/down-crop and ship WebP/JPEG, so this normally holds, but a tiny
  // source or pathological frame could buck it. If the processed buffer is bigger
  // than the input, keep the original bytes (and its original ext) instead — the
  // page still gets a real photo and the file never balloons. (A graded hero is
  // the exception: it carries the scrim/duotone the page design needs, so we keep
  // the graded output even if marginally larger — but it's been down-sized so this
  // is rare.) outFmt/outExt are reported so the caller renames the saved file.
  let finalBuf = out;
  let finalFmt = outFmt || 'jpeg';
  // Reported intrinsic dims MUST match the bytes we ship (the caller writes these
  // as the image's w/h). Default to the real crop dims; switch to the SOURCE dims
  // if the bloat guard hands the original uncropped frame back.
  let finalW = outW;
  let finalH = outH;
  if (!isHero && out && out.length > buf.length) {
    finalBuf = buf;
    finalFmt = format || 'jpeg'; // original codec — we're handing original bytes back
    finalW = srcW;
    finalH = srcH;
  }
  // FOCAL POINT: use smartcrop's region centre (relative to the SOURCE). It tracks
  // the subject and matches the actual crop window. It's also the right
  // object-position in the rare bloat-guard case where we hand the ORIGINAL
  // (uncropped) frame back, since the region centre is expressed against that same
  // source. smartCropToSlot fails soft to {0.5,0.5} internally.
  const focal = cropFocal;

  // Report the codec actually written + matching ext so the caller saves the file
  // under the right name (a PNG source typically comes back as a .webp file).
  return { buf: finalBuf, usable: true, width: finalW, height: finalH, format: finalFmt, ext: extFor(finalFmt), focal, focalCss: focalToCss(focal) };
}

/**
 * Convenience: focal-crop a hero to a target aspect AND apply the category grade
 * in one deterministic pass. Either step fails soft to the prior buffer.
 *
 * Now delegates to processSlot('hero-fullbleed') when called with the default
 * full-bleed aspect so the LOCKED CONTRACT stays the one source of truth; an
 * explicit non-default aspect/width still takes the direct crop+grade path
 * (used by callers that need a bespoke box). composeHero NEVER returns null —
 * it's a "compose if you can" convenience, so a below-floor source falls soft to
 * the original-cropped frame rather than dropping the photo (the resolution GATE
 * lives in processSlot / images.mjs, not here).
 *
 * @param {Buffer} buf
 * @param {{category?:string, aspect?:number, width?:number, strategy?:'attention'|'entropy', format?:'jpeg'|'webp'|'png', grade?:object}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function composeHero(buf, { category, aspect = 16 / 9, width = 1600, strategy = 'attention', format, grade } = {}) {
  // Default full-bleed hero with no custom grade → run the contract path so the
  // crop/aspect can never drift from processSlot. (processSlot may decline a
  // below-floor source; composeHero must still return a buffer, so fall soft.)
  if (!grade && aspect === SLOT_CONTRACT['hero-fullbleed'].aspect && width === SLOT_CONTRACT['hero-fullbleed'].minW) {
    const res = await processSlot(buf, { slot: 'hero-fullbleed', category, strategy, format });
    if (res.usable && res.buf) return res.buf;
    // Below floor (or undecodable): still compose best-effort so callers relying
    // on composeHero's "always returns bytes" contract keep working.
  }
  const cropped = await focalCrop(buf, { aspect, width, strategy, format });
  const g = grade || gradeForCategory(category);
  return applyGrade(cropped, { ...g, format });
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
