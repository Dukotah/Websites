/**
 * contract.mjs — THE data contract for a prospect config.
 *
 * Single source of truth for what a prospect JSON must look like, shared by
 * three stages that previously trusted each other blindly:
 *   1. the generator  (scripts/generate-prospects.mjs) — validates BEFORE writing,
 *      so structurally-broken slop is never emitted.
 *   2. the renderer    (pages/p/[slug].astro, index.astro) — asserts ON LOAD, so a
 *      bad JSON fails the build loudly with the slug + reason instead of rendering
 *      a half-broken page.
 *   3. the audit gate  (scripts/audit.mjs) — reuses the same quality predicates.
 *
 * Zero-dependency, runtime-checkable, and deliberately free of any Astro/TS
 * imports so BOTH Node scripts and the Astro build can import it. Types live in
 * the sibling contract.d.ts (kept in sync by hand) and in types.ts.
 *
 * Two severities, kept distinct on purpose:
 *   - ERRORS   → STRUCTURAL contract violations. Block render + deploy. A page
 *                missing a name/theme or carrying a malformed section can't render
 *                correctly, so we refuse it.
 *   - WARNINGS → CONTENT-QUALITY issues (templated filler, no real email, stock
 *                hero, default hours). These don't break rendering; they drive the
 *                `needs-review` status + dashboard flags. Never shipped silently,
 *                but not a hard build failure either.
 */

// The closed set of section types the renderer (SectionRenderer.astro) can
// dispatch. Anything outside this set is a structural error — it would render as
// nothing (the switch `default: return null`) and silently vanish.
export const SECTION_TYPES = new Set([
  'stats', 'testimonials', 'faq', 'list', 'cta', 'gallery', 'feature-split',
  'timeline', 'menu', 'team', 'map', 'press', 'bigquote', 'services-detailed',
  'service-area', 'hours-contact', 'process', 'logos', 'before-after',
  'feature-grid', 'editorial-feature', 'spec-strip',
]);

// The array property each section type carries its repeated content in. Used to
// enforce "no empty section" structurally (an empty section renders a bare
// heading band — the classic "looks broken" bug).
const SECTION_ITEMS_KEY = {
  stats: 'items', testimonials: 'items', faq: 'items', cta: null, gallery: 'images',
  'feature-split': 'rows', timeline: 'items', menu: 'groups', team: 'members',
  map: null, press: 'items', bigquote: null, 'services-detailed': 'items',
  // hours-contact is valid with phone-only (empty hours) — don't enforce non-empty.
  'service-area': 'areas', 'hours-contact': null, process: 'steps',
  logos: 'items', 'before-after': 'pairs', 'feature-grid': 'items',
  'editorial-feature': 'rows', 'spec-strip': 'items', list: 'groups',
};

// ─────────────────────────────────────────────────────────────────────────────
// Content-quality predicates — the "no filler / no fabrication" rules. Centralized
// here so the generator's hard-gating and the audit gate agree on what counts as
// slop. (Previously these regexes were copy-pasted in audit.mjs and score.ts.)
// ─────────────────────────────────────────────────────────────────────────────

/** The old "Professional X for Town and nearby." stub — pure filler. */
export const FILLER_DESC_RE = /professional \w+ for \w+ and nearby/i;
/** Placeholder service titles from the template ("Service one", …). */
export const TEMPLATED_SERVICE_RE = /\bservice (one|two|three|four|five)\b/i;
/** Lorem / "your story here" placeholder about copy. */
export const TEMPLATED_ABOUT_RE = /lorem ipsum|placeholder|your story here/i;
/** A guessed, never-verified contact address (reads as fake to a prospect). */
export const PLACEHOLDER_EMAIL_RE = /^(hello|info|contact|email|your\w*)@(example|yoursite|yourdomain|domain|email)\.[a-z]+$/i;
/** The generic Mon–Fri 8–6 default hours that are wrong for many businesses. */
export const DEFAULT_HOURS = [
  { day: 'Mon – Fri', hours: '8:00 AM – 6:00 PM' },
  { day: 'Saturday', hours: '9:00 AM – 2:00 PM' },
  { day: 'Sunday', hours: 'Closed' },
];

export function isFillerServiceDescription(s) {
  if (!s || typeof s !== 'string') return false;
  return FILLER_DESC_RE.test(s);
}
export function isTemplatedServiceTitle(s) {
  return typeof s === 'string' && TEMPLATED_SERVICE_RE.test(s);
}
export function isPlaceholderEmail(s) {
  return typeof s === 'string' && (PLACEHOLDER_EMAIL_RE.test(s.trim()) || /^\d{3}-555-/.test(s));
}
export function isStockImage(src) {
  return !src || typeof src !== 'string' || src.includes('/images/library/') || src.endsWith('.svg');
}
/** Does this hours array look like the untouched generic default? */
export function isDefaultHours(hours) {
  if (!Array.isArray(hours) || hours.length !== DEFAULT_HOURS.length) return false;
  return DEFAULT_HOURS.every((d, i) => hours[i]?.day === d.day && hours[i]?.hours === d.hours);
}

