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
import {
  pickFont,
  FONT_BY_ID,
  type FontPairing,
  type TypeScaleDef,
  TYPE_SCALES,
  verticalScaleFor,
  VERTICAL_SCALES,
  type VerticalScaleDef,
} from './fonts';

export type ShapeFamily = 'soft' | 'sharp' | 'editorial' | 'rounded-pill' | 'framed';
export type MotionLevel = 'none' | 'subtle' | 'expressive';
export type Density = 'compact' | 'standard' | 'spacious';
export type NeutralTemp = 'warm' | 'cool';
export type Archetype = 'classic' | 'editorial' | 'utility' | 'magazine';
/**
 * Hero-photo tier (set by the generator from the source photo's pixel width):
 *  - 'fullbleed' (>=1600w): any hero incl. cinematic full-bleed is allowed.
 *  - 'side'      (1000-1599w): keep the real photo but in a side-column hero —
 *    NEVER cinematic/full-bleed (it would upscale blurry).
 *  - 'none'      (<1000w): too small to show → text hero.
 */
export type HeroPhotoTier = 'fullbleed' | 'side' | 'none';

/** Page architecture per category (honored unless config.artDirection.archetype pins one). */
const ARCHETYPE_BY_CAT: Record<string, Archetype> = {
  winery: 'editorial',
  salon: 'editorial',
  spa: 'editorial',
  medical: 'editorial',
  cafe: 'editorial',
  restaurant: 'magazine',
  tattoo: 'editorial',
  landscaping: 'editorial',
  barber: 'magazine',
  towing: 'utility',
  plumbing: 'utility',
  hvac: 'utility',
  electrician: 'utility',
  roofing: 'utility',
  contractor: 'utility',
  cleaning: 'utility',
  'auto-repair': 'utility',
  fitness: 'magazine',
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
  /**
   * Per-vertical fluid scale personality (utopia-core inputs). Layered ON TOP
   * of `typeScale`: `typeScale` carries the font pairing's intrinsic feel
   * (tracking, weights, leading) while `verticalScale` gives the business
   * category its own fluid type/space RHYTHM so a dentist and a tow company
   * differ beyond color/font. tokens.ts turns this into the --step-* + --space-*
   * clamp ladders. Defaults to the category scale; pinnable via
   * config.artDirection.scaleId (a KNOWN_CATEGORIES key into VERTICAL_SCALES).
   */
  verticalScale: VerticalScaleDef;
  shape: ShapeFamily;
  motion: MotionLevel;
  density: Density;
  archetype: Archetype;
  neutralTemp: NeutralTemp;
  /**
   * Hero-photo tier from the generator (by source photo width). When 'side', the
   * photo is only medium-res, so consumers (compose.ts pickHero) must NOT pick a
   * full-bleed `cinematic` hero — it would upscale blurry. Undefined → unconstrained.
   */
  heroPhotoTier?: HeroPhotoTier;
  /** carry-through of explicit token overrides for tokens.ts to apply last */
  tokenOverrides?: TokenOverrides;
}

/** Categories the rest of the system knows about (recipes, fonts, presets). */
export const KNOWN_CATEGORIES = [
  'winery',
  'cafe',
  'restaurant',
  'towing',
  'plumbing',
  'auto-repair',
  'hvac',
  'roofing',
  'electrician',
  'contractor',
  'cleaning',
  'salon',
  'spa',
  'barber',
  'medical',
  'fitness',
  'landscaping',
  'tattoo',
  'marina',
  'default',
] as const;

/**
 * Raw category labels (from the scraper / CSV) → a canonical KNOWN_CATEGORIES key.
 * The generator writes the RAW label (e.g. "medical_spa", "hvac_services",
 * "dentist") into config.category; without this, every trade/medical/restaurant
 * lead fell through to `default` and got dressed as a winery. Keys are
 * lowercased + space/underscore-collapsed before lookup (see `canonCategory`).
 */
