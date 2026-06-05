/**
 * score-photos.mjs — audit (and optionally clean) the photos already on each
 * prospect using the key-free content scorer. Catches junk the scrape let
 * through earlier: logos/screenshots/flat art in a gallery, and near-duplicate
 * shots. Network-free — it judges the files already on disk.
 *
 *   node scripts/score-photos.mjs [slug...]                 # report only
 *   node scripts/score-photos.mjs --prune [slug...]         # drop bad gallery imgs from JSON
 *   node scripts/score-photos.mjs --prune --delete-files    # …and unlink the orphaned files
 *
 * Pruning only ever touches galleryImages (safe). A graphic/low-quality HERO is
 * reported as a warning — swapping the hero is a judgment call left to a human
 * or a media re-sweep, not silently changed here.
 */
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, PROSPECT_IMAGES } from './lib/paths.mjs';
import { scorePhoto, dhash, hamming, NEAR_DUP_DISTANCE } from './lib/photo-score.mjs';

const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');

const argv = process.argv.slice(2);
const PRUNE = argv.includes('--prune');
const DELETE_FILES = argv.includes('--delete-files');
const onlySlugs = argv.filter((a) => !a.startsWith('--'));

// Resolve a stored "/images/<slug>/<file>" path to a real file on disk.
function diskPath(src) {
  const m = /^\/images\/(.+)$/.exec(src || '');
  return m ? join(PROSPECT_IMAGES, m[1]) : null;
}

const isStock = (src) => !src || src.includes('/images/library/') || (src || '').endsWith('.svg');

async function scoreOne(file) {
  const slug = basename(file, '.json');
  const config = JSON.parse(await readFile(join(PROSPECTS, file), 'utf8'));
  const gallery = config.galleryImages ?? [];

  const notes = [];
  let pruned = 0;
  const deleted = [];
  const pruneFiles = []; // disk paths queued for deletion (guarded before unlink)

  // --- Hero (report only) ---
  const heroSrc = config.images?.hero;
  if (heroSrc && !isStock(heroSrc)) {
    const dp = diskPath(heroSrc);
    if (dp && existsSync(dp)) {
      const q = await scorePhoto(await readFile(dp));
      if (q.isGraphic) notes.push(`⚠ hero looks like a graphic (ent=${q.entropy.toFixed(1)}, [${q.reason}]) — consider a re-sweep`);
    }
  }

  // --- Gallery (prunable): drop graphics + near-dups of the hero or earlier keepers ---
  const seenPhash = [];
  // seed with the hero so a gallery copy of the hero is treated as a dup
  if (heroSrc && !isStock(heroSrc)) {
    const dp = diskPath(heroSrc);
    if (dp && existsSync(dp)) {
      const h = await dhash(await readFile(dp));
      if (h != null) seenPhash.push(h);
    }
  }

  const keep = [];
  for (const img of gallery) {
    const dp = diskPath(img.src);
    if (isStock(img.src)) {
      notes.push(`· stock/library in gallery: ${img.src} (drop before sending)`);
      if (!PRUNE) keep.push(img);
      else pruned++;
      continue;
    }
    if (!dp || !existsSync(dp)) {
      notes.push(`· missing file: ${img.src}`);
      keep.push(img); // don't drop on a missing file — could be a path issue
      continue;
    }
    const buf = await readFile(dp);
    const q = await scorePhoto(buf);
    const ph = await dhash(buf);
    const dup = ph != null && seenPhash.some((p) => hamming(p, ph) <= NEAR_DUP_DISTANCE);
    if (q.isGraphic) {
      notes.push(`✗ graphic: ${img.src}  (ent=${q.entropy.toFixed(1)}, std=${q.meanStdev.toFixed(0)}, [${q.reason}])`);
      if (PRUNE) { pruned++; pruneFiles.push(dp); continue; }
    } else if (dup) {
      notes.push(`✗ near-duplicate: ${img.src}`);
      if (PRUNE) { pruned++; pruneFiles.push(dp); continue; }
    } else {
      if (ph != null) seenPhash.push(ph);
    }
    keep.push(img);
  }

  if (PRUNE && pruned > 0) {
    config.galleryImages = keep;
    await writeFile(join(PROSPECTS, file), JSON.stringify(config, null, 2) + '\n');
    // Delete files ONLY when nothing else in the FINAL config still points at
    // them — a section/service can reference the same photo, and deleting it
    // would silently break that card. (Lesson learned the hard way.)
    if (DELETE_FILES) {
      const stillReferenced = JSON.stringify(config);
      for (const f of pruneFiles) {
        if (stillReferenced.includes(basename(f))) {
          notes.push(`· kept file (still referenced elsewhere): ${basename(f)}`);
          continue;
        }
        await unlink(f).catch(() => {});
        deleted.push(f);
      }
    }
  }

  return { slug, total: gallery.length, kept: keep.length, pruned, deleted: deleted.length, notes };
}

async function main() {
  let files = (await readdir(PROSPECTS)).filter((f) => f.endsWith('.json'));
  if (onlySlugs.length) files = files.filter((f) => onlySlugs.includes(basename(f, '.json')));

  console.log(`\n📷 Photo quality ${PRUNE ? '(PRUNE mode)' : '(report only)'} — ${files.length} prospect(s)\n`);
  let totalPruned = 0;
  for (const file of files.sort()) {
    const r = await scoreOne(file);
    const head = `${r.slug.padEnd(26)} gallery ${r.kept}/${r.total}` + (r.pruned ? `  (pruned ${r.pruned}${r.deleted ? `, deleted ${r.deleted} file(s)` : ''})` : '');
    const flagged = r.notes.filter((n) => n.startsWith('✗') || n.startsWith('⚠'));
    console.log(`${flagged.length ? '•' : '✓'} ${head}`);
    r.notes.forEach((n) => console.log(`    ${n}`));
    totalPruned += r.pruned;
  }
  console.log(`\n${PRUNE ? `Pruned ${totalPruned} image(s).` : 'Run with --prune to remove flagged gallery images.'}\n`);
}

main().catch((err) => {
  console.error('score-photos failed:', err);
  process.exit(1);
});
