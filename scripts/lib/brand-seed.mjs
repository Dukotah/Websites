/**
 * brand-seed.mjs — the deterministic BRAND seed picker for the premium author,
 * in plain JS so a Node script can run it without the Vite/utopia-laden
 * src/lib/fonts.ts (which uses import.meta.glob + utopia-core and only runs
 * inside the Astro build).
 *
 * It mirrors the SAME category-affinity table + seeded pick algorithm as
 * src/lib/fonts.ts FONT_REGISTRY/pickFont and src/lib/seed.ts hash/pick/shuffle,
 * so the fontId the author PINS is exactly what the render engine would derive.
 * Keep `FONT_CATEGORIES` and the hash/shuffle in sync with those files.
 *
 * The author pins ONLY the seed values (brand.color hex + brand.fontId); palette.ts
 * expands the hex into the full ramp at render time.
 */

// ── seed (mirror of src/lib/seed.ts) ──────────────────────────────────────
/** 32-bit FNV-1a hash of a string → unsigned 32-bit integer. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function next(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}

export function pick(seed, arr) {
  if (!arr.length) throw new Error('pick(): empty array');
  return arr[next(seed) % arr.length];
}

export function shuffle(seed, arr) {
  const out = arr.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = next(s);
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ── font registry (id + categories only — mirror of fonts.ts FONT_REGISTRY) ──
// The author only needs the id and its category affinity to seed-pick; the full
// pairing (display/body/scale) lives in fonts.ts and is resolved at render.
export const FONT_CATEGORIES = [
  { id: 'editorial-serif', categories: ['winery', 'cafe', 'salon', 'spa', 'medical', 'default'] },
  { id: 'modern-grotesk', categories: ['plumbing', 'auto-repair', 'hvac', 'electrician', 'fitness', 'tech', 'default'] },
  { id: 'warm-humanist', categories: ['cafe', 'restaurant', 'salon', 'spa', 'cleaning', 'landscaping'] },
  { id: 'rugged-slab', categories: ['towing', 'auto-repair', 'construction', 'contractor', 'roofing', 'hvac'] },
  { id: 'classic-trad', categories: ['salon', 'winery', 'medical', 'restaurant', 'law', 'default'] },
  { id: 'clean-sans', categories: ['plumbing', 'electrician', 'cleaning', 'medical', 'default', 'tech'] },
  { id: 'organic-serif', categories: ['landscaping', 'winery', 'wellness', 'spa', 'medical', 'marina'] },
  { id: 'bold-display', categories: ['auto-repair', 'towing', 'fitness', 'tattoo', 'roofing', 'contractor', 'barber'] },
  { id: 'boutique-contrast', categories: ['salon', 'spa', 'winery', 'restaurant', 'boutique', 'tattoo'] },
  { id: 'handcrafted', categories: ['cafe', 'restaurant', 'barber', 'bakery', 'makers'] },
];

/**
 * Pick a font pairing id for a category, deterministically by seed.
 * Order: explicit override → category match (seeded among matches) → default.
 * Mirrors fonts.ts pickFont exactly (shuffle(seed ^ hash(cat), matches)[0]).
 */
export function pickFontId(category, seed, override) {
  const ids = new Set(FONT_CATEGORIES.map((f) => f.id));
  if (override && ids.has(override)) return override;
  const cat = (category || 'default').toLowerCase();
  const matches = FONT_CATEGORIES.filter((f) => f.categories.includes(cat));
  if (matches.length) return shuffle(seed ^ hash(cat), matches)[0].id;
  const defaults = FONT_CATEGORIES.filter((f) => f.categories.includes('default'));
  return pick(seed ^ 0x1b873593, (defaults.length ? defaults : FONT_CATEGORIES)).id;
}

// ── per-category seed color band (small curated map) ──────────────────────
// Author pins brand.color; palette.ts builds the full ramp from this hex.
// Keyed on the canonical normCat() value. A slug-seeded jitter within a small
// band of hues keeps same-category siblings from sharing one exact hex.
const CATEGORY_SEED_COLORS = {
  dental: ['#0f7a86', '#0e6f86', '#127d80'],
  medical: ['#0f6f86', '#15707e', '#0e7a86'],
  restaurant: ['#B0341D', '#a63a22', '#9c3b2e'],
  cafe: ['#c2683a', '#b5572f', '#a8612f'],
  winery: ['#6b2737', '#7a2b3a', '#5e2330'],
  landscaping: ['#2f8f3e', '#2d8a3a', '#338f45'],
  towing: ['#d4452a', '#cf4a27', '#c9461f'],
  'auto-repair': ['#e08a1e', '#d98421', '#cf7d1e'],
  salon: ['#b5557f', '#aa5279', '#bd5a85'],
  spa: ['#8a6bb0', '#8266aa', '#7e63a6'],
  barber: ['#3a4a5a', '#3f5060', '#354554'],
  plumbing: ['#1f6feb', '#2068d6', '#1c5fbf'],
  hvac: ['#1f8a8a', '#1d8284', '#218f8f'],
  electrician: ['#e0a11e', '#d89a22', '#cf911e'],
  roofing: ['#9c3b2e', '#a6402f', '#933628'],
  contractor: ['#c77d2a', '#bd762a', '#b56f28'],
  cleaning: ['#2f9e8f', '#2d958a', '#33a394'],
  fitness: ['#e0521e', '#d64f22', '#cf4a1f'],
  tattoo: ['#3a4a5a', '#2c2c33', '#36404a'],
  marina: ['#1f5f8b', '#1d5882', '#216690'],
  default: ['#3b5a78', '#3f5f7e', '#365470'],
};

/**
 * Resolve the brand seed COLOR. A real scraped/research brand color wins; else a
 * deterministic per-category seed varied within a small band by slug hash.
 */
export function pickBrandColor(category, slug, scrapedColor) {
  if (scrapedColor && /^#?[0-9a-f]{6}$/i.test(scrapedColor.trim())) {
    const c = scrapedColor.trim();
    return c.startsWith('#') ? c : `#${c}`;
  }
  const band = CATEGORY_SEED_COLORS[category] || CATEGORY_SEED_COLORS.default;
  return band[hash(slug) % band.length];
}
