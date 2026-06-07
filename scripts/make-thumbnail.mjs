/**
 * make-thumbnail.mjs — generate a 1200×630 "video thumbnail" PNG per prospect
 * for embedding in cold-outreach email. A thumbnail showing the prospect's own
 * site behind a play button reads as a personalized walkthrough video and gets
 * far higher click-through than a bare text link — see docs/outreach-pipeline.md
 * and the outreach roadmap. KEY-FREE: pure Sharp compositing, no API.
 *
 *   node scripts/make-thumbnail.mjs [slug ...]   # all prospects if none given
 *
 * Output: data/thumbnails/<slug>.png  (gitignored — regenerate on demand).
 * Base image = the prospect's real hero photo (darkened); falls back to a solid
 * brand-color card when the hero is a library SVG / missing. Text is rendered
 * via an SVG overlay using a generic sans family (librsvg has no @fontsource).
 */
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import sharp from 'sharp';
import { ROOT, PROSPECT_IMAGES } from './lib/paths.mjs';

const W = 1200;
const H = 630;
const PROSPECTS_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
const OUT_DIR = join(ROOT, 'data', 'thumbnails');
const PUBLISH_DIR = join(ROOT, 'sites', 'demo-gallery', 'public', 'thumbnails');
const BASE_URL = (process.env.GALLERY_BASE_URL || 'yourdomain.com').replace(/^https?:\/\//, '').replace(/\/$/, '');

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Pick black or white text for legibility on a hex background (relative luminance). */
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#111111' : '#ffffff';
}

/** Resolve the on-disk hero file for a prospect, or null if it's not a real raster. */
async function resolveHeroFile(slug, config) {
  const hero = config.images?.hero ?? '';
  if (!hero || hero.includes('/images/library/') || /\.svg$/i.test(hero)) return null;
  const file = basename(hero);
  const candidate = join(PROSPECT_IMAGES, slug, file);
  try {
    await readFile(candidate);
    return candidate;
  } catch {
    // Fall back to the first raster in the slug's asset dir.
    try {
      const files = await readdir(join(PROSPECT_IMAGES, slug));
      const raster = files.find((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));
      return raster ? join(PROSPECT_IMAGES, slug, raster) : null;
    } catch {
      return null;
    }
  }
}

/** Build the base 1200×630 layer: darkened hero photo, or a brand-color card. */
async function buildBase(heroFile, brand) {
  if (heroFile) {
    const photo = await sharp(heroFile).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
    // Dark scrim so white text + the play button always read.
    const scrim = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity="0.25"/>
          <stop offset="1" stop-color="#000" stop-opacity="0.72"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#g)"/>
      </svg>`,
    );
    return sharp(photo).composite([{ input: scrim, top: 0, left: 0 }]).toBuffer();
  }
  // No real photo — solid brand card.
  return sharp({
    create: { width: W, height: H, channels: 3, background: brand || '#1f2933' },
  })
    .png()
    .toBuffer();
}

async function makeOne(slug) {
  const config = JSON.parse(await readFile(join(PROSPECTS_DIR, `${slug}.json`), 'utf8'));
  const brand = config.theme?.brand || '#1f2933';
  const heroFile = await resolveHeroFile(slug, config);
  const base = await buildBase(heroFile, brand);
  const fg = heroFile ? '#ffffff' : readableOn(brand);
  const sub = fg === '#ffffff' ? 'rgba(255,255,255,0.82)' : 'rgba(17,17,17,0.78)';

  const name = escapeXml(config.name);
  const url = escapeXml(`${BASE_URL}/p/${slug}`);
  // Long names wrap poorly in one SVG <text>; cap and rely on the play button.
  const headline = name.length > 34 ? name.slice(0, 33).trimEnd() + '…' : name;

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <style>
        .kick { font: 700 26px Arial, Helvetica, sans-serif; letter-spacing: 3px; fill: ${sub}; }
        .name { font: 800 64px Arial, Helvetica, sans-serif; fill: ${fg}; }
        .url  { font: 600 28px Arial, Helvetica, sans-serif; fill: ${sub}; }
      </style>
      <!-- centered play button -->
      <circle cx="${W / 2}" cy="248" r="62" fill="rgba(255,255,255,0.92)"/>
      <path d="M ${W / 2 - 20} 216 L ${W / 2 - 20} 280 L ${W / 2 + 36} 248 Z" fill="${brand}"/>
      <!-- copy block, bottom-left -->
      <text x="64" y="452" class="kick">A NEW WEBSITE — BUILT FOR YOU</text>
      <text x="64" y="524" class="name">${headline}</text>
      <text x="64" y="572" class="url">${url}</text>
    </svg>`,
  );

  const out = join(OUT_DIR, `${slug}.png`);
  await sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(out);
  await mkdir(PUBLISH_DIR, { recursive: true });
  await copyFile(out, join(PUBLISH_DIR, `${slug}.png`));
  console.log(`  ✓ ${slug}  ${heroFile ? '(hero photo)' : '(brand card)'} → data/thumbnails/${slug}.png  (published: sites/demo-gallery/public/thumbnails/${slug}.png)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PUBLISH_DIR, { recursive: true });
  let slugs = process.argv.slice(2);
  if (!slugs.length) {
    const files = await readdir(PROSPECTS_DIR);
    slugs = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }
  console.log(`\n🎬 Building ${slugs.length} email thumbnail(s) (1200×630)…`);
  for (const slug of slugs) {
    try {
      await makeOne(slug);
    } catch (e) {
      console.warn(`  ✗ ${slug}: ${e.message}`);
    }
  }
  console.log(`\nDone. Embed data/thumbnails/<slug>.png in the outreach email, linked to the demo URL.`);
  if (BASE_URL === 'yourdomain.com') {
    console.log('Tip: set GALLERY_BASE_URL=demos.yourdomain.com for the real URL on the thumbnail.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
