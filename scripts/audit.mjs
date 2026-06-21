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
import { scanProspect, specificityScore } from './lib/copy-quality.mjs';

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

/**
 * Classify where a photo came from based on its stored path and optional
 * credit/source metadata baked into the prospect JSON.
 *
 * Categories:
 *   'business-scraped' — pulled directly off the business's own website
 *   'wikimedia'        — from Wikimedia Commons (scripts/lib/photos.mjs)
 *   'openverse'        — from WordPress Openverse
 *   'library'          — built-in SVG fallback (public/images/library/…)
 *   'unknown'          — a real image whose provenance isn't recorded
 */
function classifyPhotoSource(imagePath, images) {
  if (!imagePath || imagePath.includes('/images/library/') || imagePath.endsWith('.svg')) {
    return 'library';
  }
  // Explicit credit metadata written by the generator takes priority.
  const credit = images?.heroCredit ?? images?.heroSource ?? '';
  if (/wikimedia|commons\.wikimedia/i.test(credit)) return 'wikimedia';
  if (/openverse|wordpress/i.test(credit)) return 'openverse';
  // Path conventions written by scripts/lib/images.mjs and scrape-site.mjs:
  //   /images/<slug>/hero.* — downloaded from the business's own site
  //   /images/<slug>/wiki-* — Wikimedia fetch
  //   /images/<slug>/ov-*   — Openverse fetch
  if (/\/wiki-/.test(imagePath)) return 'wikimedia';
  if (/\/ov-/.test(imagePath)) return 'openverse';
  // Any real file under the prospects asset tree that isn't library or tagged
  // above is most likely a business-scraped photo.
  if (/\/images\/[^/]+\/(hero|story|photo)/.test(imagePath)) return 'business-scraped';
  return 'unknown';
}

const TEMPLATED = /professional \w+ for \w+ and nearby|service (one|two|three|four)/i;
// Text-forward hero variants are photo-free BY DESIGN (huge type, no image) —
// not a defect. pickHero() falls back to these when no real photo exists.
const TEXT_HEROES = new Set(['statement', 'editorial', 'panel']);

/**
 * Returns n-grams of length `n` from a whitespace-tokenised string.
 * Used for duplicate 5-gram detection across service descriptions.
 */
