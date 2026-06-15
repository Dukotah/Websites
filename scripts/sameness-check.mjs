#!/usr/bin/env node
/**
 * sameness-check.mjs — a "perceptual sameness gate" for the demo factory.
 *
 * The factory is deterministic, so its weak spot is JUDGMENT: same-CATEGORY
 * sites quietly drifting toward the same look. `divergence.mjs` fights this at
 * BUILD time (distinct fonts / hero variants / section order per sibling); this
 * script is the mechanical CHECK that the divergence actually landed — it looks
 * at the rendered first impression and flags siblings that still look alike.
 *
 * Approach (KEY-FREE, deterministic — no API, no network):
 *   1. Read every prospect JSON, group by a simply-normalized category.
 *   2. For each prospect with an existing screenshot fold (.shots/fold/<slug>.png),
 *      compute a perceptual hash of that PNG via Sharp:
 *        - dHash: downscale to (W+1)×H grayscale, compare each pixel to its right
 *          neighbour → one bit per comparison (structure/gradient fingerprint).
 *        - aHash: downscale to W×H grayscale, compare each pixel to the mean →
 *          one bit per pixel (overall-tone fingerprint).
 *      Two hashes per shot makes the gate robust: dHash catches identical layout,
 *      aHash catches identical palette/brightness.
 *   3. Within each category, compare every pair. If BOTH the dHash AND the aHash
 *      Hamming distances fall below their thresholds, the pair is "too similar".
 *   4. Print a report; exit non-zero if any offending pair is found, so it can
 *      gate a deploy alongside audit.mjs.
 *
 * Missing fold PNG → skipped with a note (never crashes). Single-member
 * categories are trivially fine and skipped silently.
 *
 * Usage:
 *   node scripts/sameness-check.mjs            # gate the whole gallery
 *   node scripts/sameness-check.mjs --dhash 8 --ahash 6   # tune thresholds
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib/paths.mjs';

const PROSPECTS_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'premium');
const FOLD_DIR = join(ROOT, '.shots', 'fold');

// Hash grid is HASH_H rows × HASH_W columns. 9×8 dHash → 8×8 = 64 comparison
// bits (the classic dHash size); aHash uses the 8×8 grid → 64 bits too.
const HASH_W = 8;
const HASH_H = 8;

// Default Hamming-distance thresholds (out of 64 bits). A pair trips the gate
// only when it is below BOTH — i.e. similar in structure AND in tone. These are
// deliberately tight: the fold is a cropped first impression, so genuinely
// different sites comfortably exceed them, while two near-identical templated
// folds land in the single digits. Override via --dhash / --ahash.
const DEFAULT_DHASH_MAX = 10;
const DEFAULT_AHASH_MAX = 8;

/** Parse a numeric CLI flag like `--dhash 8`, returning fallback if absent/invalid. */
function numFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Normalize a category the same lightweight way `canonCategory` starts:
 * lowercase, trim, collapse whitespace/underscores to a single dash. We keep it
 * deliberately simple (no alias table) so this script stays standalone and never
 * imports the TS art-direction module — close-enough buckets are all the gate
 * needs, and an unknown label just forms its own bucket. Empty → "uncategorized".
 */
