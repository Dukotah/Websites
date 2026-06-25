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
// MUST stay in the SAME ORDER + same `categories` as fonts.ts FONT_REGISTRY:
// pickFontId/pickFont both do shuffle(seed ^ hash(cat), matches)[0], and the
// filtered `matches` order is order-dependent. Drift here = the author pins a
// different fontId than the renderer would derive. (Render uses the pinned id, so
// it never breaks, but the divergence intent only holds when these agree.)
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
  // pairings 11–30 (recombinations) — broaden per-category choice
  { id: 'luxe-didone', categories: ['winery', 'salon', 'spa', 'boutique', 'restaurant', 'default'] },
  { id: 'fraunces-soft', categories: ['cafe', 'bakery', 'salon', 'boutique', 'makers', 'default'] },
  { id: 'garalde-editorial', categories: ['winery', 'spa', 'salon', 'medical', 'law', 'restaurant'] },
  { id: 'slab-authority', categories: ['contractor', 'construction', 'roofing', 'auto-repair', 'hvac', 'law'] },
  { id: 'grotesk-press', categories: ['restaurant', 'cafe', 'fitness', 'tech', 'makers', 'default'] },
  { id: 'spectral-classic', categories: ['medical', 'dental', 'wellness', 'spa', 'winery', 'default'] },
  { id: 'figtree-friendly', categories: ['cleaning', 'landscaping', 'fitness', 'tech', 'plumbing', 'default'] },
  { id: 'mono-grotesk', categories: ['tech', 'electrician', 'fitness', 'auto-repair', 'marina', 'default'] },
  { id: 'bricolage-editorial', categories: ['cafe', 'restaurant', 'bakery', 'makers', 'boutique'] },
  { id: 'newsreader-serif', categories: ['law', 'medical', 'restaurant', 'winery', 'default'] },
  { id: 'bitter-warm', categories: ['cafe', 'bakery', 'landscaping', 'cleaning', 'contractor'] },
  { id: 'albert-display', categories: ['tech', 'plumbing', 'electrician', 'medical', 'dental', 'cleaning', 'default'] },
  { id: 'lora-refined', categories: ['salon', 'spa', 'wellness', 'medical', 'cafe', 'default'] },
  { id: 'archivo-grotesk', categories: ['fitness', 'auto-repair', 'towing', 'tattoo', 'barber', 'tech'] },
  { id: 'playfair-mod', categories: ['salon', 'boutique', 'restaurant', 'winery', 'spa'] },
  { id: 'source-clean', categories: ['medical', 'dental', 'law', 'tech', 'marina', 'default'] },
  { id: 'schibsted-bold', categories: ['tech', 'cleaning', 'electrician', 'marina', 'plumbing', 'default'] },
  { id: 'cormorant-air', categories: ['spa', 'salon', 'winery', 'boutique', 'wellness'] },
  { id: 'bitter-slab-bold', categories: ['contractor', 'roofing', 'hvac', 'plumbing', 'auto-repair'] },
  { id: 'fraunces-grotesk', categories: ['cafe', 'restaurant', 'makers', 'boutique', 'salon', 'default'] },
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

// ── HSL color math (dependency-free mirror of src/lib/color.ts) ────────────
// Kept local so this plain-JS author module needs no Vite/TS import.

/** Deterministic float in [0,1) from a seed. */
function frac(seed) {
  return next(seed) / 4294967296;
}

/** HSL (h 0..360, s/l 0..100) → #rrggbb. */
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** WCAG relative luminance of an #rrggbb color, 0 (black) .. 1 (white). */
function relLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 0xff) + 0.7152 * ch((n >> 8) & 0xff) + 0.0722 * ch(n & 0xff);
}

