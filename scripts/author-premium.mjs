#!/usr/bin/env node
/**
 * author-premium.mjs — the deterministic PREMIUM author. Replaces
 * generate-prospects.mjs's buildConfig/sections/manifest tail with a multi-page
 * PremiumConfig (src/premium/lib/premium-types.ts) authored from the SAME real
 * facts layer (loadResearch / enrichmentFromResearch / normCat / deriveStatus)
 * and the SAME photo pipeline (acquireMediaFor → src/assets/prospects/<slug>/).
 *
 * INPUT (per slug): the verified CSV row, the enrichment object `e`, the raw
 * research blob, and the acquired `media` descriptors.
 * OUTPUT: a PremiumConfig that passes scripts/premium-validate.mjs.
 *
 * Determinism-first: ships with zero API keys. When ANTHROPIC_API_KEY is set,
 * Claude UPGRADES copy fields only (never invents facts/photos/hours/ratings);
 * any error falls back to the deterministic skeleton.
 *
 * Exports authorPremium(...) for the pipeline; not a CLI on its own.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normCat, deriveStatus, clip, titleCase, humanizeCategory, hashStr, formatPhone, PUBLIC_IMAGES,
} from './lib/facts.mjs';
import { pickFontId, pickBrandColor } from './lib/brand-seed.mjs';
import { sanitizeProse, sanitizeTestimonials } from './lib/copy-sanity.mjs';
import { scorePhoto } from './lib/photo-score.mjs';
import { auditConfigCriticals } from './audit.mjs';

// ── category → page family table ───────────────────────────────────────────
// home is ALWAYS pages[0]. The family decides which pages follow and whether the
// 'services' section renders as a menu/wine-list.
const HOSPITALITY = new Set(['cafe', 'restaurant', 'winery']);
const SERVICES_LED = new Set([
  'plumbing', 'hvac', 'electrician', 'roofing', 'contractor', 'auto-repair',
  'towing', 'cleaning', 'landscaping', 'dental', 'medical',
]);
const BEAUTY_WELLNESS = new Set(['salon', 'spa', 'barber', 'tattoo', 'fitness']);

// Premium-aware category resolution. normCat() (legacy) collapses dental/medical/
// tattoo/fitness to 'default' because the legacy CATEGORIES preset map has no
// theme for them — but the PREMIUM page+brand tables treat them as first-class
// families (the hand-authored bar uses category:"dental"). So we keep the raw
// category when it's a recognized premium family member; otherwise defer to normCat.
const PREMIUM_KNOWN = new Set([
  ...HOSPITALITY, ...SERVICES_LED, ...BEAUTY_WELLNESS, 'marina',
]);
const PREMIUM_CAT_ALIASES = {
  dentist: 'dental', dentistry: 'dental', orthodontist: 'dental',
  doctor: 'medical', clinic: 'medical', 'medical-spa': 'spa',
  gym: 'fitness', 'personal-training': 'fitness',
};
function premiumCat(rawCategory) {
  const raw = (rawCategory || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (PREMIUM_KNOWN.has(raw)) return raw;
  if (PREMIUM_CAT_ALIASES[raw] && PREMIUM_KNOWN.has(PREMIUM_CAT_ALIASES[raw])) return PREMIUM_CAT_ALIASES[raw];
  const n = normCat(rawCategory);
  return PREMIUM_KNOWN.has(n) ? n : (n === 'default' && raw && PREMIUM_KNOWN.has(raw) ? raw : n);
}

// Humanized category label for nav/eyebrow ("Dental Studio", "Craft Kitchen").
function categoryLabel(cat) {
  return titleCase(humanizeCategory(cat));
}

// The page-2 slug + label for the services-equivalent page, per family.
function servicesPage(cat) {
  if (HOSPITALITY.has(cat)) return { slug: 'menu', label: 'Menu' };
  return { slug: 'services', label: 'Services' };
}
function servicesEyebrow(cat) {
  return HOSPITALITY.has(cat) ? 'On the menu' : 'What we do';
}

// Categories that ship a built-in library motif (scripts/build-image-library.mjs
// emits {hero,story,motif}.svg for each). Keep in sync with that file's PALETTES.
const LIBRARY_CATS = new Set([
  'towing', 'cafe', 'restaurant', 'plumbing', 'hvac', 'electrician', 'roofing',
  'contractor', 'cleaning', 'salon', 'spa', 'barber', 'fitness', 'landscaping',
  'marina', 'auto-repair', 'tattoo', 'dental', 'medical', 'winery', 'default',
]);
// The decorative category motif path for a photo-less editorial hero. Served
// as-is from public/ (NOT through the asset registry); the validator treats a
// .svg as library art, never a "real photo". Falls back to 'default'.
function categoryMotif(cat) {
  const c = LIBRARY_CATS.has(cat) ? cat : 'default';
  return `/images/library/${c}/motif.svg`;
}

const telDigits = (s) => (s || '').replace(/[^\d]/g, '');
const telHref = (s) => {
  const d = telDigits(s);
  if (!d) return '';
  return `tel:+${d.length === 10 ? '1' + d : d}`;
};

// ── photo mapping (on-disk only) ───────────────────────────────────────────
// The validator hard-fails on invented paths. We list the slug's asset dir and
// only reference files that exist. Convention from the acquire pipeline:
// hero.<ext>, story.<ext>, photo-N.<ext>.
async function discoverPhotos(slug) {
  const dir = join(PUBLIC_IMAGES, slug);
  if (!existsSync(dir)) return { hero: null, story: null, gallery: [], all: [], quality: {} };
  const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));
  const baseOf = (f) => f.replace(/\.[a-z0-9]+$/i, '');
  // Map JSON paths in /images/<slug>/<base>.<ext> form (validator resolves any ext).
  const pathFor = (f) => `/images/${slug}/${f}`;
  const hero = files.find((f) => baseOf(f) === 'hero');
  const story = files.find((f) => baseOf(f) === 'story');
  // photo-N in numeric order.
  const photos = files
    .filter((f) => /^photo-\d+/.test(baseOf(f)))
    .sort((a, b) => (parseInt(baseOf(a).split('-')[1]) || 0) - (parseInt(baseOf(b).split('-')[1]) || 0));
  // AUTHOR-TIME RE-SCORE (key-free, once per site): the acquisition score lives
  // in the media descriptors, but story/gallery files on disk have no quality data
  // here. Re-score each from its bytes so the gallery floor + vivid-first ranking
  // can read {faded, dynamicRange, score}. Cheap — Sharp is already a dep.
  const quality = {};
  for (const f of files) {
    const p = pathFor(f);
    try { quality[p] = await scorePhoto(readFileSync(join(dir, f))); }
    catch { quality[p] = { faded: false, dynamicRange: 1, score: 0 }; }
  }
  return {
    hero: hero ? pathFor(hero) : null,
    story: story ? pathFor(story) : null,
    gallery: photos.map(pathFor),
    all: files.map(pathFor),
    quality, // { '/images/<slug>/<file>': { faded, dynamicRange, score, ... } }
  };
}

// ── deterministic skeleton ─────────────────────────────────────────────────
async function buildSkeleton(slug, row, e, research, media, { photoSource = '' } = {}) {
  const cat = premiumCat(row.category);
  // Track when the scraped-copy guard stripped a field — forces needs-review so
  // a human rewrites from the real facts instead of shipping a hole.
  let copyStripped = false;
  // A research file may carry a better PUBLIC display name (e.g. a rebrand) than
  // the lead's CSV name — prefer it when present (the hand-authored bar does this).
  const name = research?.name || row.name;
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const city = row.city || '';
  const state = row.state || '';
  const established = (e?.established || research?.established || row.established || '')
    .toString().replace(/^est\.?\s*/i, '').match(/\d{4}/)?.[0] || '';
  const phone = e?.phone || row.phone || '';
  // Human-display phone, "(NNN) NNN-NNNN". telHref() still uses the raw `phone`.
  const phoneFmt = formatPhone(phone);
  const email = e?.email || row.email || '';
  const address = e?.address || row.address || '';
  const rating = research?.rating?.value
    ? { value: research.rating.value, ...(research.rating.count ? { count: research.rating.count } : {}), ...(research.rating.source ? { source: research.rating.source } : {}) }
    : (e?.rating ? { value: e.rating, ...(e.reviewCount ? { count: e.reviewCount } : {}) } : null);
  const priceRange = research?.priceRange || e?.priceRange || '';

  // Real facts from research/enrichment (never invented). Run every scraped
  // prose line through sanitizeProse BEFORE the length filter so e-comm/nav junk
  // ("Notify me when this product is available") and duplicated-phrase artifacts
  // are dropped, not just clipped. A stripped line flips copyStripped.
  const rawAbout = (research?.aboutBody?.length ? research.aboutBody : (e?.about ?? []))
    .map((p) => clip(String(p), 600));
  const aboutBody = [];
  for (const p of rawAbout) {
    const clean = sanitizeProse(p);
    if (!clean) { if (p && p.trim().length > 40) copyStripped = true; continue; }
    if (clean.length > 40) aboutBody.push(clean);
  }
  const services = (research?.services?.length
    ? research.services
    : (e?.services ?? []).map((t) => ({ title: titleCase(t), description: '' })))
    .filter((s) => s.title)
    .map((s) => ({ title: titleCase(s.title), description: s.description || '' }));
  // Sanitize testimonials (drop low-signal placeholder-author quotes), then clip.
  const rawTestimonials = (research?.testimonials ?? e?.testimonials ?? [])
    .filter((t) => t.quote && t.quote.length > 20);
  const testimonials = sanitizeTestimonials(rawTestimonials)
    .map((t) => ({ quote: clip(t.quote, 280), ...(t.author ? { author: t.author } : {}) }));
  if (rawTestimonials.length && !testimonials.length) copyStripped = true;
  // Sanitized hero/story subheading source: prefer a clean research subheading,
  // else the (already-sanitized) first about paragraph. Never a junk clause.
  const heroSubSrc = sanitizeProse(research?.heroSubheading || '') || aboutBody[0] || '';
  if (research?.heroSubheading && !sanitizeProse(research.heroSubheading)) copyStripped = true;
  const hours = (research?.hours?.length ? research.hours : (e?.hours ?? []))
    .filter((h) => h && h.day && h.hours);
  const highlights = (research?.highlights ?? []).filter(Boolean);
  const social = research?.social ?? e?.social ?? {};
  // Real named people for a Team section — ONLY from research/scrape, never faked.
  // research.team wins; else the live-scrape's e.team. Each {name, role?, bio?}.
  const team = (research?.team?.length ? research.team : (e?.team ?? []))
    .filter((m) => m && m.name)
    .map((m) => ({
      name: titleCase(String(m.name)),
      ...(m.role ? { role: String(m.role) } : {}),
      ...(m.bio ? { bio: clip(sanitizeProse(String(m.bio)) || '', 240) } : {}),
    }))
    .filter((m) => m.name)
    .slice(0, 4);
  // Real pricing/packages — ONLY from research (rare); default off. Each tier
  // {name, price, blurb?, features?, featured?}. Never invented.
  const pricingTiers = (Array.isArray(research?.pricing) ? research.pricing : [])
    .filter((t) => t && t.name && (t.price || t.price === 0))
    .map((t) => ({
      name: titleCase(String(t.name)),
      price: String(t.price),
      ...(t.blurb ? { blurb: clip(sanitizeProse(String(t.blurb)) || '', 140) } : {}),
      ...(Array.isArray(t.features) ? { features: t.features.map((f) => clip(String(f), 70)).filter(Boolean).slice(0, 6) } : {}),
      ...(t.featured ? { featured: true } : {}),
    }))
    .filter((t) => t.name && t.price)
    .slice(0, 4);

  // Photos. discoverPhotos lists what's on disk (validator truth), but the HERO
  // must respect the acquire pipeline's decision: when it dropped the hero below
  // the resolution/quality floor (media empty, or source tagged ':below-floor'),
  // we DON'T headline a photo — we render a clean editorial text hero. Story/
  // gallery files on disk are still fine to use.
  const photos = await discoverPhotos(slug);
  const heroDropped = !media.length;
  const scoreOf = (p) => photos.quality?.[p] || { faded: false, dynamicRange: 1, score: 0, fuzzy: false, lowRes: false };
  // STRICT PHOTO GATE (author-time): a FUZZY/out-of-focus frame must NEVER ship —
  // not as a hero, story, aside, or gallery tile. The acquisition pipeline already
  // drops fuzzy+below-floor SOURCES, but a file could have been dropped straight
  // into the assets dir, so we re-enforce fuzziness here from the on-disk re-score.
  // A bad photo ruins the page worse than its absence (owner vision). NB: we test
  // fuzziness, NOT lowRes — these are already-CROPPED OUTPUT files (a portrait
  // gallery/hero-split tile is legitimately ~600-1000px and cleared its SOURCE
  // floor at acquisition); re-rejecting on output width would drop valid tiles.
  const isFuzzyPhoto = (p) => Boolean(scoreOf(p).fuzzy);

  // ── CONGRUENCE GATE (key-free, deterministic) ──────────────────────────────
  // Decides hero-vs-editorial. The strongest key-free signal is PROVENANCE: only
  // the business's OWN scraped/dropped photo is trustworthy-by-default for an
  // INDOOR place-based business; any off-domain stock (osm/wikimedia/openverse/
  // commons/ai/library/empty) on a salon/cafe/etc. reads as "not theirs" — that's
  // the Joon bug (an off-domain mountain on a salon slipped the old wikimedia-only
  // gate). For OUTDOORSY cats a regional/outdoor stock shot reads congruent, so it
  // may still headline. This is a FLOOR, not a guarantee: subject confirmation
  // ("this really IS a salon interior") is deferred to the vision pass — key-free
  // logic can raise suspicion and route to editorial, never confirm a subject.
  //
  // PROVENANCE: own = the business's own photo; everything else is off-domain.
  const ownDomain = /business-site|agent-supplied/i.test(photoSource);
  const offDomain = !ownDomain; // osm/wikimedia/openverse/commons/ai/library/empty
  // CATEGORY EXPECTATION:
  //   INDOOR_PLACE — expects an interior/people/product subject; a landscape/stock
  //                  shot reads incongruent. (adds fitness + dental to the old 6.)
  //   OUTDOORSY    — a regional/outdoor shot reads congruent; off-domain stock OK.
  const INDOOR_PLACE = new Set(['salon', 'spa', 'dental', 'cafe', 'restaurant', 'barber', 'fitness']);
  const OUTDOORSY = new Set(['landscaping', 'marina', 'winery', 'towing', 'auto-repair']);
  // outdoorsyCongruent: an off-domain stock shot is allowed to hero ONLY for an
  // outdoorsy cat (regional/outdoor reads congruent). Documented + asserted so the
  // INDOOR_PLACE rule below is the only thing that suppresses an off-domain hero.
  const outdoorsyCongruent = OUTDOORSY.has(cat) && offDomain;
  let stockHeroSuppressed = false;
  let suppressReason = '';
  let heroImg = heroDropped ? null : photos.hero;
  const heroFaded = heroImg ? scoreOf(heroImg).faded : false;
  if (heroImg) {
    if (isFuzzyPhoto(heroImg)) {
      // STRICT PHOTO GATE: a fuzzy/out-of-focus hero is the worst thing to ship —
      // route to the composed editorial hero instead. Takes precedence over every
      // other case (a fuzzy own-photo is still a bad photo).
      heroImg = null; stockHeroSuppressed = true;
      suppressReason = 'Fuzzy/out-of-focus hero suppressed — add a sharp photo or ship the text hero';
    } else if (INDOOR_PLACE.has(cat) && !ownDomain) {
      // CORE FIX: for an indoor place-based cat, only the business's OWN photo may
      // hero. An off-domain shot (Joon's OSM/scraped-but-off-domain mountain) fails.
      heroImg = null; stockHeroSuppressed = true;
      suppressReason = 'Off-domain hero suppressed for place-based category — add the business’s own photo';
    } else if (INDOOR_PLACE.has(cat) && ownDomain && heroFaded) {
      // Own photo, but washed → prefer the composed editorial over a faded own-photo.
      heroImg = null; stockHeroSuppressed = true;
      suppressReason = 'Washed own-photo hero suppressed — prefer editorial or add a vivid photo';
    } else if (heroFaded) {
      // Any cat: a washed hero never headlines (outdoorsy included).
      heroImg = null; stockHeroSuppressed = true;
      suppressReason = 'Washed/low-contrast hero suppressed — add a vivid photo';
    }
    // else: own-domain non-faded, OR outdoorsy off-domain (regional) non-faded
    // (outdoorsyCongruent) → hero as normal.
    void outdoorsyCongruent;
  }
  // The same gate governs the editorial ASIDE and the GALLERY/STORY: an off-domain
  // shot on an indoor cat must not sneak into the aside or gallery either.
  const offDomainIndoor = INDOOR_PLACE.has(cat) && offDomain;

  // GALLERY/STORY QUALITY FLOOR (author-time): drop FADED and FUZZY survivors from
  // the gallery set rather than ship a washed or soft grid; for an indoor cat also
  // drop off-domain shots. storyImg falls through faded/fuzzy/off-domain candidates
  // to none.
  const galleryEligible = (p) => !scoreOf(p).faded && !isFuzzyPhoto(p) && !offDomainIndoor;
  const storyCandidates = [photos.story, ...photos.gallery].filter(Boolean).filter(galleryEligible);
  const storyImg = storyCandidates[0] || null;
  // Gallery pool: non-faded, congruent, best-first by the re-scored vivid ranking.
  const galleryPool = photos.gallery
    .filter((p) => p !== storyImg && galleryEligible(p))
    .sort((a, b) => (scoreOf(b).score ?? 0) - (scoreOf(a).score ?? 0));
  // Require >=3 GOOD photos or omit the gallery entirely — omission beats a faded
  // grid. (homeGallery/aboutGallery key off galleryImgs.length below.)
  const galleryImgs = galleryPool.length >= 3 ? galleryPool : [];
  const realPhotoCount = galleryImgs.length + (heroImg ? 1 : 0);

  // Brand. dental has no font affinity of its own — seed it among the medical
  // pairings (editorial-serif / classic-trad / clean-sans) so a dentist reads
  // clinical-editorial, not a generic default sans.
  const fontIdOverride = research?.brand?.fontId || research?.fontId || '';
  const seed = hashStr(slug);
  const fontCat = cat === 'dental' ? 'medical' : cat;
  const fontId = pickFontId(fontCat, seed, fontIdOverride);
  const color = pickBrandColor(cat, slug, research?.brand?.color || e?.brandColor || '');

  // ── HERO VARIANT GUARD (P0) ────────────────────────────────────────────────
  // NEVER emit a split/fullbleed hero without an image — the premium.css grid
  // for those expects a figure and renders a blank column otherwise. So:
  //   • no hero photo            → 'editorial' (type-forward; motif/aside fill the
  //                                right column, never blank)
  //   • hero photo present       → 'split' or 'fullbleed' chosen DETERMINISTICALLY
  //                                by hash(slug) so two photo-having siblings don't
  //                                open identically.
  const heroTreatSeed = hashStr(slug + 'hero');
  const heroVariant = heroImg
    ? (heroTreatSeed % 2 === 0 ? 'split' : 'fullbleed')
    : 'editorial';

  // For an editorial (photo-less) hero, fill the right column with REAL material
  // instead of leaving it blank: if a congruent story/gallery photo exists, use
  // the best secondary photo as the editorial `aside`; otherwise fall back to the
  // brand-tinted category motif backdrop behind the type. `storyImg` is the
  // best non-hero photo (story file, else first gallery shot).
  // Suppress the secondary-photo aside under the SAME congruence gate that
  // suppressed the hero: an off-domain shot on an indoor cat, or a faded shot,
  // must not fill the aside either. storyImg is already gallery-eligible
  // (non-faded + congruent), so it is safe to use directly.
  const editorialAside = (!heroImg && storyImg) ? storyImg : null;
  const heroMotif = (!heroImg && !editorialAside) ? categoryMotif(cat) : null;

  const eyebrowLoc = [area, established ? `Est. ${established}` : ''].filter(Boolean).join(' · ');
  const sp = servicesPage(cat);

  // ── HOME sections ──
  const homeSections = [];

  // hero
  const hero = {
    kind: 'hero',
    variant: heroVariant,
    ...(eyebrowLoc ? { eyebrow: eyebrowLoc } : {}),
    heading: research?.heroHeading || defaultHeroHeading(name, cat, area, established),
    ...(heroSubSrc ? { subheading: clip(heroSubSrc, 200) } : {}),
    badges: buildBadges(established, rating, highlights),
    primaryCta: { label: HOSPITALITY.has(cat) ? 'See the menu' : 'Get in touch', href: `/s/${slug}/${HOSPITALITY.has(cat) ? 'menu' : 'contact'}` },
    secondaryCta: { label: HOSPITALITY.has(cat) ? 'Book catering' : (services.length ? 'Our services' : 'Contact us'), href: `/s/${slug}/${services.length ? sp.slug : 'contact'}` },
    ...(heroImg
      ? { image: { src: heroImg, alt: `${name}${area ? ` in ${area}` : ''}`, focal: '50% 40%' } }
      : editorialAside
        ? { image: { src: editorialAside, alt: `Inside ${name}`, focal: '50% 50%' } }
        : { motif: heroMotif }),
  };
  homeSections.push(hero);

  // Build each candidate home section as a value first, then ORDER + assemble
  // per the per-slug composition seed (item 5). null = section not warranted.

  // stats — built from real values; the HOME band needs >=3 to read as a
  // substantial trust strip (a lone/paired stat looks thin on a full dark band).
  // When exactly 2, they're already surfaced as hero badges; when <3 but real
  // highlights exist, a brand-tinted 'callout' differentiator band carries that
  // weight instead of a sparse stat row.
  const stats = buildStats(established, rating, services.length, priceRange);
  const homeStats = stats.length >= 3 ? { kind: 'stats', tone: 'ink', items: stats } : null;

  // callout — the differentiator band that stands in for a sparse stat row.
  // Emitted only when there's NO full stat band AND we have real highlights (or
  // a credential-bearing badge set) to carry it. Photo-free by design.
  const calloutPoints = (highlights.length ? highlights : [])
    .map((h) => clip(String(h), 60)).filter(Boolean).slice(0, 4);
  const homeCallout = (!homeStats && calloutPoints.length >= 2)
    ? {
        kind: 'callout',
        eyebrow: 'Why choose us',
        heading: research?.calloutHeading || `What sets ${name} apart`,
        ...(aboutBody[0] ? { body: clip(aboutBody[0], 200) } : (heroSubSrc ? { body: clip(heroSubSrc, 200) } : {})),
        points: calloutPoints,
        primaryCta: { label: HOSPITALITY.has(cat) ? 'See the menu' : 'Get in touch', href: `/s/${slug}/${HOSPITALITY.has(cat) ? 'menu' : 'contact'}` },
      }
    : null;

  // story — only when aboutBody present.
  const homeStory = aboutBody.length
    ? {
        kind: 'story',
        eyebrow: 'Our story',
        heading: research?.aboutHeading ? clip(research.aboutHeading, 60) : `About ${name}`,
        body: aboutBody.slice(0, 2),
        ...(highlights.length ? { highlights: highlights.slice(0, 4) } : {}),
        ...(storyImg ? { image: { src: storyImg, alt: `Inside ${name}`, focal: '50% 50%' } } : {}),
      }
    : null;

  // services
  const homeServices = services.length
    ? {
        kind: 'services',
        eyebrow: servicesEyebrow(cat),
        heading: research?.servicesHeading || (HOSPITALITY.has(cat) ? 'On the menu' : 'What we do'),
        layout: 'grid',
        items: services.slice(0, 6).map((s) => ({ title: s.title, description: s.description || deriveServiceDesc(s.title, cat, area) })),
      }
    : null;

  // testimonials
  const homeTestimonials = testimonials.length
    ? {
        kind: 'testimonials',
        eyebrow: 'In their words',
        heading: 'What customers say',
        ...(rating ? { rating } : {}),
        items: testimonials.slice(0, 3),
      }
    : null;

  // gallery — only when >=3 real photos.
  const homeGallery = galleryImgs.length >= 3
    ? {
        kind: 'gallery',
        eyebrow: 'A closer look',
        heading: `Inside ${name}`,
        images: galleryImgs.slice(0, 6).map((src, i) => ({ src, alt: `${name} — photo ${i + 1}` })),
      }
    : null;

  // features — a structured benefit band built from REAL highlights on the home
  // page (>=3 highlights). Gives the homepage iconned benefit cards instead of
  // only a flat checklist. Rendered as a candidate; the component itself returns
  // nothing if <2 survive. Distinct from the callout (which is the <3-stats
  // fallback), so don't emit both: features wins when highlights are plentiful.
  const featureItems = highlights.slice(0, 6).map((h) => featureFromHighlight(h, cat, area));
  const homeFeatures = featureItems.length >= 3
    ? {
        kind: 'features',
        eyebrow: 'Why choose us',
        heading: `Why ${name}`,
        items: featureItems,
      }
    : null;

  // steps — a generic-but-honest "How it works" for services-led families ONLY,
  // and ONLY when there's real about + services to justify a process narrative.
  // Hospitality/beauty skip it (a "process" reads wrong for a cafe/salon).
  const homeSteps = (SERVICES_LED.has(cat) && aboutBody.length && services.length)
    ? {
        kind: 'steps',
        eyebrow: 'How it works',
        heading: 'Working with us is simple',
        items: buildSteps(cat, name),
      }
    : null;

  // team — ONLY from real named people (research/scrape). Never fabricated.
  const homeTeam = team.length
    ? {
        kind: 'team',
        eyebrow: 'The people behind the work',
        heading: team.length === 1 ? `Meet ${team[0].name}` : 'Meet the team',
        members: team,
      }
    : null;

  const homeCta = buildCta(slug, name, cat, address, phone, false, phoneFmt);

  // ── COMPOSITION SEED (item 5) ──────────────────────────────────────────────
  // Deterministic per-slug section ORDERING so siblings diverge structurally
  // (beyond just color + font). hashStr(slug+'order') picks one of three home
  // arrangements; missing sections (null) drop out, so the order is just intent.
  // The trust band (stats|callout|features) slots wherever the variant places
  // 'trust'. Precedence: a real stat row is strongest; else the iconned features
  // band (>=3 highlights) carries the "why us" beat; else the callout differentiator
  // (>=2 points). Only one fills 'trust' so we never stack two "why choose us"
  // bands. The OTHER of features/callout is suppressed to avoid redundancy.
  // CTA always closes the page.
  const trustBand = homeStats || homeFeatures || homeCallout;
  const byKey = {
    trust: trustBand,
    story: homeStory,
    services: homeServices,
    steps: homeSteps,
    team: homeTeam,
    testimonials: homeTestimonials,
    gallery: homeGallery,
  };
  // Section ORDER per variant. New beats (steps/team) are woven in where they
  // read best: steps right after services (the "what" then the "how"), team near
  // the story (the people behind it). Missing sections drop out.
  const ORDER_VARIANTS = [
    ['trust', 'story', 'team', 'services', 'steps', 'testimonials', 'gallery'],
    ['story', 'team', 'services', 'steps', 'trust', 'gallery', 'testimonials'],
    ['services', 'steps', 'story', 'team', 'testimonials', 'trust', 'gallery'],
  ];
  const orderVariant = hashStr(slug + 'order') % ORDER_VARIANTS.length;
  for (const key of ORDER_VARIANTS[orderVariant]) {
    if (byKey[key]) homeSections.push(byKey[key]);
  }
  homeSections.push(homeCta);

  // ── pages assembly ──
  const pages = [{ slug: 'home', label: 'Home', sections: homeSections }];

  // services / menu page
  if (services.length) {
    const svcItems = services.map((s) => ({ title: s.title, description: s.description || deriveServiceDesc(s.title, cat, area) }));
    // PREFER grid when NO service item carries a real photo (the common case) —
    // grid cards don't demand imagery, so there are no empty 01/02 panels.
    // Reserve 'rows' for sites that actually have per-service photos; the rows
    // component still renders a DESIGNED brand-tinted glyph (not a blank box) for
    // any image-less row, flagged via fallbackOk so the audit knows it's intended.
    const anySvcImage = svcItems.some((it) => it.image?.src);
    const svcLayout = anySvcImage ? 'rows' : 'grid';
    const svcSections = [
      {
        kind: 'hero',
        variant: 'editorial',
        eyebrow: servicesEyebrow(cat),
        heading: HOSPITALITY.has(cat) ? 'What we’re serving' : 'How we can help',
        ...(heroSubSrc ? { subheading: clip(heroSubSrc, 180) } : {}),
        motif: categoryMotif(cat),
      },
      {
        kind: 'services',
        heading: research?.servicesHeading || (HOSPITALITY.has(cat) ? 'What we’re serving' : 'What we do'),
        layout: svcLayout,
        ...(svcLayout === 'rows' ? { fallbackOk: true } : {}),
        items: svcItems,
      },
    ];
    // steps — the same generic-but-honest process, on the services page where it
    // reads most naturally (services-led families with real about + services).
    if (homeSteps) {
      svcSections.push({
        kind: 'steps',
        eyebrow: 'Our process',
        heading: 'How it works',
        items: buildSteps(cat, name),
      });
    }
    // pricing — ONLY when research carried real tiers (rare); never invented.
    if (pricingTiers.length) {
      svcSections.push({
        kind: 'pricing',
        eyebrow: 'Pricing',
        heading: HOSPITALITY.has(cat) ? 'Packages' : 'Straightforward pricing',
        tiers: pricingTiers,
      });
    }
    const faq = buildFaq(testimonials, hours, address, area, phoneFmt, cat);
    if (faq.length >= 2) svcSections.push({ kind: 'faq', eyebrow: 'Good to know', heading: 'Common questions', items: faq.slice(0, 4) });
    svcSections.push(buildCta(slug, name, cat, address, phone, true, phoneFmt));
    pages.push({ slug: sp.slug, label: sp.label, title: sp.label, sections: svcSections });
  }

  // about page — drop when no aboutBody AND no established year.
  let aboutDropped = false;
  if (aboutBody.length || established) {
    const aboutSections = [
      {
        kind: 'hero',
        variant: 'editorial',
        eyebrow: `About ${name}`,
        heading: research?.aboutHeading ? clip(research.aboutHeading, 70) : `About ${name}`,
        ...(aboutBody[0] ? { subheading: clip(aboutBody[0], 180) } : {}),
        motif: categoryMotif(cat),
      },
    ];
    if (aboutBody.length) {
      aboutSections.push({
        kind: 'story',
        eyebrow: 'Our story',
        heading: research?.aboutHeading || `About ${name}`,
        body: aboutBody.slice(0, 2),
        ...(highlights.length ? { highlights: highlights.slice(0, 4) } : {}),
        ...(storyImg ? { image: { src: storyImg, alt: `Inside ${name}`, focal: '50% 50%' } } : {}),
      });
    }
    const aboutStats = buildStats(established, rating, services.length, priceRange);
    if (aboutStats.length >= 2) aboutSections.push({ kind: 'stats', tone: 'ink', items: aboutStats });
    if (galleryImgs.length >= 3) {
      aboutSections.push({
        kind: 'gallery',
        eyebrow: 'A closer look',
        heading: `Where you'll find us`,
        images: galleryImgs.slice(0, 4).map((src, i) => ({ src, alt: `${name} — photo ${i + 1}` })),
      });
    }
    aboutSections.push({ kind: 'cta', heading: `Come see ${name}`, primaryCta: { label: 'Get in touch', href: `/s/${slug}/contact` } });
    pages.push({ slug: 'about', label: 'About', title: 'About', sections: aboutSections });
  } else {
    aboutDropped = true;
  }

  // contact page
  pages.push({
    slug: 'contact',
    label: 'Contact',
    title: 'Contact',
    sections: [{
      kind: 'contact',
      eyebrow: 'Get in touch',
      heading: 'Get in touch',
      ...(address || phone ? { blurb: `Reach ${name}${address ? ` at ${address}` : ''}${phone ? ` or call ${phoneFmt}` : ''}.` } : {}),
      showMap: Boolean(address),
      showHours: Boolean(hours.length),
    }],
  });

  // ── top-level config ──
  const config = {
    slug,
    name,
    legalName: research?.legalName || name,
    tagline: clip(sanitizeProse(research?.tagline || e?.description || ''), 110),
    seoDescription: clip(sanitizeProse(research?.seoDescription || e?.description || '') || `${name} — ${categoryLabel(cat)} serving ${area || 'the local area'}.`, 160),
    category: cat,
    categoryLabel: categoryLabel(cat),
    area,
    city,
    state,
    established,
    contact: { phone: phoneFmt, email, address },
    social: cleanSocial(social),
    ...(hours.length ? { hours } : {}),
    ...(rating ? { rating } : {}),
    ...(priceRange ? { priceRange } : {}),
    brand: { color, fontId },
    ...(heroImg ? { images: { hero: heroImg, heroAlt: `${name}${area ? ` in ${area}` : ''}` } } : {}),
    outreach: { published: false },
    pages,
  };

  return { config, meta: { aboutDropped, realPhotoCount, galleryCount: galleryImgs.length, heroImg, anyRealPhoto: realPhotoCount > 0 || galleryImgs.length > 0, cat, copyStripped, stockHeroSuppressed, suppressReason } };
}

