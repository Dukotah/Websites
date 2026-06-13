/**
 * Palette system — a full, accessible token palette derived from a single brand
 * seed (spec §4). Pure JS, dependency-free, deterministic, never throws.
 *
 * The returned `Palette` keys map 1:1 onto the color tokens in spec §2.1, so
 * `tokens.ts` can emit them directly.
 */

import {
  toHsl,
  toHex,
  mix,
  lighten,
  darken,
  contrastRatio,
  ensureContrast,
  bestTextOn,
  type Hsl,
} from './color';
import { hash, chance, rangeInt } from './seed';

export type AccentStrategy = 'analogous' | 'complementary';
export type NeutralTemp = 'warm' | 'cool';

/** Full color palette — keys map 1:1 to the §2.1 color tokens. */
export interface Palette {
  brand: string;
  /** A brighter, confidently-chromatic brand for SOLID FILLS (claim bar, pills,
   *  badges) so the chrome reads as real color, not near-black. Paired with
   *  brandVividContrast for legible text. `brand` stays the (darker) text/link hue. */
  brandVivid: string;
  brandVividContrast: string;
  brandDark: string;
  brandContrast: string;
  accent: string;
  accentContrast: string;
  bg: string;
  bgAlt: string;
  bgDeep: string;
  surface: string;
  surface2: string;
  text: string;
  textMuted: string;
  textOnDark: string;
  border: string;
  ring: string;
  /** echoed for meta theme-color / debugging */
  neutralTemp: NeutralTemp;
  accentStrategy: AccentStrategy;
}

export interface DerivePaletteOptions {
  /** explicit deep brand (config.theme.brandDark) — used as-is if valid */
  brandDark?: string;
  /** force accent strategy; otherwise seeded */
  accentStrategy?: AccentStrategy;
  /** force neutral temperament; otherwise seeded */
  neutralTemp?: NeutralTemp;
  /** seed for the (otherwise) random choices — defaults to hash(brand) */
  seed?: number;
}

/**
 * Curated category seeds (spec §4.2). These are *seeds* — `derivePalette` still
 * builds the full palette around them. Each: brand, accent, deep, paper.
 */
export const PALETTE_PRESETS: Record<
  string,
  { mood: string; brand: string; accent: string; deep: string; paper: string }
> = {
  'clay-warm': { mood: 'earthy, cafe', brand: '#c2683a', accent: '#3f7d6e', deep: '#2b211b', paper: '#f7f1e8' },
  vineyard: { mood: 'winery, deep', brand: '#7b2d3a', accent: '#b9893f', deep: '#241318', paper: '#f6efe6' },
  'slate-utility': { mood: 'plumbing/utility', brand: '#1f6feb', accent: '#f08a24', deep: '#14233a', paper: '#f3f6fb' },
  'recovery-red': { mood: 'towing/auto', brand: '#d4452a', accent: '#f2b417', deep: '#191d22', paper: '#f4f2ef' },
  garden: { mood: 'landscaping', brand: '#2f8f3e', accent: '#caa43a', deep: '#16241a', paper: '#f1f5ee' },
  'boutique-rose': { mood: 'salon', brand: '#b5557f', accent: '#6a7bb0', deep: '#241a22', paper: '#f8eff3' },
  'ink-neutral': { mood: 'default/pro', brand: '#2b2b2b', accent: '#b6794a', deep: '#141414', paper: '#f6f4f1' },
  coastal: { mood: 'hospitality', brand: '#1f7a8c', accent: '#e08a3c', deep: '#0f2a30', paper: '#eef6f6' },
};

/** A guaranteed-safe neutral palette (used if everything else fails). */
function safePalette(): Palette {
  return {
    brand: '#2b2b2b',
    brandVivid: '#3a3a3a',
    brandVividContrast: '#ffffff',
    brandDark: '#141414',
    brandContrast: '#ffffff',
    accent: '#b6794a',
    accentContrast: '#ffffff',
    bg: '#f6f4f1',
    bgAlt: '#ece8e2',
    bgDeep: '#141414',
    surface: '#ffffff',
    surface2: '#f3f0eb',
    text: '#1d1c1a',
    textMuted: '#5f5b54',
    textOnDark: '#f4f1ec',
    border: '#e2ddd4',
    ring: '#b6794a',
    neutralTemp: 'warm',
    accentStrategy: 'analogous',
  };
}

