/**
 * copy-quality.mjs — the slop detector + cleaner.
 *
 * This is the shared brain that closes the "cookie-cutter / AI-slop" gap.
 * It is imported by BOTH:
 *   - generate-prospects.mjs — to REFUSE meta-tag boilerplate as marketing copy
 *     (so the raw "This is the online store for…" string never becomes a hero).
 *   - audit.mjs — to GATE it before ship: any site whose copy still contains a
 *     critical slop pattern cannot be marked `status:"ready"`.
 *
 * Root cause it fixes: the key-free path used to dump a business's scraped
 * <meta description> verbatim into the tagline, SEO description, and hero
 * subheading. Meta text is platform boilerplate ("This is the online store for
 * X"), often truncated mid-sentence — the single biggest tell that a robot,
 * not a person, made the page. A human never writes that on their hero.
 *
 * Key-free, deterministic, zero-dependency.
 */

// ---------------------------------------------------------------------------
// Critical patterns: text that is platform/UI/meta boilerplate or leaked code
// — never acceptable as customer-facing marketing copy. Each carries a reason
// so the gate can tell the user (or the agent) exactly WHY it was rejected.
// ---------------------------------------------------------------------------
const CRITICAL_RULES = [
  {
    id: 'ecommerce-boilerplate',
    re: /\bthis is the (online store|home ?page|web ?site|shop|default)\b/i,
    msg: 'e-commerce platform boilerplate ("This is the online store for…")',
  },
  {
    id: 'placeholder-token',
    // {STREET}, ${this.getAuthor}, %CITY%, [[name]], {{ var }}
    re: /\{\{?\s*[a-z0-9_.]+\s*\}?\}|\$\{[^}]*\}|%[A-Z_]{2,}%/i,
    msg: 'unresolved template token (e.g. {STREET}, ${…}, %CITY%)',
  },
  {
    id: 'code-leak',
    re: /\b(function\s*\(|=>|getElementById|querySelector|addEventListener|console\.(log|error)|this\.\w+\(|return\s+`)/,
    msg: 'leaked JavaScript/code',
  },
  {
    id: 'cart-ui',
    re: /\b(add to cart|notify me when (this|it)|out of stock|sold out|view (your )?cart|proceed to checkout|continue shopping|coupon code|promo code|use code\b)/i,
    msg: 'store/checkout/coupon UI text',
  },
  {
    id: 'legal-cookie',
    re: /\b(we use cookies|cookie (policy|consent|preferences)|accept all cookies|privacy policy|all rights reserved|terms (of|and) (service|use|conditions))\b/i,
    msg: 'cookie/legal/footer boilerplate',
  },
  {
    id: 'lorem',
    re: /\blorem ipsum|dolor sit amet\b/i,
    msg: 'lorem ipsum placeholder text',
  },
  {
    id: 'placeholder-contact',
    // Fake 555-555 phone, or an example/placeholder email domain.
    re: /\(555\)\s*555|\b555[\s.-]?555[\s.-]?\d{4}\b|@(?:example|placeholder|domain|email|yourdomain)\.(?:com|org|net)|hello@example/i,
    msg: 'placeholder contact info (fake 555 phone / example email)',
  },
  {
    id: 'seo-keyword-stuffing',
    re: /\b(best|top|cheap|affordable|#1)\b[^.?!]{0,40}\b(near me|in your area)\b/i,
    msg: 'SEO keyword-stuffing ("best … near me")',
  },
];

// ---------------------------------------------------------------------------
// Boilerplate PREFIXES we can safely strip and keep the remainder, e.g.
// "Welcome to Joe's Pizza — we make…" → "we make…". If nothing usable remains,
// the caller treats the field as empty and composes copy from facts instead.
// ---------------------------------------------------------------------------
const STRIP_PREFIXES = [
  /^this is the (online store|home ?page|web ?site|shop)( for [^.!?]*)?[.!?,—-]*\s*/i,
  /^welcome to\b[^.!?]*[.!?,—-]+\s*/i,
  /^(home|about us?|contact us?|our story|menu)\s*[-–—:|]\s*/i,
];

// Junk substrings that, if present anywhere, get cut along with their sentence.
const STRIP_SENTENCES = [
  /you can order online to pick up/i,
  /order online/i,
  /shop (now|online)/i,
  /sign up for (our )?newsletter/i,
];

/** Collapse whitespace + decode the couple of entities scrapes leave behind. */
function norm(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A long fragment that was cut mid-stream — the "…we pride ourselves" /
 * "…local and organic" / "…(bridal, business, birthday" class. Short, clean
 * taglines (which we compose to END in punctuation) never trip this.
 */
function isTruncated(text) {
  const t = norm(text);
  if (t.length < 45) return false; // deliberate short taglines are fine
  // Unbalanced parenthesis → the sentence was clearly cut inside a list.
  const opens = (t.match(/\(/g) || []).length;
  const closes = (t.match(/\)/g) || []).length;
  if (opens > closes) return true;
  // A long line that doesn't end on terminal punctuation is a clipped sentence.
  if (!/[.!?…"”')\]]$/.test(t)) return true;
  return false;
}

/**
 * Inspect a single string. Returns an array of findings:
 *   { id, msg, severity:'critical'|'warn' }
 * Empty array = clean.
 */
export function findSlop(text) {
  const t = norm(text);
  if (!t) return [];
  const out = [];
  for (const rule of CRITICAL_RULES) {
    if (rule.re.test(t)) out.push({ id: rule.id, msg: rule.msg, severity: 'critical' });
  }
  if (isTruncated(t)) {
    out.push({
      id: 'truncated',
      msg: 'truncated mid-sentence (reads as a clipped meta tag, not written copy)',
      severity: 'critical',
    });
  }
  return out;
}

/** True if `text` contains any CRITICAL slop (the gate's hard fail). */
export function isSlop(text) {
  return findSlop(text).some((f) => f.severity === 'critical');
}

/**
 * Best-effort clean of scraped prose: strip known boilerplate prefixes and
 * junk sentences. Returns the cleaned string — which the caller must STILL
 * test with isSlop()/length, because cleaning can't rescue everything.
 */
export function cleanCopy(text) {
  let t = norm(text);
  if (!t) return '';
  for (const re of STRIP_PREFIXES) t = t.replace(re, '').trim();
  if (STRIP_SENTENCES.some((re) => re.test(t))) {
    t = t
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !STRIP_SENTENCES.some((re) => re.test(s)))
      .join(' ')
      .trim();
  }
  // Re-capitalize if a strip left a lowercase lead.
  if (t && /^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

/**
 * The one call the generator wants: given a raw scraped description, return a
 * USABLE self-description, or '' if nothing survives. Usable = cleaned, not
 * slop, and a real sentence (>= 30 chars).
 */
export function usableDescription(raw) {
  const cleaned = cleanCopy(raw);
  if (!cleaned || cleaned.length < 30) return '';
  if (isSlop(cleaned)) return '';
  return cleaned;
}

// ---------------------------------------------------------------------------
// Specificity scoring — measures how "real" and custom a text block feels vs.
// generic filler. High-specificity copy references proper nouns, numbers, and
// named services; generic copy is adjectives and verbs with nothing grounding it.
//
// knownFacts: optional array of strings the generator already extracted
// (e.g. city name, business name, owner name, real service names). Matches
// against those bump the score slightly so known-good references aren't missed.
// ---------------------------------------------------------------------------

// Common English stop-words — excluded from token count so "the" doesn't
// inflate the denominator.
const STOP = new Set([
  'a','an','the','and','or','but','in','on','of','to','for','with','by','at',
  'from','up','as','is','it','its','be','was','are','were','has','have','had',
  'that','this','these','those','we','our','you','your','i','my','their','they',
  'he','she','do','does','did','will','would','can','could','should','may',
  'might','not','no','so','if','all','any','more','also','just','very','than',
  'which','who','what','when','where','how','us','into','about','been','being',
]);

/**
 * Returns a [0..1] specificity score for `text`.
 *
 * Score = (proper_nouns + numerals + known_fact_matches) / meaningful_tokens
 *
 * - proper_nouns: words that start with a capital letter mid-sentence (not the
 *   first word) OR are all-caps abbreviations (LLC, BBB, EPA, …).
 * - numerals: tokens containing at least one digit (years, prices, "24/7", "15+").
 * - known_fact_matches: tokens that appear in the `knownFacts` list (case-insensitive).
 * - meaningful_tokens: total words excluding stop-words.
 *
 * A score >= 0.10 is considered adequate. Below 0.05 is flagged as generic.
 *
 * @param {string} text
 * @param {string[]} [knownFacts=[]]  e.g. ['Healdsburg', 'Sonoma County', 'Jeff', 'towing']
 * @returns {number}  0..1
 */
export function specificityScore(text, knownFacts = []) {
  const t = norm(text);
  if (!t) return 0;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  // Build a lowercase set from knownFacts for O(1) lookup.
  const factsLower = new Set((knownFacts ?? []).map((f) => String(f).toLowerCase().trim()));

  let meaningful = 0;
  let specific = 0;

  for (let i = 0; i < tokens.length; i++) {
    // Strip leading/trailing punctuation for classification but keep original for
    // first-word detection.
    const raw = tokens[i];
    const word = raw.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (!word) continue;
    const lower = word.toLowerCase();
    if (STOP.has(lower)) continue; // not a meaningful token

    meaningful++;

    // Proper noun: starts upper-case and is NOT the sentence-first word, OR is
    // an all-caps abbreviation >= 2 chars.
    const isCapsAbbr = word.length >= 2 && word === word.toUpperCase() && /^[A-Z]/.test(word);
    const isMidUpper = i > 0 && /^[A-Z]/.test(word) && word !== word.toUpperCase();
    // Also treat sentence-initial caps when it's a known fact — avoids penalising
    // "Smitty's Towing" at the start of a sentence.
    const isKnownFact = factsLower.has(lower);
    const isNumeral = /\d/.test(word);

    if (isCapsAbbr || isMidUpper || isKnownFact || isNumeral) specific++;
  }

  if (meaningful === 0) return 0;
  return Math.min(1, specific / meaningful);
}

// ---------------------------------------------------------------------------
// Whole-prospect scan — used by the gate. Walks every customer-facing copy
// field and returns a flat worklist of findings tagged with their location,
// so the agent (or user) gets an exact "fix this field, here's why" list.
// ---------------------------------------------------------------------------
export function scanProspect(c) {
  const findings = [];
  const check = (where, text) => {
    for (const f of findSlop(text)) findings.push({ where, text: norm(text), ...f });
  };

  check('tagline', c.tagline);
  check('seoDescription', c.seoDescription);
  check('hero.heading', c.hero?.heading);
  check('hero.subheading', c.hero?.subheading);
  // Contact fields were never scanned — a fake 555 phone or example@ email could
  // slip through every gate. Now they're slop-checked like any copy field.
  check('contact.phone', c.contact?.phone);
  check('contact.email', c.contact?.email);
  for (const [i, line] of (c.about?.body ?? []).entries()) check(`about.body[${i}]`, line);
  for (const [i, s] of (c.services ?? []).entries()) {
    check(`services[${i}].title`, s.title);
    check(`services[${i}].description`, s.description);
  }
  for (const [i, sec] of (c.sections ?? []).entries()) {
    const tag = `sections[${i}].${sec.type}`;
    check(`${tag}.heading`, sec.heading);
    for (const [j, it] of (sec.items ?? []).entries()) {
      check(`${tag}.items[${j}].q`, it.q);
      check(`${tag}.items[${j}].a`, it.a);
      check(`${tag}.items[${j}].title`, it.title);
      check(`${tag}.items[${j}].description`, it.description);
      check(`${tag}.items[${j}].quote`, it.quote);
    }
    for (const [j, r] of (sec.rows ?? []).entries()) {
      check(`${tag}.rows[${j}].heading`, r.heading);
      check(`${tag}.rows[${j}].body`, r.body);
    }
    check(`${tag}.quote`, sec.quote);
  }
  return findings;
}