const CATEGORY_ALIASES: Record<string, string> = {
  // food & drink
  coffee: 'cafe', 'coffee-shop': 'cafe', coffeehouse: 'cafe', espresso: 'cafe', roaster: 'cafe', bakery: 'cafe', patisserie: 'cafe', bistro: 'cafe',
  restaurants: 'restaurant', eatery: 'restaurant', diner: 'restaurant', grill: 'restaurant', taqueria: 'restaurant', pizzeria: 'restaurant', pizza: 'restaurant', 'mexican-restaurant': 'restaurant', 'craft-kitchen': 'restaurant', 'beer-garden': 'restaurant', brewery: 'restaurant', pub: 'restaurant',
  // beauty & wellness
  hair: 'salon', hairdresser: 'salon', 'hair-salon': 'salon', beauty: 'salon', 'beauty-salon': 'salon', nail: 'salon', nails: 'salon', 'nail-salon': 'salon', stylist: 'salon', lash: 'salon',
  massage: 'spa', 'medical-spa': 'spa', 'med-spa': 'spa', medspa: 'spa', 'day-spa': 'spa', wellness: 'spa', esthetician: 'spa', skincare: 'spa', 'medical-aesthetics': 'spa', aesthetics: 'spa', ayurveda: 'spa',
  barbershop: 'barber', 'barber-shop': 'barber',
  // medical
  dentist: 'medical', dental: 'medical', 'dental-clinic': 'medical', dds: 'medical', orthodontist: 'medical', doctor: 'medical', physician: 'medical', clinic: 'medical', chiropractor: 'medical', 'medical-office': 'medical', optometrist: 'medical', veterinary: 'medical', vet: 'medical', equine: 'medical',
  // fitness
  gym: 'fitness', 'fitness-center': 'fitness', crossfit: 'fitness', yoga: 'fitness', pilates: 'fitness', 'personal-training': 'fitness',
  // trades
  plumber: 'plumbing', 'plumbing-heating': 'plumbing', drain: 'plumbing', rooter: 'plumbing',
  electrical: 'electrician', electric: 'electrician', electricians: 'electrician',
  heating: 'hvac', cooling: 'hvac', 'air-conditioning': 'hvac', ac: 'hvac', 'hvac-contractor': 'hvac', 'hvac-services': 'hvac', 'heating-and-cooling': 'hvac', 'heating-and-air-conditioning': 'hvac', 'sheet-metal': 'hvac',
  roof: 'roofing', roofer: 'roofing', 'roofing-contractor': 'roofing', 'roofing-and-construction': 'roofing',
  'general-contractor': 'contractor', builder: 'contractor', builders: 'contractor', construction: 'contractor', remodeling: 'contractor', remodeler: 'contractor', handyman: 'contractor', concrete: 'contractor', insulation: 'contractor', carpet: 'contractor', painting: 'contractor', painter: 'contractor', flooring: 'contractor', masonry: 'contractor',
  // home services
  landscaper: 'landscaping', landscape: 'landscaping', lawn: 'landscaping', 'lawn-care': 'landscaping', gardening: 'landscaping', yard: 'landscaping', 'property-maintenance': 'landscaping',
  'house-cleaning': 'cleaning', housekeeping: 'cleaning', janitorial: 'cleaning', maid: 'cleaning',
  // auto & misc
  auto: 'auto-repair', mechanic: 'auto-repair', automotive: 'auto-repair', 'auto-body': 'auto-repair', 'body-shop': 'auto-repair', 'car-repair': 'auto-repair',
  tow: 'towing', 'tow-truck': 'towing', 'towing-service': 'towing',
  wineries: 'winery', vineyard: 'winery', vineyards: 'winery', 'tasting-room': 'winery', cellars: 'winery', cellar: 'winery', wine: 'winery',
  marinas: 'marina', harbor: 'marina',
};

