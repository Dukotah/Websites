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
// `spotlight` is a full-bleed photo hero (opaque content card over the image),
// so it lives with the photo-only set alongside cinematic/split/collage.
const PHOTO_HEROES = ['cinematic', 'spotlight', 'split', 'collage'];
// Full-bleed photo heroes — these fill the viewport, so a medium-res 'side'-tier
// photo would upscale blurry in them. They're stripped from a site's options when
// its tier is 'side' (see photoRotationForTier + the per-category hero pass).
const FULLBLEED_PHOTO_HEROES = ['cinematic', 'spotlight'];
const TEXT_HEROES = ['statement', 'editorial', 'panel', 'typographic', 'editorial-asym'];
// `editorial`, `typographic`, and `editorial-asym` read well with OR without a
// photo (each collapses to a full-width type column when none), so they bridge
// both pools and are safe to assign regardless of photo inventory.
// `feature-stat` is DELIBERATELY NOT in TEXT_HEROES: its component renders a
// contained image/stat CARD that falls back to stock/SVG art (not clean type)
// when there's no photo — the audit flags that as a critical stock hero, and
// compose.ts's render-time pickHero already excludes it from the no-photo
// branch. It stays a PHOTO hero (contained card, so it's still sharp on a
// medium-res 'side'-tier photo) — see PHOTO_HERO_ROTATION below.

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
  winery: ['cinematic', 'split', 'editorial-asym', 'feature-stat', 'editorial', 'statement', 'panel'],
  cafe: ['cinematic', 'editorial-asym', 'feature-stat', 'editorial', 'collage', 'statement'],
  salon: ['editorial-asym', 'editorial', 'split', 'feature-stat', 'typographic', 'statement', 'cinematic'],
  tattoo: ['cinematic', 'spotlight', 'statement', 'typographic', 'split', 'editorial'],
  landscaping: ['cinematic', 'spotlight', 'split', 'editorial-asym', 'feature-stat', 'editorial', 'panel'],
  plumbing: ['statement', 'spotlight', 'split', 'feature-stat', 'typographic', 'cinematic', 'panel'],
  'auto-repair': ['cinematic', 'spotlight', 'statement', 'feature-stat', 'typographic', 'split', 'panel'],
  towing: ['collage', 'spotlight', 'cinematic', 'statement', 'feature-stat', 'typographic', 'split'],
  marina: ['split', 'cinematic', 'editorial-asym', 'feature-stat', 'editorial', 'statement'],
  restaurant: ['cinematic', 'editorial-asym', 'feature-stat', 'editorial', 'collage', 'statement'],
  default: ['cinematic', 'spotlight', 'split', 'editorial-asym', 'feature-stat', 'editorial', 'typographic', 'statement', 'panel', 'collage'],
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

/** How many real gallery photos beyond the hero — collage needs ≥2. */
function galleryDepth(config) {
  return Array.isArray(config?.galleryImages) ? config.galleryImages.length : 0;
}

// Global silhouette rotations, ordered by how "photo-forward" each hero reads.
// The cross-category pass cycles these so a MIXED batch (all-different
// categories, where the per-category loop never fires) still gets varied
// silhouettes instead of every photo-rich site defaulting to split/cinematic.
const PHOTO_HERO_ROTATION = ['cinematic', 'spotlight', 'split', 'editorial-asym', 'feature-stat', 'collage', 'editorial'];
const TEXT_HERO_ROTATION = ['statement', 'typographic', 'editorial', 'panel', 'editorial-asym'];

/**
 * Hero-photo TIER contract (set by generate-prospects from the source photo
 * width): a 'side'-tier hero is only medium-res, so a FULL-BLEED hero
 * (`cinematic` or `spotlight`) would upscale it blurry. Strip both from a site's
 * photo rotation when its tier is 'side' (keep the side-column / contained-card
 * heroes — split / editorial-asym / feature-stat / collage / editorial — which
 * render the photo smaller and stay sharp). Other tiers ('fullbleed', 'none', or
 * unset) are unaffected. (FULLBLEED_PHOTO_HEROES is defined at the top.)
 */
