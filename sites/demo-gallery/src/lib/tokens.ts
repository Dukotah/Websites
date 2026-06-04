/**
 * Token emitter — converts a resolved ArtDirection into a CSS `:root{…}` block
 * containing ALL design-system custom properties (spec §2).
 *
 * artDirectionToCss(ad) is the single public export. It is called by BaseLayout
 * and injected as an inline <style> so every var() in global.css and components
 * resolves to per-site values. config.tokens overrides are applied last.
 */

import type { ArtDirection } from './art-direction';
import { TYPE_SCALES } from './fonts';

/** Step count above and below 0 in the modular scale. */
const STEPS_ABOVE = 6; // --step-1 … --step-6
const STEPS_BELOW = 1; // --step--1

/**
 * Build one fluid clamp() value for a modular scale step.
 *
 * Formula: clamp(minRem, preferredVw, maxRem)
 *   - minRem  = base * ratio^step  (at min viewport, in rem)
 *   - maxRem  = minRem * 1.35      (gentle fluid ceiling)
 *   - vwExpr  = midpoint in viewport-relative units
 *
 * For step 0 we use the typeScale's explicit base values for fidelity.
 */
function stepClamp(
  step: number,
  baseMinRem: number,
  baseVw: number,
  baseMaxRem: number,
  ratio: number,
): string {
  if (step === 0) {
    return `clamp(${baseMinRem}rem, ${baseVw}vw + ${baseMinRem * 0.5}rem, ${baseMaxRem}rem)`;
  }
  const factor = Math.pow(ratio, step);
  const minRem = +(baseMinRem * factor).toFixed(4);
  const maxRem = +(baseMaxRem * factor).toFixed(4);
  // vw that hits mid-scale at 1200px viewport
  const midRem = (minRem + maxRem) / 2;
  const vw = +((midRem / 12) * 100).toFixed(4);
  return `clamp(${minRem}rem, ${vw}vw + ${(minRem * 0.3).toFixed(4)}rem, ${maxRem}rem)`;
}

/**
 * Shape-family → concrete token values (spec §5.1).
 */
interface ShapeTokens {
  radius: string;
  radiusLg: string;
  radiusPill: string;
  borderWeight: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  frameStyle: string;
}

const SHAPE_TOKENS: Record<string, ShapeTokens> = {
  soft: {
    radius: '14px',
    radiusLg: '24px',
    radiusPill: '999px',
    borderWeight: '1px',
    // Open Props layered shadows — far more refined than flat hand-rolled ones.
    shadowSm: 'var(--shadow-2)',
    shadowMd: 'var(--shadow-3)',
    shadowLg: 'var(--shadow-5)',
    frameStyle: 'soft',
  },
  sharp: {
    radius: '0px',
    radiusLg: '0px',
    radiusPill: '0px',
    borderWeight: '2px',
    shadowSm: 'none',
    shadowMd: '3px 3px 0 rgba(0,0,0,.15)',
    shadowLg: '6px 6px 0 rgba(0,0,0,.18)',
    frameStyle: 'sharp',
  },
  editorial: {
    radius: '2px',
    radiusLg: '2px',
    radiusPill: '999px',
    borderWeight: '1px',
    shadowSm: 'none',
    shadowMd: 'none',
    shadowLg: 'none',
    frameStyle: 'editorial',
  },
  'rounded-pill': {
    radius: '18px',
    radiusLg: '18px',
    radiusPill: '999px',
    borderWeight: '1px',
    shadowSm: 'var(--shadow-2)',
    shadowMd: 'var(--shadow-4)',
    shadowLg: 'var(--shadow-6)',
    frameStyle: 'pill',
  },
  framed: {
    radius: '4px',
    radiusLg: '4px',
    radiusPill: '999px',
    borderWeight: '2px',
    shadowSm: '2px 2px 0 rgba(0,0,0,.12)',
    shadowMd: '4px 4px 0 rgba(0,0,0,.16)',
    shadowLg: '8px 8px 0 rgba(0,0,0,.18)',
    frameStyle: 'framed',
  },
};

/**
 * Density → concrete spacing tokens (spec §5.3).
 */
interface DensityTokens {
  sectionPad: string;
  gutter: string;
  maxw: string;
  gridGap: string;
}

const DENSITY_TOKENS: Record<string, DensityTokens> = {
  compact: {
    sectionPad: 'clamp(2.5rem, 6vw, 4rem)',
    gutter: 'clamp(1rem, 3vw, 1.75rem)',
    maxw: '1080px',
    gridGap: 'clamp(1rem, 2vw, 1.5rem)',
  },
  standard: {
    sectionPad: 'clamp(3.5rem, 8vw, 6rem)',
    gutter: 'clamp(1.25rem, 4vw, 2.25rem)',
    maxw: '1140px',
    gridGap: 'clamp(1.25rem, 2.5vw, 2rem)',
  },
  spacious: {
    sectionPad: 'clamp(5rem, 11vw, 9rem)',
    gutter: 'clamp(1.5rem, 5vw, 3rem)',
    maxw: '1200px',
    gridGap: 'clamp(1.5rem, 3vw, 2.5rem)',
  },
};

