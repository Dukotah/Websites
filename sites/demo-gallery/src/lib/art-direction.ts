/**
 * Art direction — the deterministic resolver that turns a prospect config into a
 * complete visual identity (spec §5). Pure, deterministic, never throws.
 *
 * resolveArtDirection(config) is the single entry point: it honors any explicit
 * overrides (config.artDirection / fontId / tokens / category) and derives
 * everything else from theme.brand + inferred category + slug seed, so a legacy
 * config with only theme.brand still gets a full, varied identity.
 */

import type { ProspectConfig, ArtDirectionConfig, TokenOverrides } from '../types';
import { hash, pick, chance } from './seed';
import { derivePalette, derivePaletteFromPreset, type Palette } from './palette';
import { pickFont, FONT_BY_ID, type FontPairing, type TypeScaleDef, TYPE_SCALES } from './fonts';

export type ShapeFamily = 'soft' | 'sharp' | 'editorial' | 'rounded-pill' | 'framed';
export type MotionLevel = 'none' | 'subtle' | 'expressive';
export type Density = 'compact' | 'standard' | 'spacious';
export type NeutralTemp = 'warm' | 'cool';
export type Archetype = 'classic' | 'editorial' | 'utility' | 'magazine';

/** Page architecture per category (honored unless config.artDirection.archetype pins one). */
const ARCHETYPE_BY_CAT: Record<string, Archetype> = {
  winery: 'editorial',
  salon: 'editorial',
  cafe: 'editorial',
  tattoo: 'editorial',
  landscaping: 'editorial',
  towing: 'utility',
  plumbing: 'utility',
  'auto-repair': 'utility',
};

export interface ArtDirection {
  /** stable slug-derived seed driving all otherwise-random choices */
  seed: number;
  /** the inferred (or explicit) business category */
  category: string;
  palette: Palette;
  fontId: string;
  fontPairing: FontPairing;
  typeScale: TypeScaleDef;
  shape: ShapeFamily;
  motion: MotionLevel;
  density: Density;
  archetype: Archetype;
  neutralTemp: NeutralTemp;
  /** carry-through of explicit token overrides for tokens.ts to apply last */
  tokenOverrides?: TokenOverrides;
}

/** Categories the rest of the system knows about (recipes, fonts, presets). */
export const KNOWN_CATEGORIES = [
  'winery',
  'cafe',
  'towing',
  'plumbing',
  'auto-repair',
  'salon',
  'landscaping',
  'tattoo',
  'default',
] as const;

/** keyword → category inference table (checked against name + services). */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  winery: ['winery', 'vineyard', 'wine', 'cellar', 'tasting'],
  cafe: ['cafe', 'café', 'coffee', 'bakery', 'espresso', 'roaster', 'bistro', 'patisserie'],
  towing: ['tow', 'towing', 'recovery', 'roadside', 'wrecker', 'flatbed'],
  plumbing: ['plumb', 'plumbing', 'drain', 'sewer', 'pipe', 'water heater', 'rooter'],
  'auto-repair': ['auto', 'mechanic', 'repair', 'transmission', 'brake', 'tire', 'collision', 'body shop', 'garage'],
  salon: ['salon', 'hair', 'spa', 'barber', 'beauty', 'nail', 'stylist', 'lash', 'aesthetic'],
  landscaping: ['landscap', 'lawn', 'garden', 'tree', 'yard', 'hardscape', 'irrigation', 'nursery'],
  tattoo: ['tattoo', 'piercing', 'pierc', 'ink', 'body art', 'tooth gem', 'flash'],
};

/**
 * Categories that should be tonally serious — caps motion to at most 'subtle'.
 */
const SERIOUS_CATEGORIES = new Set(['towing', 'plumbing', 'auto-repair']);
/** Categories that may go 'expressive'. */
const EXPRESSIVE_CATEGORIES = new Set(['cafe', 'salon', 'winery', 'landscaping', 'tattoo']);

/** Infer a business category from config when not explicitly set. */
export function inferCategory(config: ProspectConfig): string {
  if (config.category && KNOWN_CATEGORIES.includes(config.category as any)) {
    return config.category;
  }
  if (config.category) return config.category; // honor unknown explicit value
  const hay = [
    config.name ?? '',
    config.tagline ?? '',
    config.servicesHeading ?? '',
    ...(config.services ?? []).map((s) => `${s.title} ${s.description}`),
    ...(config.highlights ?? []),
  ]
    .join(' ')
    .toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => hay.includes(w))) return cat;
  }
  return 'default';
}

/** Map a category to a preferred palette preset id (used when no brand). */
const CATEGORY_PRESET: Record<string, string> = {
  winery: 'vineyard',
  cafe: 'clay-warm',
  towing: 'recovery-red',
  plumbing: 'slate-utility',
  'auto-repair': 'recovery-red',
  salon: 'boutique-rose',
  landscaping: 'garden',
  tattoo: 'boutique-rose',
  default: 'ink-neutral',
};

