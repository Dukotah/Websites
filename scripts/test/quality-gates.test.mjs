/**
 * quality-gates.test.mjs — unit tests for the RELAXED quality gates.
 *
 * Run: node --test scripts/test/
 *
 * These cover the surgical relaxations in audit.mjs (photo-light composition,
 * cliché headline, weak social proof — now WARN on substantive sites, CRITICAL
 * only on thin/dishonest stubs) and premium-validate.mjs (library SVG / OG
 * fallback acceptance). They are deliberately sharp-free: auditProspect is a pure
 * config function and audit.mjs no longer imports `sharp` at module top, so these
 * run anywhere `node` runs — no native deps, no built dist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditProspect } from '../audit.mjs';
import { imageExists } from '../premium-validate.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────
const home = (sections) => ({
  slug: 'x', name: 'X Co', seoDescription: 'desc', category: 'cafe',
  pages: [{ slug: 'home', label: 'Home', sections }],
});
const criticals = (issues) => issues.filter((i) => i[0] === 'critical').map((i) => i[1]);
const warns = (issues) => issues.filter((i) => i[0] === 'warn').map((i) => i[1]);
const has = (arr, sub) => arr.some((m) => m.includes(sub));

// A real (non-stock) photo path so the photo-light branch is skipped.
const realPhotoHero = { kind: 'hero', variant: 'split', heading: 'H',
  image: { src: '/images/x/hero.jpg', alt: 'storefront' } };
const story = { kind: 'story', body: ['Founded by the Vega family in 2003, we roast in small batches.'] };
const servicesGrid = { kind: 'services', layout: 'grid', items: [{ title: 'Espresso', description: 'House blend' }] };
const stats3 = { kind: 'stats', items: [
  { value: '20', label: 'years' }, { value: '500', label: 'jobs' }, { value: '4.9', label: 'rating' },
] };
const cta = { kind: 'cta', heading: 'Visit us' };

// ── PHOTO-LIGHT COMPOSITION GATE ───────────────────────────────────────────────
test('photo-light + composed + trust → info, no critical', () => {
  const c = home([
    { kind: 'hero', variant: 'editorial', heading: 'Single-origin coffee roasted in Sebastopol' },
    story, stats3, servicesGrid, cta,
  ]);
  c.rating = { value: 4.9 };
  const issues = auditProspect('x', c, false, false);
  assert.equal(has(criticals(issues), 'no real photos'), false, 'no photo-light critical');
});

test('photo-light substantive but NO trust → warn, not critical', () => {
  const c = home([
    { kind: 'hero', variant: 'editorial', heading: 'Single-origin coffee roasted in Sebastopol' },
    story, servicesGrid, cta, // 4 sections, structured band present, but no rating/cred/testimonial
  ]);
  const issues = auditProspect('x', c, false, false);
  assert.equal(has(criticals(issues), 'no real photos'), false, 'must not hard-block a substantive photo-light site');
  assert.equal(has(warns(issues), 'photo-light'), true, 'should warn instead');
});

test('photo-light AND thin AND no trust → critical (honesty floor kept)', () => {
  const c = home([
    { kind: 'hero', variant: 'editorial', heading: 'Welcome' },
    cta,
  ]);
  const issues = auditProspect('x', c, false, false);
  assert.equal(has(criticals(issues), 'no real photos'), true, 'thin empty stub must still be blocked');
});

// ── CLICHÉ HEADLINE GATE ────────────────────────────────────────────────────────
test('cliché headline on a substantive site → warn, not critical', () => {
  const c = home([
    { ...realPhotoHero, heading: 'Quality You Can Trust' },
    story, servicesGrid, cta,
  ]);
  const issues = auditProspect('x', c, false, false); // unresearched, but has body
  assert.equal(has(criticals(issues), 'cliché'), false, 'substantive site must not be blocked for a cliché line');
  assert.equal(has(warns(issues), 'cliché'), true, 'should warn to improve the headline');
});

test('cliché headline on a bare stub (no research, no body) → critical', () => {
  const c = home([
    { kind: 'hero', variant: 'editorial', heading: 'Quality You Can Trust' },
    cta,
  ]);
  const issues = auditProspect('x', c, false, false);
  assert.equal(has(criticals(issues), 'cliché'), true, 'the pure AI-batch tell stays blocked');
});

test('cliché headline that is verified-authored (confirmed) → info, never critical', () => {
  const c = home([
    { kind: 'hero', variant: 'editorial', heading: 'No Job Too Big' },
    cta,
  ]);
  const issues = auditProspect('x', c, true /* confirmed */, true);
  assert.equal(has(criticals(issues), 'cliché'), false, 'verified-authored cliché is intentional');
});

// ── WEAK SOCIAL-PROOF GATE ──────────────────────────────────────────────────────
test('all-placeholder testimonials on a substantive site → warn, not critical', () => {
  const c = home([
    realPhotoHero, story, servicesGrid,
    { kind: 'testimonials', items: [{ quote: 'Great!', author: 'Verified customer' }] },
    cta,
  ]);
  const issues = auditProspect('x', c, false, false);
  const socialCrit = criticals(issues).filter((m) => m.includes('social proof'));
  assert.equal(socialCrit.length, 0, 'weak proof on a real site must not hard-block');
  assert.equal(has(warns(issues), 'social proof'), true);
});

test('all-placeholder testimonials on a thin site (no body) → critical', () => {
  // hero + a placeholder testimonial only; give a real photo so the photo-light
  // gate is not what fires — we are isolating the social-proof verdict.
  const c = home([
    realPhotoHero,
    { kind: 'testimonials', items: [{ quote: 'Nice', author: 'Customer' }] },
  ]);
  const issues = auditProspect('x', c, false, false);
  assert.equal(has(criticals(issues), 'social proof'), true, 'thin + weak-only proof stays blocked');
});

// ── HONESTY FLOORS STILL FIRE (we did not soften these) ─────────────────────────
test('scraped junk copy is still critical', () => {
  const c = home([
    { ...realPhotoHero, heading: 'Real headline' },
    story, servicesGrid,
    { kind: 'cta', heading: 'Add to cart and checkout now' },
  ]);
  const issues = auditProspect('x', c, true, true);
  assert.equal(criticals(issues).some((m) => m.toLowerCase().includes('scraped junk')), true);
});

// ── premium-validate: library SVG / OG fallback acceptance ──────────────────────
test('imageExists accepts a real library SVG (OG/hero fallback)', () => {
  // This file exists in sites/demo-gallery/public/images/library/cafe/hero.svg.
  assert.equal(imageExists('/images/library/cafe/hero.svg'), true);
});

test('imageExists rejects a typo\'d library path', () => {
  assert.equal(imageExists('/images/library/cafe/does-not-exist.svg'), false);
});

test('imageExists accepts remote https photos', () => {
  assert.equal(imageExists('https://upload.wikimedia.org/x.jpg'), true);
});

test('imageExists rejects an empty src', () => {
  assert.equal(imageExists(''), false);
});
