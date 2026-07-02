/**
 * overture-id.mjs — resolve the STABLE Overture business `id` for a lead by its
 * canonical join key (matchKey), reading the real deduped export.
 *
 * This is the missing middle of the "the id must travel every handoff" seam: the
 * scraper emits the id, the CRM prefers it, but the demo manifest historically
 * dropped it. Given a demo's matchKey (or raw name), this finds the matching row
 * in the Overture export and returns its stable `id` so the manifest can carry it.
 *
 * NEVER invents an id: a miss returns "" and the caller records an empty id
 * (which the CRM treats as "fall back to fuzzy name") rather than a wrong key.
 *
 * Source (override with OVERTURE_EXPORT_CSV):
 *   C:/Users/dukot/projects/sonoma-lead-scraper/lead-tracker/data/export/ALL_COUNTIES_dedup.csv
 */
import { readFileSync, existsSync } from 'node:fs';
import { matchKey } from './match-key.mjs';

const DEFAULT_EXPORT =
  'C:/Users/dukot/projects/sonoma-lead-scraper/lead-tracker/data/export/ALL_COUNTIES_dedup.csv';

/** Quote-aware split of one CSV line into fields (handles "..,.." and "" escapes). */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

let _index = null; // Map<matchKey, { id, name, category, city, phone, email }>

/**
 * Build (and cache) a matchKey -> row index from the export. If two rows share a
 * matchKey, the FIRST wins and a collision is not silently overwritten (the
 * export is already deduped, so this is rare).
 */
export function loadOvertureIndex(csvPath = process.env.OVERTURE_EXPORT_CSV || DEFAULT_EXPORT) {
  if (_index) return _index;
  _index = new Map();
  if (!existsSync(csvPath)) {
    console.warn(`[overture-id] export not found at ${csvPath} — ids will be empty (fuzzy-name fallback).`);
    return _index;
  }
  const text = readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const col = (n) => header.indexOf(n);
  const iId = col('id');
  const iName = col('name');
  const iCat = col('category');
  const iCity = col('city');
  const iPhone = col('phone_fmt') >= 0 ? col('phone_fmt') : col('phone');
  const iEmail = col('email');
  if (iId < 0 || iName < 0) {
    console.warn('[overture-id] export missing id/name columns — ids will be empty.');
    return _index;
  }
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r]) continue;
    const f = splitCsvLine(lines[r]);
    const name = (f[iName] || '').trim();
    const id = (f[iId] || '').trim();
    if (!name || !id) continue;
    const key = matchKey(name);
    if (!key || _index.has(key)) continue;
    _index.set(key, {
      id,
      name,
      category: iCat >= 0 ? (f[iCat] || '').trim() : '',
      city: iCity >= 0 ? (f[iCity] || '').trim() : '',
      phone: iPhone >= 0 ? (f[iPhone] || '').trim() : '',
      email: iEmail >= 0 ? (f[iEmail] || '').trim() : '',
    });
  }
  return _index;
}

/** Resolve the stable Overture id for a business NAME. Returns "" on a miss. */
export function resolveOvertureId(name, csvPath) {
  const key = matchKey(name);
  const row = loadOvertureIndex(csvPath).get(key);
  return row ? row.id : '';
}

/** Resolve by an already-computed matchKey. Returns the row or null. */
export function resolveOvertureRow(matchKeyValue, csvPath) {
  return loadOvertureIndex(csvPath).get(matchKeyValue) || null;
}
