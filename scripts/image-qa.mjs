#!/usr/bin/env node
/**
 * image-qa.mjs — the IMAGE-QA GATE (the permanent guard). Key-free, deterministic.
 *
 * The crop step (attention-crop + the slot contract) is the FIX, the source-width
 * FLOOR is what kills blur, and THIS gate is what makes the floor permanent: it
 * fails the build (non-zero exit) the moment a prospect ships a real photo whose
 * intrinsic resolution is too low for the slot it lands in — the exact thing that
 * `astro build` is happy to compile and then upscale into a soft, blurry hero.
 *
 * It reads each referenced image's *intrinsic* width/height with Sharp (no
 * network, no keys) and compares the width against the slot's minimum source
 * width from the LOCKED IMAGE CONTRACT below. Below the floor = unusable (we never
 * upscale). SVG placeholders, the shared `/images/library/` art, deliberate text
 * heroes, and remote URLs are EXEMPT — they are not managed rasters, so there is
 * nothing to under-resolve.
 *
 * Runs as part of `npm run qa` so a thin photo can never slip into a deploy.
 *
 * Usage: node scripts/image-qa.mjs
 */

import sharp from 'sharp';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'sites', 'demo-gallery');
const SRC = join(APP, 'src');
// PREMIUM multi-page configs (the only render system).
const PREMIUM = join(SRC, 'data', 'premium');
// Managed prospect rasters live here; the gallery's src/lib/assets.ts maps a
// stored "/images/<slug>/<file>" path to this dir at build time.
const ASSETS = join(SRC, 'assets', 'prospects');
// SVG placeholders + shared fallback art are served as-is from here (exempt).
const PUBLIC = join(APP, 'public');

/**
 * LOCKED IMAGE CONTRACT — the SAME values the build-crop and the render-box use,
 * so the gate can never drift from them. minW is the minimum *source* width; a
 * real image narrower than its slot's floor would have to be upscaled (= blur),
 * so it is unusable and fails the gate. (aspect is documented here for parity
 * with the crop/render contract; the gate enforces the width floor.)
 */
const CONTRACT = {
  'hero-fullbleed': { aspect: 16 / 9, minW: 1600 }, // cinematic/statement/collage full-bleed
  'hero-split':     { aspect: 4 / 5,  minW: 1000 }, // side photo column in split/editorial heroes
  story:            { aspect: 4 / 5,  minW: 900 },  // the About side image
  gallery:          { aspect: 4 / 3,  minW: 640 },  // gallery / feature tiles
};

// Premium hero `variant: 'editorial'` renders type-forward with NO full-bleed
// photo — exempt from the hero floor. (Mirrors audit.mjs.)
const TEXT_HERO_VARIANTS = new Set(['editorial']);

// 'split' heroes put the photo in a 4/5 side column (not full-bleed), so the hero
// image is judged against the gentler `hero-split` floor there.
const SIDE_HERO_VARIANTS = new Set(['split']);

/** A path is a real, gate-able raster only if it's a managed prospect photo:
 *  not empty, not an SVG, not the shared library art, not a remote URL, and in
 *  the "/images/<slug>/<file>" form the asset registry manages. */
