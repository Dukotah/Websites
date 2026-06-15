#!/usr/bin/env node
/*
 * push-to-crm.mjs — close the loop between the /websites factory and the Duke CRM.
 *
 * The factory builds premium demo sites (/s/<slug>) and writes
 * data/outreach-links.json. This script
 * pushes each {name, link} to the CRM's token-gated endpoint
 *   POST {CRM_BASE_URL}/api/crm/admin/preview-url
 * which attaches the demo-site URL to the matching lead BY BUSINESS NAME. Once
 * pushed, the lead shows a "Demo" badge in the call queue and a "Preview site we
 * built" link in the lead panel — no manual copy-paste.
 *
 * Env (see .env.example):
 *   CRM_BASE_URL     e.g. https://your-duke-deploy.vercel.app   (required)
 *   CRM_ADMIN_TOKEN  shared secret matching Duke's CRM_ADMIN_TOKEN   (required)
 *   GALLERY_BASE_URL only used by the fallback (manifest absent) to build links
 *
 * Usage:
 *   npm run push-to-crm                      # push data/outreach-links.json
 *   node scripts/push-to-crm.mjs <file>      # push a specific manifest
 *   node scripts/push-to-crm.mjs --dry-run   # show what WOULD be pushed
 *   node scripts/push-to-crm.mjs --only-ready # skip prospects flagged needs-review
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PREMIUM_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'premium');

function parseArgs(argv) {
  const opts = { dryRun: false, onlyReady: false, manifest: null };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--only-ready') opts.onlyReady = true;
    else if (arg.startsWith('--')) { /* ignore unknown flags */ }
    else opts.manifest = arg;
  }
  return opts;
}

// Read the generated manifest if present; otherwise reconstruct entries from the
// committed prospect JSON files so a demo works even when the (gitignored)
// manifest hasn't been regenerated this session.
async function loadEntries(manifestPath) {
  if (existsSync(manifestPath)) {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
    return {
      source: manifestPath,
      entries: raw.map((r) => ({
        name: r.name,
        link: r.link,
        status: r.status ?? 'ready',
      })),
    };
  }

  // Fallback: scan PREMIUM configs + GALLERY_BASE_URL. Links are /s/<slug>.
  const base = (process.env.GALLERY_BASE_URL || '').replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      `No manifest at ${manifestPath} and GALLERY_BASE_URL is unset.\n` +
        `Either run "npm run generate -- data/<file>.csv" first, or set ` +
        `GALLERY_BASE_URL so links can be reconstructed from the premium files.`,
    );
  }
  const files = (await readdir(PREMIUM_DIR)).filter((f) => f.endsWith('.json'));
  const entries = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/, '');
    const cfg = JSON.parse(await readFile(join(PREMIUM_DIR, file), 'utf8'));
    if (!cfg?.name) continue;
    // Carry the real status so --only-ready can still skip flagged demos when
    // reconstructing from premium files (the manifest may be absent).
    entries.push({ name: cfg.name, link: `${base}/s/${slug}`, status: cfg.status ?? 'ready' });
  }
  return { source: `${PREMIUM_DIR} (+ GALLERY_BASE_URL)`, entries };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifestPath = opts.manifest
    ? resolve(opts.manifest)
    : join(ROOT, 'data', 'outreach-links.json');

  const crmUrl = (process.env.CRM_BASE_URL || '').replace(/\/+$/, '');
  const token = process.env.CRM_ADMIN_TOKEN || '';

  if (!opts.dryRun && (!crmUrl || !token)) {
    console.error(
      'Missing config. Set CRM_BASE_URL and CRM_ADMIN_TOKEN (matching Duke).\n' +
        '  export CRM_BASE_URL=https://your-duke-deploy.vercel.app\n' +
        '  export CRM_ADMIN_TOKEN=<same secret as Duke>\n' +
        '(or pass --dry-run to preview without pushing)',
    );
    process.exit(1);
  }

  const { source, entries: all } = await loadEntries(manifestPath);
  let entries = all.filter((e) => e.name && e.link);
  const dropped = all.length - entries.length;

  if (opts.onlyReady) {
    const before = entries.length;
    entries = entries.filter((e) => e.status !== 'needs-review');
    const skipped = before - entries.length;
    if (skipped) console.log(`Skipping ${skipped} prospect(s) flagged needs-review (--only-ready).`);
  }

  if (!entries.length) {
    console.error(`No pushable {name, link} entries found in ${source}.`);
    process.exit(1);
  }

  console.log(`Source: ${source}`);
  console.log(`Pushing ${entries.length} demo link(s) to the CRM${dropped ? ` (${dropped} skipped: missing name/link)` : ''}:`);
  for (const e of entries) {
    const flag = e.status === 'needs-review' ? '  ⚠ needs-review' : '';
    console.log(`  · ${e.name}  →  ${e.link}${flag}`);
  }

  const needsReview = entries.filter((e) => e.status === 'needs-review').length;
  if (needsReview && !opts.onlyReady) {
    console.log(
      `\n⚠ ${needsReview} of these are flagged NEEDS-REVIEW and will be pushed as-is.\n` +
        `  A flagged demo is unfinished (thin facts, no real photos, generic hours…) and\n` +
        `  reads as low-effort to the prospect. Re-run with --only-ready to skip them.`,
    );
  }

  if (opts.dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  const payload = { entries: entries.map((e) => ({ name: e.name, link: e.link })) };
  const res = await fetch(`${crmUrl}/api/crm/admin/preview-url`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    console.error(`\nCRM rejected the push (HTTP ${res.status}):`);
    console.error(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    if (res.status === 401) {
      console.error('→ Check CRM_ADMIN_TOKEN matches the value set on the Duke deployment.');
    }
    process.exit(1);
  }

  const linked = body?.linked ?? '?';
  const skipped = Array.isArray(body?.skipped) ? body.skipped : [];
  console.log(`\n✓ CRM linked ${linked} lead(s).`);
  if (skipped.length) {
    console.log(`  ${skipped.length} not matched to a lead (name mismatch?): ${skipped.join(', ')}`);
    console.log('  → These business names had no matching lead in the CRM queue.');
  }
  console.log('Open the CRM call queue — matched leads now show a "Demo" badge.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