/** Normalize any raw category label → a canonical KNOWN_CATEGORIES key, or null. */
export function canonCategory(raw?: string): string | null {
  const c = (raw ?? '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (!c) return null;
  if ((KNOWN_CATEGORIES as readonly string[]).includes(c)) return c;
  if (CATEGORY_ALIASES[c]) return CATEGORY_ALIASES[c];
  return null;
}

/** keyword → category inference table (checked against name + services). */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  winery: ['winery', 'vineyard', 'wine', 'cellar', 'tasting'],
  cafe: ['cafe', 'café', 'coffee', 'bakery', 'espresso', 'roaster', 'bistro', 'patisserie'],
  restaurant: ['restaurant', 'kitchen', 'eatery', 'taqueria', 'pizzeria', 'grill', 'brewery', 'beer garden', 'bar & grill'],
  towing: ['tow', 'towing', 'recovery', 'roadside', 'wrecker', 'flatbed'],
  plumbing: ['plumb', 'plumbing', 'drain', 'sewer', 'pipe', 'water heater', 'rooter'],
  hvac: ['hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'heat pump', 'ductwork'],
  roofing: ['roof', 'roofing', 'shingle', 'gutter', 're-roof'],
  electrician: ['electric', 'electrical', 'electrician', 'wiring', 'panel upgrade', 'lighting install'],
  contractor: ['contractor', 'construction', 'remodel', 'builder', 'concrete', 'insulation', 'carpentry', 'masonry', 'flooring', 'painting'],
  cleaning: ['cleaning', 'janitorial', 'housekeeping', 'maid'],
  'auto-repair': ['auto', 'mechanic', 'repair', 'transmission', 'brake', 'tire', 'collision', 'body shop', 'garage'],
  salon: ['salon', 'hair', 'barber', 'beauty', 'nail', 'stylist', 'lash'],
  spa: ['spa', 'massage', 'aesthetic', 'skincare', 'wellness', 'ayurveda', 'facial'],
  barber: ['barber', 'barbershop', 'fade', 'grooming'],
  medical: ['dentist', 'dental', 'dds', 'orthodont', 'clinic', 'physician', 'chiropract', 'veterinary', 'optometr', 'medical'],
  fitness: ['fitness', 'gym', 'crossfit', 'yoga', 'pilates', 'training', 'strength'],
  landscaping: ['landscap', 'lawn', 'garden', 'tree', 'yard', 'hardscape', 'irrigation', 'nursery'],
  tattoo: ['tattoo', 'piercing', 'pierc', 'ink', 'body art', 'tooth gem', 'flash'],
};

/**
 * Categories that should be tonally serious — caps motion to at most 'subtle'.
 */
const SERIOUS_CATEGORIES = new Set([
  'towing', 'plumbing', 'auto-repair', 'hvac', 'roofing', 'electrician', 'contractor', 'cleaning',
]);
/** Categories that may go 'expressive'. */
const EXPRESSIVE_CATEGORIES = new Set([
  'cafe', 'restaurant', 'salon', 'spa', 'winery', 'landscaping', 'tattoo', 'fitness', 'barber',
]);

/** Infer a business category from config when not explicitly set. */
export function inferCategory(config: ProspectConfig): string {
  // Normalize an explicit (possibly raw scraper) label first — "medical_spa",
  // "hvac_services", "dentist" all resolve to a real canonical category instead
  // of leaking through and falling back to the winery-serif default.
  if (config.category) {
    const canon = canonCategory(config.category);
    if (canon) return canon;
  }
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
  restaurant: 'clay-warm',
  towing: 'recovery-red',
  plumbing: 'slate-utility',
  hvac: 'slate-utility',
  electrician: 'slate-utility',
  roofing: 'recovery-red',
  contractor: 'ink-neutral',
  cleaning: 'coastal',
  'auto-repair': 'recovery-red',
  salon: 'boutique-rose',
  spa: 'boutique-rose',
  barber: 'ink-neutral',
  medical: 'coastal',
  fitness: 'recovery-red',
  landscaping: 'garden',
  tattoo: 'boutique-rose',
  marina: 'coastal',
  default: 'ink-neutral',
};

/** Preferred shape families per category (engine picks among these by seed). */
const CATEGORY_SHAPES: Record<string, ShapeFamily[]> = {
  winery: ['editorial', 'soft', 'framed'],
  cafe: ['soft', 'rounded-pill', 'framed'],
  restaurant: ['soft', 'editorial', 'rounded-pill'],
  towing: ['sharp', 'framed'],
  plumbing: ['sharp', 'soft'],
  hvac: ['sharp', 'soft'],
  electrician: ['sharp', 'framed'],
  roofing: ['sharp', 'framed'],
  contractor: ['sharp', 'framed', 'soft'],
  cleaning: ['rounded-pill', 'soft'],
  'auto-repair': ['sharp', 'framed'],
  salon: ['editorial', 'rounded-pill', 'soft'],
  spa: ['soft', 'editorial', 'rounded-pill'],
  barber: ['sharp', 'framed', 'editorial'],
  medical: ['soft', 'rounded-pill', 'framed'],
  fitness: ['sharp', 'framed'],
  landscaping: ['soft', 'editorial', 'framed'],
  tattoo: ['editorial', 'sharp', 'soft'],
  marina: ['soft', 'framed', 'editorial'],
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
  const warmBias = ['cafe', 'restaurant', 'winery', 'salon', 'spa', 'barber', 'landscaping'].includes(category);
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

  // ── per-vertical fluid scale ────────────────────────────────────────────
  // Give each business vertical its own type/space RHYTHM (utopia-core), so a
  // dentist and a tow company differ at the token level — not just in color.
  // Pinnable via config.artDirection.scaleId (a VERTICAL_SCALES key); read
  // through a cast since it is engine-internal and not in ArtDirectionConfig.
  const scaleIdRaw = (ad as { scaleId?: unknown }).scaleId;
  const scaleId =
    typeof scaleIdRaw === 'string' && VERTICAL_SCALES[scaleIdRaw] ? scaleIdRaw : category;
  const verticalScale = verticalScaleFor(scaleId);

  // ── shape / motion / density ───────────────────────────────────────────────
  const shape = pickShape(category, seed, ad.shape as ShapeFamily | undefined);
  const motion = pickMotion(category, seed, ad.motion as MotionLevel | undefined);
  const density = (ad.density as Density | undefined) ?? densityForFont(fontPairing, seed);
  const archetype: Archetype =
    (ad.archetype as Archetype | undefined) ?? ARCHETYPE_BY_CAT[category] ?? 'classic';

  // Hero-photo tier hint from the generator (config.artDirection.heroPhotoTier).
  // Read through a cast since it is generator-internal and not in the shared
  // ArtDirectionConfig type. Only a valid tier is threaded; anything else → undefined.
  const rawTier = (ad as { heroPhotoTier?: unknown }).heroPhotoTier;
  const heroPhotoTier: HeroPhotoTier | undefined =
    rawTier === 'fullbleed' || rawTier === 'side' || rawTier === 'none' ? rawTier : undefined;

  return {
    seed,
    category,
    palette,
    fontId,
    fontPairing,
    typeScale,
    verticalScale,
    shape,
    motion,
    density,
    archetype,
    neutralTemp,
    heroPhotoTier,
    tokenOverrides: config.tokens,
  };
}
