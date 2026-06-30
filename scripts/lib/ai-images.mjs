/**
 * ai-images.mjs — OPT-IN, env-gated AI image tier for ILLUSTRATIVE ambiance only.
 *
 * This is the bottom of the "make a no-photo page not look like clip-art" ladder,
 * below the business's own photos, OSM, and licensed stock. It generates an
 * ABSTRACT / TEXTURED / ATMOSPHERIC BACKDROP for the hero or story slot — think a
 * softly-lit, out-of-focus, palette-matched ambiance plate, NOT a depiction of a
 * real place, product, person, or team.
 *
 * HONESTY CONTRACT (hard rule): AI output is ILLUSTRATIVE ambiance. It is tagged
 * `ai:illustrative` in the photoSource so the dashboard/audit always knows it is
 * synthetic. The prompt is deliberately written to FORBID literal storefronts,
 * recognizable buildings, signage/logos, text, and faces/people — so the image
 * can never be mistaken for (or imply) the business's actual storefront, work, or
 * team. A real photo (own / stock) ALWAYS wins; this tier only runs when those
 * came up short.
 *
 * DOUBLE-GATED, OFF BY DEFAULT. It runs ONLY when BOTH are set:
 *   • AI_IMAGES_ENABLED=true      (explicit opt-in flag)
 *   • AI_IMAGE_API_KEY=<key>      (the image-gen API key)
 * Optional: AI_IMAGE_API_URL / AI_IMAGE_API_MODEL (OpenAI-compatible image API).
 * With either missing it returns [] and the chain falls through unchanged.
 *
 * Kept SEPARATE from the legacy IMAGE_API_KEY `generateImages` in images.mjs
 * (which attempts photorealistic scenes): this tier is intentionally non-literal,
 * so it never risks implying a fabricated real-world depiction of the business.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { processSlot } from './photo-art.mjs';

const UA =
  'Mozilla/5.0 (compatible; websites-outreach/1.0; +https://github.com/dukotah/websites)';

const slotForIndex = (i) => (i === 0 ? 'hero-fullbleed' : i === 1 ? 'story' : 'gallery');
const nameFor = (i, ext) =>
  `${i === 0 ? 'hero' : i === 1 ? 'story' : `photo-${i}`}.${ext}`;

/**
 * A concrete prompt for an ILLUSTRATIVE ambiance backdrop derived from the
 * category's mood — never a literal business depiction. The negative clauses are
 * load-bearing for the honesty rule: no storefront, no building, no signage/text,
 * no people. Locale only nudges palette/light, never a recognizable place.
 */
function ambiancePrompt(facts, slot) {
  const what = facts.category ? facts.category.replace(/-/g, ' ') : 'local craft';
  const mood =
    slot === 'hero'
      ? `an atmospheric, abstract textured backdrop evoking the warmth and craft of a ${what}`
      : `a soft, out-of-focus ambiance texture suggesting the materials and mood of a ${what}`;
  return (
    `Illustrative, painterly ambiance plate: ${mood}. ` +
    `Abstract and non-literal — bokeh, texture, gradient light, material close-ups and color only. ` +
    `STRICTLY NO recognizable storefront, building, sign, logo, brand, text, lettering, ` +
    `products with labels, faces, or people. Muted, editorial, palette-friendly tones suitable ` +
    `as a background behind overlaid white text. Tasteful, calm, high-end magazine feel.`
  );
}

async function fetchImage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate up to `need` ILLUSTRATIVE ambiance images, starting at on-disk index
 * `startIndex`. Double-gated (AI_IMAGES_ENABLED + AI_IMAGE_API_KEY); returns []
 * when off. Each render is routed through the LOCKED CONTRACT (processSlot) for
 * its slot so it crops/grades to the same box as every other photo. Descriptors
 * carry a `provenance: 'ai:illustrative'` tag and `ambiance: true` so the
 * dashboard/audit never mistakes a synthetic backdrop for a real photo. Fails
 * soft — any error yields fewer (or zero) images, never a throw.
 *
 * @param {{name?:string,category?:string,city?:string,area?:string}} facts
 * @param {{destDir:string, slug:string, startIndex?:number, need?:number, category?:string}} opts
 * @returns {Promise<Array>} saved media descriptors
 */
export async function acquireAiAmbiance(facts, { destDir, slug, startIndex = 0, need = 1, category } = {}) {
  if (need <= 0) return [];
  const enabled = String(process.env.AI_IMAGES_ENABLED || '').toLowerCase() === 'true';
  const key = process.env.AI_IMAGE_API_KEY;
  if (!enabled || !key) return []; // double-gated, off by default → no-op

  const endpoint = process.env.AI_IMAGE_API_URL || 'https://api.openai.com/v1/images/generations';
  const model = process.env.AI_IMAGE_API_MODEL || 'gpt-image-1';
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  for (let k = 0; k < need; k++) {
    const idx = startIndex + saved.length;
    const slot = idx === 0 ? 'hero' : 'story';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          prompt: ambiancePrompt(facts, slot),
          size: '1536x1024', // landscape, well above the 1600w-after-crop hero floor
          n: 1,
        }),
      });
      if (!res.ok) {
        console.warn(`  ! ai-ambiance HTTP ${res.status} for ${facts.name} (${slot}); skipping`);
        break; // a hard failure (bad key/quota) won't fix itself across slots
      }
      const data = await res.json();
      const item = data?.data?.[0];
      let buf;
      if (item?.b64_json) buf = Buffer.from(item.b64_json, 'base64');
      else if (item?.url) buf = await fetchImage(item.url);
      if (!buf) continue;
      // Route through the LOCKED CONTRACT for the slot it lands in so the synthetic
      // backdrop is cropped + graded to the same box as every other photo.
      const contractSlot = slotForIndex(idx);
      const proc = await processSlot(buf, { slot: contractSlot, category: category || facts.category, format: 'png' });
      // AI plates are intentionally abstract; if the (rare) result is below the
      // slot's resolution floor, skip it rather than upscale.
      const outBuf = proc.usable && proc.buf ? proc.buf : null;
      if (!outBuf) continue;
      const outExt = proc.ext || 'webp';
      const fileName = nameFor(idx, outExt);
      await writeFile(join(outDir, fileName), outBuf);
      saved.push({
        path: `/images/${slug}/${fileName}`,
        credit: '',
        license: 'AI-generated (illustrative)',
        source: `ai:${model}`,
        // PROVENANCE (honesty tag): synthetic illustrative ambiance, NOT a photo.
        provenance: 'ai:illustrative',
        ambiance: true,
        alt: '',
        w: proc.width || undefined, h: proc.height || undefined,
        focal: proc.focal ?? { fx: 0.5, fy: 0.5 },
        focalCss: proc.focalCss ?? '50% 50%',
      });
    } catch (err) {
      console.warn(`  ! ai-ambiance failed for ${facts.name} (${err.message}); skipping`);
      break;
    }
  }
  if (saved.length) Object.defineProperty(saved, 'provider', { value: 'ai:illustrative', enumerable: false });
  return saved;
}
