/**
 * Font registry — 10 self-hosted @fontsource pairings (spec §3.2) plus the
 * modular type-scale definitions consumed by tokens.ts.
 *
 * No Google CDN, no API key. The actual side-effect @fontsource imports live in
 * `font-faces.ts`; this module only describes the families + how to pick one.
 */

import { hash, pick, shuffle } from './seed';

// ---------------------------------------------------------------------------
// Display-font preload helper (FOUT prevention for LCP hero headline)
// ---------------------------------------------------------------------------
//
// Vite glob import over the exact woff2 files we want to preload — one latin
// normal file per display family. `?url` makes Vite emit each file as a
// fingerprinted asset URL; `eager: true` resolves them all at build time so
// there is no dynamic import overhead at request time. The glob covers both
// @fontsource-variable and @fontsource namespaces in one pass.
//
// Pattern rationale:
//   • Variable fonts:  <pkg>/files/<family>-latin-wght-normal.woff2
//     (the "wght" axis is what index.css loads for the base latin range)
//   • Static fonts:    <pkg>/files/<family>-latin-400-normal.woff2
//     (the base weight the browser will request first)
//
// The map key is the bare npm package name so the registry lookup below is
// a simple string→URL table access — no path manipulation at request time.

// Maps `<display-npm-package>` → fingerprinted URL (built by Vite).
// Only families that actually match the glob pattern end up in this map.
const _variableWoff2Urls = import.meta.glob<string>(
  '/node_modules/@fontsource-variable/*/files/*-latin-wght-normal.woff2',
  { eager: true, query: '?url', import: 'default' },
);
const _staticWoff2Urls = import.meta.glob<string>(
  '/node_modules/@fontsource/*/files/*-latin-400-normal.woff2',
  { eager: true, query: '?url', import: 'default' },
);

/**
 * Mapping from display npm package name → fingerprinted woff2 URL (or null
 * when the expected file wasn't found in the glob — emits nothing rather than
 * a broken preload).
 */
