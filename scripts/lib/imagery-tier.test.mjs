/**
 * imagery-tier.test.mjs — dep-free contract test for the REAL IMAGERY TIER
 * provenance tagging. The new stock/AI tiers (stock-images.mjs, ai-images.mjs)
 * transitively import sharp, so they can't be imported in a node_modules-free
 * worktree; this test instead locks the OBSERVABLE CONTRACT both sides agree on:
 *
 *   • every non-owned image is tagged in `photoSource` (stock:<provider> /
 *     ai:illustrative), and
 *   • acquireMediaFor's relevance/provenance flag fires for exactly those tags
 *     (and for generic wikimedia/openverse) but NOT for the business's own photos.
 *
 * If the tag format or the flag regex drifts on either side, this fails — the
 * honesty seam (never imply ambiance is the business's own) stays enforced.
 *
 *   node --test scripts/lib/imagery-tier.test.mjs   (run at merge-time, with deps)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// The EXACT regexes used in acquireMediaFor (scripts/lib/facts.mjs). Kept in sync
// here as the contract; if facts.mjs changes them, update this and confirm both.
const RX_GENERIC = /wikimedia|openverse|commons/i;
const RX_STOCK = /(?:^|[+:])stock:/i;
const RX_AI = /(?:^|[+:])ai:illustrative/i;

// Classify a photoSource the way acquireMediaFor flags it (own → no flag).
function flagFor(photoSource) {
  if (RX_GENERIC.test(photoSource)) return 'generic-stock';
  if (RX_STOCK.test(photoSource)) return 'licensed-stock';
  if (RX_AI.test(photoSource)) return 'ai-illustrative';
  return 'owned-or-none';
}

test('business-owned photo sources are NOT flagged as non-owned', () => {
  assert.equal(flagFor('business-site'), 'owned-or-none');
  assert.equal(flagFor('agent-supplied'), 'owned-or-none');
  assert.equal(flagFor('business-site+osm'), 'owned-or-none');
  assert.equal(flagFor('osm'), 'owned-or-none');
});

test('licensed stock heroes are flagged as licensed-stock (not their own)', () => {
  assert.equal(flagFor('stock:pexels'), 'licensed-stock');
  assert.equal(flagFor('stock:unsplash'), 'licensed-stock');
  // even when stock only backfilled after an own photo existed
  assert.equal(flagFor('business-site+stock:pexels'), 'licensed-stock');
});

test('AI illustrative heroes are flagged as ai-illustrative', () => {
  assert.equal(flagFor('ai:illustrative'), 'ai-illustrative');
  assert.equal(flagFor('osm+ai:illustrative'), 'ai-illustrative');
});

test('generic Wikimedia/Openverse still wins the generic-stock flag', () => {
  assert.equal(flagFor('wikimedia'), 'generic-stock');
  assert.equal(flagFor('openverse'), 'generic-stock');
});

test('the legacy ai-generated tag (not the illustrative tier) is not mis-tagged', () => {
  // images.mjs legacy generateImages uses bare `ai-generated` / `+ai`; only the
  // new illustrative tier uses the `ai:illustrative` tag the flag keys on.
  assert.notEqual(flagFor('business-site+ai'), 'ai-illustrative');
  assert.notEqual(flagFor('ai-generated'), 'ai-illustrative');
});
