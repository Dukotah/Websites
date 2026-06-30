// Tests for the canonical normalizer (scripts/lib/match-key.mjs).
// No test runner is configured in this repo, so this uses Node's built-in
// `node:test` + `node:assert`. Run with:  node scripts/lib/match-key.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, matchKey } from './match-key.mjs';

test('matchKey is the TIGHT join key — keeps distinguishing words', () => {
  // Strips ONLY legal-entity forms (llc/inc/corp/co/...), so distinguishing
  // words like "realty"/"group" survive and two different firms stay distinct.
  assert.equal(matchKey('Acme Realty LLC'), 'acmerealty');
  assert.equal(matchKey('Acme Group'), 'acmegroup');
  assert.equal(matchKey("Joe's Cafe"), 'joescafe');
  assert.equal(matchKey('A & B Co.'), 'ab');
});

test('matchKey does not collide where the loose norm does', () => {
  assert.notEqual(matchKey('Acme Realty'), matchKey('Acme Group'));
});

test('norm is the LOOSE suppression key — strips distinguishing words', () => {
  // norm() collapses "realty" AND "llc", so "Acme Realty LLC" -> "acme". This is
  // correct for suppression/dedup but must NOT be used as a join key.
  assert.equal(norm('Acme Realty LLC'), 'acme');
  assert.equal(norm('Acme Plumbing'), 'acmeplumbing');
});

test('empty / nullish input is safe for both keys', () => {
  assert.equal(norm(''), '');
  assert.equal(norm(undefined), '');
  assert.equal(norm(null), '');
  assert.equal(matchKey(''), '');
  assert.equal(matchKey(undefined), '');
  assert.equal(matchKey(null), '');
});
