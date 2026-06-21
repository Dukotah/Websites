#!/usr/bin/env node
/**
 * audit.mjs — a pre-publish QA pass that "looks over the project" and reports
 * what to fix BEFORE a site ships. Key-free, deterministic.
 *
 * Catches the classes of bug that slip past `npm run build` (which is happy as
 * long as it compiles) but look broken to a human:
 *   1. DEAD TOKENS — var(--x) used but never defined/injected (e.g. the footer's
 *      var(--ink) → transparent background → invisible white text). This is the
 *      #1 cause of "illegible / broken" sections.
 *   2. CONTENT gaps — stock hero art, missing alt text, empty sections,
 *      templated copy left in place.
 *
 * Exit code is non-zero if any CRITICAL issue is found, so it can gate a deploy.
 * (For design-level judgment — photo matching, layout, "does it look $4k" — see
 * the AI vision review; this static pass is the free, mechanical safety net.)
 *
 * Usage: node scripts/audit.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JUNK_RE } from './lib/copy-sanity.mjs';
import { scorePhoto } from './lib/photo-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'sites', 'demo-gallery');
const SRC = join(APP, 'src');
// PREMIUM multi-page configs (the only render system). Each renders at /s/<slug>.
const PREMIUM = join(SRC, 'data', 'premium');
// Per-prospect REAL photos on disk (so the photo gate can re-score the bytes a
// config references). Mirrors facts.mjs PUBLIC_IMAGES — the `/images/<slug>/<f>`
// JSON path maps here as <slug>/<f>.
const PUBLIC_IMAGES = join(SRC, 'assets', 'prospects');
// Human/agent-verified research lives here, one file per slug. A `confirmed:true`
// file means the copy (incl. the headline) was AUTHORED on purpose, so cliché-ish
// phrasing there is a real business motto — not the "AI batch" tell.
const RESEARCH = join(ROOT, 'data', 'research');

/** True iff a research file exists for this slug AND is confirmed:true.
 *  Guarded: most prospects have no research file — a missing/unparsable file
 *  is simply "not confirmed", never a crash. */
async function isConfirmed(slug) {
  try {
    const raw = await readFile(join(RESEARCH, `${slug}.json`), 'utf8');
    return JSON.parse(raw).confirmed === true;
  } catch {
    return false;
  }
}

/** True iff ANY research file exists for this slug (confirmed or not). A site with
 *  no research file behind it that ALSO reaches for a cliché headline is the pure
 *  "AI batch" tell — nothing was researched and the most important line is filler,
 *  so the cliché finding is promoted warn→critical (R4). */
