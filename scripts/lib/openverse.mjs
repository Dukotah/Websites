/**
 * openverse.mjs — relevant, freely-licensed photos from Openverse (no API key).
 *
 * Openverse (openverse.org, run by WordPress) aggregates ~700M CC/public-domain
 * images from Flickr, museums, Wikimedia, etc. — far broader and more on-theme
 * than Wikimedia Commons alone. Anonymous access is rate-limited but key-free.
 *
 * Returns downloaded media descriptors [{path,credit,license,source,w,h}], or []
 * on any failure so callers fall back to the next tier.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://api.openverse.org/v1/images/';
const UA = 'websites-outreach/1.0 (+https://github.com/dukotah/websites)';

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

async function search(query, { aspect = 'wide', pageSize = 10 } = {}) {
  const qs = new URLSearchParams({
    q: query,
    license_type: 'commercial', // safe to use in client work
    size: 'large',
    aspect_ratio: aspect,
    mature: 'false',
    page_size: String(pageSize),
  });
  try {
    const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.results ?? [];
  } catch {
    return [];
  }
}

async function download(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const nameFor = (idx, ext) => `${idx === 0 ? 'hero' : idx === 1 ? 'story' : `photo-${idx}`}.${ext}`;

/**
 * Get up to `max` Openverse photos for the given queries (tried in order).
 * @param {string[]} queries
 */
export async function getOpenversePhotos(queries, { destDir, slug, max = 2, startIndex = 0, aspect = 'wide' } = {}) {
  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  const seen = new Set();

  for (const q of queries) {
    if (saved.length >= max) break;
    const results = await search(q, { aspect });
    for (const r of results) {
      if (saved.length >= max) break;
      // Prefer the original; fall back to Openverse's thumbnail proxy.
      const src = r.url || r.thumbnail;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      let got = await download(src);
      if (!got && r.thumbnail) got = await download(r.thumbnail);
      if (!got) continue;
      const ext = EXT_BY_MIME[got.mime] || (r.filetype === 'png' ? 'png' : 'jpg');
      if (got.buf.length < 12000) continue; // too small to be a real photo
      const idx = startIndex + saved.length;
      const fileName = nameFor(idx, ext);
      await writeFile(join(outDir, fileName), got.buf);
      saved.push({
        path: `/images/${slug}/${fileName}`,
        credit: r.creator || 'Openverse',
        license: r.license ? `${r.license} ${r.license_version ?? ''}`.trim() : 'CC',
        source: r.foreign_landing_url || r.url || '',
      });
    }
  }
  return saved;
}