/** Preferred shape families per category (engine picks among these by seed). */
const CATEGORY_SHAPES: Record<string, ShapeFamily[]> = {
  winery: ['editorial', 'soft', 'framed'],
  cafe: ['soft', 'rounded-pill', 'framed'],
  towing: ['sharp', 'framed'],
  plumbing: ['sharp', 'soft'],
  'auto-repair': ['sharp', 'framed'],
  salon: ['editorial', 'rounded-pill', 'soft'],
  landscaping: ['soft', 'editorial', 'framed'],
  tattoo: ['editorial', 'sharp', 'soft'],
  default: ['soft', 'sharp', 'editorial'],
};

/** Density bias per type-scale (editorial/luxury → spacious, utility → tighter). */
function densityForFont(font: FontPairing, seed: number): Density {
  switch (font.typeScale) {
    case 'editorial':
      return 'spacious';
    case 'humanist':
      return chance(seed ^ 0x51ed270b, 0.5) ? 'spacious' : 'standard';
    case 'tight':
      return chance(seed ^ 0x33e6, 0.5) ? 'compact' : 'standard';
    case 'geometric':
    case 'friendly':
    default:
      return 'standard';
  }
}

/** Choose a brand-tinted neutral temperament, seeded unless overridden. */
function pickNeutralTemp(category: string, seed: number, override?: NeutralTemp): NeutralTemp {
  if (override) return override;
  // Warm categories lean cream; utility leans cool — but still seeded.
  const warmBias = ['cafe', 'winery', 'salon', 'landscaping'].includes(category);
  return chance(seed ^ 0x2545f491, warmBias ? 0.7 : 0.4) ? 'warm' : 'cool';
}

/** Choose a motion level, seeded then capped by category seriousness. */
function pickMotion(category: string, seed: number, override?: MotionLevel): MotionLevel {
  if (override) return override;
  let level: MotionLevel;
  if (EXPRESSIVE_CATEGORIES.has(category)) {
    level = pick(seed ^ 0x7feb352d, ['subtle', 'subtle', 'expressive'] as const);
  } else {
    level = pick(seed ^ 0x846ca68b, ['subtle', 'subtle', 'none'] as const);
  }
  if (SERIOUS_CATEGORIES.has(category) && level === 'expressive') level = 'subtle';
  return level;
}

/** Choose a shape family from the category's palette of options, seeded. */
function pickShape(category: string, seed: number, override?: ShapeFamily): ShapeFamily {
  if (override) return override;
  const options = CATEGORY_SHAPES[category] ?? CATEGORY_SHAPES.default;
  return pick(seed ^ 0xc2b2ae35, options);
}

/**
 * Resolve a complete ArtDirection from a prospect config + its slug.
 * The slug is read from config via a private field if present; otherwise the
 * caller may pass it. We keep the signature spec-faithful (config only) and
 * derive the seed from name when no slug is attached.
 */
export function resolveArtDirection(config: ProspectConfig, slug?: string): ArtDirection {
  const ad: ArtDirectionConfig = config.artDirection ?? {};
  const category = inferCategory(config);

  // Seed: prefer an explicit slug, else a stable hash of name+brand so the same
  // business always resolves identically.
  const seedKey = slug ?? `${config.name ?? ''}|${config.theme?.brand ?? ''}`;
  const seed = hash(seedKey);

  // ── palette ───────────────────────────────────────────────────────────────
  const accentStrategy = ad.accentStrategy;
  const neutralTemp = pickNeutralTemp(category, seed, ad.neutralTemp as NeutralTemp | undefined);
  let palette: Palette;
  const brand = config.theme?.brand;
  if (ad.paletteId) {
    palette = derivePaletteFromPreset(ad.paletteId, { seed, accentStrategy, neutralTemp });
  } else if (brand && String(brand).trim()) {
    palette = derivePalette(brand, {
      brandDark: config.theme?.brandDark,
      seed,
      accentStrategy,
      neutralTemp,
    });
  } else {
    palette = derivePaletteFromPreset(CATEGORY_PRESET[category] ?? 'ink-neutral', {
      seed,
      accentStrategy,
      neutralTemp,
    });
  }

  // ── fonts ───────────────────────────────────────────────────────────────
  const fontId = ad.fontId && FONT_BY_ID[ad.fontId] ? ad.fontId : pickFont(category, seed).id;
  const fontPairing = FONT_BY_ID[fontId];
  const typeScale = TYPE_SCALES[fontPairing.typeScale];

  // ── shape / motion / density ───────────────────────────────────────────────
  const shape = pickShape(category, seed, ad.shape as ShapeFamily | undefined);
  const motion = pickMotion(category, seed, ad.motion as MotionLevel | undefined);
  const density = (ad.density as Density | undefined) ?? densityForFont(fontPairing, seed);
  const archetype: Archetype =
    (ad.archetype as Archetype | undefined) ?? ARCHETYPE_BY_CAT[category] ?? 'classic';

  return {
    seed,
    category,
    palette,
    fontId,
    fontPairing,
    typeScale,
    shape,
    motion,
    density,
    archetype,
    neutralTemp,
    tokenOverrides: config.tokens,
  };
}