function normCategory(raw) {
  const c = (raw ?? '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  return c || 'uncategorized';
}

/**
 * Compute dHash + aHash for a PNG file. Returns { dhash, ahash } as BigInt bit
 * fields (one bit per comparison), or null if the image can't be read/decoded.
 */
async function hashImage(file) {
  let raw;
  try {
    // Decode straight to raw grayscale at our tiny grid sizes — no intermediate
    // encode, fully deterministic. dHash needs one extra column for the
    // left-vs-right comparison.
    const dGray = await sharp(file)
      .grayscale()
      .resize(HASH_W + 1, HASH_H, { fit: 'fill' })
      .raw()
      .toBuffer();
    const aGray = await sharp(file)
      .grayscale()
      .resize(HASH_W, HASH_H, { fit: 'fill' })
      .raw()
      .toBuffer();
    raw = { dGray, aGray };
  } catch {
    return null;
  }

  // dHash: bit = (pixel > pixel-to-its-right). Grid is (HASH_W+1) wide.
  let dhash = 0n;
  let bit = 0n;
  for (let y = 0; y < HASH_H; y++) {
    const rowStart = y * (HASH_W + 1);
    for (let x = 0; x < HASH_W; x++) {
      const left = raw.dGray[rowStart + x];
      const right = raw.dGray[rowStart + x + 1];
      if (left > right) dhash |= 1n << bit;
      bit++;
    }
  }

  // aHash: bit = (pixel > mean of all pixels). Grid is HASH_W × HASH_H.
  let sum = 0;
  for (let i = 0; i < raw.aGray.length; i++) sum += raw.aGray[i];
  const mean = sum / raw.aGray.length;
  let ahash = 0n;
  for (let i = 0; i < HASH_W * HASH_H; i++) {
    if (raw.aGray[i] > mean) ahash |= 1n << BigInt(i);
  }

  return { dhash, ahash };
}

/** Hamming distance between two BigInt bit fields (popcount of XOR). */
function hamming(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const dMax = numFlag('--dhash', DEFAULT_DHASH_MAX);
  const aMax = numFlag('--ahash', DEFAULT_AHASH_MAX);

  console.log('\n🔍 Perceptual sameness gate — flagging same-category demos that look too alike');
  console.log(`   thresholds: dHash ≤ ${dMax} AND aHash ≤ ${aMax} (out of 64 bits) → "too similar"\n`);

  let files;
  try {
    files = (await readdir(PROSPECTS_DIR)).filter((f) => f.endsWith('.json'));
  } catch (e) {
    console.error(`Cannot read prospects dir (${PROSPECTS_DIR}): ${e.message}`);
    process.exit(1);
  }

  // Group prospects by normalized category; record each one's hash (or why not).
  const groups = new Map(); // category -> [{ slug, name, dhash, ahash }]
  const skipped = []; // { slug, reason }

  for (const f of files) {
    const slug = f.replace(/\.json$/, '');
    let config;
    try {
      config = JSON.parse(await readFile(join(PROSPECTS_DIR, f), 'utf8'));
    } catch (e) {
      skipped.push({ slug, reason: `unreadable JSON (${e.message})` });
      continue;
    }
    const category = normCategory(config.category);
    const foldPng = join(FOLD_DIR, `${slug}.png`);
    if (!(await exists(foldPng))) {
      skipped.push({ slug, reason: 'no fold screenshot (run `npm run shots`)' });
      continue;
    }
    const hashes = await hashImage(foldPng);
    if (!hashes) {
      skipped.push({ slug, reason: 'fold PNG could not be decoded' });
      continue;
    }
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ slug, name: config.name ?? slug, ...hashes });
  }

  // Compare every same-category pair.
  const offenders = []; // { category, a, b, dDist, aDist }
  let comparedCategories = 0;
  for (const [category, members] of [...groups].sort()) {
    if (members.length < 2) continue; // a single (or zero) hashed site can't clash
    comparedCategories++;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const dDist = hamming(members[i].dhash, members[j].dhash);
        const aDist = hamming(members[i].ahash, members[j].ahash);
        if (dDist <= dMax && aDist <= aMax) {
          offenders.push({ category, a: members[i], b: members[j], dDist, aDist });
        }
      }
    }
  }

  // ---- Report ----
  const hashed = [...groups.values()].reduce((n, m) => n + m.length, 0);
  console.log(`Hashed ${hashed} fold(s) across ${groups.size} categor${groups.size === 1 ? 'y' : 'ies'}; ` +
    `compared pairs in ${comparedCategories} multi-site categor${comparedCategories === 1 ? 'y' : 'ies'}.`);

  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} site(s):`);
    for (const s of skipped.sort((x, y) => x.slug.localeCompare(y.slug))) {
      console.log(`  - ${s.slug}: ${s.reason}`);
    }
  }

  if (offenders.length) {
    console.log(`\n❌ ${offenders.length} too-similar pair(s) found:`);
    for (const o of offenders.sort((x, y) => x.category.localeCompare(y.category))) {
      console.log(
        `  [${o.category}] ${o.a.slug}  ↔  ${o.b.slug}` +
        `   (dHash dist ${o.dDist}, aHash dist ${o.aDist})`,
      );
    }
    console.log(
      '\nFix: give the offending siblings distinct art direction (font / heroVariant /' +
      '\nneutralTemp / section order) — see scripts/lib/divergence.mjs — then re-run' +
      '\n`npm run shots` and this gate. Loosen with --dhash / --ahash only if the' +
      '\nflag is a genuine false positive.',
    );
    process.exit(1);
  }

  console.log('\n✅ No same-category folds are too similar. Sameness gate passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
