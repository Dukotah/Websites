/**
 * Rebuild data/outreach-links.json from ALL sites/demo-gallery/src/data/premium/*.json.
 * Mirrors the links-manifest mapping in scripts/generate.mjs (the seam the Duke CRM
 * consumes). Additive utility — does not touch the design engine or per-lead files.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREMIUM_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'premium');
const base = (process.env.GALLERY_BASE_URL || 'https://demos.copperbaytech.com').replace(/\/$/, '');

const files = (await readdir(PREMIUM_DIR)).filter((f) => f.endsWith('.json')).sort();
const links = [];
for (const f of files) {
  const c = JSON.parse(await readFile(join(PREMIUM_DIR, f), 'utf8'));
  const slug = c.slug || f.replace(/\.json$/, '');
  links.push({
    name: c.name,
    slug,
    email: c.contact?.email ?? '',
    link: `${base}/s/${slug}`,
    status: c.status ?? 'needs-review',
    photoSource: c.photoSource ?? '',
    flags: c.flags ?? [],
    category: c.category,
    area: c.area,
    claimByDate: c.outreach?.claimByDate ?? '',
    thumbnailUrl: `/thumbnails/${slug}.png`,
  });
}
await writeFile(join(ROOT, 'data', 'outreach-links.json'), JSON.stringify(links, null, 2) + '\n');
const review = links.filter((l) => l.status === 'needs-review' || l.status === 'needs_review').length;
console.log(`Wrote ${links.length} entries to data/outreach-links.json (${review} needs-review).`);
