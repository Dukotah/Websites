/**
 * compose.mjs — pure, dependency-free composition helpers for the premium author.
 *
 * Extracted so they can be unit-tested WITHOUT pulling the heavy facts/photo
 * import chain (sharp et al.). Two concerns live here:
 *
 *   1. copyCaps(flagship)      — the clip() character budgets. The batch path keeps
 *                                today's terse caps; the flagship path loosens them
 *                                a lot so Opus-class prose isn't forced clipped.
 *   2. factDrivenOrder(byKey)  — FACT-DRIVEN home-section ordering: lead with the
 *                                section whose REAL facts are strongest, instead of
 *                                the old hashStr(slug)%3 coin-flip. Deterministic,
 *                                no LLM needed (an LLM ordering call may layer on top
 *                                on the flagship path, but this is a strong floor).
 *   3. pickCopyModel(flagship) — env-driven model selection (Opus on flagship).
 *
 * Nothing here makes a network call or touches the filesystem.
 */

// ── 1. clip() character budgets ──────────────────────────────────────────────
// Batch caps == today's hardcoded numbers (behavior matches today without the
// flag). Flagship caps are loosened so per-section Opus prose reads full, not
// truncated. seoDescription is intentionally NOT loosened (Google truncates ~160).
export function copyCaps(flagship = false) {
  return flagship
    ? {
        about: 2000,
        heroSub: 400,
        heroHeading: 120,
        tagline: 160,
        testimonial: 400,
        calloutBody: 360,
        storyBody: 2000,
        serviceDesc: 600,
        ctaHeading: 100,
        ctaBody: 320,
        seoDescription: 160,
      }
    : {
        about: 600,
        heroSub: 200,
        heroHeading: 90,
        tagline: 110,
        testimonial: 280,
        calloutBody: 200,
        storyBody: 600,
        serviceDesc: 280,
        ctaHeading: 80,
        ctaBody: 200,
        seoDescription: 160,
      };
}

// ── 3. model selection ───────────────────────────────────────────────────────
// Batch default = sonnet (cheap, fast). Flagship default = opus (the ceiling).
// Both overridable by env so the owner can dial cost without a code change.
export function pickCopyModel(flagship = false) {
  if (flagship) {
    return process.env.ANTHROPIC_FLAGSHIP_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  }
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
}

// ── 2. fact-driven section ordering ───────────────────────────────────────────
// Score each present home section by how much REAL evidence backs it. Higher =
// stronger = nearer the top. The hero is fixed at pages[0]; the CTA is appended
// by the caller. This replaces ORDER_VARIANTS[hashStr(slug)%3].
//
// byKey: { trust, story, services, steps, team, testimonials, gallery } where each
// value is the built section object (or null/undefined if not warranted).
function sectionStrength(key, sec) {
  if (!sec) return -1;
  switch (key) {
    case 'trust': {
      // A real stat row (numbers earned from facts) is the strongest trust beat;
      // an iconned features band is next; a callout differentiator is the floor.
      const base = sec.kind === 'stats' ? 92 : sec.kind === 'features' ? 72 : 60;
      const n = (sec.items?.length || sec.points?.length || 0);
      return base + n * 2;
    }
    case 'testimonials': {
      // Real third-party quotes are the most persuasive evidence a small site has.
      return 82 + (sec.items?.length || 0) * 5 + (sec.rating ? 6 : 0);
    }
    case 'services': {
      // The "what we do" spine — strong, scales a little with breadth.
      return 76 + Math.min(sec.items?.length || 0, 6) * 3;
    }
    case 'story': {
      // Weight by how much real prose + proof the story carries.
      const len = (sec.body || []).join(' ').length;
      return 64 + Math.min(len / 60, 20) + (sec.highlights?.length || 0) * 2 + (sec.image ? 6 : 0);
    }
    case 'gallery': {
      // Real photos are good evidence but secondary to words for cold trust.
      return 54 + (sec.images?.length || 0) * 3;
    }
    case 'team': {
      // Named real people — humanizing, supporting.
      return 48 + (sec.members?.length || 0) * 4;
    }
    case 'steps': {
      // Generic-but-honest process; lowest evidence weight by design.
      return 30;
    }
    default:
      return 0;
  }
}

// Canonical tiebreak order when two sections score equal — keeps output stable.
const TIE_ORDER = ['trust', 'services', 'story', 'testimonials', 'gallery', 'team', 'steps'];

// Move `x` to immediately after `anchor` when BOTH are present (adjacency rule).
function moveAfter(arr, x, anchor) {
  const xi = arr.indexOf(x);
  const ai = arr.indexOf(anchor);
  if (xi === -1 || ai === -1) return arr;
  arr.splice(xi, 1);
  arr.splice(arr.indexOf(anchor) + 1, 0, x);
  return arr;
}

export function factDrivenOrder(byKey) {
  const present = Object.keys(byKey).filter((k) => byKey[k]);
  present.sort((a, b) => {
    const d = sectionStrength(b, byKey[b]) - sectionStrength(a, byKey[a]);
    if (d !== 0) return d;
    return TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b);
  });
  // Narrative adjacency: the "how" (steps) reads best right after the "what"
  // (services); the people (team) read best right after the story.
  moveAfter(present, 'steps', 'services');
  moveAfter(present, 'team', 'story');
  return present;
}

export { sectionStrength };
