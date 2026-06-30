/**
 * Font registry — 30 self-hosted @fontsource pairings plus the modular
 * type-scale definitions consumed by tokens.ts.
 *
 * No Google CDN, no API key. The actual side-effect @fontsource imports live in
 * `font-faces.ts`; this module only describes the families + how to pick one.
 *
 * The original 10 pairings (spec §3.2) are kept verbatim (existing built sites
 * pin those ids); pairings 11–30 are RECOMBINATIONS of the same 17 already-
 * installed + already-@font-face-imported families, so they render with zero new
 * deps. The bigger pool + broader per-category affinity is what kills the
 * "every site in a category looks the same" failure mode.
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

// Per-family CSS stacks (variable face first, then static, then fallback tail).
// Every family here is installed in package.json AND imported in font-faces.ts,
// so any pairing built from these constants is guaranteed to actually render.
const FAM = {
  fraunces: `'Fraunces Variable', 'Fraunces', ${SERIF_FB}`,
  newsreader: `'Newsreader Variable', 'Newsreader', ${SERIF_FB}`,
  sourceSerif: `'Source Serif 4 Variable', 'Source Serif 4', ${SERIF_FB}`,
  playfair: `'Playfair Display Variable', 'Playfair Display', ${SERIF_FB}`,
  lora: `'Lora Variable', 'Lora', ${SERIF_FB}`,
  spectral: `'Spectral', ${SERIF_FB}`,
  bitter: `'Bitter Variable', 'Bitter', 'Zilla Slab', ${SERIF_FB}`,
  zilla: `'Zilla Slab', ${SERIF_FB}`,
  cormorant: `'Cormorant Garamond', ${SERIF_FB}`,
  space: `'Space Grotesk Variable', 'Space Grotesk', ${SANS_FB}`,
  inter: `'Inter Variable', 'Inter', ${SANS_FB}`,
  bricolage: `'Bricolage Grotesque Variable', 'Bricolage Grotesque', ${SANS_FB}`,
  figtree: `'Figtree Variable', 'Figtree', ${SANS_FB}`,
  albert: `'Albert Sans Variable', 'Albert Sans', ${SANS_FB}`,
  archivo: `'Archivo Variable', 'Archivo', ${SANS_FB}`,
  mulish: `'Mulish Variable', 'Mulish', ${SANS_FB}`,
  schibsted: `'Schibsted Grotesk Variable', 'Schibsted Grotesk', ${SANS_FB}`,
} as const;

// npm package names (the display package — [0] in fontsourcePackages — is what
// getDisplayFontPreloadHref preloads; all are present in _preloadMap).
const PKG = {
  fraunces: '@fontsource-variable/fraunces',
  newsreader: '@fontsource-variable/newsreader',
  sourceSerif: '@fontsource-variable/source-serif-4',
  playfair: '@fontsource-variable/playfair-display',
  lora: '@fontsource-variable/lora',
  spectral: '@fontsource/spectral',
  bitter: '@fontsource-variable/bitter',
  zilla: '@fontsource/zilla-slab',
  cormorant: '@fontsource/cormorant-garamond',
  space: '@fontsource-variable/space-grotesk',
  inter: '@fontsource-variable/inter',
  bricolage: '@fontsource-variable/bricolage-grotesque',
  figtree: '@fontsource-variable/figtree',
  albert: '@fontsource-variable/albert-sans',
  archivo: '@fontsource-variable/archivo',
  mulish: '@fontsource-variable/mulish',
  schibsted: '@fontsource-variable/schibsted-grotesk',
} as const;

/** 30 pairings — the original 10 (spec §3.2) + 20 recombinations (see file head). */
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
    categories: ['winery', 'cafe', 'salon', 'spa', 'medical', 'default'],
    typeScale: 'editorial',
  },
  {
    id: 'modern-grotesk',
    display: `'Space Grotesk Variable', 'Space Grotesk', ${SANS_FB}`,
    body: `'Inter Variable', 'Inter', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/space-grotesk', '@fontsource-variable/inter'],
    mood: 'crisp modern',
    categories: ['plumbing', 'auto-repair', 'hvac', 'electrician', 'fitness', 'tech', 'default'],
    typeScale: 'geometric',
  },
  {
    id: 'warm-humanist',
    display: `'Bricolage Grotesque Variable', 'Bricolage Grotesque', ${SANS_FB}`,
    body: `'Figtree Variable', 'Figtree', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/bricolage-grotesque', '@fontsource-variable/figtree'],
    mood: 'friendly, approachable',
    categories: ['cafe', 'restaurant', 'salon', 'spa', 'cleaning', 'landscaping'],
    typeScale: 'humanist',
  },
  {
    id: 'rugged-slab',
    display: `'Bitter Variable', 'Bitter', 'Zilla Slab', ${SERIF_FB}`,
    body: `'Inter Variable', 'Inter', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/bitter', '@fontsource/zilla-slab', '@fontsource-variable/inter'],
    mood: 'sturdy, blue-collar',
    categories: ['towing', 'auto-repair', 'construction', 'contractor', 'roofing', 'hvac'],
    typeScale: 'tight',
  },
  {
    id: 'classic-trad',
    display: `'Playfair Display Variable', 'Playfair Display', ${SERIF_FB}`,
    body: `'Lora Variable', 'Lora', ${SERIF_FB}`,
    fontsourcePackages: ['@fontsource-variable/playfair-display', '@fontsource-variable/lora'],
    mood: 'established, traditional',
    categories: ['salon', 'winery', 'medical', 'restaurant', 'law', 'default'],
    typeScale: 'editorial',
  },
  {
    id: 'clean-sans',
    display: `'Albert Sans Variable', 'Albert Sans', ${SANS_FB}`,
    body: `'Albert Sans Variable', 'Albert Sans', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/albert-sans'],
    mood: 'minimal, neutral',
    categories: ['plumbing', 'electrician', 'cleaning', 'medical', 'default', 'tech'],
    typeScale: 'geometric',
  },
  {
    id: 'organic-serif',
    display: `'Spectral', ${SERIF_FB}`,
    body: `'Spectral', ${SERIF_FB}`,
    fontsourcePackages: ['@fontsource/spectral'],
    mood: 'botanical, calm',
    categories: ['landscaping', 'winery', 'wellness', 'spa', 'medical', 'marina'],
    typeScale: 'humanist',
  },
  {
    id: 'bold-display',
    display: `'Archivo Variable', 'Archivo', ${SANS_FB}`,
    body: `'Archivo Variable', 'Archivo', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/archivo'],
    mood: 'confident, loud',
    categories: ['auto-repair', 'towing', 'fitness', 'tattoo', 'roofing', 'contractor', 'barber'],
    typeScale: 'tight',
  },
  {
    id: 'boutique-contrast',
    display: `'Cormorant Garamond', ${SERIF_FB}`,
    body: `'Mulish Variable', 'Mulish', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource/cormorant-garamond', '@fontsource-variable/mulish'],
    mood: 'luxe, high-contrast',
    categories: ['salon', 'spa', 'winery', 'restaurant', 'boutique', 'tattoo'],
    typeScale: 'editorial',
  },
  {
    id: 'handcrafted',
    display: `'Schibsted Grotesk Variable', 'Schibsted Grotesk', ${SANS_FB}`,
    body: `'Schibsted Grotesk Variable', 'Schibsted Grotesk', ${SANS_FB}`,
    fontsourcePackages: ['@fontsource-variable/schibsted-grotesk'],
    mood: 'crafted, indie',
    categories: ['cafe', 'restaurant', 'barber', 'bakery', 'makers'],
    typeScale: 'friendly',
  },

  // ── pairings 11–30: recombinations of the same installed families ──────────
  {
    id: 'luxe-didone',
    display: FAM.playfair,
    body: FAM.sourceSerif,
    fontsourcePackages: [PKG.playfair, PKG.sourceSerif],
    mood: 'high-contrast luxe',
    categories: ['winery', 'salon', 'spa', 'boutique', 'restaurant', 'default'],
    typeScale: 'editorial',
  },
  {
    id: 'fraunces-soft',
    display: FAM.fraunces,
    body: FAM.mulish,
    fontsourcePackages: [PKG.fraunces, PKG.mulish],
    mood: 'characterful, soft',
    categories: ['cafe', 'bakery', 'salon', 'boutique', 'makers', 'default'],
    typeScale: 'humanist',
  },
  {
    id: 'garalde-editorial',
    display: FAM.cormorant,
    body: FAM.lora,
    fontsourcePackages: [PKG.cormorant, PKG.lora],
    mood: 'refined garalde',
    categories: ['winery', 'spa', 'salon', 'medical', 'law', 'restaurant'],
    typeScale: 'editorial',
  },
  {
    id: 'slab-authority',
    display: FAM.zilla,
    body: FAM.inter,
    fontsourcePackages: [PKG.zilla, PKG.inter],
    mood: 'authoritative slab',
    categories: ['contractor', 'construction', 'roofing', 'auto-repair', 'hvac', 'law'],
    typeScale: 'tight',
  },
  {
    id: 'grotesk-press',
    display: FAM.archivo,
    body: FAM.newsreader,
    fontsourcePackages: [PKG.archivo, PKG.newsreader],
    mood: 'editorial press',
    categories: ['restaurant', 'cafe', 'fitness', 'tech', 'makers', 'default'],
    typeScale: 'geometric',
  },
  {
    id: 'spectral-classic',
    display: FAM.spectral,
    body: FAM.sourceSerif,
    fontsourcePackages: [PKG.spectral, PKG.sourceSerif],
    mood: 'calm two-serif',
    categories: ['medical', 'dental', 'wellness', 'spa', 'winery', 'default'],
    typeScale: 'humanist',
  },
  {
    id: 'figtree-friendly',
    display: FAM.figtree,
    body: FAM.inter,
    fontsourcePackages: [PKG.figtree, PKG.inter],
    mood: 'approachable geometric',
    categories: ['cleaning', 'landscaping', 'fitness', 'tech', 'plumbing', 'default'],
    typeScale: 'friendly',
  },
  {
    id: 'mono-grotesk',
    display: FAM.space,
    body: FAM.mulish,
    fontsourcePackages: [PKG.space, PKG.mulish],
    mood: 'techy geometric',
    categories: ['tech', 'electrician', 'fitness', 'auto-repair', 'marina', 'default'],
    typeScale: 'geometric',
  },
  {
    id: 'bricolage-editorial',
    display: FAM.bricolage,
    body: FAM.newsreader,
    fontsourcePackages: [PKG.bricolage, PKG.newsreader],
    mood: 'quirky display + serif',
    categories: ['cafe', 'restaurant', 'bakery', 'makers', 'boutique'],
    typeScale: 'humanist',
  },
  {
    id: 'newsreader-serif',
    display: FAM.newsreader,
    body: FAM.sourceSerif,
    fontsourcePackages: [PKG.newsreader, PKG.sourceSerif],
    mood: 'newsroom serif',
    categories: ['law', 'medical', 'restaurant', 'winery', 'default'],
    typeScale: 'editorial',
  },
  {
    id: 'bitter-warm',
    display: FAM.bitter,
    body: FAM.figtree,
    fontsourcePackages: [PKG.bitter, PKG.figtree],
    mood: 'warm slab',
    categories: ['cafe', 'bakery', 'landscaping', 'cleaning', 'contractor'],
    typeScale: 'friendly',
  },
  {
    id: 'albert-display',
    display: FAM.albert,
    body: FAM.inter,
    fontsourcePackages: [PKG.albert, PKG.inter],
    mood: 'clean confident',
    categories: ['tech', 'plumbing', 'electrician', 'medical', 'dental', 'cleaning', 'default'],
    typeScale: 'geometric',
  },
  {
    id: 'lora-refined',
    display: FAM.lora,
    body: FAM.mulish,
    fontsourcePackages: [PKG.lora, PKG.mulish],
    mood: 'gentle serif + sans',
    categories: ['salon', 'spa', 'wellness', 'medical', 'cafe', 'default'],
    typeScale: 'humanist',
  },
  {
    id: 'archivo-grotesk',
    display: FAM.archivo,
    body: FAM.schibsted,
    fontsourcePackages: [PKG.archivo, PKG.schibsted],
    mood: 'bold modern sans',
    categories: ['fitness', 'auto-repair', 'towing', 'tattoo', 'barber', 'tech'],
    typeScale: 'tight',
  },
  {
    id: 'playfair-mod',
    display: FAM.playfair,
    body: FAM.figtree,
    fontsourcePackages: [PKG.playfair, PKG.figtree],
    mood: 'didone + modern sans',
    categories: ['salon', 'boutique', 'restaurant', 'winery', 'spa'],
    typeScale: 'editorial',
  },
  {
    id: 'source-clean',
    display: FAM.sourceSerif,
    body: FAM.inter,
    fontsourcePackages: [PKG.sourceSerif, PKG.inter],
    mood: 'editorial serif + UI',
    categories: ['medical', 'dental', 'law', 'tech', 'marina', 'default'],
    typeScale: 'humanist',
  },
  {
    id: 'schibsted-bold',
    display: FAM.schibsted,
    body: FAM.mulish,
    fontsourcePackages: [PKG.schibsted, PKG.mulish],
    mood: 'scandi grotesk',
    categories: ['tech', 'cleaning', 'electrician', 'marina', 'plumbing', 'default'],
    typeScale: 'geometric',
  },
  {
    id: 'cormorant-air',
    display: FAM.cormorant,
    body: FAM.figtree,
    fontsourcePackages: [PKG.cormorant, PKG.figtree],
    mood: 'airy luxe serif',
    categories: ['spa', 'salon', 'winery', 'boutique', 'wellness'],
    typeScale: 'editorial',
  },
  {
    id: 'bitter-slab-bold',
    display: FAM.bitter,
    body: FAM.mulish,
    fontsourcePackages: [PKG.bitter, PKG.mulish],
    mood: 'bold slab',
    categories: ['contractor', 'roofing', 'hvac', 'plumbing', 'auto-repair'],
    typeScale: 'tight',
  },
  {
    id: 'fraunces-grotesk',
    display: FAM.fraunces,
    body: FAM.schibsted,
    fontsourcePackages: [PKG.fraunces, PKG.schibsted],
    mood: 'expressive serif + grotesk',
    categories: ['cafe', 'restaurant', 'makers', 'boutique', 'salon', 'default'],
    typeScale: 'editorial',
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

// ===========================================================================
// Per-vertical fluid scale (utopia-core)
// ===========================================================================
//
// The TYPE_SCALES above describe a *font-pairing's* intrinsic rhythm (ratio,
// tracking, weights). On top of that we layer a per-BUSINESS-VERTICAL fluid
// scale that nudges the modular ratio, the fluid endpoints, and the spacing
// rhythm so that — beyond color and font — a dentist page and a towing page
// have a genuinely different type/space cadence. This attacks the "competent
// but samey" failure mode at the token level.
//
// These defs feed `utopia-core`'s calculateTypeScale / calculateSpaceScale
// (see tokens.ts), which turn them into the `clamp()` ladders. Everything here
// is pure data; no network, fully deterministic.

import {
  calculateTypeScale,
  calculateSpaceScale,
  type UtopiaStep,
} from 'utopia-core';

/**
 * A vertical's fluid-scale personality. Drives utopia-core. All sizes are in
 * px (utopia's native unit); tokens.ts converts to rem clamps.
 */
export interface VerticalScaleDef {
  /** human-readable note on the intended rhythm (for maintainers). */
  mood: string;
  /** body font-size in px at the min viewport. */
  minFontSize: number;
  /** body font-size in px at the max viewport. */
  maxFontSize: number;
  /** modular ratio at the min viewport (controls heading contrast on mobile). */
  minTypeScale: number;
  /** modular ratio at the max viewport (controls heading contrast on desktop). */
  maxTypeScale: number;
  /** base spacing unit in px at the min viewport. */
  minSpace: number;
  /** base spacing unit in px at the max viewport. */
  maxSpace: number;
}

/** Fluid viewport window the scales interpolate across (px). Shared by all. */
export const SCALE_MIN_VW = 320;
export const SCALE_MAX_VW = 1240;

/**
 * Per-vertical scale registry. Verticals are grouped by feel:
 *  - "authority/calm" trades-medical want a tighter, denser, no-nonsense ladder;
 *  - "expressive/editorial" hospitality-beauty want a taller, airier ladder with
 *    more heading-to-body contrast.
 * Keyed by canonical KNOWN_CATEGORIES values; `default` is the safe fallback.
 *
 * Distinct numbers per family are the whole point — e.g. medical (1.18→1.22,
 * tight space) vs towing (1.22→1.30, punchy headings) vs winery (1.2→1.333,
 * airy editorial) all resolve to visibly different rhythms.
 */
export const VERTICAL_SCALES: Record<string, VerticalScaleDef> = {
  // ── calm authority: medical / clinical ──────────────────────────────────
  // Modest heading contrast, generous-but-orderly spacing → reassuring.
  medical:     { mood: 'calm clinical', minFontSize: 16.5, maxFontSize: 18.5, minTypeScale: 1.18, maxTypeScale: 1.24, minSpace: 16, maxSpace: 22 },
  // ── punchy utility: emergency trades ────────────────────────────────────
  // Big heading jump + tight, dense spacing → urgent, get-it-done.
  towing:      { mood: 'urgent utility', minFontSize: 16, maxFontSize: 17.5, minTypeScale: 1.24, maxTypeScale: 1.32, minSpace: 14, maxSpace: 18 },
  plumbing:    { mood: 'sturdy trade',  minFontSize: 16, maxFontSize: 17.5, minTypeScale: 1.22, maxTypeScale: 1.28, minSpace: 14, maxSpace: 19 },
  hvac:        { mood: 'sturdy trade',  minFontSize: 16, maxFontSize: 17.5, minTypeScale: 1.22, maxTypeScale: 1.28, minSpace: 14, maxSpace: 19 },
  electrician: { mood: 'crisp trade',   minFontSize: 16, maxFontSize: 17.5, minTypeScale: 1.2,  maxTypeScale: 1.27, minSpace: 14, maxSpace: 19 },
  roofing:     { mood: 'bold trade',    minFontSize: 16, maxFontSize: 17.5, minTypeScale: 1.23, maxTypeScale: 1.3,  minSpace: 14, maxSpace: 18 },
  contractor:  { mood: 'solid build',   minFontSize: 16, maxFontSize: 18,   minTypeScale: 1.2,  maxTypeScale: 1.27, minSpace: 15, maxSpace: 20 },
  'auto-repair': { mood: 'mechanical',  minFontSize: 16, maxFontSize: 17.5, minTypeScale: 1.23, maxTypeScale: 1.3,  minSpace: 14, maxSpace: 18 },
  cleaning:    { mood: 'fresh tidy',    minFontSize: 16, maxFontSize: 18,   minTypeScale: 1.2,  maxTypeScale: 1.25, minSpace: 15, maxSpace: 21 },
  // ── expressive editorial: hospitality / beauty / craft ──────────────────
  // Tall heading contrast + airy spacing → premium, unhurried.
  winery:      { mood: 'airy editorial', minFontSize: 17, maxFontSize: 19,   minTypeScale: 1.2,  maxTypeScale: 1.333, minSpace: 17, maxSpace: 26 },
  cafe:        { mood: 'warm inviting',  minFontSize: 16.5, maxFontSize: 18.5, minTypeScale: 1.2, maxTypeScale: 1.28, minSpace: 16, maxSpace: 24 },
  restaurant:  { mood: 'rich menu',      minFontSize: 16.5, maxFontSize: 18.5, minTypeScale: 1.2, maxTypeScale: 1.3, minSpace: 16, maxSpace: 24 },
  salon:       { mood: 'chic boutique',  minFontSize: 16.5, maxFontSize: 18.5, minTypeScale: 1.2, maxTypeScale: 1.32, minSpace: 16, maxSpace: 25 },
  spa:         { mood: 'serene luxe',    minFontSize: 17, maxFontSize: 19,   minTypeScale: 1.18, maxTypeScale: 1.3, minSpace: 17, maxSpace: 26 },
  barber:      { mood: 'sharp craft',    minFontSize: 16, maxFontSize: 18,   minTypeScale: 1.22, maxTypeScale: 1.3, minSpace: 15, maxSpace: 22 },
  tattoo:      { mood: 'bold ink',       minFontSize: 16, maxFontSize: 18,   minTypeScale: 1.24, maxTypeScale: 1.34, minSpace: 15, maxSpace: 22 },
  fitness:     { mood: 'energetic',      minFontSize: 16, maxFontSize: 18,   minTypeScale: 1.24, maxTypeScale: 1.32, minSpace: 15, maxSpace: 21 },
  landscaping: { mood: 'organic calm',   minFontSize: 16.5, maxFontSize: 18.5, minTypeScale: 1.2, maxTypeScale: 1.28, minSpace: 16, maxSpace: 24 },
  marina:      { mood: 'coastal open',   minFontSize: 16.5, maxFontSize: 18.5, minTypeScale: 1.2, maxTypeScale: 1.28, minSpace: 16, maxSpace: 25 },
  // ── neutral fallback ────────────────────────────────────────────────────
  default:     { mood: 'balanced',       minFontSize: 16, maxFontSize: 18,   minTypeScale: 1.2,  maxTypeScale: 1.25, minSpace: 16, maxSpace: 21 },
};

/** Resolve the vertical scale for a category, with a safe default. */
export function verticalScaleFor(category: string): VerticalScaleDef {
  return VERTICAL_SCALES[category] ?? VERTICAL_SCALES.default;
}

/** A fully-computed fluid scale ready for tokens.ts to emit. */
export interface ComputedScale {
  /** type steps keyed by step index (e.g. -1, 0 … 6) → clamp string. */
  typeSteps: Record<number, string>;
  /** space sizes keyed by t-shirt label (xs, s, m …) → clamp string. */
  spaceSizes: Record<string, string>;
}

/** Step range emitted for the type ladder (mirrors tokens.ts --step-* range). */
const TYPE_NEG_STEPS = 1; // --step--1
const TYPE_POS_STEPS = 6; // --step-1 … --step-6

/**
 * Build the concrete fluid type + space scales for a vertical via utopia-core.
 *
 * Deterministic and pure. If utopia's WCAG 1.4.4 check flags a type step (font
 * shrinking too much as the viewport grows — an a11y/zoom hazard), we nudge the
 * min ratio down a hair and recompute once; if it still complains we fall back
 * to the neutral `default` scale so we never emit a known-bad ladder. This keeps
 * the contrast/legibility audit spirit clean without throwing.
 */
export function computeVerticalScale(def: VerticalScaleDef): ComputedScale {
  const typeSteps = buildTypeSteps(def);
  const space = calculateSpaceScale({
    minWidth: SCALE_MIN_VW,
    maxWidth: SCALE_MAX_VW,
    minSize: def.minSpace,
    maxSize: def.maxSpace,
    // Two smaller sub-base sizes + a tall positive ramp for section rhythm.
    negativeSteps: [0.5, 0.25],
    positiveSteps: [1.5, 2, 3, 4, 6],
  });
  const spaceSizes: Record<string, string> = {};
  for (const s of space.sizes) spaceSizes[s.label] = s.clamp;
  return { typeSteps, spaceSizes };
}

/** Compute the type ladder with a one-shot WCAG self-heal (see computeVerticalScale). */
function buildTypeSteps(def: VerticalScaleDef): Record<number, string> {
  const attempt = (minTypeScale: number): UtopiaStep[] =>
    calculateTypeScale({
      minWidth: SCALE_MIN_VW,
      maxWidth: SCALE_MAX_VW,
      minFontSize: def.minFontSize,
      maxFontSize: def.maxFontSize,
      minTypeScale,
      maxTypeScale: def.maxTypeScale,
      negativeSteps: TYPE_NEG_STEPS,
      positiveSteps: TYPE_POS_STEPS,
    });

  let steps = attempt(def.minTypeScale);
  if (steps.some((s) => s.wcagViolation)) {
    // Nudge the mobile ratio toward the desktop ratio (less aggressive shrink).
    const gentler = Math.min(def.maxTypeScale, def.minTypeScale + 0.04);
    const retried = attempt(gentler);
    if (!retried.some((s) => s.wcagViolation)) {
      steps = retried;
    } else {
      // Last resort: neutral default scale (known-clean), never emit bad ladder.
      const d = VERTICAL_SCALES.default;
      steps = calculateTypeScale({
        minWidth: SCALE_MIN_VW,
        maxWidth: SCALE_MAX_VW,
        minFontSize: d.minFontSize,
        maxFontSize: d.maxFontSize,
        minTypeScale: d.minTypeScale,
        maxTypeScale: d.maxTypeScale,
        negativeSteps: TYPE_NEG_STEPS,
        positiveSteps: TYPE_POS_STEPS,
      });
    }
  }

  const out: Record<number, string> = {};
  for (const s of steps) out[s.step] = s.clamp;
  return out;
}

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
