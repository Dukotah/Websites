/**
 * divergence.mjs — the anti-cookie-cutter pass for a BATCH.
 *
 * The composition engine is deterministic per-slug, which means two businesses
 * in the same category (e.g. five wineries) tend to resolve to the same font,
 * the same hero, and the same section order — they look like one template with
 * the words swapped. Customers notice. This pass runs once over the WHOLE batch,
 * groups prospects by category, and hands each same-category sibling a DISTINCT
 * visual identity so no two can be mixed up at a glance:
 *
 *   - fontId         (a different type pairing per sibling)
 *   - heroVariant    (a different hero layout per sibling)
 *   - neutralTemp    (alternating warm / cool)
 *   - section order  (rotated so the scroll narrative differs)
 *
 * Deterministic (seeded by category), and it RESPECTS explicit author pins —
 * a value already set on the config is never overwritten. Single-member
 * categories are left untouched (no collision → let the engine seed as before).
 *
 * Pure, zero-dependency. The fontIds and heroVariants below MUST stay in sync
 * with sites/demo-gallery/src/lib/fonts.ts (FONT_REGISTRY) and the HeroVariant
 * union in compose.ts.
 */

// Hero variants that need a real photo vs. those that stand on type alone.
const PHOTO_HEROES = ['cinematic', 'split', 'collage'];
const TEXT_HEROES = ['statement', 'editorial', 'panel'];
// `editorial` reads well with OR without a photo, so it bridges both pools.

// Per-category font pools — distinct pairings, ordered best-first. Mirror of the
// `categories` arrays in fonts.ts (plus a rustic extra or two for variety).
const FONT_POOLS = {
  winery: ['editorial-serif', 'classic-trad', 'organic-serif', 'boutique-contrast', 'handcrafted'],
  cafe: ['warm-humanist', 'editorial-serif', 'handcrafted', 'classic-trad'],
  bakery: ['handcrafted', 'warm-humanist', 'editorial-serif'],
  salon: ['boutique-contrast', 'editorial-serif', 'classic-trad', 'warm-humanist'],
  landscaping: ['organic-serif', 'warm-humanist', 'editorial-serif'],
  wellness: ['organic-serif', 'editorial-serif', 'warm-humanist'],
  tattoo: ['bold-display', 'boutique-contrast', 'editorial-serif'],
  plumbing: ['modern-grotesk', 'clean-sans', 'rugged-slab'],
  'auto-repair': ['rugged-slab', 'modern-grotesk', 'bold-display'],
  towing: ['rugged-slab', 'bold-display', 'modern-grotesk'],
  construction: ['rugged-slab', 'bold-display', 'modern-grotesk'],
  fitness: ['bold-display', 'modern-grotesk', 'rugged-slab'],
  tech: ['modern-grotesk', 'clean-sans', 'space-grotesk'],
  // marina = part utility (boats/repair/fuel), part lifestyle (lake/recreation).
  marina: ['modern-grotesk', 'rugged-slab', 'editorial-serif', 'clean-sans'],
  restaurant: ['warm-humanist', 'editorial-serif', 'handcrafted', 'classic-trad'],
  default: ['editorial-serif', 'modern-grotesk', 'classic-trad', 'clean-sans', 'warm-humanist'],
};

// Per-category hero rotation — an ordered mix of photo + text heroes so adjacent
// siblings alternate "big photo" vs "big type". Filtered per-site by photo
// availability at assignment time.
const HERO_POOLS = {
  winery: ['cinematic', 'split', 'editorial', 'statement', 'panel'],
  cafe: ['cinematic', 'editorial', 'collage', 'statement'],
  salon: ['editorial', 'split', 'statement', 'cinematic'],
  tattoo: ['cinematic', 'statement', 'split', 'editorial'],
  landscaping: ['cinematic', 'split', 'editorial', 'panel'],
  plumbing: ['statement', 'split', 'cinematic', 'panel'],
  'auto-repair': ['cinematic', 'statement', 'split', 'panel'],
  towing: ['collage', 'cinematic', 'statement', 'split'],
  marina: ['split', 'cinematic', 'editorial', 'statement'],
  restaurant: ['cinematic', 'editorial', 'collage', 'statement'],
  default: ['cinematic', 'split', 'editorial', 'statement', 'panel', 'collage'],
};

// Per-category pool of distinctive "depth" sections handed out one-per-sibling so
// same-category sites don't share an identical section set. Only types the
// generator can build from scraped facts (see buildDepthSection) belong here.
const DEPTH_POOLS = {
  winery: ['bigquote', 'timeline', 'feature-split'],
  cafe: ['bigquote', 'feature-split', 'timeline'],
  restaurant: ['bigquote', 'feature-split', 'timeline'],
  salon: ['bigquote', 'feature-split', 'timeline'],
  landscaping: ['feature-split', 'bigquote', 'timeline'],
  default: ['feature-split', 'bigquote', 'timeline'],
};

/**
 * Can the generator actually build this depth section for the config? Checked
 * from the config alone (divergence has no scrape handle), mirroring the
 * data-gates in buildDepthSection so a hint is never assigned for absent data.
 */
function depthBuildable(config, type) {
  switch (type) {
    case 'timeline':
      return Boolean(String(config.established ?? '').match(/\d{4}/));
    case 'bigquote': {
      const t = (config.sections ?? []).find((s) => s.type === 'testimonials');
      const strongQuote = t && (t.items ?? []).some((it) => it.quote && it.quote.length > 60);
      return Boolean(strongQuote) || String(config.tagline ?? '').length > 40;
    }
    case 'feature-split':
      return (config.services ?? []).some((s) => s.description && s.description.length > 30);
    default:
      return false;
  }
}

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A config has a real (non-stock) hero photo we can stage full-bleed. */
function hasRealPhoto(config) {
  const src = config?.images?.hero ?? '';
  return Boolean(src) && !src.includes('/images/library/') && !src.endsWith('.svg');
}

