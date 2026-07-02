#!/usr/bin/env node
/*
 * register-bespoke.mjs — take a hand-built _bespoke-* Astro site and plug it into
 * the whole funnel in ONE idempotent, per-site command:
 *
 *   1. BUILD    the bespoke site under a /b/<slug>/ base so the existing gallery
 *               Vercel deploy can host it as a sub-path (no per-site Vercel
 *               project sprawl — one deploy serves /s/<slug> templates AND
 *               /b/<slug>/ bespoke flagships).
 *   2. THUMBNAIL a 1200x630 branded email card (Sharp, key-free).
 *   3. STABLE ID resolve the Overture `id` by canonical matchKey from the real
 *               deduped export, so the id travels the handoff (never invented).
 *   4. SEAM     upsert the entry into data/outreach-links.json WITH id + matchKey.
 *   5. GALLERY  register an external card in data/bespoke-registry.json so the
 *               demo dashboard lists the flagship alongside the template demos.
 *   6. CRM      POST the demo to the CRM (preferred-by-id) so it attaches to the
 *               matching lead. (Only with --commit; needs CRM_BASE_URL + token.)
 *
 * The best sites in this business (21 _bespoke-* folders) currently reach NOBODY:
 * none deployed, none in the gallery, none attached to a lead. This closes that.
 *
 * Usage:
 *   node scripts/register-bespoke.mjs <slug-or-path> [flags]
 *   node scripts/register-bespoke.mjs csi --dry-run
 *   node scripts/register-bespoke.mjs ../_bespoke-csi --category "general-contractor" --commit
 *
 * Flags:
 *   --dry-run           build + thumbnail + resolve id, but mutate NOTHING tracked
 *                       and do NOT call the CRM (the proof mode).
 *   --commit            actually POST the demo to the CRM (needs env below).
 *   --name/--city/--email/--phone/--category/--brand  override extracted meta.
 *   --status <ready|needs-review>   seam status (default: ready).
 *   --skip-build        reuse an existing dist (faster re-runs).
 *   --base-url <url>    gallery base (default GALLERY_BASE_URL or demos.copperbaytech.com).
 *
 * CRM env (only for --commit): CRM_BASE_URL, CRM_ADMIN_TOKEN.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, basename, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { ROOT } from './lib/paths.mjs';
import { matchKey } from './lib/match-key.mjs';
import { resolveOvertureRow, loadOvertureIndex } from './lib/overture-id.mjs';

const PROJECTS = resolve(ROOT, '..');
const GALLERY = join(ROOT, 'sites', 'demo-gallery');
const OUTREACH_LINKS = join(ROOT, 'data', 'outreach-links.json');
const BESPOKE_REGISTRY = join(ROOT, 'data', 'bespoke-registry.json');
const THUMBS_DATA = join(ROOT, 'data', 'thumbnails');
const THUMBS_PUB = join(GALLERY, 'public', 'thumbnails');

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const target = positional[0];
if (!target) { console.error('Usage: node scripts/register-bespoke.mjs <slug-or-path> [--dry-run|--commit]'); process.exit(1); }
const DRY = has('--dry-run');
const COMMIT = has('--commit');
const SKIP_BUILD = has('--skip-build');
const STATUS = val('--status', 'ready');
const BASE_URL = (val('--base-url') || process.env.GALLERY_BASE_URL || 'https://demos.copperbaytech.com')
  .replace(/\/+$/, '')
  .replace(/^(?!https?:\/\/)/, 'https://');

// --- locate the bespoke dir + slug -----------------------------------------
function resolveDir(t) {
  const candidates = [
    isAbsolute(t) ? t : null,
    join(PROJECTS, t),
    join(PROJECTS, `_bespoke-${t}`),
    join(PROJECTS, t.replace(/^_bespoke-/, '')),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, 'astro.config.mjs')) || existsSync(join(c, 'package.json'))) return c;
  return null;
}
const dir = resolveDir(target);
if (!dir) { console.error(`Could not find a bespoke Astro project for "${target}" under ${PROJECTS}`); process.exit(1); }
const folder = basename(dir).replace(/^_bespoke-/, '');

// --- extract business meta (register.json > site.ts biz{} > flags) ----------
function extractMeta() {
  const meta = {};
  const regPath = join(dir, 'register.json');
  if (existsSync(regPath)) Object.assign(meta, JSON.parse(readFileSync(regPath, 'utf8')));
  // Parse a `biz = { ... }` block from src/lib/site.ts (the _bespoke convention).
  const sitePaths = ['src/lib/site.ts', 'src/lib/site.js', 'src/config.ts'].map((p) => join(dir, p));
  const sp = sitePaths.find(existsSync);
  if (sp) {
    const src = readFileSync(sp, 'utf8');
    const grab = (k) => { const m = src.match(new RegExp(`\\b${k}\\s*:\\s*"([^"]*)"`)); return m ? m[1] : ''; };
    meta.name ??= grab('name');
    meta.short ??= grab('short') || meta.name;
    meta.city ??= grab('city');
    meta.email ??= grab('email');
    meta.phone ??= grab('phone');
  }
  // CLI overrides always win.
  for (const k of ['name', 'city', 'email', 'phone', 'category', 'brand', 'short']) {
    const v = val(`--${k}`);
    if (v) meta[k] = v;
  }
  return meta;
}
const meta = extractMeta();
if (!meta.name) { console.error(`No business name found for ${folder}. Add a register.json or pass --name.`); process.exit(1); }
const slug = (val('--slug') || (meta.short || meta.name)).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const mk = matchKey(meta.name);
const brand = meta.brand || '#1f2933';
const category = meta.category || 'custom';
const area = meta.city || '';
const link = `${BASE_URL}/b/${slug}/`;

// --- resolve the stable Overture id (never invented) ------------------------
// Prefer an id carried directly in the bespoke folder's register.json (the
// cleanest handoff — the scraper already knew it); otherwise resolve it from the
// Overture export by canonical matchKey. NEVER invent one on a miss.
loadOvertureIndex();
const row = resolveOvertureRow(mk);
const overtureId = (meta.id || (row ? row.id : '')).trim();

console.log(`\n=== register-bespoke: ${meta.name} ===`);
console.log(`  dir        ${dir}`);
console.log(`  slug       ${slug}`);
console.log(`  matchKey   ${mk}`);
console.log(`  id         ${overtureId || '(no Overture match — CRM will fall back to name join)'}`);
console.log(`  link       ${link}`);
console.log(`  mode       ${DRY ? 'DRY-RUN (no tracked writes, no CRM)' : COMMIT ? 'COMMIT (writes + CRM)' : 'WRITE (files only, no CRM)'}`);

// --- 1. BUILD under /b/<slug>/ base ----------------------------------------
// _bespoke-* node_modules are installed under WSL Ubuntu (Linux .bin symlinks, no
// Windows .cmd shims), so on win32 the build MUST run through WSL. Elsewhere run
// npm directly.
function toWslPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
}
function build() {
  if (SKIP_BUILD && existsSync(join(dir, 'dist', 'index.html'))) { console.log('\n[build] --skip-build: reusing existing dist'); return; }
  const cfg = join(dir, 'astro.config.register.mjs');
  writeFileSync(cfg, `import base from './astro.config.mjs';\nexport default { ...base, base: '/b/${slug}', build: { ...(base.build || {}), assets: '_astro' } };\n`);
  console.log('\n[build] astro build --config astro.config.register.mjs …');
  try {
    if (process.platform === 'win32') {
      const wsl = toWslPath(dir);
      execSync(`wsl -d Ubuntu -- bash -lc ${JSON.stringify(`cd '${wsl}' && npm run build -- --config astro.config.register.mjs`)}`, { stdio: 'inherit' });
    } else {
      execSync('npm run build -- --config astro.config.register.mjs', { cwd: dir, stdio: 'inherit' });
    }
  } finally {
    try { rmSync(cfg); } catch {}
  }
  if (!existsSync(join(dir, 'dist', 'index.html'))) throw new Error('build produced no dist/index.html');
}

// --- 2. THUMBNAIL (branded 1200x630 card) ----------------------------------
async function makeThumb() {
  const W = 1200, H = 630;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  // Try a real hero photo from the built site; else a solid brand card.
  let hero = null;
  for (const d of [join(dir, 'dist', 'img'), join(dir, 'public', 'img'), join(dir, 'dist', '_astro')]) {
    if (!existsSync(d)) continue;
    const f = readdirSync(d).find((x) => /\.(jpe?g|png|webp|avif)$/i.test(x) && /hero|cover|banner|main/i.test(x))
           || readdirSync(d).find((x) => /\.(jpe?g|png|webp)$/i.test(x));
    if (f) { hero = join(d, f); break; }
  }
  let base;
  if (hero) {
    const photo = await sharp(hero).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
    const scrim = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0.74"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
    base = await sharp(photo).composite([{ input: scrim, top: 0, left: 0 }]).toBuffer();
  } else {
    base = await sharp({ create: { width: W, height: H, channels: 3, background: brand } }).png().toBuffer();
  }
  const headline = meta.name.length > 34 ? meta.name.slice(0, 33).trimEnd() + '…' : meta.name;
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><style>.k{font:700 26px Arial,sans-serif;letter-spacing:3px;fill:rgba(255,255,255,0.85)}.n{font:800 60px Arial,sans-serif;fill:#fff}.u{font:600 28px Arial,sans-serif;fill:rgba(255,255,255,0.85)}</style><circle cx="${W / 2}" cy="248" r="62" fill="rgba(255,255,255,0.92)"/><path d="M ${W / 2 - 20} 216 L ${W / 2 - 20} 280 L ${W / 2 + 36} 248 Z" fill="${brand}"/><text x="64" y="452" class="k">A NEW WEBSITE — BUILT FOR YOU</text><text x="64" y="524" class="n">${esc(headline)}</text><text x="64" y="572" class="u">${esc(link.replace(/^https?:\/\//, ''))}</text></svg>`);
  mkdirSync(THUMBS_DATA, { recursive: true });
  const out = join(THUMBS_DATA, `${slug}.png`);
  await sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(out);
  console.log(`\n[thumb] ${hero ? '(hero photo)' : '(brand card)'} → data/thumbnails/${slug}.png`);
  if (!DRY) { mkdirSync(THUMBS_PUB, { recursive: true }); cpSync(out, join(THUMBS_PUB, `${slug}.png`)); }
  return `/thumbnails/${slug}.png`;
}

// --- 4/5. SEAM + GALLERY upserts (idempotent by slug) ----------------------
function upsertJson(path, entry, keyField = 'slug') {
  let arr = [];
  if (existsSync(path)) { try { arr = JSON.parse(readFileSync(path, 'utf8')); } catch { arr = []; } }
  if (!Array.isArray(arr)) arr = [];
  const i = arr.findIndex((e) => e[keyField] === entry[keyField]);
  if (i >= 0) arr[i] = { ...arr[i], ...entry };
  else arr.push(entry);
  writeFileSync(path, JSON.stringify(arr, null, 2) + '\n');
  return i >= 0 ? 'updated' : 'added';
}

// --- 6. CRM attach (preferred-by-id) ---------------------------------------
async function attachCrm(thumbnailUrl) {
  const crmUrl = (process.env.CRM_BASE_URL || '').replace(/\/+$/, '');
  const token = process.env.CRM_ADMIN_TOKEN || '';
  if (!crmUrl || !token) { console.warn('\n[crm] CRM_BASE_URL / CRM_ADMIN_TOKEN unset — skipping CRM attach.'); return; }
  const payload = { entries: [{ name: meta.name, link, id: overtureId, matchKey: mk, status: STATUS, category, area, thumbnailUrl, slug }] };
  const res = await fetch(`${crmUrl}/api/crm/admin/preview-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) { console.error(`\n[crm] rejected (HTTP ${res.status}): ${body}`); return; }
  console.log(`\n[crm] attached — ${body}`);
}

// --- run --------------------------------------------------------------------
async function main() {
  if (!SKIP_BUILD || DRY) build(); else console.log('\n[build] skipped');
  const thumbnailUrl = await makeThumb();

  const seamEntry = {
    id: overtureId,
    matchKey: mk,
    name: meta.name,
    slug,
    email: meta.email || '',
    phone: meta.phone || '',
    website: '',
    link,
    status: STATUS,
    tier: 'bespoke',
    photoSource: 'bespoke',
    flags: [],
    category,
    area,
    claimByDate: '',
    thumbnailUrl,
  };
  const galleryCard = { slug, name: meta.name, link, category, area, thumbnailUrl, tier: 'bespoke', status: STATUS };

  if (DRY) {
    console.log('\n[dry-run] would COPY   dist → sites/demo-gallery/public/b/' + slug + '/');
    console.log('[dry-run] would UPSERT data/outreach-links.json:');
    console.log(JSON.stringify(seamEntry, null, 2));
    console.log('[dry-run] would UPSERT data/bespoke-registry.json (gallery card):');
    console.log(JSON.stringify(galleryCard, null, 2));
    console.log('[dry-run] would POST  the demo to the CRM by id (with --commit + CRM env).');
    console.log('\n[dry-run] complete — nothing tracked was written, CRM untouched.');
    return;
  }

  // 3. host under the gallery deploy at /b/<slug>/
  const dest = join(GALLERY, 'public', 'b', slug);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(dir, 'dist'), dest, { recursive: true });
  console.log(`\n[host] copied dist → sites/demo-gallery/public/b/${slug}/  (served at ${link})`);

  console.log(`[seam] outreach-links.json: ${upsertJson(OUTREACH_LINKS, seamEntry)}`);
  console.log(`[gallery] bespoke-registry.json: ${upsertJson(BESPOKE_REGISTRY, galleryCard)}`);

  if (COMMIT) await attachCrm(thumbnailUrl);
  else console.log('\n[crm] (no --commit) — run again with --commit to attach to the CRM lead.');

  console.log('\nDone. Review the built site under public/b/, then commit the gallery + push to deploy.');
}

main().catch((e) => { console.error(e); process.exit(1); });
