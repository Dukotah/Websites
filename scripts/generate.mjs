#!/usr/bin/env node
/**
 * generate.mjs — the single PREMIUM pipeline command (npm run generate).
 *
 * CSV → real facts (research file OR live scrape) → acquireMediaFor photos →
 * authorPremium → src/data/premium/<slug>.json (multi-page PremiumConfig) →
 * premium-validate gate → data/outreach-links.json with /s/<slug> links →
 * auto-sync to the Duke CRM (the seam that makes "generating IS the push").
 *
 * Reuses the upstream facts + photo layers from generate-prospects.mjs unchanged;
 * only the buildConfig/manifest TAIL is the premium author.
 *
 * Usage: node scripts/generate.mjs [path/to/file.csv] [--no-photos]
 *                                   [--no-crm-sync] [--no-claude]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scrapeSite } from './lib/scrape-site.mjs';
import {
  parseCsv, slugify, loadResearch, enrichmentFromResearch, normCat, catKeyFor,
  nameMatchesSite, acquireMediaFor,
} from './generate-prospects.mjs';
import { authorPremium } from './author-premium.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREMIUM_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'premium');
const VALIDATE = join(ROOT, 'scripts', 'premium-validate.mjs');

async function main() {
  const csvArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/prospects.sample.csv';
  const csvPath = resolve(ROOT, csvArg);
  const skipWikimedia = process.argv.includes('--no-photos');
  const useClaude = !process.argv.includes('--no-claude');

  let csv;
  try { csv = await readFile(csvPath, 'utf8'); }
  catch { console.error(`Could not read CSV: ${csvPath}`); process.exit(1); }

  const rows = parseCsv(csv);
  if (!rows.length) { console.error('No data rows found in CSV.'); process.exit(1); }

  await mkdir(PREMIUM_DIR, { recursive: true });
  const base = (process.env.GALLERY_BASE_URL || 'https://demos.copperbaytech.com').replace(/\/$/, '');
  console.log(
    `Authoring ${rows.length} premium site(s) → /s/<slug>.\n` +
    `  Copy:   ${useClaude && process.env.ANTHROPIC_API_KEY ? 'Claude upgrade over deterministic skeleton' : 'deterministic (real facts)'}\n` +
    `  Photos: agent-dropped → their site → ${skipWikimedia ? '' : 'Wikimedia → '}library\n`,
  );

  const built = [];

  for (const row of rows) {
    if (!row.name) continue;
    const slug = slugify(row.name);
    const catKey = catKeyFor(row);
    row.website = row.website || row.existing_website || '';

    // 0) Research file wins (confirmed:true = authoritative). Else live scrape.
    const research = await loadResearch(slug);
    const authoritative = research?.confirmed === true;

    let e = null;
    let mismatchName = '';
    if (research) {
      e = enrichmentFromResearch(research, row, { authoritative });
      console.log(`  · ${row.name}: using ${authoritative ? 'verified' : 'auto'} research (data/research/${slug}.json)`);
    } else if (row.website) {
      process.stdout.write(`  · ${row.name}: scraping ${row.website} … `);
      e = await scrapeSite(row.website);
      const match = nameMatchesSite(row.name, e);
      if (e && !match.ok) {
        mismatchName = match.siteName || row.website;
        console.log(`⚠ wrong site? identifies as "${mismatchName}" — facts discarded`);
        e = null;
      } else {
        console.log(e ? `ok (richness ${e.richness})` : 'unreachable');
      }
    } else {
      console.log(`  · ${row.name}: no website/research — authoring from CSV facts only`);
    }
    if (e) {
      row.city = row.city || e.city || '';
      row.state = row.state || e.state || '';
    }

    // 1) Photos + contact backfill — reuse the route-agnostic media pipeline.
    const { media, photoSource, photoFlags } =
      await acquireMediaFor(slug, row, e, catKey, { authoritative, skipWikimedia });

    // 2) Author the premium multi-page config from the real facts + media.
    const { config, status, flags } = await authorPremium(slug, row, e, research, media, {
      photoSource, photoFlags, mismatchName, useClaude,
    });

    built.push({ slug, config, status, flags, photoSource, link: `${base}/s/${slug}` });
  }

  // Re-seed colliding siblings: two slugs sharing an identical fontId+color.
  const seen = new Map();
  for (const b of built) {
    const key = `${b.config.category}|${b.config.brand.fontId}|${b.config.brand.color}`;
    if (seen.has(key)) {
      // Nudge the color a touch deterministically so the pair diverges.
      const c = b.config.brand.color;
      b.config.brand.color = shiftHex(c, (b.slug.length % 3) + 1);
      console.log(`  · ${b.slug}: re-seeded brand color (collision with ${seen.get(key)})`);
    } else {
      seen.set(key, b.slug);
    }
  }

  // 3) Write each config.
  for (const b of built) {
    await writeFile(join(PREMIUM_DIR, `${b.slug}.json`), JSON.stringify(b.config, null, 2) + '\n');
  }

  // 4) Inline premium-validate gate. Any slug with errors → needs-review +
  //    'Failed premium validation' flag, excluded from the ready set (still written).
  let validateOut = '';
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [VALIDATE]);
    validateOut = stdout;
  } catch (err) {
    validateOut = (err.stdout || '') + (err.stderr || '');
  }
  // Parse which slugs errored (lines: "  ✗ <slug>").
  const erroredSlugs = new Set(
    validateOut.split('\n').filter((l) => /^\s*✗\s/.test(l)).map((l) => l.replace(/^\s*✗\s+/, '').trim()),
  );
  for (const b of built) {
    if (erroredSlugs.has(b.slug)) {
      if (!b.flags.includes('Failed premium validation')) b.flags.push('Failed premium validation');
      b.status = 'needs-review';
      b.config.status = 'needs-review';
      b.config.flags = b.flags;
      await writeFile(join(PREMIUM_DIR, `${b.slug}.json`), JSON.stringify(b.config, null, 2) + '\n');
    }
  }

  // 5) Build the links manifest — /s/<slug>, slug ALWAYS present (Duke never hits
  //    the /p/ split fallback). Keep every existing key + status vocabulary.
  const links = built.map((b) => ({
    name: b.config.name,
    slug: b.slug,
    email: b.config.contact?.email ?? '',
    link: `${base}/s/${b.slug}`,
    status: b.status,
    photoSource: b.photoSource,
    flags: b.flags,
    category: b.config.category,
    area: b.config.area,
    claimByDate: b.config.outreach?.claimByDate ?? '',
    thumbnailUrl: `/thumbnails/${b.slug}.png`,
  }));
  await writeFile(join(ROOT, 'data', 'outreach-links.json'), JSON.stringify(links, null, 2) + '\n');

  process.stdout.write('\n' + validateOut + '\n');
  for (const b of built) console.log(`  ✓ ${b.config.name}  →  ${b.link}   [photos: ${b.photoSource} · ${b.status}]`);
  const review = links.filter((l) => l.status === 'needs-review').length;
  console.log(`\nWrote ${links.length} premium site(s) to sites/demo-gallery/src/data/premium/`);
  if (review) console.log(`  ${review} flagged needs-review — open the dashboard before sending.`);
  console.log('Links manifest: data/outreach-links.json');

  // 6) AUTO-SYNC TAIL (verbatim seam): execFile the Duke sync; never fail on error.
  const noSync = process.argv.includes('--no-crm-sync') || process.env.CRM_SYNC === 'off';
  const dukeDir = process.env.DUKE_DIR || 'C:/Users/dukot/projects/Duke';
  const syncScript = join(dukeDir, 'scripts', 'sync-demos-to-crm.mjs');
  if (!noSync && existsSync(syncScript)) {
    console.log('\nSyncing the batch into the CRM New tab…');
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [syncScript, '--commit', '--websites', ROOT]);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    } catch (e) {
      console.warn(`  ⚠ CRM sync skipped (${(e.message || String(e)).split('\n')[0]}). Run it manually: node "${syncScript}" --commit`);
    }
  } else if (!noSync) {
    console.log(`\n(CRM auto-sync off — ${syncScript} not found. Set DUKE_DIR or run the sync manually.)`);
  }
}

// Deterministic small hex shift for collision re-seed (keeps the same hue band).
function shiftHex(hex, delta) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const ch = (v) => Math.max(0, Math.min(255, parseInt(v, 16) + delta * 6)).toString(16).padStart(2, '0');
  return `#${ch(m[1])}${ch(m[2])}${ch(m[3])}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { main };
