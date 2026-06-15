#!/usr/bin/env node
/**
 * build-image-library.mjs — generate the built-in fallback image library.
 *
 * Produces a tasteful, category-themed hero + story background (SVG) for each
 * business category, committed to the gallery so demos always have polished
 * art even with no network and no API keys. Wikimedia photos (when available)
 * override these per prospect; this is the always-works floor.
 *
 * Two roles, both deterministic:
 *   • {hero,story}.svg — the photo pipeline's last-tier fallback (full-bleed
 *     painterly gradient scene). Treated as STOCK by the audit (.svg), never as
 *     a real photo.
 *   • motif.svg — an AVISP-style ABSTRACT/illustrative panel tinted to
 *     `currentColor` so it picks up the brand. The premium editorial hero uses
 *     it as a decorative backdrop behind the type when there's no real photo —
 *     it stays clearly illustrative (line-art motif), never posing as a photo.
 *
 * Usage:  node scripts/build-image-library.mjs
 * Output: sites/demo-gallery/public/images/library/<category>/{hero,story,motif}.svg
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'sites', 'demo-gallery', 'public', 'images', 'library');

// [light, deep, accent] per category — same brand families as the generator.
// The hero/story scenes use these literal colors; the motif uses currentColor.
const PALETTES = {
  towing: ['#e2573b', '#1f2933', '#f2b134'],
  cafe: ['#c2683a', '#3b2f2a', '#e3b778'],
  restaurant: ['#b6452f', '#2c1d18', '#e0a24f'],
  plumbing: ['#2f86f0', '#16324f', '#7fd4e8'],
  hvac: ['#2f86f0', '#16324f', '#8fd0e0'],
  electrician: ['#f2b134', '#1c2530', '#ffd76a'],
  roofing: ['#8a6a4a', '#2a2018', '#d2a878'],
  contractor: ['#c08a3e', '#262019', '#e6c182'],
  cleaning: ['#2bb0a6', '#193a38', '#8fe0d6'],
  salon: ['#c56a92', '#2e2230', '#e9b6cd'],
  spa: ['#7fae8e', '#22302a', '#cfe6cf'],
  barber: ['#3f5a73', '#1a222c', '#9ab0c4'],
  fitness: ['#e2573b', '#1c1f24', '#f2a047'],
  landscaping: ['#3aa050', '#22321f', '#bfe06a'],
  marina: ['#1f7fa6', '#142a36', '#7fc6d9'],
  'auto-repair': ['#e8961f', '#23272e', '#f4d35e'],
  tattoo: ['#c2185b', '#1a1620', '#e8a0c0'],
  dental: ['#3a8fb0', '#16323d', '#9fd6e6'],
  medical: ['#2f86a0', '#15303a', '#8fcadb'],
  winery: ['#8e3b4a', '#2b1a22', '#d9a05b'],
  default: ['#c2683a', '#243b53', '#e0b074'],
};

// Per-category motif glyph — a small set of deterministic line-art primitives
// drawn in `currentColor` (so the brand tints them). Each returns SVG fragment
// markup positioned in a 0..1000 x 0..650 viewBox space (filled by the caller).
const G = (w, h) => ({ x: (n) => Math.round(n * w), y: (n) => Math.round(n * h) });
function motifGlyph(cat, w, h) {
  const { x, y } = G(w, h);
  const stroke = `stroke="currentColor" fill="none" stroke-width="${Math.round(h * 0.012)}" stroke-linecap="round" stroke-linejoin="round"`;
  const fill = `fill="currentColor"`;
  switch (cat) {
    case 'dental':
    case 'medical':
      // Cross / tooth-ish rounded form + pulse line.
      return `
      <path d="M ${x(0.62)} ${y(0.28)} q ${x(0.06)} ${y(-0.12)} ${x(0.12)} 0 q ${x(0.05)} ${y(0.14)} 0 ${y(0.34)} q ${x(-0.03)} ${y(0.1)} ${x(-0.06)} 0 q ${x(-0.03)} ${y(-0.1)} ${x(-0.06)} 0 q ${x(-0.05)} ${y(0.1)} ${x(-0.06)} ${y(-0.34)} q ${x(-0.05)} ${y(-0.14)} ${x(0.12)} 0 Z" ${stroke} opacity="0.9"/>
      <path d="M ${x(0.2)} ${y(0.78)} h ${x(0.18)} l ${x(0.05)} ${y(-0.14)} l ${x(0.07)} ${y(0.28)} l ${x(0.05)} ${y(-0.14)} h ${x(0.18)}" ${stroke} opacity="0.55"/>`;
    case 'spa':
    case 'salon':
      // Leaf / petal fan.
      return `<g ${stroke} opacity="0.8">
        ${[0, 1, 2, 3, 4].map((i) => {
          const a = (-0.5 + i * 0.25);
          const cx = x(0.7), cy = y(0.62);
          return `<path d="M ${cx} ${cy} q ${Math.round(Math.cos(a) * w * 0.18)} ${Math.round(Math.sin(a - 1.2) * h * 0.34)} ${Math.round(Math.cos(a - 0.2) * w * 0.02)} ${-Math.round(h * 0.34)}"/>`;
        }).join('')}
      </g>`;
    case 'barber':
      // Barber pole stripes + comb.
      return `<g ${stroke} opacity="0.8">
        <rect x="${x(0.62)}" y="${y(0.2)}" width="${x(0.1)}" height="${y(0.55)}" rx="${x(0.05)}"/>
        <path d="M ${x(0.62)} ${y(0.32)} l ${x(0.1)} ${y(-0.08)} M ${x(0.62)} ${y(0.46)} l ${x(0.1)} ${y(-0.08)} M ${x(0.62)} ${y(0.6)} l ${x(0.1)} ${y(-0.08)}"/>
      </g>`;
    case 'fitness':
      // Dumbbell.
      return `<g ${stroke} opacity="0.85">
        <line x1="${x(0.4)}" y1="${y(0.5)}" x2="${x(0.78)}" y2="${y(0.5)}"/>
        <rect x="${x(0.34)}" y="${y(0.36)}" width="${x(0.06)}" height="${y(0.28)}" rx="${x(0.02)}"/>
        <rect x="${x(0.78)}" y="${y(0.36)}" width="${x(0.06)}" height="${y(0.28)}" rx="${x(0.02)}"/>
      </g>`;
    case 'plumbing':
    case 'hvac':
      // Pipe bend + droplet.
      return `<g ${stroke} opacity="0.8">
        <path d="M ${x(0.4)} ${y(0.3)} v ${y(0.2)} q 0 ${y(0.18)} ${x(0.16)} ${y(0.18)} h ${x(0.2)}"/>
        <path d="M ${x(0.7)} ${y(0.7)} q ${x(0.07)} ${y(-0.12)} 0 ${y(-0.2)} q ${x(-0.07)} ${y(0.08)} 0 ${y(0.2)} Z" ${fill} opacity="0.5"/>
      </g>`;
    case 'electrician':
      // Bolt.
      return `<path d="M ${x(0.62)} ${y(0.22)} l ${x(-0.1)} ${y(0.3)} h ${x(0.08)} l ${x(-0.08)} ${y(0.26)} l ${x(0.2)} ${y(-0.34)} h ${x(-0.09)} l ${x(0.08)} ${y(-0.22)} Z" ${stroke} opacity="0.85"/>`;
    case 'roofing':
    case 'contractor':
      // Roofline / house frame.
      return `<g ${stroke} opacity="0.8">
        <path d="M ${x(0.34)} ${y(0.56)} l ${x(0.2)} ${y(-0.26)} l ${x(0.2)} ${y(0.26)}"/>
        <path d="M ${x(0.4)} ${y(0.52)} v ${y(0.22)} h ${x(0.28)} v ${y(-0.22)}"/>
      </g>`;
    case 'cleaning':
      // Sparkle cluster.
      return `<g ${stroke} opacity="0.8">
        ${[[0.6, 0.4, 0.12], [0.78, 0.58, 0.08], [0.5, 0.66, 0.06]].map(([cx, cy, r]) =>
          `<path d="M ${x(cx)} ${y(cy - r)} v ${y(2 * r)} M ${x(cx - r)} ${y(cy)} h ${x(2 * r)}"/>`).join('')}
      </g>`;
    case 'auto-repair':
    case 'towing':
      // Gear ring.
      return `<g ${stroke} opacity="0.8">
        <circle cx="${x(0.64)}" cy="${y(0.5)}" r="${y(0.18)}"/>
        <circle cx="${x(0.64)}" cy="${y(0.5)}" r="${y(0.07)}"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2;
          return `<line x1="${x(0.64) + Math.round(Math.cos(a) * y(0.18))}" y1="${y(0.5) + Math.round(Math.sin(a) * y(0.18))}" x2="${x(0.64) + Math.round(Math.cos(a) * y(0.25))}" y2="${y(0.5) + Math.round(Math.sin(a) * y(0.25))}"/>`;
        }).join('')}
      </g>`;
    case 'tattoo':
      // Needle + line flourish.
      return `<g ${stroke} opacity="0.8">
        <path d="M ${x(0.38)} ${y(0.7)} q ${x(0.2)} ${y(-0.4)} ${x(0.4)} ${y(-0.2)}"/>
        <circle cx="${x(0.78)}" cy="${y(0.5)}" r="${y(0.03)}" ${fill}/>
      </g>`;
    case 'cafe':
    case 'restaurant':
      // Cup + steam (cafe) / fork+knife feel.
      return `<g ${stroke} opacity="0.82">
        <path d="M ${x(0.46)} ${y(0.46)} h ${x(0.22)} v ${y(0.12)} q 0 ${y(0.14)} ${x(-0.11)} ${y(0.14)} q ${x(-0.11)} 0 ${x(-0.11)} ${y(-0.14)} Z"/>
        <path d="M ${x(0.68)} ${y(0.5)} q ${x(0.06)} ${y(0.02)} ${x(0.06)} ${y(0.08)} q 0 ${y(0.06)} ${x(-0.06)} ${y(0.06)}"/>
        <path d="M ${x(0.5)} ${y(0.4)} q ${x(0.03)} ${y(-0.05)} 0 ${y(-0.1)} M ${x(0.58)} ${y(0.4)} q ${x(0.03)} ${y(-0.05)} 0 ${y(-0.1)}"/>
      </g>`;
    case 'winery':
      // Glass + grape.
      return `<g ${stroke} opacity="0.82">
        <path d="M ${x(0.5)} ${y(0.34)} h ${x(0.16)} q 0 ${y(0.2)} ${x(-0.08)} ${y(0.2)} q ${x(-0.08)} 0 ${x(-0.08)} ${y(-0.2)} M ${x(0.58)} ${y(0.54)} v ${y(0.16)} M ${x(0.52)} ${y(0.7)} h ${x(0.12)}"/>
      </g>`;
    case 'landscaping':
    case 'marina':
      // Hills / waves.
      return `<g ${stroke} opacity="0.78">
        <path d="M ${x(0.3)} ${y(0.6)} q ${x(0.12)} ${y(-0.16)} ${x(0.24)} 0 q ${x(0.12)} ${y(-0.16)} ${x(0.24)} 0"/>
        <path d="M ${x(0.3)} ${y(0.72)} q ${x(0.12)} ${y(-0.16)} ${x(0.24)} 0 q ${x(0.12)} ${y(-0.16)} ${x(0.24)} 0"/>
      </g>`;
    default:
      // Concentric arcs — neutral but composed.
      return `<g ${stroke} opacity="0.7">
        <circle cx="${x(0.68)}" cy="${y(0.5)}" r="${y(0.3)}"/>
        <circle cx="${x(0.68)}" cy="${y(0.5)}" r="${y(0.18)}"/>
      </g>`;
  }
}

// A soft, premium abstract scene: diagonal gradient + layered translucent
// blobs + a vignette. Reads as a designed photo backdrop under the hero scrim.
function svg(w, h, [light, deep, accent]) {
  const r = (n) => Math.round(n);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${deep}"/>
      <stop offset="0.55" stop-color="${light}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.7" cy="0.25" r="0.8">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.55" r="0.75">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.28"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${r(w * 0.78)}" cy="${r(h * 0.2)}" r="${r(h * 0.55)}" fill="url(#glow)"/>
  <g opacity="0.16" fill="#ffffff">
    <circle cx="${r(w * 0.18)}" cy="${r(h * 0.82)}" r="${r(h * 0.42)}"/>
    <circle cx="${r(w * 0.62)}" cy="${r(h * 0.95)}" r="${r(h * 0.5)}"/>
  </g>
  <g opacity="0.10" stroke="#ffffff" stroke-width="2" fill="none">
    <path d="M0 ${r(h * 0.7)} Q ${r(w * 0.3)} ${r(h * 0.55)} ${r(w * 0.6)} ${r(h * 0.72)} T ${w} ${r(h * 0.68)}"/>
    <path d="M0 ${r(h * 0.82)} Q ${r(w * 0.35)} ${r(h * 0.68)} ${r(w * 0.7)} ${r(h * 0.84)} T ${w} ${r(h * 0.8)}"/>
  </g>
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
</svg>
`;
}

// The MOTIF: an abstract, illustrative panel drawn in currentColor so the
// premium hero/callout can tint it to the brand. Deliberately NOT photographic
// — soft tinted wash + concentric guide rings + a category line-art glyph. The
// consumer wraps it with `color:<brand>` and low opacity behind type.
function motifSvg(cat, w, h) {
  const r = (n) => Math.round(n);
  const glyph = motifGlyph(cat, w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="wash" cx="0.72" cy="0.3" r="0.85">
      <stop offset="0" stop-color="currentColor" stop-opacity="0.18"/>
      <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#wash)"/>
  <g stroke="currentColor" fill="none" stroke-width="${r(h * 0.004)}" opacity="0.12">
    <circle cx="${r(w * 0.74)}" cy="${r(h * 0.34)}" r="${r(h * 0.5)}"/>
    <circle cx="${r(w * 0.74)}" cy="${r(h * 0.34)}" r="${r(h * 0.34)}"/>
    <circle cx="${r(w * 0.74)}" cy="${r(h * 0.34)}" r="${r(h * 0.18)}"/>
  </g>
  <g color="currentColor">${glyph}</g>
</svg>
`;
}

const categories = Object.keys(PALETTES);
for (const cat of categories) {
  const dir = join(LIB, cat);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'hero.svg'), svg(1600, 900, PALETTES[cat]));
  await writeFile(join(dir, 'story.svg'), svg(1200, 900, PALETTES[cat]));
  await writeFile(join(dir, 'motif.svg'), motifSvg(cat, 1000, 650));
  console.log(`  ✓ ${cat}/hero.svg + story.svg + motif.svg`);
}
console.log(`\nGenerated library art for ${categories.length} categories in sites/demo-gallery/public/images/library/`);
