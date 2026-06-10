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
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'sites', 'demo-gallery');
const SRC = join(APP, 'src');
const PROSPECTS = join(SRC, 'data', 'prospects');

// Tokens injected at runtime by tokens.ts (artDirectionToCss) — always present.
const INJECTED = new Set([
  'brand','brand-dark','brand-contrast','accent','accent-contrast','bg','bg-alt','bg-deep',
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
    for (const m of css.matchAll(/var\(\s*--([a-z0-9-]+)/gi)) used.push({ token: m[1], file: f });
  }

  // Open Props families are defined in node_modules (imported in BaseLayout), not
  // in our scanned files — treat them as known.
  const OPEN_PROPS = /^(shadow-[1-6]|ease-[a-z0-9-]+|gradient-\d+|layer-\d+|size-\d+|radius-\d+)$/;
  const dead = used.filter((u) => !defined.has(u.token) && !OPEN_PROPS.test(u.token));
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
// Text-forward hero variants are photo-free BY DESIGN (huge type, no image) —
// not a defect. pickHero()/divergence fall back to these when no real photo
// exists; editorial-asym collapses to a full-width type column without one.
const TEXT_HEROES = new Set(['statement', 'editorial', 'panel', 'typographic', 'editorial-asym']);
// Local-business headline clichés — the "AI batch" tell. A headline should make
// a specific, earned promise, not reach for one of these filler phrases.
const HEADLINE_CLICHES =
  /\b(done right|you can trust|second to none|no job too (big|small)|one[- ]stop shop|a cut above|exceed(s|ing)? (your )?expectations|where quality meets|satisfaction (is )?(our |)guarantee|we'?ve got you covered|rain or shine|quality you can|your trusted partner)\b/i;

function auditProspect(slug, c) {
  const issues = [];
  const textHero = TEXT_HEROES.has(c.heroVariant);
  if (isStock(c.images?.hero)) {
    if (textHero) {
      // Intentional text hero (e.g. honest placeholder, or a business with no
      // congruent real photo). Looks deliberate, not slop — just note it.
      issues.push(['info', `text hero (no photo) — deliberate "${c.heroVariant}" layout`]);
    } else {
      issues.push(['critical', 'hero is stock/SVG art (no real photo)']);
    }
  }
  // Only warn about missing alt when a hero photo is actually rendered.
  if (!textHero && c.images?.hero && !c.images?.heroAlt?.trim())
    issues.push(['warn', 'missing hero alt text']);
  for (const s of c.sections ?? []) {
    const arr = s.items ?? s.rows ?? s.groups ?? s.steps ?? s.members ?? s.areas ?? s.images;
    if (Array.isArray(arr) && arr.length === 0) issues.push(['critical', `empty "${s.type}" section`]);
  }
  if ((c.services ?? []).some((s) => TEMPLATED.test(s.description ?? '') || TEMPLATED.test(s.title ?? '')))
    issues.push(['warn', 'templated service copy left in place']);
  // Cliché headline — the most important line on the page reaching for filler.
  const heading = c.hero?.heading ?? '';
  if (HEADLINE_CLICHES.test(heading))
    issues.push(['warn', `cliché headline "${heading}" — rewrite with a specific, earned promise`]);
  // Social proof: a rating OR real testimonials. Missing BOTH is a real gap
  // (93% of buyers weigh reviews); missing only quotes (but has a rating) is minor.
  const hasTestimonials = (c.sections ?? []).some(
    (s) => s.type === 'testimonials' && (s.items?.length ?? 0) > 0,
  );
  const hasRating =
    (c.rating?.count ?? 0) > 0 ||
    (c.sections ?? []).some(
      (s) =>
        s.type === 'stats' &&
        (s.items ?? []).some((it) => /★|star|review|rating/i.test(`${it.label} ${it.value}`)),
    );
  if (!hasTestimonials && !hasRating)
    issues.push(['warn', 'no social proof — add a rating or a real testimonial before sending']);
  else if (!hasTestimonials) issues.push(['info', 'no testimonials (has rating; quotes would help)']);
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
  ['accent-contrast', 'accent', 'text on accent'],
];

// ── Duplicate sections (the bug audit.mjs was blind to) ──────────────────────
// The config-level checks above can't see the COMPOSED page, so a duplicate
// section produced at compose-time (e.g. a mid-page CTA on top of the closing
// CTA → two identical banners) shipped undetected. This parses the built page's
// section wrappers (`class="section <token>"`) and maps each variant token back
// to its logical family, so a repeated family is caught regardless of variant.
const SECTION_FAMILY = {
  svc: 'services-detailed', svcrows: 'services-detailed', bento: 'services-detailed',
  fg: 'feature-grid', fgb: 'feature-grid',
  'stats-section': 'stats', 'stats-band': 'stats', 'stats-inline': 'stats',
  faq: 'faq', faqa: 'faq',
  fs: 'feature-split', fsf: 'feature-split',
  gallery: 'gallery', gu: 'gallery', gf: 'gallery',
  tms: 'testimonials', tmsl: 'testimonials',
  'cta-band': 'cta', ctapanel: 'cta', ctabanner: 'cta',
  // cta-inline is a DISTINCT family — one slim mid-page nudge + one closing
  // banner is intentional, not a duplicate. Two of either still flags.
  ctainline: 'cta-inline',
};

function auditComposedDupes(html) {
  const counts = {};
  for (const m of html.matchAll(/class="section ([a-z0-9-]+)/g)) {
    const fam = SECTION_FAMILY[m[1]];
    if (fam) counts[fam] = (counts[fam] ?? 0) + 1;
  }
  const issues = [];
  for (const [fam, n] of Object.entries(counts)) {
    if (n > 1) issues.push(['critical', `duplicate "${fam}" section ×${n} on the page (composed twice)`]);
  }
  return issues;
}

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

  // 2. Per-prospect content
  console.log('\n## Prospects');
  const files = (await readdir(PROSPECTS)).filter((f) => f.endsWith('.json'));
  let missingDist = false;
  for (const f of files) {
    const slug = f.replace(/\.json$/, '');
    const c = JSON.parse(await readFile(join(PROSPECTS, f), 'utf8'));
    const issues = auditProspect(slug, c);
    // Measured WCAG contrast from the built page (needs a prior `npm run build`).
    const distHtml = await readFile(join(DIST, 'p', slug, 'index.html'), 'utf8').catch(() => null);
    if (distHtml) {
      issues.push(...auditComposedDupes(distHtml));
      issues.push(...auditContrast(parseTokens(distHtml)));
    } else missingDist = true;
    const crit = issues.filter((i) => i[0] === 'critical');
    critical += crit.length;
    if (issues.length === 0) {
      console.log(`  ✓ ${f.replace(/\.json$/, '').padEnd(26)} clean`);
    } else {
      console.log(`  ${crit.length ? '✗' : '•'} ${f.replace(/\.json$/, '').padEnd(26)}`);
      for (const [level, msg] of issues) {
        const mark = level === 'critical' ? 'CRITICAL' : level === 'warn' ? 'warn' : 'info';
        console.log(`      [${mark}] ${msg}`);
      }
    }
  }

  if (missingDist) {
    console.log('\n  ℹ contrast checks skipped for some pages — run `npm run build` first.');
  }

  console.log('\n' + '─'.repeat(48));
  console.log(critical ? `✗ ${critical} critical issue(s) — fix before publishing.` : '✓ No critical issues.');
  process.exitCode = critical ? 1 : 0;
}

main();
