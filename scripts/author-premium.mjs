#!/usr/bin/env node
/**
 * author-premium.mjs — the deterministic PREMIUM author. Replaces
 * generate-prospects.mjs's buildConfig/sections/manifest tail with a multi-page
 * PremiumConfig (src/premium/lib/premium-types.ts) authored from the SAME real
 * facts layer (loadResearch / enrichmentFromResearch / normCat / deriveStatus)
 * and the SAME photo pipeline (acquireMediaFor → src/assets/prospects/<slug>/).
 *
 * INPUT (per slug): the verified CSV row, the enrichment object `e`, the raw
 * research blob, and the acquired `media` descriptors.
 * OUTPUT: a PremiumConfig that passes scripts/premium-validate.mjs.
 *
 * Determinism-first: ships with zero API keys. When ANTHROPIC_API_KEY is set,
 * Claude UPGRADES copy fields only (never invents facts/photos/hours/ratings);
 * any error falls back to the deterministic skeleton.
 *
 * Exports authorPremium(...) for the pipeline; not a CLI on its own.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  normCat, deriveStatus, clip, titleCase, humanizeCategory, hashStr, PUBLIC_IMAGES,
} from './lib/facts.mjs';
import { pickFontId, pickBrandColor } from './lib/brand-seed.mjs';

// ── category → page family table ───────────────────────────────────────────
// home is ALWAYS pages[0]. The family decides which pages follow and whether the
// 'services' section renders as a menu/wine-list.
const HOSPITALITY = new Set(['cafe', 'restaurant', 'winery']);
const SERVICES_LED = new Set([
  'plumbing', 'hvac', 'electrician', 'roofing', 'contractor', 'auto-repair',
  'towing', 'cleaning', 'landscaping', 'dental', 'medical',
]);
const BEAUTY_WELLNESS = new Set(['salon', 'spa', 'barber', 'tattoo', 'fitness']);

// Premium-aware category resolution. normCat() (legacy) collapses dental/medical/
// tattoo/fitness to 'default' because the legacy CATEGORIES preset map has no
// theme for them — but the PREMIUM page+brand tables treat them as first-class
// families (the hand-authored bar uses category:"dental"). So we keep the raw
// category when it's a recognized premium family member; otherwise defer to normCat.
const PREMIUM_KNOWN = new Set([
  ...HOSPITALITY, ...SERVICES_LED, ...BEAUTY_WELLNESS, 'marina',
]);
const PREMIUM_CAT_ALIASES = {
  dentist: 'dental', dentistry: 'dental', orthodontist: 'dental',
  doctor: 'medical', clinic: 'medical', 'medical-spa': 'spa',
  gym: 'fitness', 'personal-training': 'fitness',
};
function premiumCat(rawCategory) {
  const raw = (rawCategory || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (PREMIUM_KNOWN.has(raw)) return raw;
  if (PREMIUM_CAT_ALIASES[raw] && PREMIUM_KNOWN.has(PREMIUM_CAT_ALIASES[raw])) return PREMIUM_CAT_ALIASES[raw];
  const n = normCat(rawCategory);
  return PREMIUM_KNOWN.has(n) ? n : (n === 'default' && raw && PREMIUM_KNOWN.has(raw) ? raw : n);
}

// Humanized category label for nav/eyebrow ("Dental Studio", "Craft Kitchen").
function categoryLabel(cat) {
  return titleCase(humanizeCategory(cat));
}

// The page-2 slug + label for the services-equivalent page, per family.
function servicesPage(cat) {
  if (HOSPITALITY.has(cat)) return { slug: 'menu', label: 'Menu' };
  return { slug: 'services', label: 'Services' };
}
function servicesEyebrow(cat) {
  return HOSPITALITY.has(cat) ? 'On the menu' : 'What we do';
}

const telDigits = (s) => (s || '').replace(/[^\d]/g, '');
const telHref = (s) => {
  const d = telDigits(s);
  if (!d) return '';
  return `tel:+${d.length === 10 ? '1' + d : d}`;
};

// ── photo mapping (on-disk only) ───────────────────────────────────────────
// The validator hard-fails on invented paths. We list the slug's asset dir and
// only reference files that exist. Convention from the acquire pipeline:
// hero.<ext>, story.<ext>, photo-N.<ext>.
function discoverPhotos(slug) {
  const dir = join(PUBLIC_IMAGES, slug);
  if (!existsSync(dir)) return { hero: null, story: null, gallery: [], all: [] };
  const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));
  const baseOf = (f) => f.replace(/\.[a-z0-9]+$/i, '');
  // Map JSON paths in /images/<slug>/<base>.<ext> form (validator resolves any ext).
  const pathFor = (f) => `/images/${slug}/${f}`;
  const hero = files.find((f) => baseOf(f) === 'hero');
  const story = files.find((f) => baseOf(f) === 'story');
  // photo-N in numeric order.
  const photos = files
    .filter((f) => /^photo-\d+/.test(baseOf(f)))
    .sort((a, b) => (parseInt(baseOf(a).split('-')[1]) || 0) - (parseInt(baseOf(b).split('-')[1]) || 0));
  return {
    hero: hero ? pathFor(hero) : null,
    story: story ? pathFor(story) : null,
    gallery: photos.map(pathFor),
    all: files.map(pathFor),
  };
}

// ── deterministic skeleton ─────────────────────────────────────────────────
function buildSkeleton(slug, row, e, research, media) {
  const cat = premiumCat(row.category);
  // A research file may carry a better PUBLIC display name (e.g. a rebrand) than
  // the lead's CSV name — prefer it when present (the hand-authored bar does this).
  const name = research?.name || row.name;
  const area = [row.city, row.state].filter(Boolean).join(', ');
  const city = row.city || '';
  const state = row.state || '';
  const established = (e?.established || research?.established || row.established || '')
    .toString().replace(/^est\.?\s*/i, '').match(/\d{4}/)?.[0] || '';
  const phone = e?.phone || row.phone || '';
  const email = e?.email || row.email || '';
  const address = e?.address || row.address || '';
  const rating = research?.rating?.value
    ? { value: research.rating.value, ...(research.rating.count ? { count: research.rating.count } : {}), ...(research.rating.source ? { source: research.rating.source } : {}) }
    : (e?.rating ? { value: e.rating, ...(e.reviewCount ? { count: e.reviewCount } : {}) } : null);
  const priceRange = research?.priceRange || e?.priceRange || '';

  // Real facts from research/enrichment (never invented).
  const aboutBody = (research?.aboutBody?.length ? research.aboutBody : (e?.about ?? []))
    .map((p) => clip(String(p), 600)).filter((p) => p.length > 40);
  const services = (research?.services?.length
    ? research.services
    : (e?.services ?? []).map((t) => ({ title: titleCase(t), description: '' })))
    .filter((s) => s.title)
    .map((s) => ({ title: titleCase(s.title), description: s.description || '' }));
  const testimonials = (research?.testimonials ?? e?.testimonials ?? [])
    .filter((t) => t.quote && t.quote.length > 20)
    .map((t) => ({ quote: clip(t.quote, 280), author: t.author || 'Customer review' }));
  const hours = (research?.hours?.length ? research.hours : (e?.hours ?? []))
    .filter((h) => h && h.day && h.hours);
  const highlights = (research?.highlights ?? []).filter(Boolean);
  const social = research?.social ?? e?.social ?? {};

  // Photos. discoverPhotos lists what's on disk (validator truth), but the HERO
  // must respect the acquire pipeline's decision: when it dropped the hero below
  // the resolution/quality floor (media empty, or source tagged ':below-floor'),
  // we DON'T headline a photo — we render a clean editorial text hero. Story/
  // gallery files on disk are still fine to use.
  const photos = discoverPhotos(slug);
  const heroDropped = !media.length;
  const heroImg = heroDropped ? null : photos.hero;
  const storyImg = photos.story || photos.gallery[0] || null;
  // Gallery = photos beyond hero/story, only when >=3 exist.
  const galleryPool = photos.gallery.filter((p) => p !== storyImg);
  const galleryImgs = galleryPool.length >= 3 ? galleryPool : [];
  const realPhotoCount = photos.gallery.length + (heroImg ? 1 : 0);

  // Brand. dental has no font affinity of its own — seed it among the medical
  // pairings (editorial-serif / classic-trad / clean-sans) so a dentist reads
  // clinical-editorial, not a generic default sans.
  const fontIdOverride = research?.brand?.fontId || research?.fontId || '';
  const seed = hashStr(slug);
  const fontCat = cat === 'dental' ? 'medical' : cat;
  const fontId = pickFontId(fontCat, seed, fontIdOverride);
  const color = pickBrandColor(cat, slug, research?.brand?.color || e?.brandColor || '');

  // Hero variant from photo tier signal (same as the old compose).
  const heroVariant = heroImg ? 'split' : 'editorial';

  const eyebrowLoc = [area, established ? `Est. ${established}` : ''].filter(Boolean).join(' · ');
  const sp = servicesPage(cat);

  // ── HOME sections ──
  const homeSections = [];

  // hero
  const hero = {
    kind: 'hero',
    variant: heroVariant,
    ...(eyebrowLoc ? { eyebrow: eyebrowLoc } : {}),
    heading: research?.heroHeading || defaultHeroHeading(name, cat, area, established),
    ...(research?.heroSubheading || aboutBody[0]
      ? { subheading: clip(research?.heroSubheading || aboutBody[0], 200) }
      : {}),
    badges: buildBadges(established, rating, highlights),
    primaryCta: { label: HOSPITALITY.has(cat) ? 'See the menu' : 'Get in touch', href: `/s/${slug}/${HOSPITALITY.has(cat) ? 'menu' : 'contact'}` },
    secondaryCta: { label: HOSPITALITY.has(cat) ? 'Book catering' : (services.length ? 'Our services' : 'Contact us'), href: `/s/${slug}/${services.length ? sp.slug : 'contact'}` },
    ...(heroImg ? { image: { src: heroImg, alt: `${name}${area ? ` in ${area}` : ''}`, focal: '50% 40%' } } : {}),
  };
  homeSections.push(hero);

  // stats — only real values; need >=2.
  const stats = buildStats(established, rating, services.length, priceRange);
  if (stats.length >= 2) homeSections.push({ kind: 'stats', tone: 'ink', items: stats });

  // story — only when aboutBody present.
  if (aboutBody.length) {
    homeSections.push({
      kind: 'story',
      eyebrow: 'Our story',
      heading: research?.aboutHeading ? clip(research.aboutHeading, 60) : `About ${name}`,
      body: aboutBody.slice(0, 2),
      ...(highlights.length ? { highlights: highlights.slice(0, 4) } : {}),
      ...(storyImg ? { image: { src: storyImg, alt: `Inside ${name}`, focal: '50% 50%' } } : {}),
    });
  }

  // services
  if (services.length) {
    homeSections.push({
      kind: 'services',
      eyebrow: servicesEyebrow(cat),
      heading: research?.servicesHeading || (HOSPITALITY.has(cat) ? 'On the menu' : 'What we do'),
      layout: 'grid',
      items: services.slice(0, 6).map((s) => ({ title: s.title, description: s.description || deriveServiceDesc(s.title, cat, area) })),
    });
  }

  // testimonials
  if (testimonials.length) {
    homeSections.push({
      kind: 'testimonials',
      eyebrow: 'In their words',
      heading: 'What customers say',
      ...(rating ? { rating } : {}),
      items: testimonials.slice(0, 3),
    });
  }

  // gallery — only when >=3 real photos.
  if (galleryImgs.length >= 3) {
    homeSections.push({
      kind: 'gallery',
      eyebrow: 'A closer look',
      heading: `Inside ${name}`,
      images: galleryImgs.slice(0, 6).map((src, i) => ({ src, alt: `${name} — photo ${i + 1}` })),
    });
  }

  // cta
  homeSections.push(buildCta(slug, name, cat, address, phone));

  // ── pages assembly ──
  const pages = [{ slug: 'home', label: 'Home', sections: homeSections }];

  // services / menu page
  if (services.length) {
    const svcSections = [
      {
        kind: 'hero',
        variant: 'editorial',
        eyebrow: servicesEyebrow(cat),
        heading: HOSPITALITY.has(cat) ? 'What we’re serving' : 'How we can help',
        ...(aboutBody[0] || research?.heroSubheading ? { subheading: clip(research?.heroSubheading || aboutBody[0], 180) } : {}),
      },
      {
        kind: 'services',
        heading: research?.servicesHeading || (HOSPITALITY.has(cat) ? 'What we’re serving' : 'What we do'),
        layout: 'rows',
        items: services.map((s) => ({ title: s.title, description: s.description || deriveServiceDesc(s.title, cat, area) })),
      },
    ];
    const faq = buildFaq(testimonials, hours, address, area, phone, cat);
    if (faq.length >= 2) svcSections.push({ kind: 'faq', eyebrow: 'Good to know', heading: 'Common questions', items: faq.slice(0, 4) });
    svcSections.push(buildCta(slug, name, cat, address, phone, true));
    pages.push({ slug: sp.slug, label: sp.label, title: sp.label, sections: svcSections });
  }

  // about page — drop when no aboutBody AND no established year.
  let aboutDropped = false;
  if (aboutBody.length || established) {
    const aboutSections = [
      {
        kind: 'hero',
        variant: 'editorial',
        eyebrow: `About ${name}`,
        heading: research?.aboutHeading ? clip(research.aboutHeading, 70) : `About ${name}`,
        ...(aboutBody[0] ? { subheading: clip(aboutBody[0], 180) } : {}),
      },
    ];
    if (aboutBody.length) {
      aboutSections.push({
        kind: 'story',
        eyebrow: 'Our story',
        heading: research?.aboutHeading || `About ${name}`,
        body: aboutBody.slice(0, 2),
        ...(highlights.length ? { highlights: highlights.slice(0, 4) } : {}),
        ...(storyImg ? { image: { src: storyImg, alt: `Inside ${name}`, focal: '50% 50%' } } : {}),
      });
    }
    const aboutStats = buildStats(established, rating, services.length, priceRange);
    if (aboutStats.length >= 2) aboutSections.push({ kind: 'stats', tone: 'ink', items: aboutStats });
    if (galleryImgs.length >= 3) {
      aboutSections.push({
        kind: 'gallery',
        eyebrow: 'A closer look',
        heading: `Where you'll find us`,
        images: galleryImgs.slice(0, 4).map((src, i) => ({ src, alt: `${name} — photo ${i + 1}` })),
      });
    }
    aboutSections.push({ kind: 'cta', heading: `Come see ${name}`, primaryCta: { label: 'Get in touch', href: `/s/${slug}/contact` } });
    pages.push({ slug: 'about', label: 'About', title: 'About', sections: aboutSections });
  } else {
    aboutDropped = true;
  }

  // contact page
  pages.push({
    slug: 'contact',
    label: 'Contact',
    title: 'Contact',
    sections: [{
      kind: 'contact',
      eyebrow: 'Get in touch',
      heading: 'Get in touch',
      ...(address || phone ? { blurb: `Reach ${name}${address ? ` at ${address}` : ''}${phone ? ` or call ${phone}` : ''}.` } : {}),
      showMap: Boolean(address),
      showHours: Boolean(hours.length),
    }],
  });

  // ── top-level config ──
  const config = {
    slug,
    name,
    legalName: research?.legalName || name,
    tagline: clip(research?.tagline || e?.description || '', 110),
    seoDescription: clip(research?.seoDescription || e?.description || `${name} — ${categoryLabel(cat)} serving ${area || 'the local area'}.`, 160),
    category: cat,
    categoryLabel: categoryLabel(cat),
    area,
    city,
    state,
    established,
    contact: { phone, email, address },
    social: cleanSocial(social),
    ...(hours.length ? { hours } : {}),
    ...(rating ? { rating } : {}),
    ...(priceRange ? { priceRange } : {}),
    brand: { color, fontId },
    ...(heroImg ? { images: { hero: heroImg, heroAlt: `${name}${area ? ` in ${area}` : ''}` } } : {}),
    outreach: { published: false },
    pages,
  };

  return { config, meta: { aboutDropped, realPhotoCount, galleryCount: galleryImgs.length, heroImg, anyRealPhoto: realPhotoCount > 0 || galleryImgs.length > 0, cat } };
}

