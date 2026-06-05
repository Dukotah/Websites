/**
 * gen-lqip.mjs — generate tiny blur-up placeholders (LQIP) for every prospect
 * raster, written to src/lib/lqip.json as a { "/images/<slug>/<file>": dataURI }
 * map. <SiteImage> uses these as a blurred CSS background that the real,
 * AVIF/WebP responsive image fades in over once it decodes.
 *
 * Key-free: uses the Sharp that astro:assets already installs. Runs as the
 * demo-gallery `prebuild` step so deploys (Vercel) regenerate deterministically.
 * Idempotent — same inputs produce the same JSON.
 */
import sharp from 'sharp';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ASSET_DIR = join(ROOT, 'src', 'assets', 'prospects');
const OUT = join(ROOT, 'src', 'lib', 'lqip.json');

const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

/** Recursively collect raster files under a directory. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (RASTER.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function main() {
  if (!existsSync(ASSET_DIR)) {
    console.log('[lqip] no prospect assets dir — writing empty map.');
    await writeFile(OUT, '{}\n');
    return;
  }

  const files = (await walk(ASSET_DIR)).sort();
  const map = {};

  for (const file of files) {
    // Key matches the registry: "/images/<slug>/<file>"
    const key = '/images/' + relative(ASSET_DIR, file).split(/[\\/]/).join('/');
    try {
      const buf = await sharp(file)
        .resize(24, 24, { fit: 'inside' })
        .blur(1.2)
        .webp({ quality: 40 })
        .toBuffer();
      map[key] = `data:image/webp;base64,${buf.toString('base64')}`;
    } catch (err) {
      console.warn(`[lqip] skip ${key}: ${err.message}`);
    }
  }

  // Stable key order so the file diffs cleanly.
  const ordered = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
  await writeFile(OUT, JSON.stringify(ordered, null, 0) + '\n');
  console.log(`[lqip] wrote ${Object.keys(ordered).length} placeholders → ${relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error('[lqip] failed:', err);
  process.exit(1);
});
