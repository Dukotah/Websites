#!/usr/bin/env node
/**
 * build-image-library.mjs — generate the built-in fallback image library.
 *
 * Produces a tasteful, category-themed hero + story background (SVG) for each
 * business category, committed to the gallery so demos always have polished
 * art even with no network and no API keys. Wikimedia photos (when available)
 * override these per prospect; this is the always-works floor.
 *
 * Usage:  node scripts/build-image-library.mjs
 * Output: sites/demo-gallery/public/images/library/<category>/{hero,story}.svg
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'sites', 'demo-gallery', 'public', 'images', 'library');

// [light, deep, accent] per category — same brand families as the generator.
const PALETTES = {
  towing: ['#e2573b', '#1f2933', '#f2b134'],
  cafe: ['#c2683a', '#3b2f2a', '#e3b778'],
  plumbing: ['#2f86f0', '#16324f', '#7fd4e8'],
  salon: ['#c56a92', '#2e2230', '#e9b6cd'],
  landscaping: ['#3aa050', '#22321f', '#bfe06a'],
  'auto-repair': ['#e8961f', '#23272e', '#f4d35e'],
  tattoo: ['#c2185b', '#1a1620', '#e8a0c0'],
  winery: ['#8e3b4a', '#2b1a22', '#d9a05b'],
  default: ['#c2683a', '#243b53', '#e0b074'],
};

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

const categories = Object.keys(PALETTES);
for (const cat of categories) {
  const dir = join(LIB, cat);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'hero.svg'), svg(1600, 900, PALETTES[cat]));
  await writeFile(join(dir, 'story.svg'), svg(1200, 900, PALETTES[cat]));
  console.log(`  ✓ ${cat}/hero.svg + story.svg`);
}
console.log(`\nGenerated library art for ${categories.length} categories in sites/demo-gallery/public/images/library/`);
