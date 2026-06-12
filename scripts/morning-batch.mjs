#!/usr/bin/env node
/*
 * morning-batch.mjs — produce a fresh, deduped batch of demo sites and land them
 * in the CRM "New" tab, ready for manual review + send. Built to run unattended
 * on a schedule (Task Scheduler), but safe to run by hand.
 *
 * Pipeline (the FULL quality path, not a shortcut):
 *   1. Pull the next N un-built leads from the scraped pool (best score first),
 *      skipping any business already turned into a prospect or marked done.
 *   2. build-research  → normalizes + deep-scrapes ONCE, with the name↔website
 *      MISMATCH GUARD (the FOCUS pool has them, e.g. "Lysell" → a drilling site).
 *   3. verify-research --promote  → only if ANTHROPIC_API_KEY is set (cleans the
 *      scrape + writes verified copy); skipped gracefully otherwise.
 *   4. generate-prospects  → builds the sites (hero-resolution gate on) and
 *      auto-syncs them into the CRM New tab.
 *   5. Records the picked businesses so tomorrow pulls the NEXT N.
 *
 * What this does and does NOT do (so the flags are trustworthy):
 *   - It runs the MECHANICAL audit + the photo/hero gates and flags weak sites
 *     `needs-review`. It does NOT do human-level visual judgment — that's the
 *     manual review the New tab is for. Treat `needs-review` as "look before send".
 *
 * Usage:
 *   node scripts/morning-batch.mjs            # default: 10 leads from the pool
 *   node scripts/morning-batch.mjs --n 10
 *   node scripts/morning-batch.mjs --pool <csv> --state CA
 *   node scripts/morning-batch.mjs --dry-run  # show the picks, build nothing
 */
import { readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
const DONE_LIST = join(ROOT, 'data', 'morning-done.txt');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const N = Math.max(1, Number(arg('--n', '10')) || 10);
const STATE = arg('--state', 'CA');
const DRY = process.argv.includes('--dry-run');
const POOL = arg('--pool', 'C:/Users/dukot/projects/santa-rosa-leads/santa_rosa_FOCUS.csv');

const slugify = (s) => s.toLowerCase().trim().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Minimal CSV parse (handles quoted cells with commas/newlines).
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const cell = (v = '') => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

async function main() {
  if (!existsSync(POOL)) { console.error(`Lead pool not found: ${POOL}`); process.exit(1); }
  const pool = parseCsv(await readFile(POOL, 'utf8'));

  // Already-built (slug exists as a prospect) or previously picked.
  const builtSlugs = new Set(
    (await readdir(PROSPECTS)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')),
  );
  let doneSlugs = new Set();
  if (existsSync(DONE_LIST)) doneSlugs = new Set((await readFile(DONE_LIST, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean));

  // Pick the next N: highest Score first, skipping built/done and rows without a
  // business name (a website is optional — the generator can still render).
  const fresh = pool
    .map((r) => ({ ...r, _name: r.Business || r.name || r.business, _slug: slugify(r.Business || r.name || r.business || '') }))
    .filter((r) => r._name && r._slug && !builtSlugs.has(r._slug) && !doneSlugs.has(r._slug))
    .sort((a, b) => (Number(b.Score || b.score || 0) - Number(a.Score || a.score || 0)));

  const picks = fresh.slice(0, N);
  if (!picks.length) { console.log('No fresh leads left in the pool — add more leads or reset data/morning-done.txt.'); return; }

  console.log(`Morning batch: ${picks.length} fresh lead(s) from ${POOL.split(/[\\/]/).pop()} (${fresh.length} remaining in pool)`);
  for (const p of picks) console.log(`  · [${p.Score || '?'}] ${p._name}  (${p.Category || '?'} · ${p.City || '?'})`);
  if (DRY) { console.log('\n--dry-run: nothing built.'); return; }

  // Write a scraper-shaped CSV for build-research (it maps Business/Category/etc).
  const cols = ['Business', 'Category', 'City', 'Phone', 'Email', 'Website', 'Address'];
  const stamp = picks.length; // avoid Date in scripts that may run headless; filename uses count+first slug
  const csvName = `morning-${picks[0]._slug}-${stamp}`;
  const csvPath = join(ROOT, 'data', `${csvName}.csv`);
  await writeFile(csvPath, [cols.join(','), ...picks.map((p) => cols.map((c) => cell(p[c] ?? '')).join(','))].join('\n') + '\n');

  const sh = async (label, file, args) => {
    console.log(`\n▶ ${label}…`);
    try { const { stdout, stderr } = await run(file, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
      process.stdout.write((stdout || '').split('\n').slice(-12).join('\n') + '\n'); if (stderr) process.stderr.write(stderr); return true;
    } catch (e) { process.stdout.write((e.stdout || '').split('\n').slice(-12).join('\n') + '\n'); console.warn(`  ⚠ ${label} failed: ${(e.message || e).split('\n')[0]}`); return false; }
  };

  // 2) research (mismatch-guarded) → 3) optional verify/promote → 4) generate (auto-syncs to CRM)
  await sh('build-research', process.execPath, [join(ROOT, 'scripts', 'build-research.mjs'), csvPath, '--state', STATE]);
  if (process.env.ANTHROPIC_API_KEY) await sh('verify-research --promote', process.execPath, [join(ROOT, 'scripts', 'verify-research.mjs'), '--promote']);
  const leadsCsv = join(ROOT, 'data', `${csvName}-leads.csv`);
  const ok = await sh('generate-prospects (+ auto-sync to CRM)', process.execPath, [join(ROOT, 'scripts', 'generate-prospects.mjs'), leadsCsv]);

  // 5) Record picks so tomorrow advances. Only on a successful generate.
  if (ok) await appendFile(DONE_LIST, picks.map((p) => p._slug).join('\n') + '\n');

  console.log(`\n✓ Morning batch done. Review in the CRM New tab — "Needs review" = look before sending; the rest are ready.`);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
