// Tests for the canonical business-name match key (scripts/lib/match-key.mjs).
// No test runner is configured in this repo, so this uses Node's built-in
// `node:test` + `node:assert`. Run with:  node scripts/lib/match-key.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, matchKey } from './match-key.mjs';

test('strips suffixes, punctuation and spaces', () => {
  // NOTE: the canonical normalizer strips `realty` AND `llc` as business-suffix
  // tokens, so "Acme Realty LLC" collapses to just "acme". (The brief's example
  // expecting "acmerealty" predates `realty` being in the suffix list; the shared
  // function — which must stay byte-identical across repos — is the source of
  // truth.) A name without a stripped token keeps both words joined.
  assert.equal(norm('Acme Realty LLC'), 'acme');
  assert.equal(norm('Acme Plumbing'), 'acmeplumbing');
  assert.equal(norm("Joe's Cafe"), 'joescafe');
  assert.equal(norm('A & B Co.'), 'ab');
});

test('matchKey is an alias of norm', () => {
  assert.equal(matchKey, norm);
  assert.equal(matchKey('Acme Realty LLC'), 'acme');
});

test('empty / nullish input is safe', () => {
  assert.equal(norm(''), '');
  assert.equal(norm(undefined), '');
  assert.equal(norm(null), '');
});
