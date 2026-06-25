#!/usr/bin/env node
/*
 * ⚠ DEPRECATED — legacy unattended scheduler. The pipeline is now run ON DEMAND
 * by the `pipeline` agent (see ~/.claude/agents/pipeline.md and the "Operating
 * model" section in CLAUDE.md), not by a cron. The `MorningDemoBatch` Task
 * Scheduler job is disabled and should stay that way. This file is kept for
 * reference only; don't re-enable it or build new automation on it. To reuse its
 * gated-batch logic (QA gate + quarantine queue), fold those parts into an
 * on-demand command instead.
 *
 * morning-batch.mjs — produce a fresh batch of demo sites and land ONLY the ones
 * that pass quality in the CRM "New" tab. Built to run unattended on a schedule
 * (Task Scheduler), but safe to run by hand.
 *
 * THE CONTRACT (changed): this batch REFUSES TO SHIP SLOP. Instead of "build
 * everything and flag the weak", it now: builds, gates, publishes only what
 * passes, and queues the rest for finishing. Concretely:
 *
 *   1. Pick the next N un-built leads — REQUIRING a website (the #1 quality lever;
 *      the generator scrapes it for real facts + photos). No-website leads are
 *      skipped by default (cap with --no-website-cap N), because unattended there
 *      is no researcher to make them good, so they can only come out as template.
 *   2. build-research  → normalizes + deep-scrapes ONCE, with the name↔website
 *      MISMATCH GUARD (the FOCUS pool has them, e.g. "Lysell" → a drilling site).
 *   3. verify-research --promote  → only if ANTHROPIC_API_KEY is set.
 *   4. generate --no-crm-sync  → authors the premium sites + writes the manifest,
 *      but does NOT touch the CRM yet (we gate first).
 *   5. QA GATE — `npm run build` (hard gate: a broken build aborts the whole run)
 *      + `premium-validate.mjs` + `audit.mjs` (per-slug criticals). A site is
 *      READY only if its manifest status is `ready` AND it has no validate/audit
 *      criticals. The rest are QUARANTINED.
 *   6. Quarantine the failures: their prospect JSON moves to data/quarantine/,
 *      they're dropped from the manifest, and the lead is queued in
 *      data/research-queue.txt (NOT marked done) so it gets FINISHED later — never
 *      silently shipped, never burned.
 *   7. Land ONLY the ready sites in the CRM (sync is --only-ready, belt + braces).
 *      With --publish, the ready sites are also thumbnailed, committed and pushed
 *      FIRST (so the demo link + thumbnail are live before the CRM card exists —
 *      no more dead preview links). Without --publish, the CRM sync is skipped and
 *      the ready set is printed for a manual push (so a card can never point at a
 *      not-yet-live link).
 *   8. Record ONLY the ready businesses as done so tomorrow pulls the NEXT N; the
 *      quarantined ones stay in the research queue for a human/agent pass.
 *
 * Usage:
 *   node scripts/morning-batch.mjs                  # 10 website leads, gate, no publish
 *   node scripts/morning-batch.mjs --n 10 --publish # gate + push live + land in CRM
 *   node scripts/morning-batch.mjs --no-website-cap 2   # allow up to 2 no-website leads
 *   node scripts/morning-batch.mjs --dry-run        # show the picks, build nothing
 */
import { readFile, writeFile, readdir, appendFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'sites', 'demo-gallery');
// PREMIUM multi-page configs — the only render system (each renders at /s/<slug>).
const PREMIUM = join(APP, 'src', 'data', 'premium');
const QUARANTINE = join(ROOT, 'data', 'quarantine');
const MANIFEST = join(ROOT, 'data', 'outreach-links.json');
const DONE_LIST = join(ROOT, 'data', 'morning-done.txt');
const QUEUE_LIST = join(ROOT, 'data', 'research-queue.txt');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const N = Math.max(1, Number(arg('--n', '10')) || 10);
const STATE = arg('--state', 'CA');
const NO_WEBSITE_CAP = Math.max(0, Number(arg('--no-website-cap', '0')) || 0);
const DRY = process.argv.includes('--dry-run');
const PUBLISH = process.argv.includes('--publish');
const POOL = arg('--pool', 'C:/Users/dukot/projects/santa-rosa-leads/santa_rosa_FOCUS.csv');

