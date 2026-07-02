#!/usr/bin/env node
/*
 * backfill-ids.mjs — populate the STABLE Overture `id` on existing outreach-links
 * entries whose id is empty, by resolving the deduped export via canonical
 * matchKey. Closes the middle of the "id travels every handoff" seam for demos
 * that were written before register-bespoke carried the id.
 *
 * NEVER invents an id: an entry with no export match keeps id:"" (the CRM then
 * falls back to the back-compat name join). Idempotent — re-runnable.
 *
 *   node scripts/backfill-ids.mjs            # write matched ids into outreach-links.json
 *   node scripts/backfill-ids.mjs --dry-run  # report only
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/paths.mjs';
import { matchKey } from './lib/match-key.mjs';
import { resolveOvertureRow, loadOvertureIndex } from './lib/overture-id.mjs';

const DRY = process.argv.includes('--dry-run');
const path = join(ROOT, 'data', 'outreach-links.json');
if (!existsSync(path)) { console.error(`No manifest at ${path}`); process.exit(1); }

const arr = JSON.parse(readFileSync(path, 'utf8'));
loadOvertureIndex();

let filled = 0, already = 0, missed = 0;
for (const e of arr) {
  if (!e || !e.name) continue;
  const mk = e.matchKey || matchKey(e.name);
  if (!e.matchKey) e.matchKey = mk; // ensure the join key is present too
  if (e.id) { already++; continue; }
  const row = resolveOvertureRow(mk);
  if (row?.id) { e.id = row.id; filled++; console.log(`  ✓ ${e.name.padEnd(28)} id ${row.id}`); }
  else { missed++; console.log(`  · ${e.name.padEnd(28)} (no export match — name-join fallback)`); }
}

console.log(`\n${filled} filled · ${already} already had an id · ${missed} no match (${arr.length} total)`);
if (DRY) { console.log('--dry-run: nothing written.'); process.exit(0); }
writeFileSync(path, JSON.stringify(arr, null, 2) + '\n');
console.log(`Wrote ${path}`);
