/**
 * Unit tests for the pure composition helpers (scripts/lib/compose.mjs).
 * No heavy deps — runs with `node --test` even where node_modules is absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyCaps, factDrivenOrder, pickCopyModel, sectionStrength } from '../lib/compose.mjs';

test('copyCaps: flagship loosens prose caps vs batch', () => {
  const batch = copyCaps(false);
  const flag = copyCaps(true);
  assert.ok(flag.about > batch.about, 'about loosened');
  assert.ok(flag.heroSub > batch.heroSub, 'heroSub loosened');
  assert.ok(flag.tagline > batch.tagline, 'tagline loosened');
  assert.ok(flag.testimonial > batch.testimonial, 'testimonial loosened');
  assert.ok(flag.serviceDesc > batch.serviceDesc, 'serviceDesc loosened');
  // batch caps match today's hardcoded numbers (behavior matches today).
  assert.equal(batch.about, 600);
  assert.equal(batch.heroSub, 200);
  assert.equal(batch.tagline, 110);
  assert.equal(batch.testimonial, 280);
  // seoDescription is intentionally NOT loosened (Google truncates ~160).
  assert.equal(batch.seoDescription, 160);
  assert.equal(flag.seoDescription, 160);
});

test('pickCopyModel: batch=sonnet, flagship=opus, env overrides', () => {
  const savedM = process.env.ANTHROPIC_MODEL;
  const savedF = process.env.ANTHROPIC_FLAGSHIP_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_FLAGSHIP_MODEL;
  assert.equal(pickCopyModel(false), 'claude-sonnet-4-6');
  assert.equal(pickCopyModel(true), 'claude-opus-4-8');
  process.env.ANTHROPIC_FLAGSHIP_MODEL = 'opus-custom';
  assert.equal(pickCopyModel(true), 'opus-custom');
  // restore
  if (savedM === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = savedM;
  if (savedF === undefined) delete process.env.ANTHROPIC_FLAGSHIP_MODEL; else process.env.ANTHROPIC_FLAGSHIP_MODEL = savedF;
});

test('factDrivenOrder: only present (truthy) keys are returned', () => {
  const order = factDrivenOrder({
    trust: { kind: 'stats', items: [1, 2, 3] },
    story: null,
    services: { items: [{}, {}] },
    steps: null,
    team: null,
    testimonials: null,
    gallery: null,
  });
  assert.deepEqual(new Set(order), new Set(['trust', 'services']));
});

test('factDrivenOrder: review-rich site leads with testimonials over a thin story', () => {
  const order = factDrivenOrder({
    trust: null,
    story: { body: ['short'], highlights: [] },
    services: null,
    testimonials: { items: [{}, {}, {}], rating: { value: 4.9 } },
    gallery: null,
    team: null,
    steps: null,
  });
  assert.equal(order[0], 'testimonials');
  assert.ok(order.indexOf('testimonials') < order.indexOf('story'));
});

test('factDrivenOrder: a real stat row outranks services', () => {
  const order = factDrivenOrder({
    trust: { kind: 'stats', items: [1, 2, 3, 4] },
    services: { items: [{}, {}, {}, {}, {}, {}] },
  });
  assert.equal(order[0], 'trust');
});

test('factDrivenOrder: steps follow services; team follows story (adjacency)', () => {
  const order = factDrivenOrder({
    trust: { kind: 'stats', items: [1, 2, 3] },
    story: { body: ['a fairly long real story paragraph that carries weight here'], highlights: [1, 2] },
    services: { items: [{}, {}, {}] },
    steps: {},
    team: { members: [{}, {}] },
    testimonials: { items: [{}] },
    gallery: { images: [{}, {}, {}] },
  });
  assert.equal(order.indexOf('steps'), order.indexOf('services') + 1, 'steps immediately after services');
  assert.equal(order.indexOf('team'), order.indexOf('story') + 1, 'team immediately after story');
});

test('factDrivenOrder: deterministic (stable across calls)', () => {
  const byKey = {
    trust: { kind: 'features', items: [1, 2] },
    story: { body: ['x'] },
    services: { items: [{}, {}] },
    testimonials: { items: [{}, {}] },
  };
  assert.deepEqual(factDrivenOrder({ ...byKey }), factDrivenOrder({ ...byKey }));
});

test('sectionStrength: stats trust beats features beats callout', () => {
  const stats = sectionStrength('trust', { kind: 'stats', items: [1, 2, 3] });
  const features = sectionStrength('trust', { kind: 'features', items: [1, 2, 3] });
  const callout = sectionStrength('trust', { kind: 'callout', points: [1, 2, 3] });
  assert.ok(stats > features && features > callout);
});

test('sectionStrength: null section sorts to the bottom', () => {
  assert.equal(sectionStrength('story', null), -1);
});