// ─────────────────────────────────────────────────────────────────────────────
// Small structural assertions
// ─────────────────────────────────────────────────────────────────────────────

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isArr = Array.isArray;

/** Validate one section's structural shape. Returns an array of error strings. */
function validateSection(section, path, errors) {
  if (!isObj(section)) {
    errors.push(`${path} is not an object`);
    return;
  }
  const type = section.type;
  if (!isStr(type) || !SECTION_TYPES.has(type)) {
    errors.push(`${path}.type "${type}" is not a known section type`);
    return;
  }
  const key = SECTION_ITEMS_KEY[type];
  if (key) {
    const arr = section[key];
    if (!isArr(arr)) errors.push(`${path} (${type}) is missing its "${key}" array`);
    else if (arr.length === 0) errors.push(`${path} (${type}) has an empty "${key}" array`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a prospect config against the contract.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 *   valid === (errors.length === 0). Warnings never affect `valid`.
 */
export function validateProspectConfig(config) {
  const errors = [];
  const warnings = [];

  if (!isObj(config)) {
    return { valid: false, errors: ['config is not an object'], warnings };
  }

  // ── Required scalars ───────────────────────────────────────────────────────
  if (!isStr(config.name) || !config.name.trim()) errors.push('name is required (non-empty string)');
  for (const f of ['tagline', 'seoDescription', 'area', 'established']) {
    if (config[f] != null && !isStr(config[f])) errors.push(`${f} must be a string`);
  }

  // ── Required objects ───────────────────────────────────────────────────────
  if (!isObj(config.contact)) errors.push('contact object is required');
  else for (const f of ['phone', 'email', 'address']) {
    if (config.contact[f] != null && !isStr(config.contact[f])) errors.push(`contact.${f} must be a string`);
  }

  if (!isObj(config.hero)) errors.push('hero object is required');
  else if (!isStr(config.hero.heading) || !config.hero.heading.trim()) {
    errors.push('hero.heading is required (the page needs a headline)');
  }

  if (!isObj(config.images)) errors.push('images object is required');
  else if (!isStr(config.images.hero) || !config.images.hero.trim()) {
    errors.push('images.hero is required (a hero src, even if stock library art)');
  }

  if (!isObj(config.about)) errors.push('about object is required');
  else if (config.about.body != null && !isArr(config.about.body)) {
    errors.push('about.body must be an array of strings');
  }

  if (!isObj(config.theme)) errors.push('theme object is required');
  else if (!isStr(config.theme.brand)) errors.push('theme.brand is required');

  if (config.highlights != null && !isArr(config.highlights)) errors.push('highlights must be an array');
  if (config.services != null && !isArr(config.services)) errors.push('services must be an array');
  if (config.hours != null && !isArr(config.hours)) errors.push('hours must be an array');

  // ── Services shape ─────────────────────────────────────────────────────────
  if (isArr(config.services)) {
    config.services.forEach((s, i) => {
      if (!isObj(s) || !isStr(s.title) || !s.title.trim()) {
        errors.push(`services[${i}] needs a non-empty title`);
      }
    });
  }

  // ── Sections shape (the part the renderer dispatches on) ───────────────────
  if (config.sections != null) {
    if (!isArr(config.sections)) errors.push('sections must be an array');
    else config.sections.forEach((s, i) => validateSection(s, `sections[${i}]`, errors));
  }

  // ── Quality warnings (drive needs-review, never block the build) ───────────
  const email = config.contact?.email ?? '';
  if (!email.trim()) warnings.push('no email — add a real email or contact form before sending');
  else if (isPlaceholderEmail(email)) warnings.push(`email "${email}" looks fabricated — verify before sending`);

  if (isStockImage(config.images?.hero)) warnings.push('hero is stock/library art — no real photo');
  if (isDefaultHours(config.hours)) warnings.push('hours are the generic Mon–Fri 8–6 default — verify before sending');

  for (const s of config.services ?? []) {
    if (isFillerServiceDescription(s.description) || isTemplatedServiceTitle(s.title)) {
      warnings.push('templated service copy left in place — replace with real specifics');
      break;
    }
  }
  if (isArr(config.about?.body) && config.about.body.some((p) => TEMPLATED_ABOUT_RE.test(String(p)))) {
    warnings.push('about copy is templated/placeholder — rewrite from research');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Throw on STRUCTURAL invalidity (errors only) — for build-time enforcement at
 * the renderer boundary. Warnings are ignored here (they're the needs-review
 * system's job, not a reason to break the build).
 *
 * @param {object} config
 * @param {string} slug  for a useful error message
 */
export function assertValidProspectConfig(config, slug) {
  const { valid, errors } = validateProspectConfig(config);
  if (!valid) {
    throw new Error(
      `Invalid prospect config "${slug}" — violates the data contract:\n` +
        errors.map((e) => `  • ${e}`).join('\n') +
        `\n(see sites/demo-gallery/src/lib/contract.mjs)`,
    );
  }
}