const slugify = (s) => s.toLowerCase().trim().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const websiteOf = (r) => String(r.Website || r.website || r.existing_website || '').trim();

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

  // Already-built (slug exists as a premium config), previously picked, or quarantined.
  const builtSlugs = new Set(
    (await readdir(PREMIUM)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')),
  );
  const listSet = async (p) => existsSync(p)
    ? new Set((await readFile(p, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean)) : new Set();
  const doneSlugs = await listSet(DONE_LIST);
  const queuedSlugs = await listSet(QUEUE_LIST);

  // Candidate pool: named, not already built/done. (Queued leads stay eligible —
  // they're meant to be finished, not skipped — but won't be re-picked here while
  // they sit in the queue; we exclude them so the batch advances to fresh leads.)
  const fresh = pool
    .map((r) => ({ ...r, _name: r.Business || r.name || r.business, _slug: slugify(r.Business || r.name || r.business || ''), _website: websiteOf(r) }))
    .filter((r) => r._name && r._slug && !builtSlugs.has(r._slug) && !doneSlugs.has(r._slug) && !queuedSlugs.has(r._slug))
    .sort((a, b) => (Number(b.Score || b.score || 0) - Number(a.Score || a.score || 0)));

  // REQUIRE a website. Top up with at most NO_WEBSITE_CAP no-website leads only if
  // there aren't enough website leads to fill N (so unattended output stays clean).
  const withSite = fresh.filter((r) => r._website);
  const withoutSite = fresh.filter((r) => !r._website);
  const picks = withSite.slice(0, N);
  if (picks.length < N && NO_WEBSITE_CAP > 0) {
    picks.push(...withoutSite.slice(0, Math.min(NO_WEBSITE_CAP, N - picks.length)));
  }

  if (!picks.length) {
    console.log(`No fresh leads WITH a website left in the pool (${withoutSite.length} no-website skipped). ` +
      `Add leads, raise --no-website-cap, or reset data/morning-done.txt.`);
    return;
  }

  console.log(`Morning batch: ${picks.length} lead(s) from ${POOL.split(/[\\/]/).pop()} ` +
    `(${withSite.length} website / ${withoutSite.length} no-website remaining)`);
  for (const p of picks) console.log(`  · [${p.Score || '?'}] ${p._name}  (${p.Category || '?'} · ${p.City || '?'})${p._website ? '' : '  ⚠ no website'}`);
  if (DRY) { console.log('\n--dry-run: nothing built.'); return; }

  // Write a scraper-shaped CSV for build-research (it maps Business/Category/etc).
  const cols = ['Business', 'Category', 'City', 'Phone', 'Email', 'Website', 'Address'];
  const csvName = `morning-${picks[0]._slug}-${picks.length}`;
  const csvPath = join(ROOT, 'data', `${csvName}.csv`);
  await writeFile(csvPath, [cols.join(','), ...picks.map((p) => cols.map((c) => cell(p[c] ?? (c === 'Website' ? p._website : ''))).join(','))].join('\n') + '\n');

  const sh = async (label, file, args, opts = {}) => {
    console.log(`\n▶ ${label}…`);
    try {
      const { stdout, stderr } = await run(file, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...opts });
      process.stdout.write((stdout || '').split('\n').slice(-12).join('\n') + '\n'); if (stderr) process.stderr.write(stderr);
      return { ok: true, stdout: stdout || '', stderr: stderr || '' };
    } catch (e) {
      process.stdout.write((e.stdout || '').split('\n').slice(-12).join('\n') + '\n');
      console.warn(`  ⚠ ${label} failed: ${(e.message || e).split('\n')[0]}`);
      return { ok: false, stdout: e.stdout || '', stderr: e.stderr || '' };
    }
  };

  // 2) research (mismatch-guarded) → 3) optional verify/promote → 4) generate (NO sync yet)
  await sh('build-research', process.execPath, [join(ROOT, 'scripts', 'build-research.mjs'), csvPath, '--state', STATE]);
  if (process.env.ANTHROPIC_API_KEY) await sh('verify-research --promote', process.execPath, [join(ROOT, 'scripts', 'verify-research.mjs'), '--promote']);
  const leadsCsv = join(ROOT, 'data', `${csvName}-leads.csv`);
  const gen = await sh('generate (premium, build only)', process.execPath, [join(ROOT, 'scripts', 'generate.mjs'), leadsCsv, '--no-crm-sync']);
  if (!gen.ok) { console.error('\n✗ Generate failed — nothing built, nothing marked done. Aborting.'); process.exit(1); }

  const pickSlugs = new Set(picks.map((p) => p._slug));

  // ── 5) QA GATE ─────────────────────────────────────────────────────────────
  // Hard gate: the gallery must BUILD. A broken build means we can't trust any
  // page, so we ship nothing and mark nothing done (operator investigates).
  // shell:true is required on Windows — Node refuses to spawn npm.cmd directly
  // (spawn EINVAL) since the .cmd-execution security change. Paths here are
  // space-free so no extra quoting is needed.
  const build = await sh('npm run build (QA gate)', NPM, ['--prefix', APP, 'run', 'build'], { shell: true });
  if (!build.ok) {
    console.error('\n✗ Build failed — refusing to publish or mark anything done. Fix the build and re-run.');
    process.exit(1);
  }

  // Premium schema/photo gate: premium-validate prints "  ✗ <slug>" for any
  // config with errors (invented photo path, missing section, etc.). A slug that
  // fails validation is never publishable.
  const validate = await sh('premium-validate (QA gate)', process.execPath, [join(ROOT, 'scripts', 'premium-validate.mjs')]);
  const validateFailSlugs = new Set();
  for (const m of validate.stdout.matchAll(/^\s*✗\s+([a-z0-9-]+)\b/gim)) validateFailSlugs.add(m[1]);

  // Per-slug criticals from the (premium-aware) mechanical audit. Two kinds:
  //   · a global dead-token critical (affects every page) → quarantine the batch
  //   · a per-slug critical (✗ <slug>) → quarantine just that slug
  const audit = await sh('audit.mjs (QA gate)', process.execPath, [join(ROOT, 'scripts', 'audit.mjs')]);
  const globalCritical = /CRITICAL var\(--/.test(audit.stdout);
  const auditCritSlugs = new Set();
  for (const m of audit.stdout.matchAll(/^\s*✗\s+([a-z0-9-]+)\b/gim)) auditCritSlugs.add(m[1]);

  // Manifest status (the premium author already flags thin/photoless/templated/
  // validation-failed sites as needs-review).
  let manifest = [];
  try { manifest = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { manifest = []; }
  const batchEntries = manifest.filter((e) => pickSlugs.has(e.slug));

  const isReady = (e) =>
    !globalCritical &&
    (e.status ?? 'ready') !== 'needs-review' &&
    !validateFailSlugs.has(e.slug) &&
    !auditCritSlugs.has(e.slug);

  const ready = batchEntries.filter(isReady);
  const failed = batchEntries.filter((e) => !isReady(e));
  const readySlugs = new Set(ready.map((e) => e.slug));

  console.log('\n' + '─'.repeat(56));
  console.log(`QA gate: ${ready.length} ready · ${failed.length} quarantined` +
    (globalCritical ? '  (global dead-token critical — whole batch held)' : ''));

  // ── 6) Quarantine the failures ────────────────────────────────────────────
  await mkdir(QUARANTINE, { recursive: true });
  for (const e of failed) {
    const reason = globalCritical ? 'dead-token critical'
      : validateFailSlugs.has(e.slug) ? 'premium-validate error'
      : auditCritSlugs.has(e.slug) ? 'audit critical'
      : `status:${e.status}` + (e.flags?.length ? ` (${e.flags.join(', ')})` : '');
    const src = join(PREMIUM, `${e.slug}.json`);
    if (existsSync(src)) { await rename(src, join(QUARANTINE, `${e.slug}.json`)).catch(() => {}); }
    console.log(`  ⤷ quarantined ${e.slug} — ${reason}`);
  }
  // Queue the failed businesses for a finishing pass (NOT marked done → retried).
  if (failed.length) {
    await appendFile(QUEUE_LIST, failed.map((e) => e.slug).join('\n') + '\n');
    console.log(`  → ${failed.length} lead(s) queued in data/research-queue.txt for a research pass.`);
  }

  // Rewrite the manifest to the ready set only, so neither the CRM sync nor a
  // later push can ever pick up a quarantined site.
  const readyManifest = manifest.filter((e) => readySlugs.has(e.slug) || !pickSlugs.has(e.slug));
  // Drop quarantined slugs entirely (even if they were in a prior manifest).
  const cleanedManifest = readyManifest.filter((e) => !failed.some((f) => f.slug === e.slug));
  await writeFile(MANIFEST, JSON.stringify(cleanedManifest, null, 2) + '\n');

  if (!ready.length) {
    console.log('\n✗ Nothing passed the gate this run — 0 sites published, all queued for finishing.');
    return;
  }

  // ── 7) Publish (optional) + land ONLY ready sites in the CRM ───────────────
  if (PUBLISH) {
    // Thumbnails for the ready sites (so the CRM card image isn't a 404).
    await sh('make-thumbnail (ready)', process.execPath, [join(ROOT, 'scripts', 'make-thumbnail.mjs'), ...readySlugs]);
    // Commit + push the ready sites FIRST → Vercel deploys → links go live, THEN
    // we create CRM cards that point at them. Order matters: no dead links.
    const paths = [
      'sites/demo-gallery/src/data/premium',
      'sites/demo-gallery/src/assets/prospects',
      'sites/demo-gallery/public/thumbnails',
      `data/${csvName}.csv`, `data/${csvName}-leads.csv`,
    ];
    await sh('git add', 'git', ['add', ...paths]);
    const commit = await sh('git commit', 'git', ['commit', '-m', `Morning batch: ${ready.length} gated demo site(s)`]);
    if (commit.ok) {
      const push = await sh('git push', 'git', ['push']);
      if (push.ok) {
        console.log('  ✓ pushed — Vercel is deploying the ready sites (~1 min to live).');
        const syncScript = join(process.env.DUKE_DIR || 'C:/Users/dukot/projects/Duke', 'scripts', 'sync-demos-to-crm.mjs');
        if (existsSync(syncScript)) {
          await sh('CRM sync (--only-ready)', process.execPath, [syncScript, '--commit', '--only-ready', '--websites', ROOT]);
        } else {
          console.log('  (CRM sync script not found — set DUKE_DIR; ready sites are live, push landed.)');
        }
      } else {
        console.warn('  ⚠ push failed — ready sites committed locally but NOT live; CRM sync skipped to avoid dead links.');
      }
    } else {
      console.log('  (nothing to commit — sites may already be committed; run the CRM sync manually with --only-ready.)');
    }
  } else {
    console.log(`\n${ready.length} site(s) PASSED and are ready to publish:`);
    for (const e of ready) console.log(`  · ${e.name}  →  ${e.link}`);
    console.log('\nCRM sync skipped (no --publish) so a card can never point at a not-yet-live link.');
    console.log('Re-run with --publish to thumbnail + push + land them in the CRM New tab,');
    console.log('or push manually then: node "<Duke>/scripts/sync-demos-to-crm.mjs" --commit --only-ready');
  }

  // ── 8) Record ONLY the ready businesses as done (failures stay queued) ──────
  await appendFile(DONE_LIST, ready.map((e) => e.slug).join('\n') + '\n');
  console.log(`\n✓ Morning batch done. ${ready.length} ready, ${failed.length} queued for finishing. ` +
    `Nothing weak shipped.`);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
