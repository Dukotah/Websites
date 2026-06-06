#!/usr/bin/env node
// crm-reconcile.mjs — pre-push sanity check: which demos are tied to a real CRM
// lead, and which aren't?
//
// Pulls the same lead CSV the CRM (Duke) reads, joins it against
// data/demo-manifest.json with the SAME keys Duke uses (leadId → existing-site
// host → business name), and prints a match-rate report so you never push blind.
// Writes the unmatched set to data/crm-unmatched-demos.json — the exact demos
// Duke can turn into new leads ("create a lead from the info it has").
//
//   node scripts/crm-reconcile.mjs        # or: npm run crm-reconcile
//
// Note: this sees only the public lead CSV, not Duke's private custom leads, so a
// demo flagged unmatched here MIGHT already match a custom lead in Duke. It's a
// bulk-list sanity check, not the source of truth — Duke does the real join.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CSV_URL =
  process.env.CRM_LEADS_CSV_URL ||
  'https://raw.githubusercontent.com/dukotah/sonoma-lead-scraper/claude/lead-data-sourcing-eyOeN/lead-tracker/data/export/ALL_COUNTIES_dedup.csv';

const hostLabel = (u) => {
  if (!u) return '';
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
};
const nameKey = (n) => (n ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function parseCSVLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchLeads() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`lead CSV ${res.status}`);
  const lines = (await res.text()).split('\n').filter(Boolean);
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (row, k) => { const i = headers.indexOf(k); return i >= 0 ? (row[i] ?? '').trim() : ''; };
  const leads = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const name = col(row, 'name') || col(row, 'business') || col(row, 'business_name');
    if (!name) continue;
    leads.push({ id: col(row, 'id'), name, website: col(row, 'website') });
  }
  return { leads, hasId: headers.includes('id'), hasWebsite: headers.includes('website') };
}

async function main() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'data', 'demo-manifest.json'), 'utf8'));
  const demos = manifest.demos ?? [];

  let leads, hasId, hasWebsite;
  try {
    ({ leads, hasId, hasWebsite } = await fetchLeads());
  } catch (e) {
    console.error(`\n✗ Could not reach the CRM lead CSV: ${e.message}`);
    console.error(`  (set CRM_LEADS_CSV_URL to override the source)\n`);
    process.exit(1);
  }

  const byId = new Map(), byHost = new Map(), byName = new Map();
  for (const l of leads) {
    if (l.id && !byId.has(l.id)) byId.set(l.id, l);
    const h = hostLabel(l.website); if (h && !byHost.has(h)) byHost.set(h, l);
    const n = nameKey(l.name); if (n && !byName.has(n)) byName.set(n, l);
  }

  const matched = [], unmatched = [];
  const by = { id: 0, host: 0, name: 0 };
  for (const d of demos) {
    let lead = null, how = '';
    if (d.leadId && byId.has(String(d.leadId))) { lead = byId.get(String(d.leadId)); how = 'id'; }
    else if (hostLabel(d.host) && byHost.has(hostLabel(d.host))) { lead = byHost.get(hostLabel(d.host)); how = 'host'; }
    else if (byName.has(nameKey(d.name))) { lead = byName.get(nameKey(d.name)); how = 'name'; }
    if (lead) { by[how]++; matched.push({ ...d, matchedBy: how, leadName: lead.name }); }
    else unmatched.push(d);
  }

  console.log(`\nCRM reconcile — ${demos.length} demo(s) vs ${leads.length} CRM leads`);
  console.log(`  source: ${CSV_URL}`);
  console.log(`  CSV has id column: ${hasId ? 'yes (exact 1:1 join available)' : 'no'} · website column: ${hasWebsite ? 'yes' : 'no'}\n`);

  if (matched.length) {
    console.log(`✓ ${matched.length} tied to a CRM lead  (id:${by.id} host:${by.host} name:${by.name})`);
    for (const m of matched) console.log(`    ✓ ${m.name}  →  ${m.matchedBy}: ${m.leadName}`);
  }
  if (unmatched.length) {
    console.log(`\n✗ ${unmatched.length} demo(s) with NO matching CRM lead — Duke can create a lead from each:`);
    for (const u of unmatched) console.log(`    ✗ ${u.name}${u.host ? `  (${u.host})` : ''}  →  ${u.demoUrl}`);
  }

  const rate = demos.length ? Math.round((matched.length / demos.length) * 100) : 0;
  console.log(`\nMATCH RATE: ${matched.length}/${demos.length} (${rate}%)`);

  await writeFile(
    join(ROOT, 'data', 'crm-unmatched-demos.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: unmatched.length, demos: unmatched }, null, 2) + '\n',
  );
  console.log(`Wrote data/crm-unmatched-demos.json (${unmatched.length}) — feed these to Duke's "create lead from demo".\n`);
}

main();
