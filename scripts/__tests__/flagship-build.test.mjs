/**
 * Unit tests for the flagship pipeline's PURE helpers (no heavy deps, no network).
 * Run: node --test scripts/__tests__/flagship-build.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFlagshipArgs, evaluateFinding, photoIndexFromLocation, applyVisionFeedback, buildFlowHook,
} from '../flagship-build.mjs';
import { buildResearchTargets, researchGaps, leadQuery } from '../lib/research-targets.mjs';

test('parseFlagshipArgs: defaults + flags', () => {
  const o = parseFlagshipArgs(['data/leads.csv', '--bar', 'A', '--max-loops', '3', '--only', 'a,b', '--promote', '--flow']);
  assert.equal(o.csv, 'data/leads.csv');
  assert.equal(o.bar, 'A');
  assert.equal(o.maxLoops, 3);
  assert.deepEqual(o.only, ['a', 'b']);
  assert.equal(o.promote, true);
  assert.equal(o.flow, true);
});

test('parseFlagshipArgs: --help and unknown flag', () => {
  assert.equal(parseFlagshipArgs(['--help']).help, true);
  assert.throws(() => parseFlagshipArgs(['--nope']), /Unknown flag/);
});

test('evaluateFinding: pass/hold/critical/grade-bar', () => {
  assert.equal(evaluateFinding(null).pass, false);
  assert.equal(evaluateFinding({ grade: 'A', verdict: 'send', findings: [] }, 'B').pass, true);
  assert.equal(evaluateFinding({ grade: 'A', verdict: 'hold', findings: [] }, 'B').pass, false);
  assert.equal(evaluateFinding({ grade: 'A', verdict: 'send', findings: [{ severity: 'critical' }] }, 'B').pass, false);
  assert.equal(evaluateFinding({ grade: 'C', verdict: 'send', findings: [] }, 'B').pass, false);
  assert.equal(evaluateFinding({ grade: 'B', verdict: 'send', findings: [{ severity: 'warn' }] }, 'B').pass, true);
});

test('photoIndexFromLocation', () => {
  assert.equal(photoIndexFromLocation('gallery, 3rd image'), 2);
  assert.equal(photoIndexFromLocation('photo-2'), 1);
  assert.equal(photoIndexFromLocation('hero'), -1);
  assert.equal(photoIndexFromLocation(''), -1);
});

test('applyVisionFeedback: hero-critical clears the photo pool (→ editorial)', () => {
  const research = { slug: 'x', realPhotoUrls: ['a.jpg', 'b.jpg', 'c.jpg'] };
  const finding = {
    grade: 'D', verdict: 'hold',
    findings: [{ dimension: 'hero-congruence', severity: 'critical', location: 'hero', issue: 'mountain on a salon' }],
  };
  const { research: out, actions, clearedHero } = applyVisionFeedback(research, finding, { loop: 1 });
  assert.equal(clearedHero, true);
  assert.deepEqual(out.realPhotoUrls, []);
  assert.ok(actions.some((a) => /editorial hero/.test(a)));
  assert.equal(out._visionFeedback.length, 1);
});

test('applyVisionFeedback: buried gallery warn drops one photo by index', () => {
  const research = { slug: 'x', realPhotoUrls: ['a.jpg', 'b.jpg', 'c.jpg'] };
  const finding = {
    grade: 'B', verdict: 'send',
    findings: [{ dimension: 'photo-congruence', severity: 'warn', location: 'gallery, 2nd image', issue: 'store interior' }],
  };
  const { research: out } = applyVisionFeedback(research, finding, { loop: 1 });
  assert.deepEqual(out.realPhotoUrls, ['a.jpg', 'c.jpg']);
});

test('applyVisionFeedback: richness flag requests a copy rewrite, leaves photos', () => {
  const research = { slug: 'x', realPhotoUrls: ['a.jpg'] };
  const finding = {
    grade: 'C', verdict: 'hold',
    findings: [{ dimension: 'richness-credibility', severity: 'critical', issue: 'reads as generic AI slop' }],
  };
  const { research: out, needsCopy } = applyVisionFeedback(research, finding, { loop: 2 });
  assert.equal(needsCopy, true);
  assert.deepEqual(out.realPhotoUrls, ['a.jpg']); // photos untouched
});

test('applyVisionFeedback does not mutate the input', () => {
  const research = { slug: 'x', realPhotoUrls: ['a.jpg', 'b.jpg'] };
  applyVisionFeedback(research, { findings: [{ dimension: 'hero-quality', severity: 'critical', location: 'hero' }] });
  assert.deepEqual(research.realPhotoUrls, ['a.jpg', 'b.jpg']);
  assert.equal(research._visionFeedback, undefined);
});

test('buildResearchTargets: builds source URLs, own-site first', () => {
  const t = buildResearchTargets({ name: 'Joon Salon', city: 'Petaluma', state: 'CA', website: 'https://joon.example' });
  assert.equal(t[0].source, 'own-site');
  const sources = t.map((x) => x.source);
  for (const s of ['google', 'yelp', 'facebook', 'bbb', 'news']) assert.ok(sources.includes(s), `missing ${s}`);
  assert.ok(t.find((x) => x.source === 'yelp').url.includes('Joon'));
});

test('buildResearchTargets: empty without a name', () => {
  assert.deepEqual(buildResearchTargets({}), []);
});

test('researchGaps: flags missing facts; complete file has none', () => {
  const gaps = researchGaps({ services: [], testimonials: [], realPhotoUrls: [] });
  assert.ok(gaps.length >= 4);
  const complete = researchGaps({
    established: 'Est. 1998',
    services: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
    testimonials: [{ quote: 'x' }, { quote: 'y' }],
    realPhotoUrls: ['p.jpg'],
    _lead: { owner: 'Jane' },
  });
  assert.deepEqual(complete, []);
});

test('leadQuery composes name + city, state', () => {
  assert.equal(leadQuery({ name: 'Acme', city: 'Napa', state: 'CA' }), 'Acme Napa, CA');
});

test('buildFlowHook mentions the slug and the catalog', () => {
  const h = buildFlowHook('joon-salon', 'A');
  assert.ok(h.includes('joon-salon'));
  assert.ok(/FEATURES\.md/.test(h));
});
