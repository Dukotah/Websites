/**
 * scraper-csv.mjs — normalize a lead CSV from the lead-scraper into the shape
 * the website factory consumes.
 *
 * The scraper exports a few layouts (a wide "ENRICHED" CRM file and a trimmed
 * "FOCUS" file), each with its own Title-Case headers. The generator wants a
 * lean lowercase set: name, website, category, city, state, phone, email,
 * address. This maps any of those layouts onto that contract by trying a list
 * of known header aliases per field — and ALSO carries the extra signal the
 * scraper already paid to find (owner name, socials) so the research bridge can
 * fuse it in instead of re-deriving it. `parseCsv` lowercases headers, so all
 * lookups here are lowercase.
 */
import { parseCsv, normCat } from '../generate-prospects.mjs';

// Return the first non-empty value among the given (lowercased) header aliases.
const pick = (row, ...keys) => {
  for (const k of keys) {
    const v = row[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
};

/**
 * Map raw scraper rows → builder rows. The 8 standard columns the generator
 * reads, plus `facebook`/`instagram`/`owner` extras the bridge fuses into the
 * research file (the generator ignores unknown columns).
 *
 * @param {object[]} rows  rows from parseCsv (lowercase keys)
 * @param {{state?: string}} [opts]  default state when the CSV has no column
 */
export function mapScraperRows(rows, { state = '' } = {}) {
  return rows
    .map((row) => {
      const rawCat = pick(row, 'category');
      // Normalize scraper category labels → the builder's themed vocabulary
      // ("electrical" → electrician, "med spa" → spa, "auto_repair" → auto-repair).
      // Keep the raw label when there's no mapping, so the render-time art engine
      // can still keyword-guess instead of getting a literal "default".
      const norm = normCat(rawCat);
      return {
      name: pick(row, 'business', 'name', 'brokerage'),
      website: pick(row, 'website', 'discovered_website', 'existing_website'),
      category: norm === 'default' ? rawCat : norm,
      city: pick(row, 'city'),
      state: pick(row, 'state') || state,
      // Prefer a validated/E.164 phone when the enriched file carries one.
      phone: pick(row, 'phone (e.164)', 'phone', 'owner_phone'),
      email: pick(row, 'email', 'owner email', 'owner_email'),
      address: pick(row, 'address'),
      // --- extras carried for fusion (not builder-standard columns) ---
      facebook: pick(row, 'facebook'),
      instagram: pick(row, 'instagram'),
      owner: pick(row, 'owner', 'owner_name'),
      };
    })
    .filter((r) => r.name);
}

/** parseCsv + mapScraperRows in one call. */
export function parseScraperCsv(text, opts) {
  return mapScraperRows(parseCsv(text), opts);
}

// The 8 columns the generator reads, in order. Extras are intentionally dropped
// from the emitted CSV — they live in the research file instead.
export const BUILDER_COLUMNS = ['name', 'website', 'category', 'city', 'state', 'phone', 'email', 'address'];

const csvCell = (v = '') => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialize builder rows to a clean CSV string (8 standard columns only). */
export function toBuilderCsv(rows) {
  const lines = [BUILDER_COLUMNS.join(',')];
  for (const r of rows) lines.push(BUILDER_COLUMNS.map((k) => csvCell(r[k])).join(','));
  return lines.join('\n') + '\n';
}
