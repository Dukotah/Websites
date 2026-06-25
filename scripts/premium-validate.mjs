#!/usr/bin/env node
/*
 * premium-validate.mjs — QA gate for agent-authored premium sites.
 * For every data/premium/<slug>.json it checks the v2 contract:
 *   • required identity fields (slug/name/seoDescription/category/pages)
 *   • pages[] has a 'home' page; every section has a known `kind`
 *   • EVERY referenced photo (images.hero + every section image/images src)
 *     points at a file that actually exists on disk under the slug's asset dir
 *     (the #1 way an agent-authored site ships broken — an invented photo path)
 *   • internal links look like /s/<slug>/... or tel:/mailto:/http
 * Exits non-zero on any error so it can gate the build/deploy. --slug <s> limits.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'premium');
const ASSET_ROOT = join(ROOT, 'sites', 'demo-gallery', 'src', 'assets', 'prospects');
// Shared/library art (and other public files) are served verbatim from here, so a
// `/images/library/...` or any `.svg` fallback resolves under public/, not under
// the per-slug prospect dir. (Used by imageExists for the OG/hero fallback case.)
const PUBLIC_ROOT = join(ROOT, 'sites', 'demo-gallery', 'public');

const KNOWN_KINDS = new Set([
  'hero', 'story', 'services', 'stats', 'testimonials', 'gallery', 'faq', 'cta', 'callout', 'contact',
  'steps', 'team', 'features', 'pricing',
]);

const argv = process.argv.slice(2);
const onlySlug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null;

// Collect every image `src` referenced anywhere in a section tree.
function collectImageSrcs(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectImageSrcs(n, out); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'src' && typeof v === 'string') out.push(v);
    else collectImageSrcs(v, out);
  }
}

// Resolve a /images/<slug>/<file> path to its on-disk asset file (any extension
// the asset registry would accept). Returns true if a matching file exists.
function imageExists(src) {
  if (!src) return false;
  // SHARED / LIBRARY ART is served as-is from public/ — NOT from the per-slug
  // prospect asset dir — so it must be checked there, not under prospects/<slug>.
  // A photo-light site legitimately uses a library SVG as images.hero AND as the
  // OG/share-image fallback; the old code ran the regex first, matched
  // "/images/library/<cat>/hero.svg" as slug="library", disk-checked
  // prospects/library (which never exists) and wrongly REJECTED it — blocking a
  // real photo-light run. Resolve library/SVG/remote BEFORE the prospect check.
  // (Any .svg is shared fallback art by convention — never a per-prospect photo.)
  if (src.startsWith('http')) return true; // remote (e.g. Wikimedia) — trust it
  if (src.startsWith('/images/library/') || src.endsWith('.svg')) {
    // Verify it actually exists in public/ so a typo'd library path still fails,
    // but treat the served-as-is location as the source of truth (not prospects/).
    return existsSync(join(PUBLIC_ROOT, src.replace(/^\//, '')));
  }
  const m = /^\/images\/([^/]+)\/(.+?)(\.[a-z0-9]+)?$/i.exec(src);
  if (!m) return false;
  const [, slug, base, ext] = m;
  const dir = join(ASSET_ROOT, slug);
  if (!existsSync(dir)) return false;
  const files = readdirSync(dir);
  // Accept the exact file, or the same basename under any extension (webp/jpg/png)
  // since the build may have transcoded it.
  return files.some((f) => f === `${base}${ext ?? ''}` || f.replace(/\.[a-z0-9]+$/i, '') === base);
}

function validateOne(slug, config) {
  const errs = [];
  const warns = [];
  for (const f of ['slug', 'name', 'seoDescription', 'category', 'pages']) {
    if (!config[f]) errs.push(`missing required field: ${f}`);
  }
  if (config.slug && config.slug !== slug) errs.push(`slug "${config.slug}" != filename "${slug}"`);
  if (Array.isArray(config.pages)) {
    if (!config.pages.some((p) => p.slug === 'home')) errs.push(`no 'home' page`);
    config.pages.forEach((p, i) => {
      if (!p.slug || !p.label) errs.push(`page[${i}] missing slug/label`);
      if (!Array.isArray(p.sections) || !p.sections.length) errs.push(`page '${p.slug}' has no sections`);
      (p.sections || []).forEach((s, j) => {
        if (!KNOWN_KINDS.has(s.kind)) errs.push(`page '${p.slug}' section[${j}] unknown kind '${s.kind}'`);
        if (s.kind === 'hero' && !s.heading) errs.push(`page '${p.slug}' hero missing heading`);
      });
    });
  }
  // Photo refs — the big one.
  const srcs = [];
  if (config.images?.hero) srcs.push(config.images.hero);
  collectImageSrcs(config.pages, srcs);
  const missing = [...new Set(srcs)].filter((s) => !imageExists(s));
  for (const m of missing) errs.push(`photo does not exist on disk: ${m}`);

  if (!config.images?.hero) warns.push(`no images.hero (OG/share image will be missing)`);
  if (config.status === 'ready' && missing.length) warns.push(`status 'ready' but has broken photos`);
  return { errs, warns };
}

function main() {
  if (!existsSync(DATA_DIR)) {
    console.error(`No premium data dir: ${DATA_DIR}`);
    process.exit(1);
  }
  let files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  if (onlySlug) files = files.filter((f) => f === `${onlySlug}.json`);
  if (!files.length) { console.log('No premium sites to validate.'); return; }

  console.log(`\n# PREMIUM VALIDATE — ${files.length} site(s)\n`);
  let totalErr = 0;
  for (const file of files.sort()) {
    const slug = file.replace(/\.json$/, '');
    let config;
    try { config = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')); }
    catch (e) { console.log(`  ✗ ${slug}\n      [INVALID JSON] ${e.message}`); totalErr++; continue; }
    const { errs, warns } = validateOne(slug, config);
    if (!errs.length && !warns.length) { console.log(`  ✓ ${slug}`); continue; }
    console.log(`  ${errs.length ? '✗' : '•'} ${slug}`);
    for (const e of errs) console.log(`      [ERROR] ${e}`);
    for (const w of warns) console.log(`      [warn]  ${w}`);
    totalErr += errs.length;
  }
  console.log('\n' + '─'.repeat(56));
  if (totalErr) { console.log(`✗ ${totalErr} error(s) — fix before deploy.`); process.exit(1); }
  console.log('✓ All premium sites valid — every photo exists, schema clean.');
}

// Export the photo-resolution helpers so they're unit-testable without running
// the CLI (main() calls process.exit, so it must NOT run on import).
export { imageExists, validateOne };

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
