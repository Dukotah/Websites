/**
 * Prospect quality scorer (spec §10.1).
 *
 * scoreProspect(config, ad, plan) → { score, grade, dims, flags, status }
 *
 * Dimensions and weights:
 *   realPhotos       25  hero not stock; bonus for gallery images
 *   copyAuthenticity 20  no templated service titles or generic about copy
 *   sectionRichness  20  count + diversity of rich sections
 *   contactComplete  10  phone + real email + address + hours
 *   identityStrength 10  distinct font + palette + shape (vs defaults)
 *   trustSignals     10  testimonials + established year + rating
 *   seoMeta          5   seoDescription length + mentions town + tagline
 */

import type { ProspectConfig, Section } from '../types';
import type { ArtDirection } from './art-direction';
import type { PagePlan } from './compose';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScoreDimension {
  name: string;
  weight: number;
  earned: number; // 0..weight
  note?: string;
}

export interface ProspectScore {
  score: number;   // 0..100 (Σ earned across dimensions)
  grade: Grade;
  dims: ScoreDimension[];
  flags: string[]; // specific gap messages
  status: 'ready' | 'needs-review';
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATED_SERVICE_PATTERN = /service (one|two|three|four|five)/i;
const TEMPLATED_ABOUT_PATTERN = /lorem ipsum|placeholder|your story here/i;
const TEMPLATED_DESC_PATTERN = /professional \w+ for \w+ and nearby/i;
const TEMPLATED_EMAIL_PATTERN = /^hello@/i;

function isStockImage(src: string): boolean {
  return !src || src.includes('/images/library/') || src.endsWith('.svg');
}

// Rich section types that count toward "section richness"
const RICH_TYPES = new Set<string>([
  'gallery', 'feature-split', 'timeline', 'menu', 'team', 'map', 'press',
  'bigquote', 'services-detailed', 'service-area', 'hours-contact', 'process',
  'logos', 'before-after', 'feature-grid', 'stats', 'testimonials',
]);

// Default art-direction values to detect distinctiveness
const DEFAULT_FONT_ID = 'modern-grotesk';
const DEFAULT_SHAPE = 'soft';

// ─────────────────────────────────────────────────────────────────────────────
// Dimension scorers
// ─────────────────────────────────────────────────────────────────────────────

function scoreRealPhotos(
  config: ProspectConfig,
  flags: string[],
): ScoreDimension {
  const W = 25;
  const heroSrc = config.images?.hero ?? '';
  const storySrc = config.images?.story ?? '';
  const gallery = config.galleryImages ?? [];

  let earned = 0;

  if (!isStockImage(heroSrc)) {
    earned += 15;
    // Bonus for gallery
    if (gallery.length >= 3) earned += 7;
    else if (gallery.length >= 1) earned += 3;
    // Bonus for story image
    if (!isStockImage(storySrc)) earned += 3;
  } else {
    flags.push('Stock art — no real hero photo');
  }

  earned = Math.min(earned, W);
  return { name: 'Real photos', weight: W, earned };
}

function scoreCopyAuthenticity(
  config: ProspectConfig,
  flags: string[],
): ScoreDimension {
  const W = 20;
  let deductions = 0;

  const services = config.services ?? [];
  const hasTemplatedTitles = services.some((s) => TEMPLATED_SERVICE_PATTERN.test(s.title));
  if (hasTemplatedTitles) {
    deductions += 8;
    flags.push('Service titles are templated ("Service one", "Service two"…)');
  }

  const aboutBody = (config.about?.body ?? []).join(' ');
  if (TEMPLATED_ABOUT_PATTERN.test(aboutBody) || aboutBody.trim().length < 80) {
    deductions += 6;
    flags.push('About section is empty or uses placeholder copy');
  }

  const hasTemplatedDescs = services.some((s) => TEMPLATED_DESC_PATTERN.test(s.description ?? ''));
  if (hasTemplatedDescs) {
    deductions += 6;
    flags.push('Service descriptions are templated ("Professional X for Y and nearby")');
  }

  return { name: 'Copy authenticity', weight: W, earned: Math.max(0, W - deductions) };
}

function scoreSectionRichness(
  plan: PagePlan,
  flags: string[],
): ScoreDimension {
  const W = 20;
  const sections = plan.sections;
  const richSections = sections.filter((s) => RICH_TYPES.has(s.type));
  const uniqueTypes = new Set(richSections.map((s) => s.type)).size;

  // Scale: 0→0, 1→5, 2→10, 3→14, 4→17, 5+→20
  const countScore = Math.min(20, Math.round((uniqueTypes / 5) * 20));
  const earned = Math.min(W, countScore);

  if (richSections.length === 0) {
    flags.push('Thin — no rich sections rendered');
  } else if (richSections.length === 1) {
    flags.push('Thin — only 1 rich section');
  }

  return { name: 'Section richness', weight: W, earned };
}

function scoreContactComplete(
  config: ProspectConfig,
  flags: string[],
): ScoreDimension {
  const W = 10;
  let earned = 0;
  const contact = config.contact ?? ({} as NonNullable<typeof config.contact>);

  if (contact.phone?.trim()) earned += 3;
  else flags.push('Phone number missing');

  const email = contact.email ?? '';
  if (email.trim() && !TEMPLATED_EMAIL_PATTERN.test(email)) earned += 3;
  else if (!email.trim()) flags.push('Email missing');

  if (contact.address?.trim()) earned += 2;
  else flags.push('Address missing');

  if ((config.hours ?? []).length > 0) earned += 2;

  return { name: 'Contact completeness', weight: W, earned };
}

function scoreIdentityStrength(
  ad: ArtDirection,
  flags: string[],
): ScoreDimension {
  const W = 10;
  let earned = 0;

  if (ad.fontId && ad.fontId !== DEFAULT_FONT_ID) earned += 4;
  else flags.push('Default font — no distinct typographic identity');

  if (ad.palette.brand && ad.palette.brand !== '#2b2b2b') earned += 3;

  if (ad.shape && ad.shape !== DEFAULT_SHAPE) earned += 3;

  return { name: 'Identity strength', weight: W, earned };
}

function scoreTrustSignals(
  config: ProspectConfig,
  plan: PagePlan,
  flags: string[],
): ScoreDimension {
  const W = 10;
  let earned = 0;

  const hasTestimonials = plan.sections.some((s) => s.type === 'testimonials');
  if (hasTestimonials) earned += 5;
  else flags.push('No testimonials');

  if (config.established && config.established.trim()) earned += 3;

  // Check for a rating signal in about or highlights
  const haystack = [
    ...(config.highlights ?? []),
    ...(config.about?.body ?? []),
  ].join(' ');
  if (/\b[45]\.\d\b|\b\d+ reviews?\b|\brated\b/i.test(haystack)) earned += 2;

  return { name: 'Trust signals', weight: W, earned };
}

function scoreSeoMeta(
  config: ProspectConfig,
  flags: string[],
): ScoreDimension {
  const W = 5;
  let earned = 0;

  const seo = config.seoDescription ?? '';
  if (seo.length >= 80 && seo.length <= 160) earned += 2;
  else if (seo.length > 0) earned += 1;
  else flags.push('SEO description missing');

  const area = config.area ?? '';
  if (area && seo.toLowerCase().includes(area.toLowerCase().split(',')[0].toLowerCase())) {
    earned += 2;
  } else if (area) {
    flags.push('SEO description does not mention the service area');
  }

  const tagline = config.tagline ?? '';
  if (tagline && !/your tagline here|tagline/i.test(tagline)) earned += 1;

  return { name: 'SEO / meta', weight: W, earned: Math.min(W, earned) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function scoreProspect(
  config: ProspectConfig,
  ad: ArtDirection,
  plan: PagePlan,
): ProspectScore {
  const flags: string[] = [];

  const dims: ScoreDimension[] = [
    scoreRealPhotos(config, flags),
    scoreCopyAuthenticity(config, flags),
    scoreSectionRichness(plan, flags),
    scoreContactComplete(config, flags),
    scoreIdentityStrength(ad, flags),
    scoreTrustSignals(config, plan, flags),
    scoreSeoMeta(config, flags),
  ];

  const score = Math.round(dims.reduce((sum, d) => sum + d.earned, 0));

  const grade: Grade =
    score >= 85 ? 'A' :
    score >= 70 ? 'B' :
    score >= 55 ? 'C' :
    score >= 40 ? 'D' : 'F';

  const realPhotoDim = dims[0];
  const copyDim = dims[1];
  const hasRealPhotos = realPhotoDim.earned >= 15;
  const copyAuthentic = copyDim.earned >= 14;

  const status: 'ready' | 'needs-review' =
    score >= 70 && hasRealPhotos && copyAuthentic ? 'ready' : 'needs-review';

  return { score, grade, dims, flags, status };
}
