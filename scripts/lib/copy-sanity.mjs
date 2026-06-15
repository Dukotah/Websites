#!/usr/bin/env node
/**
 * copy-sanity.mjs — the shared SCRAPED-COPY GUARD.
 *
 * Scraping a small-business site for prose drags in e-commerce / nav / legal
 * junk ("Notify me when this product is available", "Add to cart", "© 2024 …")
 * and duplicated-phrase artifacts (a clause repeated verbatim, the classic
 * "Notify me…: Notify me…:" the Petaluma bug). This module is the single place
 * that decides whether a scraped string is real prose worth shipping.
 *
 * Imported by BOTH scripts/author-premium.mjs (skeleton copy fields) and
 * scripts/lib/facts.mjs (enrichmentFromResearch) so the same junk never reaches
 * a page from either path. Pure functions, no I/O — also duplicated as a regex
 * into scripts/audit.mjs's gate so a stripped field can't sneak past review.
 */

// E-commerce / nav / legal junk that scraping commonly mistakes for prose.
export const JUNK_RE =
  /notify me when this product is available|add to cart|out of stock|sold out|view cart|checkout|continue shopping|sign in|create account|subscribe to our newsletter|enter your email|this is the online store|©|all rights reserved|cookie|privacy policy/i;

/**
 * sanitizeProse(str) → a clean string, or '' when unsalvageable.
 *   • trims whitespace
 *   • drops the string entirely if it matches JUNK_RE
 *   • drops duplicated-phrase artifacts: split on `:`/`.`, and if 2+ identical
 *     trimmed clauses appear, the string is a scrape repeat → reject.
 */
export function sanitizeProse(str) {
  if (!str) return '';
  const t = String(str).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (JUNK_RE.test(t)) return '';
  // Duplicated-clause artifact: same clause repeated (e.g. "X: X:" or "X. X.").
  const clauses = t
    .split(/[:.]/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length >= 3);
  const seen = new Set();
  for (const c of clauses) {
    if (seen.has(c)) return ''; // a clause repeats verbatim → junk
    seen.add(c);
  }
  return t;
}

// Generic placeholder authors carry no signal on their own — a short quote
// attributed to one of these reads as a fabricated filler card.
const PLACEHOLDER_AUTHOR =
  /^(yelp reviewer|verified customer|customer review|customer|local customer|happy customer|returning customer|satisfied customer)$/i;
// Review-list noise that sometimes slips into a quote (mirrors scrape-site).
const REVIEW_NOISE =
  /(leave a review|write a review|read more|view all|see all|google|yelp|facebook|trustpilot|powered by|©|copyright)/i;

/**
 * sanitizeTestimonials(arr) → keep only credible quotes.
 *   • A quote with a REAL (non-placeholder) author is always kept.
 *   • A quote with a generic placeholder author is kept ONLY when the quote
 *     itself is substantive (>=60 chars and not REVIEW_NOISE) — a low-signal
 *     short placeholder quote is dropped.
 *   • Never invents a name.
 */
export function sanitizeTestimonials(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const t of arr) {
    if (!t || !t.quote) continue;
    const quote = String(t.quote).trim();
    if (!quote || REVIEW_NOISE.test(quote)) continue;
    const author = String(t.author || '').trim();
    const placeholder = !author || PLACEHOLDER_AUTHOR.test(author);
    if (!placeholder) { out.push({ ...t, quote, author }); continue; } // real attribution
    // Generic placeholder author → keep only substantive quotes, and blank the
    // author so the quote renders UNATTRIBUTED (no fake "Yelp reviewer" byline)
    // rather than carrying a fabricated-looking attribution.
    if (quote.length >= 60) out.push({ ...t, quote, author: '' });
  }
  return out;
}
