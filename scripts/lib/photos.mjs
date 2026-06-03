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

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'websites-repo outreach factory (https://github.com/dukotah/websites)';

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

  let candidates = [];
  for (const q of queries) {
    candidates = await searchCommons(q, width);
    if (candidates.length >= max) break;
  }
  if (candidates.length === 0) return [];

  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  for (let i = 0; i < candidates.length && saved.length < max; i++) {
    const { title, info } = candidates[i];
    try {
      const src = info.thumburl ?? info.url;
      const img = await fetch(src, { headers: { 'User-Agent': UA } });
      if (!img.ok) throw new Error(`download ${img.status}`);
      const ext = (info.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const idx = startIndex + saved.length;
      const fileName = `${idx === 0 ? 'hero' : idx === 1 ? 'story' : `photo-${idx}`}.${ext}`;
      await writeFile(join(outDir, fileName), Buffer.from(await img.arrayBuffer()));

      const meta = info.extmetadata ?? {};
      saved.push({
        path: `/images/${slug}/${fileName}`,
        credit: strip(meta.Artist?.value) || 'Wikimedia Commons',
        license: strip(meta.LicenseShortName?.value) || 'See source',
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
        alt: '',
      });
    } catch {
      // skip this candidate, try the next
    }
  }
  return saved;
}