/** Build a brand-tinted neutral at a target lightness and low saturation. */
function tintedNeutral(hue: number, sat: number, l: number): string {
  return toHex({ h: hue, s: sat, l });
}

/**
 * Derive a full, WCAG-corrected palette from a brand hex.
 * Deterministic and never throws (bad hex → safe neutral palette).
 */
export function derivePalette(brand: string, opts: DerivePaletteOptions = {}): Palette {
  try {
    const seed = opts.seed ?? hash(String(brand ?? ''));
    const baseHsl: Hsl = toHsl(brand);

    // Per-business identity + vividness (the two color failures Fable flagged):
    //   1. siblings sharing a category preset color rendered the IDENTICAL hex —
    //      so nudge the hue by a seeded ±8° to give each its own shade;
    //   2. the preset brands were muddy + dark, so the chrome read as near-black —
    //      floor the chroma to a confident level on darker brands.
    // Lightness is left untouched so the WCAG contrast pass below stays stable.
    const jitter = rangeInt(seed ^ 0x68bc21, 0, 16) - 8; // -8..+8°
    const vivBrand: Hsl = {
      h: (baseHsl.h + jitter + 360) % 360,
      s: baseHsl.l < 60 ? Math.max(baseHsl.s, 58) : baseHsl.s,
      l: baseHsl.l,
    };

    // Guard: a fully invalid/black-zero input toHsl still returns something
    // usable; we proceed and let the contrast pass clean it up.
    const hue = vivBrand.h;
    const brandSat = vivBrand.s;

    const neutralTemp: NeutralTemp =
      opts.neutralTemp ?? (chance(seed ^ 0x9e3779b1, 0.5) ? 'warm' : 'cool');
    const accentStrategy: AccentStrategy =
      opts.accentStrategy ?? (chance(seed ^ 0x85ebca6b, 0.5) ? 'complementary' : 'analogous');

    // Brand: the authored color, vivified + hue-jittered (above), normalized
    // through hsl→hex so downstream math is consistent.
    const brandHex = toHex(vivBrand);

    // brand-dark: provided override (if valid & distinct) else derived deep.
    let brandDark: string;
    if (opts.brandDark && contrastRatio(opts.brandDark, '#ffffff') > 1.2) {
      brandDark = toHex(toHsl(opts.brandDark));
    } else {
      brandDark = toHex({
        h: hue,
        s: Math.min(100, brandSat + 8),
        l: rangeInt(seed ^ 0x27d4eb2f, 18, 24),
      });
    }

    // accent: analogous (±25–40°) or complementary (180°), seeded.
    const accentHue =
      accentStrategy === 'complementary'
        ? (hue + 180) % 360
        : (hue + (chance(seed ^ 0x165667b1, 0.5) ? 1 : -1) * rangeInt(seed ^ 0x12345, 25, 40) + 360) % 360;
    let accent = toHex({
      h: accentHue,
      s: Math.max(45, Math.min(85, brandSat + 6)),
      l: clampLightForChroma(52),
    });

    // Neutral temperament: warm tilts hue toward 35° amber, cool toward 215°.
    // Bias kept closer to the BRAND hue (lower blend weight) and a touch more
    // saturated, so the cream/paper visibly belongs to this brand — a wine site
    // gets warm wine-cream, a teal HVAC site a cool tinted paper — instead of the
    // same near-white on every page. (Contrast pass below self-corrects text.)
    const neutralHue = neutralTemp === 'warm' ? blendHue(hue, 35, 0.45) : blendHue(hue, 215, 0.42);
    const neutralSat = neutralTemp === 'warm' ? 11 : 8;

    const bg = tintedNeutral(neutralHue, neutralSat - 2, neutralTemp === 'warm' ? 97 : 98);
    const bgAlt = tintedNeutral(neutralHue, neutralSat, neutralTemp === 'warm' ? 92 : 93);
    const surface = tintedNeutral(neutralHue, Math.max(0, neutralSat - 4), 100);
    const surface2 = tintedNeutral(neutralHue, neutralSat, 95);
    const border = tintedNeutral(neutralHue, neutralSat, 87);

    // bg-deep: a true BRAND-dark, not near-black. This is the surface that dark
    // hero panels, dark bands and the footer sit on — the #1 reason every page
    // read as black+cream was that brand chroma was capped at 40 and lightness at
    // 16. Let the brand hue + chroma actually show (a winery reads wine-dark, an
    // HVAC site teal-dark) while staying dark enough (L 14–21) that the contrast
    // pass keeps light text ≥4.5. Truly neutral brands (ink default) stay neutral.
    const bgDeep = toHex({
      h: hue,
      s: brandSat < 6 ? brandSat : Math.max(30, Math.min(70, brandSat + 16)),
      l: rangeInt(seed ^ 0xdeadbeef, 14, 21),
    });

    // Text colors — contrast pass against bg.
    let text = toHex({ h: neutralHue, s: Math.min(18, neutralSat + 8), l: 12 });
    text = ensureContrast(text, bg, 7); // aim AAA body where possible
    let textMuted = toHex({ h: neutralHue, s: Math.min(14, neutralSat + 4), l: 40 });
    textMuted = ensureContrast(textMuted, bg, 4.5); // AA body min
    let textOnDark = toHex({ h: neutralHue, s: 8, l: 92 });
    textOnDark = ensureContrast(textOnDark, bgDeep, 4.5);

    // brand-vivid: the brand at a confident display lightness so SOLID FILLS
    // (claim bar, header pill, badges) read as real color instead of near-black.
    // Darker brands are lifted into a 42–54 band; its own contrast color is then
    // measured so the label stays legible whatever the hue (white on wine, dark
    // on bright teal, etc.).
    const brandVivid = toHex({
      h: hue,
      s: Math.max(brandSat, 60),
      l: Math.min(54, Math.max(42, toHsl(brandHex).l + 12)),
    });
    const brandVividContrast = ensureContrast(bestTextOn(brandVivid), brandVivid, 4.5);

    // Contrast text for solid brand / accent fills.
    const brandContrast = ensureContrast(bestTextOn(brandHex), brandHex, 4.5);
    const accentContrast = ensureContrast(bestTextOn(accent), accent, 4.5);

    // Ensure accent itself reads as a link on bg (AA large min 3:1); nudge if not.
    if (contrastRatio(accent, bg) < 3) {
      accent = ensureContrast(accent, bg, 3);
    }

    // Ring = accent at full saturation.
    const accentHsl = toHsl(accent);
    const ring = toHex({ h: accentHsl.h, s: Math.min(100, accentHsl.s + 25), l: accentHsl.l });

    return {
      brand: brandHex,
      brandVivid,
      brandVividContrast,
      brandDark,
      brandContrast,
      accent,
      accentContrast,
      bg,
      bgAlt,
      bgDeep,
      surface,
      surface2,
      text,
      textMuted,
      textOnDark,
      border,
      ring,
      neutralTemp,
      accentStrategy,
    };
  } catch {
    return safePalette();
  }
}

/** Keep saturated mid colors from going muddy at extreme lightness. */
function clampLightForChroma(l: number): number {
  return Math.max(42, Math.min(60, l));
}

/** Blend hue `a` toward hue `b` by weight `t` along the shortest arc. */
function blendHue(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

/** Convenience: derive a palette from a named preset (spec §4.2). */
export function derivePaletteFromPreset(presetId: string, opts: DerivePaletteOptions = {}): Palette {
  const preset = PALETTE_PRESETS[presetId] ?? PALETTE_PRESETS['ink-neutral'];
  return derivePalette(preset.brand, { brandDark: preset.deep, ...opts });
}

// Re-export so consumers can lighten/darken/mix without importing color.ts too.
export { lighten, darken, mix };