/** Rotate the section array by `n`, keeping any trailing `cta` pinned last. */
function rotateSections(sections, n) {
  if (!Array.isArray(sections) || sections.length < 3) return sections;
  const hasCtaLast = sections[sections.length - 1]?.type === 'cta';
  const body = hasCtaLast ? sections.slice(0, -1) : sections.slice();
  const cta = hasCtaLast ? sections.slice(-1) : [];
  if (body.length < 2) return sections;
  const k = ((n % body.length) + body.length) % body.length;
  const rotated = [...body.slice(k), ...body.slice(0, k)];
  return [...rotated, ...cta];
}

/**
 * Assign divergent art direction across a batch in place.
 * @param {Array<{slug:string, category:string, config:object}>} prospects
 * @returns {Array<{slug:string, changes:string[]}>} per-slug summary of what changed
 */
export function diversifyBatch(prospects) {
  const groups = new Map();
  for (const p of prospects) {
    const cat = p.category || 'default';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }

  const report = [];
  for (const [cat, members] of groups) {
    // Single-member category → no collision risk, leave the engine's seeded
    // defaults alone (keeps behavior identical for one-off categories).
    if (members.length < 2) continue;

    // Deterministic order + a per-category starting offset so different batches
    // don't all begin at index 0.
    members.sort((a, b) => a.slug.localeCompare(b.slug));
    const offset = hash(cat);

    const fontPool = FONT_POOLS[cat] ?? FONT_POOLS.default;
    const heroPool = HERO_POOLS[cat] ?? HERO_POOLS.default;

    // Pre-claim every explicit author pin so assignment never collides with one,
    // regardless of where the pinned sibling sits in iteration order.
    const usedFonts = new Set();
    const usedHeroes = new Set();
    const usedDepth = new Set();
    const depthPool = DEPTH_POOLS[cat] ?? DEPTH_POOLS.default;
    for (const p of members) {
      if (p.config.artDirection?.fontId) usedFonts.add(p.config.artDirection.fontId);
      if (p.config.heroVariant) usedHeroes.add(p.config.heroVariant);
      if (p.config.artDirection?.preferredDepthSection) usedDepth.add(p.config.artDirection.preferredDepthSection);
    }

    members.forEach((p, i) => {
      const cfg = p.config;
      const changes = [];
      cfg.artDirection = cfg.artDirection ?? {};

      // ── Font: distinct per sibling (round-robin, skip already-claimed) ──────
      if (!cfg.artDirection.fontId) {
        let font = fontPool[(offset + i) % fontPool.length];
        if (usedFonts.has(font)) {
          font = fontPool.find((f) => !usedFonts.has(f)) ?? font;
        }
        usedFonts.add(font);
        cfg.artDirection.fontId = font;
        changes.push(`font=${font}`);
      }

      // ── Hero: distinct per sibling, valid for the site's photo inventory ────
      if (!cfg.heroVariant) {
        const real = hasRealPhoto(cfg);
        const ordered = heroPool.filter((h) => (real ? true : !PHOTO_HEROES.includes(h)));
        const pool = ordered.length ? ordered : real ? PHOTO_HEROES : TEXT_HEROES;
        let hero = pool[(offset + i) % pool.length];
        if (usedHeroes.has(hero)) hero = pool.find((h) => !usedHeroes.has(h)) ?? hero;
        usedHeroes.add(hero);
        cfg.heroVariant = hero;
        changes.push(`hero=${hero}`);
      }

      // ── Palette temperature: alternate warm / cool ──────────────────────────
      if (!cfg.artDirection.neutralTemp) {
        cfg.artDirection.neutralTemp = (offset + i) % 2 === 0 ? 'warm' : 'cool';
        changes.push(`temp=${cfg.artDirection.neutralTemp}`);
      }

      // ── Section order: rotate so the scroll narrative differs ───────────────
      if (i > 0 && Array.isArray(cfg.sections) && cfg.sections.length >= 3) {
        cfg.sections = rotateSections(cfg.sections, i);
        changes.push('sections-rotated');
      }

      // ── Depth section: a DISTINCT extra section per sibling, so the batch
      //    can't share one identical section set. Advisory — the generator only
      //    builds it if the real data exists; we pick a buildable type not
      //    already present and not already claimed by a sibling. ───────────────
      if (!cfg.artDirection.preferredDepthSection) {
        const present = new Set((cfg.sections ?? []).map((s) => s.type));
        const buildable = depthPool.filter((t) => !present.has(t) && depthBuildable(cfg, t));
        let chosen = '';
        for (let k = 0; k < buildable.length; k++) {
          const cand = buildable[(offset + i + k) % buildable.length];
          if (!usedDepth.has(cand)) { chosen = cand; break; }
        }
        if (!chosen && buildable.length) chosen = buildable[(offset + i) % buildable.length];
        if (chosen) {
          usedDepth.add(chosen);
          cfg.artDirection.preferredDepthSection = chosen;
          changes.push(`depth=${chosen}`);
        }
      }

      // Drop an empty artDirection so we don't write noise.
      if (Object.keys(cfg.artDirection).length === 0) delete cfg.artDirection;

      if (changes.length) report.push({ slug: p.slug, changes });
    });
  }
  return report;
}

export const _internal = { FONT_POOLS, HERO_POOLS, rotateSections, hasRealPhoto };