/**
 * Motion level → concrete duration/distance tokens (spec §5.2).
 * All zeroed when motion === 'none'.
 */
interface MotionTokens {
  motionFade: string;
  motionRise: string;
  motionEase: string;
}

const MOTION_TOKENS: Record<string, MotionTokens> = {
  none: {
    motionFade: '0ms',
    motionRise: '0px',
    motionEase: 'linear',
  },
  subtle: {
    motionFade: '190ms',
    motionRise: '10px',
    motionEase: 'var(--ease-out-3)',
  },
  expressive: {
    motionFade: '320ms',
    motionRise: '20px',
    motionEase: 'var(--ease-spring-3)',
  },
};

/**
 * Convert a resolved ArtDirection into a CSS `:root { … }` string containing
 * all §2.1 tokens. Applies config.tokens overrides last.
 */
export function artDirectionToCss(ad: ArtDirection): string {
  const { palette, fontPairing, typeScale, shape, motion, density, tokenOverrides } = ad;

  // ── modular type scale ───────────────────────────────────────────────────
  const { ratio, baseMinRem, baseVw, baseMaxRem } = typeScale;
  const steps: Record<string, string> = {};
  // Below zero: step--1
  for (let i = 1; i <= STEPS_BELOW; i++) {
    steps[`--step--${i}`] = stepClamp(-i, baseMinRem, baseVw, baseMaxRem, ratio);
  }
  // Step 0
  steps['--step-0'] = stepClamp(0, baseMinRem, baseVw, baseMaxRem, ratio);
  // Above zero
  for (let i = 1; i <= STEPS_ABOVE; i++) {
    steps[`--step-${i}`] = stepClamp(i, baseMinRem, baseVw, baseMaxRem, ratio);
  }

  // ── shape ────────────────────────────────────────────────────────────────
  const shapeT = SHAPE_TOKENS[shape] ?? SHAPE_TOKENS.soft;

  // ── density ──────────────────────────────────────────────────────────────
  const densityT = DENSITY_TOKENS[density] ?? DENSITY_TOKENS.standard;

  // ── motion ───────────────────────────────────────────────────────────────
  const motionT = MOTION_TOKENS[motion] ?? MOTION_TOKENS.subtle;

  // ── pattern opacity — seeded subtle decoration ────────────────────────────
  // Framed/editorial shapes get a bit more pattern; others minimal.
  const patternOpacity =
    shape === 'framed' ? '0.04' : shape === 'editorial' ? '0.03' : '0.02';

  // ── assemble all props ────────────────────────────────────────────────────
  const props: Record<string, string> = {
    // color
    '--brand': palette.brand,
    '--brand-dark': palette.brandDark,
    '--brand-contrast': palette.brandContrast,
    '--accent': palette.accent,
    '--accent-contrast': palette.accentContrast,
    '--bg': palette.bg,
    '--bg-alt': palette.bgAlt,
    '--bg-deep': palette.bgDeep,
    '--surface': palette.surface,
    '--surface-2': palette.surface2,
    '--text': palette.text,
    '--text-muted': palette.textMuted,
    '--text-on-dark': palette.textOnDark,
    '--border': palette.border,
    '--ring': palette.ring,

    // fonts
    '--font-display': fontPairing.display,
    '--font-body': fontPairing.body,
    '--fw-display': String(typeScale.fwDisplay),
    '--fw-body': String(typeScale.fwBody),
    '--fw-bold': String(typeScale.fwBold),
    '--tracking-display': typeScale.trackingDisplay,
    '--tracking-eyebrow': typeScale.trackingEyebrow,
    '--leading-display': String(typeScale.leadingDisplay),
    '--leading-body': String(typeScale.leadingBody),

    // type scale steps
    ...steps,

    // shape
    '--radius': shapeT.radius,
    '--radius-lg': shapeT.radiusLg,
    '--radius-pill': shapeT.radiusPill,
    '--border-weight': shapeT.borderWeight,
    '--shadow-sm': shapeT.shadowSm,
    '--shadow-md': shapeT.shadowMd,
    '--shadow-lg': shapeT.shadowLg,
    '--frame-style': shapeT.frameStyle,

    // density
    '--section-pad': densityT.sectionPad,
    '--gutter': densityT.gutter,
    '--maxw': densityT.maxw,
    '--grid-gap': densityT.gridGap,

    // motion
    '--motion-fade': motionT.motionFade,
    '--motion-rise': motionT.motionRise,
    '--motion-ease': motionT.motionEase,

    // decoration
    '--pattern-opacity': patternOpacity,
  };

  // ── apply explicit token overrides (escape hatch) ─────────────────────────
  if (tokenOverrides) {
    for (const [k, v] of Object.entries(tokenOverrides)) {
      if (v !== undefined) {
        // Ensure the key has the -- prefix
        props[k.startsWith('--') ? k : `--${k}`] = v;
      }
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  const body = Object.entries(props)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  return `:root {\n${body}\n}`;
}