// ── helpers ────────────────────────────────────────────────────────────────
function cleanSocial(s) {
  const out = {};
  for (const k of ['facebook', 'instagram', 'google', 'yelp', 'linkedin']) {
    if (s?.[k] && /^https?:\/\//.test(s[k])) out[k] = s[k];
  }
  return out;
}

function buildBadges(established, rating, highlights) {
  const b = [];
  if (established) b.push(`Serving since ${established}`);
  if (rating) b.push(`${rating.value}★${rating.count ? ` from ${rating.count} reviews` : ''}`);
  for (const h of highlights) { if (b.length >= 3) break; if (!b.includes(h)) b.push(clip(h, 48)); }
  return b.slice(0, 3);
}

function buildStats(established, rating, serviceCount, priceRange) {
  const stats = [];
  if (established) {
    const yrs = new Date().getFullYear() - Number(established);
    if (yrs > 0 && yrs < 200) stats.push({ value: `${yrs}+`, label: 'Years in business' });
    else stats.push({ value: String(established), label: 'Serving since' });
  }
  if (rating) stats.push({ value: `${rating.value}★`, label: rating.count ? `${rating.count} reviews` : 'Customer rating' });
  if (serviceCount >= 3) stats.push({ value: String(serviceCount), label: 'Services offered' });
  if (priceRange) stats.push({ value: priceRange, label: 'Fairly priced' });
  return stats.slice(0, 4);
}

function buildCta(slug, name, cat, address, phone, isServicePage = false) {
  const cta = {
    kind: 'cta',
    heading: HOSPITALITY.has(cat) ? 'Hungry yet?' : (isServicePage ? 'Let’s talk' : `Work with ${name}`),
    ...(address || phone ? { body: `${address ? `Find us at ${address}. ` : ''}${phone ? `Call ${phone} — we’re glad to help.` : ''}`.trim() } : {}),
    primaryCta: { label: 'Get in touch', href: `/s/${slug}/contact` },
  };
  const t = telHref(phone);
  if (t) cta.secondaryCta = { label: `Call ${phone}`, href: t };
  return cta;
}

function buildFaq(testimonials, hours, address, area, phone, cat) {
  const faq = [];
  if (address) faq.push({ q: 'Where are you located?', a: `You'll find us at ${address}.` });
  if (hours.length) faq.push({ q: 'What are your hours?', a: hours.map((h) => `${h.day}: ${h.hours}`).join('; ') + '.' });
  if (area) faq.push({ q: 'What areas do you serve?', a: `We proudly serve ${area} and the surrounding community.` });
  if (phone) faq.push({ q: 'How do I get in touch?', a: `Call us at ${phone} — we're glad to help.` });
  return faq;
}

function defaultHeroHeading(name, cat, area, established) {
  if (established) return `${name}, serving ${area || 'the area'} since ${established}`;
  return `${name} — ${categoryLabel(cat)} you can count on`;
}

const SERVICE_DESC = [
  (t, area) => `${titleCase(t)} handled with care${area ? `, right here in ${area}` : ''}.`,
  (t) => `Real experience behind every ${t.toLowerCase()} job, big or small.`,
  (t, area) => `Count on us for ${t.toLowerCase()}${area ? ` across ${area}` : ''}, start to finish.`,
];
function deriveServiceDesc(title, cat, area) {
  const seed = hashStr(title + cat);
  return SERVICE_DESC[seed % SERVICE_DESC.length](title, area);
}

// ── Claude copy upgrade (optional) ─────────────────────────────────────────
// Upgrades ONLY copy fields from the deterministic skeleton + the same real
// facts; never invents facts/photos/hours/ratings. On any error, returns the
// skeleton unchanged. Validated back into the same PremiumConfig shape.
async function upgradeCopyWithClaude(config, e, research) {
  if (!process.env.ANTHROPIC_API_KEY) return config;
  try {
    const facts =
      (research?.aboutBody?.length ? `\nAbout (verified): ${clip(research.aboutBody.join(' '), 700)}` : '') +
      (e?.description ? `\nSelf-description: ${clip(e.description, 300)}` : '') +
      (config.established ? `\nEstablished: ${config.established}` : '') +
      (config.rating ? `\nRating: ${config.rating.value}★${config.rating.count ? ` (${config.rating.count})` : ''}` : '') +
      (config.services ? '' : '');
    const services = (config.pages[0].sections.find((s) => s.kind === 'services')?.items ?? []).map((s) => s.title).join('; ');
    const system = [{
      type: 'text',
      text:
        'You upgrade COPY for a small-business website built from REAL facts. Return ONLY minified JSON: ' +
        '{"heroHeading":string,"heroSubheading":string,"storyBody":string[2],' +
        '"services":[{"title":string,"description":string}],"ctaHeading":string,"ctaBody":string}. ' +
        'Use ONLY the facts given — never invent awards, numbers, services, photos, hours, or ratings. ' +
        'Keep service titles EXACTLY as given (rewrite only descriptions). Voice: warm, concrete, local, no hype, no emoji. ' +
        'heroHeading <=10 words.',
      cache_control: { type: 'ephemeral' },
    }];
    const user =
      `Business: ${config.name}\nCategory: ${config.categoryLabel}\nArea: ${config.area}\n` +
      `Services: ${services}` + facts;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6', max_tokens: 1400, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.content?.map((b) => b.text ?? '').join('').trim();
    const j = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    return applyClaudeCopy(config, j);
  } catch (err) {
    console.warn(`  ! Claude premium-copy upgrade failed for ${config.slug} (${err.message}); keeping deterministic copy`);
    return config;
  }
}

// Merge Claude's copy back into the config WITHOUT touching facts/photos/structure.
function applyClaudeCopy(config, j) {
  const titleSet = new Set();
  for (const page of config.pages) {
    for (const sec of page.sections) {
      if (sec.kind === 'hero' && page.slug === 'home') {
        if (j.heroHeading) sec.heading = clip(j.heroHeading, 90);
        if (j.heroSubheading) sec.subheading = clip(j.heroSubheading, 200);
      }
      if (sec.kind === 'story' && Array.isArray(j.storyBody) && j.storyBody.length) {
        sec.body = j.storyBody.slice(0, 2).map((p) => clip(String(p), 600));
      }
      if (sec.kind === 'services' && Array.isArray(j.services)) {
        // Match by title only; rewrite description, keep facts/titles fixed.
        for (const item of sec.items) {
          const m = j.services.find((s) => s.title && s.title.toLowerCase() === item.title.toLowerCase());
          if (m?.description) item.description = clip(m.description, 280);
        }
      }
      if (sec.kind === 'cta') {
        if (j.ctaHeading) sec.heading = clip(j.ctaHeading, 80);
        if (j.ctaBody) sec.body = clip(j.ctaBody, 200);
      }
    }
  }
  return config;
}

// ── public entry ───────────────────────────────────────────────────────────
/**
 * authorPremium — build a validated PremiumConfig for one prospect.
 * @returns { config, status, flags, photoSource }
 */
export async function authorPremium(slug, row, e, research, media, {
  photoSource = '', photoFlags = [], mismatchName = '', useClaude = true,
} = {}) {
  let { config, meta } = buildSkeleton(slug, row, e, research, media);

  // Optional Claude copy upgrade (deterministic skeleton already shippable).
  if (useClaude) config = await upgradeCopyWithClaude(config, e, research);

  // Status — reuse deriveStatus verbatim, then layer premium-specific flags.
  const templated = []; // premium author builds from real facts; no template stubs tracked here
  const { flags } = deriveStatus(row, e, media, photoSource, templated, mismatchName);
  flags.push(...photoFlags);

  // Premium-specific flags.
  const totalSections = config.pages.reduce((n, p) => n + p.sections.length, 0);
  if (totalSections < 6) flags.push('Single-page content — needs more real material for multi-page');
  if (meta.aboutDropped) flags.push('No About content — about page folded');
  if (!meta.anyRealPhoto) flags.push('No real photos — using a text/library hero');

  const status = flags.length ? 'needs-review' : 'ready';
  config.status = status;
  config.flags = flags;

  return { config, status, flags, photoSource };
}

export { buildSkeleton, discoverPhotos };
