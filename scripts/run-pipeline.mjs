#!/usr/bin/env node
/*
 * run-pipeline.mjs — one command to take a CSV all the way to deployed demo
 * sites with their links dropped onto the matching CRM leads.
 *
 * Chains the outreach factory so a whole batch ships with a single invocation,
 * and FAILS CLOSED: if the build breaks or the audit finds a critical issue, it
 * stops before anything is pushed or linked.
 *
 * Stages (each skippable):
 *   1. generate   npm run generate-prospects -- <csv>
 *   2. build      build the gallery (catches breakage a grep/compile misses)
 *   3. audit      node scripts/audit.mjs   (non-zero exit on criticals → gate)
 *   4. deploy     git add/commit/push      (Vercel rebuilds the gallery)
 *   5. crm        npm run push-to-crm      (drop demo links onto leads)
 *   6. send       POST CRM auto-outreach   (cold emails — OFF unless --send)
 *
 * Usage:
 *   npm run pipeline -- --csv data/leads.csv
 *   npm run pipeline -- --csv data/leads.csv --dry-run     # preview, no outward effects
 *   npm run pipeline -- --csv data/leads.csv --send        # also fire outreach (preview)
 *   npm run pipeline -- --csv data/leads.csv --send --confirm   # actually send emails
 *   npm run pipeline -- --skip-generate --no-deploy        # just (re)push existing links
 *
 * Flags:
 *   --csv <f>        input CSV (required unless --skip-generate)
 *   --skip-generate  reuse the prospect files already on disk
 *   --no-build       skip the gallery build
 *   --no-audit       skip the mechanical QA gate (not recommended)
 *   --no-deploy      don't git commit/push (no Vercel rebuild)
 *   --no-crm         don't push demo links to the CRM
 *   --send           include the outreach send stage (defaults to a dry preview)
 *   --confirm        with --send, actually deliver (otherwise it's a preview)
 *   --dry-run        run local checks only; no commit/push/crm-write/send
 *   --message "..."  commit message for the deploy step
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const o = {
    csv: null, skipGenerate: false, build: true, audit: true, deploy: true,
    crm: true, send: false, confirm: false, dryRun: false, message: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') o.csv = argv[++i];
    else if (a === '--skip-generate') o.skipGenerate = true;
    else if (a === '--no-build') o.build = false;
    else if (a === '--no-audit') o.audit = false;
    else if (a === '--no-deploy') o.deploy = false;
    else if (a === '--no-crm') o.crm = false;
    else if (a === '--send') o.send = true;
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--message') o.message = argv[++i];
  }
  return o;
}

let stepNum = 0;
function banner(title) {
  stepNum++;
  console.log(`\n\x1b[1m\x1b[36m── ${stepNum}. ${title} ──\x1b[0m`);
}
function run(cmd, opts = {}) {
  console.log(`\x1b[2m$ ${cmd}\x1b[0m`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}
function skip(why) {
  console.log(`\x1b[2m  (skipped — ${why})\x1b[0m`);
}

async function sendOutreach({ dryRun }) {
  const crmUrl = (process.env.CRM_BASE_URL || '').replace(/\/+$/, '');
  const token = process.env.CRM_ADMIN_TOKEN || '';
  if (!crmUrl || !token) {
    throw new Error('Outreach send needs CRM_BASE_URL and CRM_ADMIN_TOKEN.');
  }
  const res = await fetch(`${crmUrl}/api/crm/admin/auto-outreach`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ dryRun }),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (res.status === 404) {
    console.log('  CRM auto-outreach endpoint not deployed yet — skipping send.');
    console.log('  (Reps can still send from the CRM Email/BulkOutreach tab.)');
    return;
  }
  if (!res.ok) {
    throw new Error(`auto-outreach failed (HTTP ${res.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  const verb = dryRun ? 'WOULD send' : 'Sent';
  console.log(`  ${verb} ${body.count ?? body.sent ?? '?'} email(s); ${body.skipped ?? 0} skipped (suppressed/no-email/cap).`);
  if (Array.isArray(body.recipients) && body.recipients.length) {
    for (const r of body.recipients.slice(0, 20)) console.log(`    · ${r.name ?? r.email} ${r.previewUrl ? '→ ' + r.previewUrl : ''}`);
    if (body.recipients.length > 20) console.log(`    … +${body.recipients.length - 20} more`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  console.log('\x1b[1mOutreach pipeline\x1b[0m' + (o.dryRun ? '  \x1b[33m(dry-run — no outward effects)\x1b[0m' : ''));

  if (!o.skipGenerate && !o.csv) {
    console.error('Need --csv <file> (or --skip-generate to reuse existing prospect files).');
    process.exit(1);
  }
  if (o.csv && !existsSync(resolve(ROOT, o.csv))) {
    console.error(`CSV not found: ${o.csv}`);
    process.exit(1);
  }

  // 1. Generate
  banner('Generate prospect sites');
  if (o.skipGenerate) skip('--skip-generate');
  else run(`npm run generate-prospects -- ${JSON.stringify(o.csv)}`);

  // 2. Build (local, safe — always worth running)
  banner('Build the gallery');
  if (!o.build) skip('--no-build');
  else run('npm install --prefix sites/demo-gallery && npm run build --prefix sites/demo-gallery');

  // 3. Audit gate
  banner('Audit (mechanical QA gate)');
  if (!o.audit) skip('--no-audit');
  else run('node scripts/audit.mjs'); // non-zero exit aborts the pipeline here

  // 4. Deploy
  banner('Deploy (commit + push → Vercel rebuild)');
  if (o.dryRun) skip('--dry-run: not pushing');
  else if (!o.deploy) skip('--no-deploy');
  else {
    const msg = o.message || `Pipeline batch: ${o.csv ? o.csv.split('/').pop() : 'prospects'}`;
    run('git add sites/demo-gallery/src/data/prospects sites/demo-gallery/src/assets/prospects data');
    // Commit only if something is staged.
    try { execSync('git diff --cached --quiet', { cwd: ROOT }); skip('nothing to commit'); }
    catch {
      run(`git commit -m ${JSON.stringify(msg)}`);
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
      run(`git push -u origin ${branch}`);
    }
  }

  // 5. Push links to CRM
  banner('Link demos to CRM leads');
  if (!o.crm) skip('--no-crm');
  else run(`node scripts/push-to-crm.mjs${o.dryRun ? ' --dry-run' : ''}`);

  // 6. Outreach send (off unless asked; preview unless --confirm)
  banner('Send cold outreach');
  if (!o.send) skip('--send not set');
  else {
    const dryRun = o.dryRun || !o.confirm;
    if (dryRun && !o.dryRun) console.log('  Preview only — add --confirm to actually deliver.');
    await sendOutreach({ dryRun });
  }

  console.log('\n\x1b[1m\x1b[32m✓ Pipeline complete.\x1b[0m' + (o.dryRun ? ' (dry-run)' : ''));
}

main().catch((err) => { console.error(`\n\x1b[31m✗ ${err?.message || err}\x1b[0m`); process.exit(1); });