// ── per-category HSL GENERATOR ranges (replaces the old 3-hex bands) ────────
// Each category is a HUE FAMILY (recognizably "a winery is wine, an HVAC is
// teal") expressed as a center hue + spread, plus saturation and *lightness*
// ranges. The slug deterministically samples a point inside that volume, so
// every sibling gets its own art-directed shade across a wide gamut instead of
// cycling 3 fixed hexes. Lightness ranges are deliberately mid-dark (the brand
// seed is also used as text/link color), and a luminance ceiling below keeps any
// sample from drifting pastel. palette.ts then expands this into the full ramp
// and runs the WCAG passes that guarantee the DERIVED tokens hit AA.
//
// Keyed on the canonical normCat() value. h=hue°, hs=± hue spread, smin/smax=
// saturation %, lmin/lmax=lightness %.
const CATEGORY_HSL = {
  dental:        { h: 184, hs: 12, smin: 62, smax: 84, lmin: 26, lmax: 34 },
  medical:       { h: 192, hs: 14, smin: 52, smax: 78, lmin: 27, lmax: 36 },
  restaurant:    { h: 9,   hs: 11, smin: 62, smax: 82, lmin: 34, lmax: 44 },
  cafe:          { h: 22,  hs: 13, smin: 50, smax: 68, lmin: 39, lmax: 49 },
  bakery:        { h: 28,  hs: 13, smin: 48, smax: 68, lmin: 37, lmax: 47 },
  winery:        { h: 348, hs: 17, smin: 44, smax: 66, lmin: 25, lmax: 35 },
  landscaping:   { h: 130, hs: 18, smin: 42, smax: 64, lmin: 29, lmax: 39 },
  wellness:      { h: 150, hs: 22, smin: 34, smax: 56, lmin: 32, lmax: 43 },
  towing:        { h: 10,  hs: 10, smin: 64, smax: 84, lmin: 41, lmax: 50 },
  'auto-repair': { h: 32,  hs: 13, smin: 68, smax: 88, lmin: 39, lmax: 49 },
  salon:         { h: 332, hs: 20, smin: 38, smax: 62, lmin: 41, lmax: 53 },
  boutique:      { h: 322, hs: 22, smin: 36, smax: 60, lmin: 37, lmax: 49 },
  spa:           { h: 264, hs: 22, smin: 28, smax: 50, lmin: 44, lmax: 56 },
  barber:        { h: 212, hs: 16, smin: 16, smax: 34, lmin: 26, lmax: 36 },
  plumbing:      { h: 216, hs: 14, smin: 66, smax: 88, lmin: 39, lmax: 50 },
  hvac:          { h: 182, hs: 14, smin: 58, smax: 80, lmin: 30, lmax: 40 },
  electrician:   { h: 42,  hs: 12, smin: 74, smax: 90, lmin: 42, lmax: 51 },
  roofing:       { h: 12,  hs: 13, smin: 48, smax: 70, lmin: 31, lmax: 41 },
  contractor:    { h: 33,  hs: 14, smin: 56, smax: 78, lmin: 37, lmax: 47 },
  construction:  { h: 38,  hs: 14, smin: 60, smax: 82, lmin: 39, lmax: 49 },
  cleaning:      { h: 172, hs: 16, smin: 48, smax: 70, lmin: 33, lmax: 43 },
  fitness:       { h: 16,  hs: 12, smin: 72, smax: 90, lmin: 41, lmax: 51 },
  tattoo:        { h: 222, hs: 30, smin: 8,  smax: 30, lmin: 20, lmax: 32 },
  marina:        { h: 206, hs: 16, smin: 54, smax: 78, lmin: 28, lmax: 40 },
  tech:          { h: 230, hs: 24, smin: 54, smax: 80, lmin: 37, lmax: 49 },
  law:           { h: 218, hs: 18, smin: 34, smax: 60, lmin: 26, lmax: 36 },
  makers:        { h: 26,  hs: 16, smin: 50, smax: 70, lmin: 36, lmax: 46 },
  default:       { h: 210, hs: 26, smin: 30, smax: 58, lmin: 30, lmax: 42 },
};

/** Brand seed must not drift pastel (it doubles as text/link color). */
const MAX_SEED_LUMINANCE = 0.46;

/**
 * Resolve the brand seed COLOR. A real scraped/research brand color wins; else a
 * deterministic per-category HSL sample inside the category's hue family. Three
 * independent seeded draws (hue / sat / lightness) give each slug a distinct,
 * art-directed shade across a WIDE gamut — not one of three fixed hexes — while a
 * luminance ceiling keeps it confident enough to read as a brand. palette.ts
 * expands this seed and enforces AA on every derived token.
 */
export function pickBrandColor(category, slug, scrapedColor) {
  if (scrapedColor && /^#?[0-9a-f]{6}$/i.test(scrapedColor.trim())) {
    const c = scrapedColor.trim();
    return c.startsWith('#') ? c : `#${c}`;
  }
  const g = CATEGORY_HSL[category] || CATEGORY_HSL.default;
  const base = hash(String(slug || ''));
  const hue = g.h + (frac(base ^ 0x9e3779b1) * 2 - 1) * g.hs;
  const sat = g.smin + frac(base ^ 0x85ebca6b) * (g.smax - g.smin);
  let light = g.lmin + frac(base ^ 0xc2b2ae35) * (g.lmax - g.lmin);
  let hex = hslToHex(hue, sat, light);
  // Luminance guard: pull lightness down (preserving hue/sat) if a bright-hue
  // sample (amber/teal) lands too light to read as a brand seed.
  let guard = 0;
  while (relLuminance(hex) > MAX_SEED_LUMINANCE && light > 18 && guard++ < 24) {
    light -= 2;
    hex = hslToHex(hue, sat, light);
  }
  return hex;
}