// ── helpers ────────────────────────────────────────────────────────────────
function cleanSocial(s) {
  const out = {};
  for (const k of ['facebook', 'instagram', 'google', 'yelp', 'linkedin']) {
    if (s?.[k] && /^https?:\/\//.test(s[k])) out[k] = s[k];
  }
  return out;
}

// A hero badge is a short LABEL, not a sentence. Clip at a word boundary and
// never leave a dangling/unmatched parenthetical (the "(Lic"/"(CSLB" bug) — drop
// from the last unmatched "(" and trim trailing connective punctuation. The full
// untruncated highlight still lives in the story section, so trust signals (a
// license #, a credential) are preserved for the audit even when trimmed here.
function cleanBadge(h, max = 48) {
  let s = String(h || '').replace(/\s+/g, ' ').trim();
  // A badge is a short LABEL — drop any parenthetical detail (e.g. a license #;
  // the full highlight still carries it in the story section for the audit).
  s = s.replace(/\s*\([^)]*\)?\s*/g, ' ').replace(/\s+/g, ' ').trim();
  // Trim trailing connective punctuation, em/en dashes, then a dangling connective.
  s = s.replace(/[\s,;:·—–\-(]+$/, '').trim();
  s = s.replace(/\s+(for|and|of|the|to|with|in|on|at|by|from|or|a|an|since|as|who|that|which)$/i, '').trim();
  // Still a full sentence, not a label → skip it rather than truncate mid-clause.
  if (s.length > max) return '';
  return s;
}

function buildBadges(established, rating, highlights) {
  const b = [];
  if (established) b.push(`Serving since ${established}`);
  if (rating) b.push(`${rating.value}★${rating.count ? ` from ${rating.count} reviews` : ''}`);
  for (const h of highlights) {
    if (b.length >= 3) break;
    const badge = cleanBadge(h);
    if (badge && !b.includes(badge)) b.push(badge);
  }
  return b.slice(0, 3);
}

function buildStats(established, rating, serviceCount, priceRange) {
  const stats = [];
  if (established) {
    const yrs = new Date().getFullYear() - Number(established);
    if (yrs > 0 && yrs < 200) stats.push({ value: `${yrs}+`, label: 'Years in business' });
    else stats.push({ value: String(established), label: 'Serving since' });
  }
  if (rating) stats.push({ value: `${rating.value}★`, label: rating.count ? `${rating.count} reviews` : 'Customer rating' });
  if (serviceCount >= 3) stats.push({ value: String(serviceCount), label: 'Services offered' });
  if (priceRange) stats.push({ value: priceRange, label: 'Fairly priced' });
  return stats.slice(0, 4);
}

function buildCta(slug, name, cat, address, phone, isServicePage = false, phoneDisplay = phone) {
  const cta = {
    kind: 'cta',
    heading: HOSPITALITY.has(cat) ? 'Hungry yet?' : (isServicePage ? 'Let’s talk' : `Work with ${name}`),
    ...(address || phone ? { body: `${address ? `Find us at ${address}. ` : ''}${phone ? `Call ${phoneDisplay} — we’re glad to help.` : ''}`.trim() } : {}),
    primaryCta: { label: 'Get in touch', href: `/s/${slug}/contact` },
  };
  const t = telHref(phone);
  if (t) cta.secondaryCta = { label: `Call ${phoneDisplay}`, href: t };
  return cta;
}

function buildFaq(testimonials, hours, address, area, phone, cat) {
  const faq = [];
  if (address) faq.push({ q: 'Where are you located?', a: `You'll find us at ${address}.` });
  if (hours.length) faq.push({ q: 'What are your hours?', a: hours.map((h) => `${h.day}: ${h.hours}`).join('; ') + '.' });
  if (area) faq.push({ q: 'What areas do you serve?', a: `We proudly serve ${area} and the surrounding community.` });
  if (phone) faq.push({ q: 'How do I get in touch?', a: `Call us at ${phone} — we're glad to help.` });
  return faq;
}

// Map a real highlight phrase to one of the FeaturesSection icon keywords by
// keyword match (the component falls back to 'check' for anything unmapped, so a
// miss is safe). Keep keywords in sync with FeatureIcon in premium-types.ts.
function iconForHighlight(text) {
  const t = (text || '').toLowerCase();
  if (/\b(licensed|insured|bonded|certified|warrant|guarantee|trusted|safe|secure)\b/.test(t)) return 'shield';
  if (/\b(24\/7|hour|fast|same[- ]day|response|on time|quick|emergency|appointment)\b/.test(t)) return 'clock';
  if (/\b(organic|eco|green|natural|sustainable|farm|estate|fresh|seasonal|local(ly)?)\b/.test(t)) return 'leaf';
  if (/\b(repair|install|service|fix|maintenance|work|crew|skilled|experienced|hand)\b/.test(t)) return 'wrench';
  if (/\b(clean|spotless|premium|quality|craft|fine|luxury|award|best|top)\b/.test(t)) return 'sparkle';
  if (/\b(area|serving|local|town|county|neighborhood|community|near|location)\b/.test(t)) return 'map-pin';
  if (/\b(call|phone|reach|contact|dispatch|book)\b/.test(t)) return 'phone';
  return 'check';
}

// Split one highlight into a short title + a body line for a feature card. Most
// highlights are a single terse phrase ("Licensed & insured", "ASE-certified");
// we keep the phrase AS the title and write a calm, factual body from category.
function featureFromHighlight(text, cat, area) {
  const title = clip(titleCase(String(text)), 48);
  const lower = String(text).toLowerCase();
  let body;
  if (/\b(licensed|insured|bonded|certified)\b/.test(lower)) body = 'Properly credentialed, so the work is covered and done to standard.';
  else if (/\b(24\/7|hour|emergency|response|fast|same[- ]day)\b/.test(lower)) body = 'When it matters, we move quickly — you won’t be left waiting.';
  else if (/\b(free|estimate|upfront|pricing|fair|honest)\b/.test(lower)) body = 'Clear, honest pricing up front — no surprises on the final bill.';
  else if (/\b(local|family|owned|community)\b/.test(lower)) body = `Rooted right here${area ? ` in ${area}` : ''}, with a real stake in doing it right.`;
  else if (/\b(fresh|organic|seasonal|scratch|house|craft|estate)\b/.test(lower)) body = 'Made with care and real ingredients — quality you can taste.';
  else body = 'A standard we hold on every job, not just the easy ones.';
  return { title, body, icon: iconForHighlight(text) };
}

// Generic-but-HONEST process for services-led families. Every line is true of
// any reputable trade/service business — no invented specifics. Emitted only
// when real about + services exist (see caller guard).
function buildSteps(cat, name) {
  const reach = HOSPITALITY.has(cat) ? 'Get in touch' : 'Reach out';
  return [
    { title: reach, body: `Call or message ${name} and tell us what you need.` },
    { title: 'We assess', body: 'We look at the details and talk through the right approach with you.' },
    { title: 'We do the work', body: 'Our team handles it properly, keeping you in the loop along the way.' },
    { title: 'You’re set', body: 'The job’s done right, and we stand behind it.' },
  ];
}

function defaultHeroHeading(name, cat, area, established) {
  if (established) return `${name}, serving ${area || 'the area'} since ${established}`;
  return `${name} — ${categoryLabel(cat)} you can count on`;
}

const SERVICE_DESC = [
  (t, area) => `${titleCase(t)} handled with care${area ? `, right here in ${area}` : ''}.`,
  (t) => `Real experience behind every ${t.toLowerCase()} job, big or small.`,
  (t, area) => `Count on us for ${t.toLowerCase()}${area ? ` across ${area}` : ''}, start to finish.`,
];
function deriveServiceDesc(title, cat, area) {
  const seed = hashStr(title + cat);
  return SERVICE_DESC[seed % SERVICE_DESC.length](title, area);
}

// ── Claude copy upgrade (optional) ─────────────────────────────────────────
// Upgrades ONLY copy fields from the deterministic skeleton + the same real
// facts; never invents facts/photos/hours/ratings. On any error, returns the
// skeleton unchanged. Validated back into the same PremiumConfig shape.
async function upgradeCopyWithClaude(config, e, research) {
  if (!process.env.ANTHROPIC_API_KEY) return config;
  try {
    const facts =
      (research?.aboutBody?.length ? `\nAbout (verified): ${clip(research.aboutBody.join(' '), 700)}` : '') +
      (e?.description ? `\nSelf-description: ${clip(e.description, 300)}` : '') +
      (config.established ? `\nEstablished: ${config.established}` : '') +
      (config.rating ? `\nRating: ${config.rating.value}★${config.rating.count ? ` (${config.rating.count})` : ''}` : '') +
      (config.services ? '' : '');
    const services = (config.pages[0].sections.find((s) => s.kind === 'services')?.items ?? []).map((s) => s.title).join('; ');
    const system = [{
      type: 'text',
      text:
        'You upgrade COPY for a small-business website built from REAL facts. Return ONLY minified JSON: ' +
        '{"heroHeading":string,"heroSubheading":string,"storyBody":string[2],' +
        '"services":[{"title":string,"description":string}],"ctaHeading":string,"ctaBody":string}. ' +
        'Use ONLY the facts given — never invent awards, numbers, services, photos, hours, or ratings. ' +
        'Keep service titles EXACTLY as given (rewrite only descriptions). Voice: warm, concrete, local, no hype, no emoji. ' +
        'heroHeading <=10 words.',
      cache_control: { type: 'ephemeral' },
    }];
    const user =
      `Business: ${config.name}\nCategory: ${config.categoryLabel}\nArea: ${config.area}\n` +
      `Services: ${services}` + facts;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6', max_tokens: 1400, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.content?.map((b) => b.text ?? '').join('').trim();
    const j = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    return applyClaudeCopy(config, j);
  } catch (err) {
    console.warn(`  ! Claude premium-copy upgrade failed for ${config.slug} (${err.message}); keeping deterministic copy`);
    return config;
  }
}

// Merge Claude's copy back into the config WITHOUT touching facts/photos/structure.
function applyClaudeCopy(config, j) {
  const titleSet = new Set();
  for (const page of config.pages) {
    for (const sec of page.sections) {
      if (sec.kind === 'hero' && page.slug === 'home') {
        if (j.heroHeading) sec.heading = clip(j.heroHeading, 90);
        if (j.heroSubheading) sec.subheading = clip(j.heroSubheading, 200);
      }
      if (sec.kind === 'story' && Array.isArray(j.storyBody) && j.storyBody.length) {
        sec.body = j.storyBody.slice(0, 2).map((p) => clip(String(p), 600));
      }
      if (sec.kind === 'services' && Array.isArray(j.services)) {
        // Match by title only; rewrite description, keep facts/titles fixed.
        for (const item of sec.items) {
          const m = j.services.find((s) => s.title && s.title.toLowerCase() === item.title.toLowerCase());
          if (m?.description) item.description = clip(m.description, 280);
        }
      }
      if (sec.kind === 'cta') {
        if (j.ctaHeading) sec.heading = clip(j.ctaHeading, 80);
        if (j.ctaBody) sec.body = clip(j.ctaBody, 200);
      }
    }
  }
  return config;
}

// ── public entry ───────────────────────────────────────────────────────────
/**
 * authorPremium — build a validated PremiumConfig for one prospect.
 * @returns { config, status, flags, photoSource }
 */
export async function authorPremium(slug, row, e, research, media, {
  photoSource = '', photoFlags = [], mismatchName = '', useClaude = true,
} = {}) {
  let { config, meta } = await buildSkeleton(slug, row, e, research, media, { photoSource });

  // Optional Claude copy upgrade (deterministic skeleton already shippable).
  if (useClaude) config = await upgradeCopyWithClaude(config, e, research);

  // Status — reuse deriveStatus, then layer premium-specific flags. CONFIRMED
  // research is authoritative: it satisfies the website/hours verification that
  // the unverified live-scrape path needs (a no-website business is the outreach
  // opportunity, not a defect).
  const templated = []; // premium author builds from real facts; no template stubs tracked here
  const authoritative = research?.confirmed === true;
  const { flags } = deriveStatus(row, e, media, photoSource, templated, mismatchName, authoritative);
  flags.push(...photoFlags);

  // Premium-specific flags.
  const totalSections = config.pages.reduce((n, p) => n + p.sections.length, 0);
  if (totalSections < 6) flags.push('Single-page content — needs more real material for multi-page');
  if (meta.aboutDropped) flags.push('No About content — about page folded');
  // Photo-light is NOT flagged here. A zero-photo home is a first-class outcome
  // when the composition carries it; the audit's photoLightVerdict (folded into
  // auditCriticals below) is the single source of truth — it passes a composed,
  // trust-bearing photo-light home and flags a thin one. Flagging it again here
  // would block EVERY dead-site lead (which by definition has no first-party
  // photos) from ever reaching ready, contradicting that verdict.
  // P0 guards: scraped copy was junk (stripped) → must rewrite from real facts;
  // a generic regional stock hero on a place-based business was suppressed.
  if (meta.copyStripped) flags.push('Scraped copy was junk — rewrite from real facts');
  // A distinct flag string per suppression case so the human knows WHY the hero
  // was routed to editorial (off-domain provenance vs washed photo).
  if (meta.stockHeroSuppressed) flags.push(meta.suppressReason || 'Generic stock hero suppressed — add a real photo');

  // ── 95% SELF-GATE (the AVISP bar) ──────────────────────────────────────────
  // status:'ready' is reserved for sites that clear the AVISP/Copper Bay bar on
  // their own. Concretely, ALL must hold (any miss → needs-review, held from the
  // CRM by the only-ready sync):
  //   1. REAL VERIFIED FACTS — deriveStatus already flags no-website / unreachable
  //      / thin research (richness<35) / missing email / generic hours, so any of
  //      those sits in `flags`.
  //   2. CLEAN COPY — copyStripped (scraped junk removed) and any premium-validate
  //      failure already flag; the audit hook below ALSO catches scraped-junk /
  //      code-leak / coupon-legalese / templated copy that reaches a field.
  //   3. CONGRUENT OR NO PHOTOS, NEVER BAD ONES — the congruence + strict photo
  //      gate above route a fuzzy/low-res/off-domain/washed hero to a composed
  //      editorial hero AND flag it (stockHeroSuppressed). The site is still
  //      shippable photo-light, but the flag forces a human glance.
  //   4. ZERO AUDIT CRITICALS — run the mechanical content audit (auditProspect)
  //      over the finished config. A photo-light page with no trust signal, an
  //      empty/blank-panel section, a bare phone, a lone stat, etc. are criticals
  //      that DROP a site below 95%, so they force needs-review here too.
  const auditCriticals = await auditConfigCriticals(slug, config);
  for (const msg of auditCriticals) flags.push(`Audit critical — ${msg}`);

  const status = flags.length ? 'needs-review' : 'ready';
  config.status = status;
  config.flags = flags;
  // Persist provenance so the vision packet (vision-qa.mjs packetFor) can show the
  // judge WHY a hero may have been routed to editorial. Not rendered; QA metadata.
  if (photoSource) config.photoSource = photoSource;

  return { config, status, flags, photoSource };
}

export { buildSkeleton, discoverPhotos };