function photoRotationForTier(cfg) {
  const tier = cfg?.artDirection?.heroPhotoTier;
  if (tier === 'side') return PHOTO_HERO_ROTATION.filter((h) => !FULLBLEED_PHOTO_HEROES.includes(h));
  return PHOTO_HERO_ROTATION;
}

/**
 * Cross-category silhouette diversity for the WHOLE batch. The per-category loop
 * only fires for ≥2 same-category siblings; a batch of all-distinct categories
 * therefore gets NO hero diversity from it, and every photo-rich site collapses
 * to compose.ts's split/cinematic default — the "looks like one template" tell.
 *
 * This balances hero usage across the entire batch and avoids adjacent repeats
 * (by stable slug order), choosing a silhouette appropriate to each site's photo
 * inventory. Respects any heroVariant already pinned (author or per-category pass).
 */
function diversifyHeroesGlobally(prospects, report) {
  const ordered = [...prospects].sort((a, b) => a.slug.localeCompare(b.slug));

  // Seed usage counts with heroes already pinned, so the global fill BALANCES
  // against them rather than ignoring them.
  const counts = {};
  for (const p of ordered) {
    const h = p.config.heroVariant;
    if (h) counts[h] = (counts[h] ?? 0) + 1;
  }

  let prev = '';
  for (const p of ordered) {
    const cfg = p.config;
    if (cfg.heroVariant) { prev = cfg.heroVariant; continue; } // respect pins

    const photo = hasRealPhoto(cfg);
    let rotation = photo ? photoRotationForTier(cfg) : TEXT_HERO_ROTATION;
    if (photo && galleryDepth(cfg) < 2) rotation = rotation.filter((h) => h !== 'collage');
    // `statement` and `typographic` render the headline as ONE giant stacked
    // word-stack — gorgeous for a short punch, but a long headline overflows the
    // fold (clipped "…SINCE 1982"). For long headlines, drop them in favor of the
    // wrap-friendly editorial/panel heroes. (Keep at least one option.)
    const headlineLen = (cfg.hero?.heading ?? '').trim().length;
    if (headlineLen > 24) {
      const wrapped = rotation.filter((h) => h !== 'statement' && h !== 'typographic');
      if (wrapped.length) rotation = wrapped;
    }

    // Least-used hero in the rotation that isn't the previous site's silhouette;
    // usage dominates, rotation order tie-breaks (keeps it deterministic).
    let best = '';
    let bestScore = Infinity;
    rotation.forEach((h, idx) => {
      if (h === prev && rotation.length > 1) return;
      const score = (counts[h] ?? 0) * 100 + idx;
      if (score < bestScore) { bestScore = score; best = h; }
    });
    if (!best) best = rotation[0];

    cfg.heroVariant = best;
    counts[best] = (counts[best] ?? 0) + 1;
    prev = best;

    const entry = report.find((r) => r.slug === p.slug);
    if (entry) entry.changes.push(`hero=${best}`);
    else report.push({ slug: p.slug, changes: [`hero=${best}`] });
  }
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
        // A 'side'-tier photo is only medium-res — a FULL-BLEED hero (cinematic
        // or spotlight) would upscale it blurry, so drop both from this site's
        // options (keep the side-column / contained-card photo heroes, incl.
        // feature-stat). Other tiers are unaffected.
        const sideTier = real && cfg.artDirection?.heroPhotoTier === 'side';
        const ordered = heroPool.filter(
          (h) => (real ? true : !PHOTO_HEROES.includes(h)) && !(sideTier && FULLBLEED_PHOTO_HEROES.includes(h)),
        );
        const fallback = real
          ? sideTier
            ? PHOTO_HEROES.filter((h) => !FULLBLEED_PHOTO_HEROES.includes(h))
            : PHOTO_HEROES
          : TEXT_HEROES;
        const pool = ordered.length ? ordered : fallback;
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

  // Cross-category silhouette pass: gives a mixed batch (where the per-category
  // loop above never fires) varied, balanced hero silhouettes. Runs last so it
  // respects every heroVariant the per-category pass and author pins already set.
  diversifyHeroesGlobally(prospects, report);

  return report;
}

export const _internal = { FONT_POOLS, HERO_POOLS, rotateSections, hasRealPhoto };