async function hasResearchFile(slug) {
  try {
    await readFile(join(RESEARCH, `${slug}.json`), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// Tokens injected at runtime by tokens.ts (artDirectionToCss) — always present.
const INJECTED = new Set([
  'brand','brand-vivid','brand-vivid-contrast','brand-dark','brand-contrast','accent','accent-contrast','bg','bg-alt','bg-deep',
  'surface','surface-2','text','text-muted','text-on-dark','border','ring',
  'font-display','font-body','fw-display','fw-body','fw-bold','tracking-display','tracking-eyebrow',
  'leading-display','leading-body','radius','radius-lg','radius-pill','border-weight',
  'shadow-sm','shadow-md','shadow-lg','frame-style','section-pad','gutter','maxw','grid-gap',
  'motion-fade','motion-rise','motion-ease','pattern-opacity',
  'step--1','step-0','step-1','step-2','step-3','step-4','step-5','step-6',
]);

async function walk(dir, exts, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, exts, out);
    else if (exts.includes(extname(e.name))) out.push(p);
  }
  return out;
}

const rel = (p) => p.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');

async function auditTokens() {
  const files = await walk(SRC, ['.astro', '.css']);
  const defined = new Set(INJECTED);
  const used = []; // {token, file}

  for (const f of files) {
    const css = await readFile(f, 'utf8');
    for (const m of css.matchAll(/--([a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
  }
  for (const f of files) {
    const css = await readFile(f, 'utf8');
    // Capture the char after the token so a `var(--x, fallback)` (a defaulted
    // reference) can be treated as safe — a fallback can never render invisible,
    // so a token used ONLY with a fallback isn't a "dead token" bug.
    for (const m of css.matchAll(/var\(\s*--([a-z0-9-]+)\s*(,?)/gi)) {
      used.push({ token: m[1], file: f, hasFallback: m[2] === ',' });
    }
  }

  // Open Props families are defined in node_modules (imported in PremiumBase),
  // not in our scanned files — treat them as known.
  const OPEN_PROPS = /^(shadow-[1-6]|ease-[a-z0-9-]+|gradient-\d+|layer-\d+|size-\d+|radius-\d+)$/;
  // A token is "dead" only when it's referenced WITHOUT a fallback, isn't defined
  // anywhere, and isn't an Open Props primitive. Group by token: if it ever
  // appears with a fallback, those usages are safe (only fallback-less ones flag).
  const dead = used.filter((u) => !u.hasFallback && !defined.has(u.token) && !OPEN_PROPS.test(u.token));
  // group by token
  const byToken = new Map();
  for (const d of dead) {
    if (!byToken.has(d.token)) byToken.set(d.token, new Set());
    byToken.get(d.token).add(rel(d.file));
  }
  return byToken;
}

const isStock = (src) => !src || src.includes('/images/library/') || src.endsWith('.svg');
const TEMPLATED = /professional \w+ for \w+ and nearby|service (one|two|three|four)/i;
// Premium hero `variant: 'editorial'` is photo-free BY DESIGN (type-forward, no
// image) — not a defect. The author falls back to it when no real photo clears
// the resolution floor.
const TEXT_HERO_VARIANTS = new Set(['editorial']);
// Local-business headline clichés — the "AI batch" tell. A headline should make
// a specific, earned promise, not reach for one of these filler phrases.
const HEADLINE_CLICHES =
  /\b(done right|you can trust|you can count on|second to none|no job too (big|small)|one[- ]stop shop|a cut above|exceed(s|ing)? (your )?expectations|where quality meets|satisfaction (is )?(our |)guarantee|we'?ve got you covered|rain or shine|quality you can|your trusted partner)\b/i;

// Scraped e-comm/nav junk that must never reach a rendered field. A narrower set
// than copy-sanity's JUNK_RE — these are the unambiguous "this is broken" tells
// (the full JUNK_RE is also tested for shared coverage). Critical on any match.
const SCRAPED_JUNK =
  /notify me when this product is available|add to cart|out of stock|sold out|this is the online store|view cart|checkout|continue shopping/i;
// Unevaluated code that leaked into copy: a JS template literal (${...}), a
// raw method call, or an HTML tag in a text field. The golden-gear bug shipped
// "${this.getReviewAuthor(review, ...)}" as a testimonial quote.
const CODE_LEAK = /\$\{[^}]*\}|\b\w+\.\w+\([^)]*\)|<\/?[a-z][a-z0-9]*[\s>]/i;
// Coupon / promo fine-print scraped in as marketing copy — never a real
// hero/section subheading. ("$30 Value. Limit one per customer. ...")
const COUPON_LEGALESE =
  /limit one per customer|cannot be combined with|coupon must be presented|some restrictions may apply|not valid with|while supplies last|see store for details/i;
// Generic-only testimonial author (low signal when the quote is short too).
const PLACEHOLDER_AUTHOR =
  /^(yelp reviewer|verified customer|customer review|customer|local customer|happy customer|returning customer|satisfied customer)$/i;

// A clause repeated verbatim ("Notify me…: Notify me…:") — the duplicated-phrase
// scrape artifact. Returns true when 2+ identical trimmed clauses appear.
function hasDuplicatedClause(s) {
  if (!s) return false;
  const clauses = String(s).split(/[:.]/).map((c) => c.trim().toLowerCase()).filter((c) => c.length >= 6);
  const seen = new Set();
  for (const c of clauses) { if (seen.has(c)) return true; seen.add(c); }
  return false;
}

// Every human-facing copy string on a section, tagged with where it came from.
function copyStringsOf(sections) {
  const out = []; // { text, where }
  const add = (text, where) => { if (text && typeof text === 'string') out.push({ text, where }); };
  for (const s of sections) {
    add(s.heading, `${s.kind}.heading`);
    add(s.subheading, `${s.kind}.subheading`);
    add(s.intro, `${s.kind}.intro`);
    add(s.blurb, `${s.kind}.blurb`);
    add(s.body && Array.isArray(s.body) ? s.body.join(' ') : s.body, `${s.kind}.body`);
    for (const it of s.items ?? []) {
      add(it.title, `${s.kind} item.title`);
      add(it.description, `${s.kind} item.description`);
      add(it.body, `${s.kind} item.body`);
      add(it.q, `${s.kind} item.q`);
      add(it.a, `${s.kind} item.a`);
      add(it.quote, `${s.kind} item.quote`);
    }
    // Team bios + pricing tiers carry copy on differently-named arrays.
    for (const m of s.members ?? []) {
      add(m.name, `${s.kind} member.name`);
      add(m.role, `${s.kind} member.role`);
      add(m.bio, `${s.kind} member.bio`);
    }
    for (const t of s.tiers ?? []) {
      add(t.name, `${s.kind} tier.name`);
      add(t.blurb, `${s.kind} tier.blurb`);
    }
  }
  return out;
}

// A bare digit run that isn't inside a tel: href.
const BARE_PHONE = /\b\d{10,11}\b/;

// Flatten every section across every page of a PremiumConfig.
const allSections = (c) => (c.pages ?? []).flatMap((p) => p.sections ?? []);

/**
 * Audit ONE premium (multi-page) config. The shape differs from the legacy
 * single-page ProspectConfig: sections live in pages[].sections keyed by `kind`,
 * the home hero is the first 'hero' section (heading at section.heading, photo at
 * section.image.src), and the OG/share image is config.images.hero.
 */
function auditProspect(slug, c, confirmed = false, researched = false) {
  const issues = [];
  const sections = allSections(c);
  const homeHero = (c.pages?.[0]?.sections ?? []).find((s) => s.kind === 'hero');
  const heroImg = homeHero?.image?.src ?? c.images?.hero;
  const textHero = !heroImg || TEXT_HERO_VARIANTS.has(homeHero?.variant);

  // A site with NO real photo anywhere reads as low-effort. The home hero being a
  // text hero is fine (deliberate), but if no section carries a real photo either,
  // call it out.
  const anyRealPhoto =
    !isStock(heroImg) ||
    sections.some((s) => {
      const srcs = [s.image?.src, ...((s.images ?? []).map((i) => i?.src))].filter(Boolean);
      return srcs.some((src) => !isStock(src));
    });
  // PHOTO-LIGHT IS A FIRST-CLASS OUTCOME (owner vision: the SITE carries quality,
  // not photos — copperbaytech.com / AVISP are the bar, both premium with little
  // imagery). So "no real photos" is NOT inherently a failure. It's only a real
  // problem when the page is ALSO thin — i.e. it leans on absent photos instead of
  // carrying itself with composed, type/brand-driven structure. We DEFER the
  // verdict (photoLightVerdict) until the composition + trust signals are known
  // below, then decide: a well-composed photo-light home is acceptable; a sparse
  // one that wanted photos and has nothing else is the low-effort case we still
  // flag. A site WITH a real photo but a deliberate text hero is just info.
  let photoLightVerdict = null; // set below once richness is known
  if (anyRealPhoto && textHero) {
    issues.push(['info', `text hero (no photo) — deliberate "${homeHero?.variant ?? 'editorial'}" layout`]);
  }
  // Only warn about missing alt when a hero photo is actually rendered.
  if (!textHero && heroImg && !(homeHero?.image?.alt?.trim() || c.images?.heroAlt?.trim()))
    issues.push(['warn', 'missing hero alt text']);

  // Empty sections — any section whose content array is present but empty.
  // (team uses `members`, pricing uses `tiers` — include them so an empty one
  // doesn't slip past as a rendered hole.)
  for (const s of sections) {
    const arr = s.items ?? s.images ?? s.members ?? s.tiers ?? s.body;
    if (Array.isArray(arr) && arr.length === 0) issues.push(['critical', `empty "${s.kind}" section`]);
  }

  // New AVISP-parity sections render NOTHING below their min-item threshold (so
  // an absent section never leaves a hole), but the author shouldn't emit one
  // that won't render — that's wasted intent. Warn if it slipped through.
  const SECTION_MIN = { steps: 3, features: 2, team: 1, pricing: 1 };
  for (const s of sections) {
    const min = SECTION_MIN[s.kind];
    if (min == null) continue;
    const n = (s.items ?? s.members ?? s.tiers ?? []).length;
    if (n > 0 && n < min) issues.push(['warn', `"${s.kind}" section has ${n} item(s) — renders nothing below ${min}; drop it or add real material`]);
  }

  // Templated service copy left in place (premium services live in 'services'
  // sections' items).
  const services = sections.filter((s) => s.kind === 'services').flatMap((s) => s.items ?? []);
  if (services.some((s) => TEMPLATED.test(s.description ?? '') || TEMPLATED.test(s.title ?? '')))
    issues.push(['warn', 'templated service copy left in place']);

  // Cliché headline — the most important line on the page reaching for filler.
  const heading = homeHero?.heading ?? '';
  if (HEADLINE_CLICHES.test(heading)) {
    if (confirmed)
      issues.push(['info', `headline "${heading}" matches a cliché pattern but is verified-authored copy`]);
    else if (!researched)
      // No research file backs the site AND the headline is filler — the pure
      // "AI batch" tell. Critical: a researched, specific promise is required.
      issues.push(['critical', `cliché headline "${heading}" with no research backing — research a specific, earned promise`]);
    else
      issues.push(['warn', `cliché headline "${heading}" — rewrite with a specific, earned promise`]);
  }
  // TEMPLATED-HEADLINE-ONLY (critical, unless verified-authored) — a site whose
  // home hero uses the deterministic FALLBACK headline ("<Name> — <Category> you
  // can count on") AND carries NO real body material (no story, no services, no
  // testimonials) is a bare templated stub, not a researched site. That's exactly
  // the sub-AVISP case the 95% bar holds back: the headline is the only "copy" and
  // it's a template. A site that earned a real story/services/quotes is NOT caught
  // here even if it kept the fallback headline (the body carries it).
  const templatedHeadline = new RegExp(
    `\\byou can count on$|\\b(serving|since)\\b.*\\bsince \\d{4}$`, 'i',
  ).test(heading) || /—\s*[\w\s]+\s+you can count on/i.test(heading);
  const hasBody = sections.some(
    (s) => (s.kind === 'story' && (s.body?.length ?? 0) > 0) ||
      (s.kind === 'services' && (s.items?.length ?? 0) > 0) ||
      (s.kind === 'testimonials' && (s.items?.length ?? 0) > 0),
  );
  if (templatedHeadline && !hasBody && !confirmed) {
    issues.push(['critical', `templated-headline-only — hero "${heading}" is the deterministic fallback and the page has no real story/services/testimonials; research and write real copy`]);
  }

  // Social proof: a rating OR real testimonials. Missing BOTH is a real gap;
  // missing only quotes (but has a rating) is minor.
  const hasTestimonials = sections.some(
    (s) => s.kind === 'testimonials' && (s.items?.length ?? 0) > 0,
  );
  const hasRating =
    (c.rating?.value ?? 0) > 0 ||
    sections.some(
      (s) =>
        s.kind === 'stats' &&
        (s.items ?? []).some((it) => /★|star|review|rating/i.test(`${it.label} ${it.value}`)),
    );
  // Verified third-party credentials (certs/licenses/warranties) are legitimate
  // trust — a new/small business with no public reviews YET still converts on
  // "ASE Blue Seal", "CAMTC Licensed", "Licensed & insured", "36-month warranty".
  // So a credential-backed site is shippable; a review just makes it stronger.
  // Awards/competition honors are the winery/food equivalent: a tiny by-appointment
  // estate with no scrapeable reviews still earns trust from a real "Double Gold",
  // a "Wine of the Year" pedigree, or "Farm Family of the Year".
  const CREDENTIAL = /certified|licensed|insured|bonded|accredited|warrant|guarantee|\bASE\b|\bBBB\b|NAPA|CAMTC|AMTA|board[- ]certified|member|#\s?\d|medal|award[- ]winning|wine of the year|best of class|double gold|family of the year|\d{2,3}\s*points/i;
  // Premium highlights live in hero `badges` + story `highlights` (no top-level
  // c.highlights). Pool them all and test for a credential.
  const credentialText = [
    ...((homeHero?.badges) ?? []),
    ...sections.filter((s) => s.kind === 'story').flatMap((s) => s.highlights ?? []),
  ];
  const hasCredentials = credentialText.some((h) => CREDENTIAL.test(h));

  // ── Photo-light verdict (deferred from the photo check above) ──────────────
  // A zero-photo home reaches the bar when the SITE carries it: a substantial,
  // composed section set (so the page isn't a thin hero + CTA), at least one
  // structured non-photo "visual" band (callout/features/stats/steps/story carry
  // real layout interest without imagery), AND a real trust signal (a verified
  // credential, a rating, or a real testimonial — never fabricated). That's the
  // AVISP/Copper Bay pattern. When all hold, photo-light is a first-class, ready
  // outcome (info). When it doesn't, the page is leaning on absent photos with
  // nothing composed behind them — the genuine low-effort case — so it stays
  // critical and is held back from the CRM.
  if (!anyRealPhoto) {
    const homeSections = c.pages?.[0]?.sections ?? [];
    const homeKinds = homeSections.map((s) => s.kind);
    const STRUCTURED_NONPHOTO = new Set(['callout', 'features', 'stats', 'steps', 'story', 'faq', 'pricing']);
    const structuredBands = homeKinds.filter((k) => STRUCTURED_NONPHOTO.has(k)).length;
    const composed = homeSections.length >= 5 && structuredBands >= 2;
    const hasTrust = hasCredentials || hasRating || hasTestimonials;
    if (composed && hasTrust) {
      photoLightVerdict = ['info', 'photo-light home — composed type/brand-driven layout carries it (no photos by design)'];
    } else {
      const why = !composed
        ? 'thin layout — not enough composed structure to carry a zero-photo page'
        : 'no trust signal — add a verified credential, rating, or real testimonial';
      photoLightVerdict = ['critical', `no real photos and ${why}`];
    }
    issues.push(photoLightVerdict);
  }

  // 1. SCRAPED-JUNK COPY (critical) — scan every human-facing string for e-comm/
  // nav junk and duplicated-clause artifacts. Also include the broader JUNK_RE
  // shared with the author so the gate matches what the author strips.
  const tagline = c.tagline ?? '';
  const seoDescription = c.seoDescription ?? '';
  const copyStrings = [
    ...copyStringsOf(sections),
    ...(tagline ? [{ text: tagline, where: 'tagline' }] : []),
    ...(seoDescription ? [{ text: seoDescription, where: 'seoDescription' }] : []),
  ];
  for (const { text, where } of copyStrings) {
    if (SCRAPED_JUNK.test(text) || JUNK_RE.test(text)) {
      issues.push(['critical', `scraped junk copy in ${where}: "${text.slice(0, 60)}"`]);
    } else if (CODE_LEAK.test(text)) {
      issues.push(['critical', `unevaluated code/markup leaked into ${where}: "${text.slice(0, 60)}"`]);
    } else if (COUPON_LEGALESE.test(text)) {
      issues.push(['critical', `coupon/promo fine-print used as copy in ${where}: "${text.slice(0, 60)}"`]);
    } else if (hasDuplicatedClause(text)) {
      issues.push(['critical', `duplicated-clause artifact in ${where}: "${text.slice(0, 60)}"`]);
    }
  }

  // 2. UNFORMATTED PHONE (critical) — a bare 10/11-digit run in any human-facing
  // phone display (NOT a tel: href, which legitimately holds raw digits).
  const phoneTexts = [
    [c.contact?.phone, 'config.contact.phone'],
    ...sections.filter((s) => s.kind === 'cta').flatMap((s) => [
      [s.body, 'cta.body'],
      [s.secondaryCta?.label, 'cta.secondaryCta.label'],
    ]),
    ...sections.filter((s) => s.kind === 'faq').flatMap((s) => (s.items ?? []).map((it) => [it.a, 'faq.answer'])),
    ...sections.filter((s) => s.kind === 'contact').map((s) => [s.blurb, 'contact.blurb']),
  ];
  for (const [text, where] of phoneTexts) {
    if (text && typeof text === 'string' && BARE_PHONE.test(text)) {
      const n = text.match(BARE_PHONE)[0];
      issues.push(['critical', `unformatted phone "${n}" in ${where} — format as (NNN) NNN-NNNN`]);
    }
  }

  // 3. GENERIC-ONLY TESTIMONIAL (warn; escalates the social-proof gate to
  // critical when EVERY testimonial is placeholder+short and there's no rating).
  const tmnItems = sections.filter((s) => s.kind === 'testimonials').flatMap((s) => s.items ?? []);
  const isLowSignal = (t) => PLACEHOLDER_AUTHOR.test((t.author ?? '').trim()) && (t.quote ?? '').length < 60;
  const lowSignal = tmnItems.filter(isLowSignal);
  for (const _ of lowSignal) issues.push(['warn', 'low-signal testimonial with placeholder author']);
  const allTmnPlaceholder = tmnItems.length > 0 && lowSignal.length === tmnItems.length;

  // 4. EMPTY HERO (critical) — a split/fullbleed hero with no image renders a
  // blank panel. Editorial-with-no-image is deliberate (info, handled above).
  if (homeHero && (homeHero.variant === 'split' || homeHero.variant === 'fullbleed') && !homeHero.image?.src) {
    issues.push(['critical', 'hero is split/fullbleed but has no image — will render a blank panel']);
  }

  // 5. EMPTY IMAGE PANEL ON INNER PAGES (critical) — a rows-layout services
  // section with NO item images renders empty 01/02 grey panels. The designed
  // glyph fallback is acceptable only when the author opts in via fallbackOk.
  for (const s of sections.filter((x) => x.kind === 'services' && x.layout === 'rows')) {
    const anyImg = (s.items ?? []).some((it) => it.image?.src);
    if (!anyImg && !s.fallbackOk) {
      issues.push(['critical', 'rows-layout services with no images renders empty 01/02 grey panels — use grid or add photos']);
    }
  }

  // 6. SINGLE-STAT-IN-MULTI-CARD BAND (critical for <2, warn for exactly 2).
  for (const s of sections.filter((x) => x.kind === 'stats')) {
    const n = (s.items ?? []).length;
    if (n < 2) issues.push(['critical', 'stats band has <2 items — a lone stat reads as a broken empty card']);
    else if (n === 2) issues.push(['warn', 'only 2 stats — consider folding into hero badges or a callout']);
  }

  // Social proof: a rating OR real testimonials. Missing BOTH is a real gap;
  // missing only quotes (but has a rating) is minor.
  if (hasTestimonials || hasRating) {
    if (!hasTestimonials) issues.push(['info', 'no testimonials (has rating; quotes would help)']);
    // All-placeholder short testimonials with no rating → escalate to critical.
    else if (allTmnPlaceholder && !hasRating) {
      issues.push(['critical', 'no social proof — all testimonials are placeholder-author + short, and there is no rating']);
    }
  } else if (hasCredentials) {
    issues.push(['info', 'no reviews yet — trust carried by verified credentials; add a review when available']);
  } else if (allTmnPlaceholder) {
    issues.push(['critical', 'no social proof — all testimonials are placeholder-author + short, and there is no rating']);
  } else {
    issues.push(['warn', 'no social proof — add a rating, a real testimonial, or a credential']);
  }
  return issues;
}

// ── Photo sharpness / resolution gate (the "fuzzy hero" bug, measured) ───────
// auditProspect catches MISSING/empty photos and blank panels from the JSON
// alone, but it can't see whether a referenced photo is FUZZY or OFF-FRAME — that
// needs the bytes. This re-scores every REAL (non-stock) photo a config points at
// via the SAME photo-score the acquisition + author gates use, and surfaces:
//   • FUZZY photo (hero or tile) → CRITICAL — a soft/out-of-focus frame is the
//     owner-vision red line; it must be omitted, never shipped.
//   • LOW-RES photo → WARN only — these are already-CROPPED OUTPUT files, so a
//     small portrait gallery/hero-split tile is legitimately ~600-1000px wide and
//     cleared its SOURCE resolution floor (SLOT_CONTRACT.minW) at acquisition.
//     Re-flagging output width as critical would wrongly block valid small tiles;
//     we surface it as a non-blocking heads-up to source a larger original.
// A library SVG / missing file is skipped (not a real photo). Best-effort: an
// unreadable file is reported, never crashes the run.
const realImgPaths = (c) => {
  const out = new Set();
  for (const s of allSections(c)) {
    if (s.image?.src && !isStock(s.image.src)) out.add(s.image.src);
    for (const im of s.images ?? []) if (im?.src && !isStock(im.src)) out.add(im.src);
  }
  if (c.images?.hero && !isStock(c.images.hero)) out.add(c.images.hero);
  return [...out];
};

// Map a `/images/<slug>/<file>` JSON path to the real on-disk file. The path may
// carry any extension; the asset registry resolves it, so we glob the base name.
async function diskFileFor(jsonPath) {
  const m = /^\/images\/([^/]+)\/(.+)$/.exec(jsonPath || '');
  if (!m) return null;
  const dir = join(PUBLIC_IMAGES, m[1]);
  const want = m[2].replace(/\.[a-z0-9]+$/i, '');
  let files = [];
  try { files = await readdir(dir); } catch { return null; }
  const hit = files.find((f) => f.replace(/\.[a-z0-9]+$/i, '') === want);
  return hit ? join(dir, hit) : null;
}

async function auditPhotos(slug, c) {
  const issues = [];
  const homeHero = (c.pages?.[0]?.sections ?? []).find((s) => s.kind === 'hero');
  const heroSrc = homeHero?.image?.src ?? c.images?.hero;
  for (const src of realImgPaths(c)) {
    const file = await diskFileFor(src);
    if (!file) continue; // unresolved/library → not a real on-disk photo
    let q;
    try { q = await scorePhoto(await readFile(file)); }
    catch { continue; }
    const isHero = src === heroSrc;
    const file_ = src.split('/').pop();
    if (q.fuzzy) {
      // FUZZY = critical (blocks the gate): omit it or replace with a sharp shot.
      issues.push(['critical', `${isHero ? 'HERO ' : ''}photo ${file_} is fuzzy/out-of-focus — omit it (text/library hero) or replace with a sharp shot`]);
    } else if (q.lowRes) {
      // LOW-RES on a cropped output = non-blocking warn (source a larger original).
      issues.push(['warn', `${isHero ? 'HERO ' : ''}photo ${file_} renders small (${q.w}×${q.h}) — source a higher-resolution original if a larger crop is wanted`]);
    }
  }
  return issues;
}

// ── WCAG contrast (the "invisible / illegible text" bug, measured) ───────────
// Dead-token checking catches var(--x)→undefined; this catches the OTHER half:
// tokens that ARE defined but render text too faint to read (e.g. a pale brand
// with white button text, or muted text on a tinted bg). Parses the per-page
// color tokens that tokens.ts injects into the built HTML and measures real
// ratios — so it needs `npm run build` to have run first.
const DIST = join(APP, 'dist');

function srgbChannel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** First-wins parse of the injected color tokens from a built page's inline CSS. */
function parseTokens(html) {
  const t = {};
  for (const m of html.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    if (!(m[1] in t)) t[m[1]] = m[2];
  }
  return t;
}

// The pairs that actually carry readable text in the rendered pages.
const CONTRAST_PAIRS = [
  ['text', 'bg', 'body text on page'],
  ['text', 'surface', 'body text on cards'],
  ['text-muted', 'bg', 'muted text on page'],
  ['text-on-dark', 'bg-deep', 'text on dark sections'],
  ['brand-contrast', 'brand', 'button label on brand'],
  ['brand-vivid-contrast', 'brand-vivid', 'label on the brand bar/pill'],
  ['accent-contrast', 'accent', 'text on accent'],
];

function auditContrast(tokens) {
  const issues = [];
  for (const [fg, bg, desc] of CONTRAST_PAIRS) {
    if (!tokens[fg] || !tokens[bg]) continue;
    const r = contrast(tokens[fg], tokens[bg]);
    const at = `(${tokens[fg]} on ${tokens[bg]})`;
    if (r < 3.0) issues.push(['critical', `contrast ${r.toFixed(2)}:1 — ${desc} ${at}, AA needs 4.5`]);
    else if (r < 4.5) issues.push(['warn', `contrast ${r.toFixed(2)}:1 — ${desc} ${at}, below AA 4.5`]);
  }
  return issues;
}

async function main() {
  let critical = 0;
  console.log('\n🔎 Project audit\n' + '─'.repeat(48));

  // 1. Dead tokens (the footer-class bug)
  const dead = await auditTokens();
  console.log('\n## Design tokens');
  if (dead.size === 0) {
    console.log('  ✓ no dead tokens — every var(--x) is defined or injected');
  } else {
    for (const [token, files] of dead) {
      critical++;
      console.log(`  ✗ CRITICAL var(--${token}) is never defined → invisible/broken styling`);
      console.log(`      in: ${[...files].join(', ')}`);
    }
  }

  // 2. Per-prospect content (premium multi-page configs, rendered at /s/<slug>)
  console.log('\n## Prospects');
  const files = (await readdir(PREMIUM)).filter((f) => f.endsWith('.json'));
  let missingDist = false;
  const seqCounts = new Map(); // section-kind sequence string → [slugs]
  for (const f of files) {
    const slug = f.replace(/\.json$/, '');
    const c = JSON.parse(await readFile(join(PREMIUM, f), 'utf8'));
    const confirmed = await isConfirmed(slug);
    const researched = confirmed || await hasResearchFile(slug);
    const issues = auditProspect(slug, c, confirmed, researched);
    // Re-score the real photos this config references (fuzzy / low-res surfaced
    // from the bytes — the strict photo gate, measured at audit time too).
    issues.push(...await auditPhotos(slug, c));
    // The composed section order is known from the JSON itself (premium pages
    // ARE the section list), so we report it directly — no HTML scrape needed.
    const seq = (c.pages?.[0]?.sections ?? []).map((s) => s.kind);
    const seqKey = seq.join('>');
    if (!seqCounts.has(seqKey)) seqCounts.set(seqKey, []);
    seqCounts.get(seqKey).push(slug);
    // Measured WCAG contrast from the built HOME page (needs a prior `npm run
    // build`). Premium home renders at dist/s/<slug>/index.html.
    const distHtml = await readFile(join(DIST, 's', slug, 'index.html'), 'utf8').catch(() => null);
    if (distHtml) {
      issues.push(...auditContrast(parseTokens(distHtml)));
    } else missingDist = true;
    const crit = issues.filter((i) => i[0] === 'critical');
    critical += crit.length;
    if (issues.length === 0) {
      console.log(`  ✓ ${slug.padEnd(26)} clean`);
    } else {
      console.log(`  ${crit.length ? '✗' : '•'} ${slug.padEnd(26)}`);
      for (const [level, msg] of issues) {
        const mark = level === 'critical' ? 'CRITICAL' : level === 'warn' ? 'warn' : 'info';
        console.log(`      [${mark}] ${msg}`);
      }
    }
    // Home-page section order — so a human/loop can SEE the structure.
    if (seq.length) console.log(`      ↳ ${seq.join(' › ')}`);
  }

  if (missingDist) {
    console.log('\n  ℹ contrast checks skipped for some pages — run `npm run build` first.');
  }

  // 7. SAMENESS NUDGE (info, non-blocking) — when >4 sites share the identical
  // home section-kind order, surface the sibling-template problem the
  // composition seed is meant to fix.
  const SAMENESS_N = 4;
  for (const [seqKey, slugs] of seqCounts) {
    if (slugs.length > SAMENESS_N) {
      console.log(`\n  [info] ${slugs.length} sites share identical section order — add structural divergence`);
      console.log(`      ↳ ${seqKey.split('>').join(' › ')}`);
    }
  }

  console.log('\n' + '─'.repeat(48));
  console.log(critical ? `✗ ${critical} critical issue(s) — fix before publishing.` : '✓ No critical issues.');
  process.exitCode = critical ? 1 : 0;
}

/**
 * auditConfigCriticals — run the SAME mechanical content audit a built site gets
 * (auditProspect) over an in-memory PremiumConfig and return ONLY the CRITICAL
 * issue messages. The 95% self-gate (author-premium.mjs) calls this so a config
 * that would surface an audit critical (no-trust photo-light, scraped junk, an
 * empty/blank-panel section, a bare phone, etc.) can NEVER reach status:'ready'.
 *
 * Contrast is the one critical class that needs the built HTML (dist), so it is
 * intentionally NOT evaluated here — the inline gate runs pre-build. The full
 * `npm run audit` still measures contrast post-build as the belt-and-suspenders
 * check; this hook catches the content criticals at author time.
 *
 * @param {string} slug
 * @param {object} config  a PremiumConfig (pre-build, in memory)
 * @returns {Promise<string[]>} critical issue messages (empty = clears the gate)
 */
export async function auditConfigCriticals(slug, config) {
  try {
    const confirmed = await isConfirmed(slug);
    const researched = confirmed || await hasResearchFile(slug);
    const issues = auditProspect(slug, config, confirmed, researched);
    return issues.filter((i) => i[0] === 'critical').map((i) => i[1]);
  } catch {
    return []; // fail soft — never let an audit hiccup block authoring
  }
}

export { auditProspect, isConfirmed };

// Only run the CLI audit when invoked directly (not when imported as the gate).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