function isManagedRaster(src) {
  if (!src || typeof src !== 'string') return false;
  if (/^https?:\/\//i.test(src)) return false;          // remote — not ours to size
  if (src.toLowerCase().endsWith('.svg')) return false; // vector placeholder
  if (src.includes('/images/library/')) return false;   // shared fallback art
  return src.startsWith('/images/');                     // managed prospect path
}

/** Map a stored "/images/<slug>/<file>" path to the real file on disk under
 *  src/assets/prospects/. Returns null if the file isn't present (the registry
 *  would then have dropped it — handled by the caller as a "missing" note). */
async function resolveFile(src) {
  const rest = src.replace(/^\/images\//, ''); // "<slug>/<file>"
  const p = join(ASSETS, rest);
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
  } catch {
    /* fall through */
  }
  return null;
}

/** Read intrinsic width/height with Sharp. Fails SOFT (returns null) so a
 *  corrupt/unsupported file never crashes the whole gate — it's reported and
 *  skipped, never silently passed as OK. */
async function intrinsic(file) {
  try {
    const meta = await sharp(file).metadata();
    if (meta?.width && meta?.height) return { w: meta.width, h: meta.height };
  } catch {
    /* fall through */
  }
  return null;
}

/** Collect every gate-able image reference for a PREMIUM (multi-page) config,
 *  each tagged with the slot whose floor it must clear. Premium images live on
 *  sections (hero.image, story.image, gallery.images[], services item images)
 *  plus the top-level config.images.hero (the OG/share image). */
function collectRefs(c) {
  const refs = []; // { slot, src, label }
  const sections = (c.pages ?? []).flatMap((p) => p.sections ?? []);
  const homeHero = (c.pages?.[0]?.sections ?? []).find((s) => s.kind === 'hero');
  const heroSrc = homeHero?.image?.src ?? c.images?.hero;
  const textHero = !heroSrc || TEXT_HERO_VARIANTS.has(homeHero?.variant);

  // Hero slot per the LOCKED CONTRACT. A 'split' hero variant renders the photo
  // in a 4/5 side column → judged against the gentler hero-split floor. A
  // fullbleed/default variant uses the cinematic floor.
  const heroSlot = SIDE_HERO_VARIANTS.has(homeHero?.variant) ? 'hero-split' : 'hero-fullbleed';

  // Hero — only when the home hero actually renders a photo (text heroes show none).
  if (!textHero && isManagedRaster(heroSrc))
    refs.push({ slot: heroSlot, src: heroSrc, label: 'hero' });

  // The OG/share hero (config.images.hero), if distinct from the rendered hero.
  if (isManagedRaster(c.images?.hero) && c.images.hero !== heroSrc)
    refs.push({ slot: 'hero-fullbleed', src: c.images.hero, label: 'og-hero' });

  // Story side images (4/5 story slot) — every 'story' section's image.
  sections.filter((s) => s.kind === 'story').forEach((s, i) => {
    if (isManagedRaster(s.image?.src))
      refs.push({ slot: 'story', src: s.image.src, label: `story[${i}]` });
  });

  // Gallery — every 'gallery' section's images + any 'services' item images.
  const galleryRefs = [
    ...sections.filter((s) => s.kind === 'gallery' && Array.isArray(s.images)).flatMap((s) => s.images),
    ...sections.filter((s) => s.kind === 'services' && Array.isArray(s.items))
      .flatMap((s) => s.items.map((it) => it?.image).filter(Boolean)),
  ];
  galleryRefs.forEach((g, i) => {
    if (isManagedRaster(g?.src))
      refs.push({ slot: 'gallery', src: g.src, label: `gallery[${i}]` });
  });

  return refs;
}

async function main() {
  console.log('# IMAGE-QA GATE — source-resolution floor (LOCKED IMAGE CONTRACT)\n');

  let prospectFiles;
  try {
    prospectFiles = (await readdir(PREMIUM)).filter((f) => f.endsWith('.json'));
  } catch {
    console.log(`✗ Could not read premium dir: ${PREMIUM}`);
    process.exitCode = 1;
    return;
  }

  let failures = 0; // # of under-resolution failures (gates the deploy)
  let checked = 0;  // # of real rasters actually measured
  let notes = 0;    // soft notes (unreadable / missing-on-disk) — never gate

  for (const f of prospectFiles) {
    const slug = f.replace(/\.json$/, '');
    let c;
    try {
      c = JSON.parse(await readFile(join(PREMIUM, f), 'utf8'));
    } catch {
      console.log(`  ? ${slug.padEnd(34)} unreadable JSON — skipped`);
      notes++;
      continue;
    }

    const refs = collectRefs(c);
    if (refs.length === 0) {
      // No managed rasters (text hero + SVG placeholders) — nothing to gate.
      console.log(`  · ${slug.padEnd(34)} no real photos (exempt)`);
      continue;
    }

    const problems = []; // strings to print under this prospect
    for (const ref of refs) {
      const floor = CONTRACT[ref.slot].minW;
      const file = await resolveFile(ref.src);
      if (!file) {
        // Referenced but not on disk — the registry drops it and the page falls
        // back to a placeholder, so it's a content note, not a blur failure.
        problems.push(['note', `${ref.label}: missing on disk (${ref.src}) — placeholder will show`]);
        notes++;
        continue;
      }
      const dim = await intrinsic(file);
      if (!dim) {
        problems.push(['note', `${ref.label}: unreadable by Sharp (${ref.src}) — passed through`]);
        notes++;
        continue;
      }
      checked++;
      if (dim.w < floor) {
        problems.push([
          'fail',
          `${ref.label}: ${dim.w}×${dim.h} — under ${ref.slot} floor of ${floor}w (would upscale/blur)`,
        ]);
        failures++;
      }
    }

    if (problems.length === 0) {
      console.log(`  ✓ ${slug.padEnd(34)} OK (${refs.length} image${refs.length === 1 ? '' : 's'})`);
    } else {
      const hasFail = problems.some((p) => p[0] === 'fail');
      console.log(`  ${hasFail ? '✗' : '•'} ${slug.padEnd(34)}`);
      for (const [level, msg] of problems) {
        console.log(`      [${level === 'fail' ? 'FAIL' : 'note'}] ${msg}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(56));
  console.log(`Measured ${checked} real image(s); ${notes} soft note(s).`);
  console.log(
    failures
      ? `✗ ${failures} under-resolution failure(s) — replace with higher-res source(s) before publishing.`
      : '✓ No under-resolution failures — every shipped photo clears its slot floor.',
  );
  process.exitCode = failures ? 1 : 0;
}

main();