function ngrams(text, n) {
  const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i <= words.length - n; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Count words in text (simple whitespace split, ignoring empty tokens).
 */
function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * TRUE if `str` is a string field that appears to contain a raw undefined/null
 * or leaked object rendering — things that indicate the generator failed to
 * fill a field and the default serialisation leaked through.
 */
const GARBAGE_VALUE = /\bundefined\b|\bnull\b|\[object\s+\w+\]|\{[a-zA-Z_$][a-zA-Z0-9_$]*\s*\}/;

function auditProspect(slug, c) {
  const issues = [];
  const ready = c.status === 'ready';

  // ── SLOP GATE ────────────────────────────────────────────────────────────
  // Scan every customer-facing copy field for raw-meta boilerplate, truncated
  // sentences, leaked code, store/coupon UI text, and unresolved {TOKENS}. This
  // is the safety net that makes "did the agent get it right" automatic: a site
  // marked `status:"ready"` is a PROMISE it's send-able — so any slop on a ready
  // site is CRITICAL (it must never reach cold outreach). On a needs-review site
  // the same slop is a worklist item (warn) telling the agent exactly what to fix.
  const slop = scanProspect(c);
  // These categories are NEVER acceptable copy at any stage — block them even on
  // a needs-review site, so blatantly broken text can't slip out unflagged.
  const ALWAYS_CRITICAL = new Set(['lorem', 'code-leak', 'placeholder-token', 'ecommerce-boilerplate', 'placeholder-contact']);
  for (const f of slop) {
    const level = ready || ALWAYS_CRITICAL.has(f.id) ? 'critical' : 'warn';
    const snippet = f.text.length > 60 ? f.text.slice(0, 57) + '…' : f.text;
    issues.push([level, `slop in ${f.where}: ${f.msg} — "${snippet}"`]);
  }

  // ── COPY-QUALITY: HARD STRING CHECKS ─────────────────────────────────────
  // Walk every customer-facing string field looking for:
  //   1. Trailing "..." indicating a mid-sentence truncation the slop gate
  //      might not catch (e.g. a manually-entered field cut short).
  //   2. Values that serialise as "undefined", "null", "[object Object]", or
  //      a raw {variableName} — meaning the generator never filled the field.
  // These are always ERRORs because they look broken to any recipient.
  const stringFields = [
    ['tagline', c.tagline],
    ['seoDescription', c.seoDescription],
    ['hero.heading', c.hero?.heading],
    ['hero.subheading', c.hero?.subheading],
    ['about.headline', c.about?.headline],
    ...(c.about?.body ?? []).map((v, i) => [`about.body[${i}]`, v]),
    ...(c.services ?? []).flatMap((s, i) => [
      [`services[${i}].title`, s.title],
      [`services[${i}].description`, s.description],
    ]),
  ];
  for (const [where, val] of stringFields) {
    if (val == null) continue;
    const s = String(val);
    if (/\.{3}\s*$/.test(s)) {
      issues.push(['critical', `truncated field ${where}: ends with "…" — looks like a clipped meta value`]);
    }
    if (GARBAGE_VALUE.test(s)) {
      issues.push(['critical', `garbage value in ${where}: contains "undefined", "null", [object…], or {token} — field was never populated`]);
    }
  }

  // ── COPY-QUALITY: STRUCTURAL WARNINGS ────────────────────────────────────
  // hero.subheading > 220 chars — too long for a cold-outreach hero panel.
  const subheading = String(c.hero?.subheading ?? '');
  if (subheading.length > 220) {
    issues.push(['warn', `hero.subheading is ${subheading.length} chars (>220) — trim to a punchy one-liner for the fold`]);
  }

  // hero.heading < 4 words — probably an untouched placeholder.
  const headingWords = wordCount(c.hero?.heading);
  if (headingWords > 0 && headingWords < 4) {
    issues.push(['warn', `hero.heading is only ${headingWords} word(s) — too short; expand into a value proposition`]);
  }

  // service.description < 12 words — not enough context.
  for (const [i, s] of (c.services ?? []).entries()) {
    const wc = wordCount(s.description);
    if (s.description != null && wc < 12) {
      issues.push(['warn', `services[${i}].description is ${wc} words (<12) — expand so it reads like an agency wrote it`]);
    }
  }

  // 3+ service descriptions sharing a 5-gram → copy-paste / template filler.
  const serviceDescs = (c.services ?? []).map((s) => s.description ?? '');
  if (serviceDescs.length >= 3) {
    const gramCount = new Map();
    for (const [i, desc] of serviceDescs.entries()) {
      for (const gram of ngrams(desc, 5)) {
        if (!gramCount.has(gram)) gramCount.set(gram, new Set());
        gramCount.get(gram).add(i);
      }
    }
    const shared = [...gramCount.entries()].filter(([, idxs]) => idxs.size >= 3);
    if (shared.length > 0) {
      const example = shared[0][0];
      issues.push(['warn', `3+ service descriptions share a 5-gram ("${example}") — copy-paste detected; rewrite each service distinctly`]);
    }
  }

  // Specificity score on about body + service descriptions — low means generic.
  const knownFacts = [c.name, c.city, c.state, c.category].filter(Boolean);
  const aboutText = (c.about?.body ?? []).join(' ');
  if (aboutText.trim()) {
    const score = specificityScore(aboutText, knownFacts);
    if (score < 0.05) {
      issues.push(['warn', `about body has very low specificity (score ${score.toFixed(2)}) — add proper nouns, numbers, or named facts to ground the copy`]);
    }
  }
  const serviceText = (c.services ?? []).map((s) => `${s.title ?? ''} ${s.description ?? ''}`).join(' ');
  if (serviceText.trim()) {
    const score = specificityScore(serviceText, knownFacts);
    if (score < 0.05) {
      issues.push(['warn', `services copy has very low specificity (score ${score.toFixed(2)}) — name specific services, prices, or distinguishing details`]);
    }
  }

  // ── PHOTO SOURCE GATE ────────────────────────────────────────────────────
  // Classify the hero photo provenance and surface it in audit output. If the
  // image is a built-in library fallback, escalate needs-review to CRITICAL:
  // a site with library art is NOT ready to send as cold outreach — the whole
  // point of this pipeline is real photos.
  const heroPath = c.images?.hero ?? '';
  const photoSource = classifyPhotoSource(heroPath, c.images);
  issues.push(['info', `photo_source: ${photoSource}${photoSource === 'business-scraped' ? ' ✓' : ''}`]);

  const textHero = TEXT_HEROES.has(c.heroVariant);
  if (isStock(heroPath)) {
    if (textHero) {
      // Intentional text hero (e.g. honest placeholder, or a business with no
      // congruent real photo). Looks deliberate, not slop — just note it.
      issues.push(['info', `text hero (no photo) — deliberate "${c.heroVariant}" layout`]);
    } else if (ready) {
      issues.push(['critical', 'hero is stock/SVG library art — a site cannot be "ready" with no real photo; source a real image first']);
    } else {
      // needs-review: escalate to critical (blocks "ready" gate — library art
      // must be replaced before this site can ever be promoted to ready).
      issues.push(['critical', 'hero uses /images/library/ fallback art — replace with a real photo before marking ready (see CLAUDE.md photo-sourcing tiers)']);
    }
  }

  // Only warn about missing alt when a hero photo is actually rendered.
  if (!textHero && heroPath && !c.images?.heroAlt?.trim())
    issues.push(['warn', 'missing hero alt text']);
  for (const s of c.sections ?? []) {
    const arr = s.items ?? s.rows ?? s.groups ?? s.steps ?? s.members ?? s.areas ?? s.images;
    if (Array.isArray(arr) && arr.length === 0) issues.push(['critical', `empty "${s.type}" section`]);
  }
  if ((c.services ?? []).some((s) => TEMPLATED.test(s.description ?? '') || TEMPLATED.test(s.title ?? '')))
    issues.push([ready ? 'critical' : 'warn', 'templated service copy left in place']);
  if (!(c.sections ?? []).some((s) => s.type === 'testimonials')) issues.push(['info', 'no testimonials (trust signal)']);
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

/**
 * Read the canonical quality score per slug straight off the built dashboard
 * (index.astro emits data-slug/data-score/data-grade on each card). Reusing the
 * real scorer — score.ts — means the gate and the dashboard can never disagree.
 */
function parseDashboardScores(html) {
  const byslug = new Map();
  for (const m of html.matchAll(/data-slug="([^"]+)"[^>]*data-score="(\d+)"[^>]*data-grade="([A-F])"/g)) {
    byslug.set(m[1], { score: Number(m[2]), grade: m[3] });
  }
  return byslug;
}

// The bar for shipping: "ready" must mean A-grade. Below this, a site marked
// ready is lying about being send-able.
const READY_MIN_SCORE = 85;

/**
 * First-wins parse of the injected color tokens from a built page's inline CSS.
 * Hex values are stored as a string (measurable); a non-hex value (oklch/rgb/hsl,
 * e.g. from a tokens override) is stored as { nonHex } so the contrast check can
 * WARN that it couldn't measure the pair rather than skip it silently.
 */
function parseTokens(html) {
  const t = {};
  for (const m of html.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    if (name in t) continue;
    const hex = m[2].trim().match(/^#[0-9a-fA-F]{3,8}\b/);
    t[name] = hex ? hex[0] : { nonHex: m[2].trim() };
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

function auditContrast(tokens) {
  const issues = [];
  for (const [fg, bg, desc] of CONTRAST_PAIRS) {
    const f = tokens[fg];
    const b = tokens[bg];
    if (!f || !b) continue;
    // A non-hex token (oklch/rgb/hsl override) can't be measured here — warn
    // rather than skip silently, so the gate's blind spot is visible.
    if (typeof f !== 'string' || typeof b !== 'string') {
      issues.push(['warn', `contrast not measured for ${desc} — non-hex color token; verify legibility manually`]);
      continue;
    }
    const r = contrast(f, b);
    const at = `(${f} on ${b})`;
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
  // Canonical scores from the built dashboard (score.ts) — used to enforce the
  // A-grade bar on anything marked ready.
  const dashHtml = await readFile(join(DIST, 'index.html'), 'utf8').catch(() => null);
  const scores = dashHtml ? parseDashboardScores(dashHtml) : new Map();
  let missingDist = false;
  for (const f of files) {
    const slug = f.replace(/\.json$/, '');
    const c = JSON.parse(await readFile(join(PROSPECTS, f), 'utf8'));
    const issues = auditProspect(slug, c);
    // A-grade gate: a "ready" site that scores below the bar is not send-able.
    // Fail CLOSED — a ready site with no build output can't have its score (or
    // contrast) verified, so it must not pass silently.
    const sc = scores.get(slug);
    if (c.status === 'ready' && !sc) {
      issues.push(['critical', `marked ready but no build output to verify its score — run \`npm run build\` before auditing, or set status:"needs-review"`]);
    } else if (c.status === 'ready' && sc.score < READY_MIN_SCORE) {
      issues.push(['critical', `marked ready but scores ${sc.score} (${sc.grade}) — below the A bar (${READY_MIN_SCORE}); fix the gaps or set status:"needs-review"`]);
    } else if (sc) {
      issues.push(['info', `score ${sc.score} (${sc.grade})`]);
    }
    // Measured WCAG contrast from the built page (needs a prior `npm run build`).
    const distHtml = await readFile(join(DIST, 'p', slug, 'index.html'), 'utf8').catch(() => null);
    if (distHtml) issues.push(...auditContrast(parseTokens(distHtml)));
    else {
      missingDist = true;
      // If the dashboard built but THIS page didn't, a ready site's contrast is
      // unverifiable — flag it. (When nothing built, the score gate above already
      // fired the critical, so don't double-report.)
      if (c.status === 'ready' && dashHtml) {
        issues.push(['critical', `marked ready but no built page to measure WCAG contrast — rebuild before auditing`]);
      }
    }
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
