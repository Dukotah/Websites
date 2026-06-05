/**
 * Asset registry — bridges the string image paths stored in prospect JSON
 * (e.g. "/images/the-hole-thing/hero.jpg") to the real imported `ImageMetadata`
 * objects that `astro:assets` needs to optimize (responsive srcset + AVIF/WebP).
 *
 * Prospect photos live in `src/assets/prospects/<slug>/<file>` so Sharp can
 * process them at build. We keep the JSON paths in their public-style
 * "/images/<slug>/<file>" form (so nothing else has to change) and translate
 * here. SVG placeholders + the shared library stay in `public/images/` and are
 * served as-is — they are intentionally NOT in this registry, so callers fall
 * back to a plain <img> for them (Sharp must never rasterize an SVG).
 */
import type { ImageMetadata } from 'astro';

// Eagerly import metadata for every prospect raster. This only reads dimensions
// at build; the expensive transform happens lazily, per image actually rendered.
const modules = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/prospects/**/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP,AVIF}',
  { eager: true },
);

/** Map of "/images/<slug>/<file>" → ImageMetadata. */
const registry = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/\/src\/assets\/prospects\/(.+)$/);
  if (m) registry.set(`/images/${m[1]}`, mod.default);
}

/**
 * Resolve a stored image path to its optimizable asset, or undefined when the
 * path is remote, an SVG, or otherwise not a managed prospect raster.
 */
export function resolveAsset(src: string | undefined | null): ImageMetadata | undefined {
  if (!src) return undefined;
  return registry.get(src);
}

/** True when `src` points at a managed, optimizable raster. */
export function isManagedAsset(src: string | undefined | null): boolean {
  return resolveAsset(src) !== undefined;
}