function _buildPreloadMap(): Record<string, string | null> {
  const out: Record<string, string | null> = {};

  // Variable fonts — extract package name from path like
  // /node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2
  for (const [path, url] of Object.entries(_variableWoff2Urls)) {
    const m = path.match(/^\/node_modules\/(@fontsource-variable\/[^/]+)\//);
    if (m) out[m[1]] = url;
  }

  // Static fonts — extract package name from path like
  // /node_modules/@fontsource/spectral/files/spectral-latin-400-normal.woff2
  for (const [path, url] of Object.entries(_staticWoff2Urls)) {
    const m = path.match(/^\/node_modules\/(@fontsource\/[^/]+)\//);
    if (m) out[m[1]] = url;
  }

  return out;
}

const _preloadMap = _buildPreloadMap();

/**
 * Return the Vite-fingerprinted woff2 URL for the DISPLAY font of the given
 * fontId, or null when no verified file could be resolved.
 *
 * Only the first (display) package in the pairing's fontsourcePackages list is
 * considered — that is the face the hero headline renders in.
 *
 * Callers must emit nothing rather than a broken preload when this returns null.
 */
export function getDisplayFontPreloadHref(fontId: string): string | null {
  const pairing = FONT_BY_ID[fontId];
  if (!pairing) return null;
  const pkg = pairing.fontsourcePackages[0];
  return _preloadMap[pkg] ?? null;
}

export type TypeScaleName = 'tight' | 'editorial' | 'friendly' | 'geometric' | 'humanist';

export interface FontPairing {
  id: string;
  /** CSS font-family stack for headings (display face + fallbacks). */
  display: string;
  /** CSS font-family stack for body + UI. */
  body: string;
  /** npm packages to import (variable preferred). */
  fontsourcePackages: string[];
  /** human-readable mood label. */
  mood: string;
  /** business categories this pairing suits (matchmaking). */
  categories: string[];
  /** which modular type scale this pairing uses. */
  typeScale: TypeScaleName;
}

/**
 * Shared fallback tails so a face never collapses to Times if the woff2 hasn't
 * loaded yet (font-display: swap is the @fontsource default).
 */
const SERIF_FB = `Georgia, 'Times New Roman', serif`;
const SANS_FB = `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/** The 10 pairings from spec §3.2. */
export const FONT_REGISTRY: FontPairing[] = [
  {
    id: 'editorial-serif',
    display: `'Fraunces Variable', 'Fraunces', ${SERIF_FB}`,
    body: `'Newsreader Variable', 'Newsreader', 'Source Serif 4 Variable', ${SERIF_FB}`,
    fontsourcePackages: [
      '@fontsource-variable/fraunces',
      '@fontsource-variable/newsreader',
      '@fontsource-variable/source-serif-4',
    ],
    mood: 'refined editorial',
    categories: ['winery', 'cafe', 'salon', 'default'],
    typeScale: 'editorial',
  },
  {
    id: 'modern-grotesk',
    display: `'Space Grotesk Variable', 'Space Grotesk', ${SANS_FB}`,
    body: `'Inter Variable', 'Inter', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/space-grotesk', '@fontsource-variable/inter'],
    mood: 'crisp modern',
    categories: ['plumbing', 'auto-repair', 'tech', 'default'],
    typeScale: 'geometric',
  },
  {
    id: 'warm-humanist',
    display: `'Bricolage Grotesque Variable', 'Bricolage Grotesque', ${SANS_FB}`,
    body: `'Figtree Variable', 'Figtree', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/bricolage-grotesque', '@fontsource-variable/figtree'],
    mood: 'friendly, approachable',
    categories: ['cafe', 'salon', 'landscaping'],
    typeScale: 'humanist',
  },
  {
    id: 'rugged-slab',
    display: `'Bitter Variable', 'Bitter', 'Zilla Slab', ${SERIF_FB}`,
    body: `'Inter Variable', 'Inter', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/bitter', '@fontsource/zilla-slab', '@fontsource-variable/inter'],
    mood: 'sturdy, blue-collar',
    categories: ['towing', 'auto-repair', 'construction'],
    typeScale: 'tight',
  },
  {
    id: 'classic-trad',
    display: `'Playfair Display Variable', 'Playfair Display', ${SERIF_FB}`,
    body: `'Lora Variable', 'Lora', ${SERIF_FB}`,
    fontsourcePackages: ['@fontsource-variable/playfair-display', '@fontsource-variable/lora'],
    mood: 'established, traditional',
    categories: ['salon', 'winery', 'law', 'default'],
    typeScale: 'editorial',
  },
  {
    id: 'clean-sans',
    display: `'Albert Sans Variable', 'Albert Sans', ${SANS_FB}`,
    body: `'Albert Sans Variable', 'Albert Sans', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/albert-sans'],
    mood: 'minimal, neutral',
    categories: ['plumbing', 'default', 'tech'],
    typeScale: 'geometric',
  },
  {
    id: 'organic-serif',
    display: `'Spectral', ${SERIF_FB}`,
    body: `'Spectral', ${SERIF_FB}`,
    fontsourcePackages: ['@fontsource/spectral'],
    mood: 'botanical, calm',
    categories: ['landscaping', 'winery', 'wellness'],
    typeScale: 'humanist',
  },
  {
    id: 'bold-display',
    display: `'Archivo Variable', 'Archivo', ${SANS_FB}`,
    body: `'Archivo Variable', 'Archivo', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/archivo'],
    mood: 'confident, loud',
    categories: ['auto-repair', 'towing', 'fitness', 'tattoo'],
    typeScale: 'tight',
  },
  {
    id: 'boutique-contrast',
    display: `'Cormorant Garamond', ${SERIF_FB}`,
    body: `'Mulish Variable', 'Mulish', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource/cormorant-garamond', '@fontsource-variable/mulish'],
    mood: 'luxe, high-contrast',
    categories: ['salon', 'winery', 'boutique', 'tattoo'],
    typeScale: 'editorial',
  },
  {
    id: 'handcrafted',
    display: `'Schibsted Grotesk Variable', 'Schibsted Grotesk', ${SANS_FB}`,
    body: `'Schibsted Grotesk Variable', 'Schibsted Grotesk', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/schibsted-grotesk'],
    mood: 'crafted, indie',
    categories: ['cafe', 'bakery', 'makers'],
    typeScale: 'friendly',
  },
];

