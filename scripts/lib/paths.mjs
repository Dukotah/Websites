/**
 * Shared filesystem locations for the factory scripts.
 *
 * Prospect photos live under `sites/demo-gallery/src/assets/prospects/<slug>/`
 * (NOT public/) so `astro:assets` + Sharp can optimize them at build —
 * responsive srcset, AVIF/WebP, and blur-up placeholders. The paths STORED in
 * prospect JSON stay in their public-style "/images/<slug>/<file>" form; the
 * site's asset registry (src/lib/assets.ts) translates those to the real
 * imported assets at render time, so downloaders only need to change WHERE the
 * bytes land — never the recorded path.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// scripts/lib/ → repo root
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Optimizable home for every prospect's downloaded photos. */
export const PROSPECT_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'src', 'assets', 'prospects');

/** Shared SVG fallback library (stays in public/ — SVGs are served as-is). */
export const LIBRARY_IMAGES = join(ROOT, 'sites', 'demo-gallery', 'public', 'images', 'library');
