/**
 * Dependency-free color math for the palette system.
 *
 * Uses HSL + WCAG relative luminance (sufficient and dependency-free, per spec
 * §4). Every function is defensive: bad input never throws — it falls back to a
 * safe neutral so the build never crashes on a malformed brand hex.
 */

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

export interface Rgb {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
}

const SAFE_RGB: Rgb = { r: 43, g: 43, b: 43 }; // #2b2b2b neutral fallback

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * Parse a hex string (#rgb, #rrggbb, with or without leading #) → Rgb.
 * Invalid input returns the safe neutral. Never throws.
 */
export function parseHex(hex: string): Rgb {
  if (typeof hex !== 'string') return { ...SAFE_RGB };
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    return { ...SAFE_RGB };
  }
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { ...SAFE_RGB };
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/** Rgb → hex string with leading #. Always valid. */
export function rgbToHex(rgb: Rgb): string {
  const r = clamp(round(rgb.r), 0, 255);
  const g = clamp(round(rgb.g), 0, 255);
  const b = clamp(round(rgb.b), 0, 255);
  const s = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  return `#${s}`;
}

/** Rgb → Hsl. Never throws. */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: round(h), s: round(s * 100), l: round(l * 100) };
}

/** Hsl → Rgb. Never throws. */
export function hslToRgb(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: round((r + m) * 255),
    g: round((g + m) * 255),
    b: round((b + m) * 255),
  };
}

/** Hex string → Hsl. */
export function toHsl(hex: string): Hsl {
  return rgbToHsl(parseHex(hex));
}

/** Hsl → hex string. */
export function toHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

/**
 * WCAG relative luminance of a color (hex string or Rgb). 0 (black) .. 1
 * (white). Used for contrast computation and black/white text picks.
 */
export function relativeLuminance(color: string | Rgb): number {
  const rgb = typeof color === 'string' ? parseHex(color) : color;
  const chan = (c: number) => {
    const v = clamp(c, 0, 255) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

/**
 * WCAG contrast ratio between two colors (hex or Rgb). 1 (none) .. 21 (max).
 * Order-independent.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Lighten a hex color by `amount` lightness percentage points (0..100). */
export function lighten(hex: string, amount: number): string {
  const hsl = toHsl(hex);
  return toHex({ ...hsl, l: clamp(hsl.l + amount, 0, 100) });
}

/** Darken a hex color by `amount` lightness percentage points (0..100). */
export function darken(hex: string, amount: number): string {
  const hsl = toHsl(hex);
  return toHex({ ...hsl, l: clamp(hsl.l - amount, 0, 100) });
}

/**
 * Linearly mix two hex colors in sRGB space. `t` = weight of `b` (0 → all a,
 * 1 → all b). Clamped.
 */
export function mix(a: string, b: string, t: number): string {
  const w = clamp(t, 0, 1);
  const ca = parseHex(a);
  const cb = parseHex(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * w,
    g: ca.g + (cb.g - ca.g) * w,
    b: ca.b + (cb.b - ca.b) * w,
  });
}

/** Pick '#000000' or '#ffffff' — whichever has more contrast against `bg`. */
export function bestTextOn(bg: string): string {
  const onBlack = contrastRatio(bg, '#000000');
  const onWhite = contrastRatio(bg, '#ffffff');
  return onWhite >= onBlack ? '#ffffff' : '#000000';
}

/**
 * Adjust `fg` (lighten or darken along its own hue) until it meets `minRatio`
 * contrast against `bg`, or return the best achievable extreme. Never throws.
 * Chooses the adjustment direction by which side of `bg` has more headroom.
 */
export function ensureContrast(fg: string, bg: string, minRatio: number): string {
  if (contrastRatio(fg, bg) >= minRatio) return fg;
  const bgLum = relativeLuminance(bg);
  const hsl = toHsl(fg);
  // If bg is light, darken fg toward black; if bg is dark, lighten toward white.
  const goDarker = bgLum > 0.5;
  let best = fg;
  let bestRatio = contrastRatio(fg, bg);
  for (let step = 1; step <= 100; step++) {
    const l = goDarker
      ? clamp(hsl.l - step, 0, 100)
      : clamp(hsl.l + step, 0, 100);
    const candidate = toHex({ ...hsl, l });
    const ratio = contrastRatio(candidate, bg);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= minRatio) return candidate;
    if (l === 0 || l === 100) break;
  }
  // Last resort: pure black/white, whichever is better.
  const extreme = bestTextOn(bg);
  return contrastRatio(extreme, bg) > bestRatio ? extreme : best;
}