/** Quick id → pairing lookup. */
export const FONT_BY_ID: Record<string, FontPairing> = Object.fromEntries(
  FONT_REGISTRY.map((f) => [f.id, f]),
);

/**
 * Type-scale definitions (spec §2.2). Each scale supplies a modular ratio, a
 * fluid body base (clamp min/preferred/max in rem & vw), display weight,
 * tracking and leading. tokens.ts turns these into the --step-* clamp ladder.
 */
export interface TypeScaleDef {
  ratio: number;
  /** body --step-0 clamp() parts, in rem (min/max) + vw (preferred). */
  baseMinRem: number;
  baseVw: number;
  baseMaxRem: number;
  fwDisplay: number;
  fwBody: number;
  fwBold: number;
  trackingDisplay: string;
  trackingEyebrow: string;
  leadingDisplay: number;
  leadingBody: number;
}

export const TYPE_SCALES: Record<TypeScaleName, TypeScaleDef> = {
  tight: {
    ratio: 1.333,
    baseMinRem: 1,
    baseVw: 0.3,
    baseMaxRem: 1.08,
    fwDisplay: 800,
    fwBody: 400,
    fwBold: 700,
    trackingDisplay: '-0.03em',
    trackingEyebrow: '0.18em',
    leadingDisplay: 1.02,
    leadingBody: 1.6,
  },
  editorial: {
    ratio: 1.32,
    baseMinRem: 1.02,
    baseVw: 0.35,
    baseMaxRem: 1.14,
    fwDisplay: 600,
    fwBody: 400,
    fwBold: 600,
    trackingDisplay: '-0.02em',
    trackingEyebrow: '0.24em',
    leadingDisplay: 1.06,
    leadingBody: 1.72,
  },
  friendly: {
    ratio: 1.2,
    baseMinRem: 1,
    baseVw: 0.32,
    baseMaxRem: 1.08,
    fwDisplay: 700,
    fwBody: 400,
    fwBold: 700,
    trackingDisplay: '-0.005em',
    trackingEyebrow: '0.16em',
    leadingDisplay: 1.12,
    leadingBody: 1.66,
  },
  geometric: {
    ratio: 1.25,
    baseMinRem: 1,
    baseVw: 0.3,
    baseMaxRem: 1.06,
    fwDisplay: 600,
    fwBody: 400,
    fwBold: 600,
    trackingDisplay: '-0.015em',
    trackingEyebrow: '0.2em',
    leadingDisplay: 1.08,
    leadingBody: 1.64,
  },
  humanist: {
    ratio: 1.25,
    baseMinRem: 1.02,
    baseVw: 0.34,
    baseMaxRem: 1.12,
    fwDisplay: 600,
    fwBody: 400,
    fwBold: 650,
    trackingDisplay: '-0.01em',
    trackingEyebrow: '0.18em',
    leadingDisplay: 1.1,
    leadingBody: 1.7,
  },
};

/**
 * Pick a font pairing for a category, deterministically by seed.
 * Order (spec §3.3): explicit override → category match (seeded among matches)
 * → default-tagged fallback (seeded).
 */
export function pickFont(category: string, seed: number, override?: string): FontPairing {
  if (override && FONT_BY_ID[override]) {
    return FONT_BY_ID[override];
  }
  const cat = (category || 'default').toLowerCase();
  const matches = FONT_REGISTRY.filter((f) => f.categories.includes(cat));
  if (matches.length) {
    // shuffle deterministically then take first so distribution is stable+varied
    return shuffle(seed ^ hash(cat), matches)[0];
  }
  const defaults = FONT_REGISTRY.filter((f) => f.categories.includes('default'));
  return pick(seed ^ 0x1b873593, defaults.length ? defaults : FONT_REGISTRY);
}
