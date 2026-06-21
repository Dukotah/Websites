/**
 * photos.mjs — best-effort REAL photos for a prospect, free and key-free.
 *
 * Searches Wikimedia Commons (no API key) for freely-licensed images matching
 * the business / its town / its category, and downloads the best couple into
 * the gallery's public images. Returns [] on any failure so the caller falls
 * back to the built-in library art. Network-dependent: if the environment
 * can't reach Commons, it simply returns [] and the library is used.
 *
 * NOTE on the photo priority chain: the strongest source — the business's OWN
 * photos already online — is found by the AGENT via web search (a judgment
 * task), not here. This module is the automated middle tier between that and
 * the generated library.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isUsablePhoto, isCommercialLicense } from './photo-score.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'websites-repo outreach factory (https://github.com/dukotah/websites)';

// Words too generic to anchor a relevance check ("X Store", "Y LLC" etc.).
const STOPWORDS = new Set(['the', 'and', 'llc', 'inc', 'co', 'company', 'shop', 'store', 'services', 'service']);

const strip = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  return res.json();
}

// Search Commons (File namespace) and return candidate {title, info} with image
// info already attached, biggest-first-ish. Best-effort: returns [] on error.
async function searchCommons(query, width) {
  try {
    const data = await api({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6', // File:
      gsrlimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime',
      iiurlwidth: String(width),
    });
    const pages = Object.values(data?.query?.pages ?? {});
    return pages
      .map((p) => ({ title: p.title, info: p.imageinfo?.[0] }))
      .filter((c) => c.info && /image\/(jpe?g|png)/.test(c.info.mime || ''));
  } catch {
    return [];
  }
}

/**
 * Try to get up to `max` real photos for a row. Builds a few queries from the
 * available CSV fields (name → category+town → town) and uses the first that
 * yields enough usable images.
 *
 * @returns {Promise<Array<{path,credit,license,source,alt}>>}
 */
export async function getRealPhotos(row, { destDir, slug, max = 2, width = 1600, startIndex = 0, queries: queryOverride } = {}) {
  const town = [row.city, row.state].filter(Boolean).join(', ');
  const queries = (queryOverride?.length
    ? queryOverride
    : [
        [row.name, town].filter(Boolean).join(' '),
        [row.category, town].filter(Boolean).join(' '),
        town,
      ]
  ).filter((q) => q && q.trim().length > 1);

  // A Commons full-text search on "<name> <town>" can surface images that merely
  // MENTION the town/business in their description (e.g. a state-capitol shot for
  // "Capital Roofing"). Build relevance tokens from the name/category so we can
  // keep only on-topic hits. (Skipped when there are none — a town-only search is
  // judged on quality alone.)
  const relevanceTokens = [row.name, row.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  // Accumulate DISTINCT candidates across ALL queries — don't stop at the first
  // query that returns "enough", because that query's hits may be off-theme.
  const seen = new Set();
  let candidates = [];
  for (const q of queries) {
    for (const c of await searchCommons(q, width)) {
      if (!c.title || seen.has(c.title)) continue;
      seen.add(c.title);
      candidates.push(c);
    }
  }
  if (relevanceTokens.length) {
    const relevant = candidates.filter((c) =>
      relevanceTokens.some((tok) => c.title.toLowerCase().includes(tok)),
    );
    // Only narrow to on-topic hits if we actually found some; otherwise keep the
    // town-level pool rather than returning nothing.
    if (relevant.length) candidates = relevant;
  }
  if (candidates.length === 0) return [];

  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  for (let i = 0; i < candidates.length && saved.length < max; i++) {
    const { title, info } = candidates[i];
    try {
      const meta = info.extmetadata ?? {};
      const license = strip(meta.LicenseShortName?.value);
      // Never ship a non-commercial / no-derivative image on a commercial demo.
      if (!isCommercialLicense(license)) continue;
      const src = info.thumburl ?? info.url;
      const img = await fetch(src, { headers: { 'User-Agent': UA } });
      if (!img.ok) throw new Error(`download ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      // Pixel-level quality gate — drop logos, diagrams, maps, sub-hero thumbs.
      if (!(await isUsablePhoto(buf))) continue;
      const ext = (info.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const idx = startIndex + saved.length;
      const fileName = `${idx === 0 ? 'hero' : idx === 1 ? 'story' : `photo-${idx}`}.${ext}`;
      await writeFile(join(outDir, fileName), buf);

      saved.push({
        path: `/images/${slug}/${fileName}`,
        credit: strip(meta.Artist?.value) || 'Wikimedia Commons',
        license: license || 'See source',
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
        alt: '',
      });
    } catch {
      // skip this candidate, try the next
    }
  }
  return saved;
}
