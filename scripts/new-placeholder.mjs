#!/usr/bin/env node
/**
 * new-placeholder.mjs — scaffold an HONEST placeholder prospect for a lead that
 * has no website and no findable online info, so you can show them the DESIGN
 * before you have their real facts.
 *
 * It writes a prospect JSON that:
 *   - uses a TEXT-FORWARD hero (no fake photo — nothing fabricated),
 *   - fills representative, category-appropriate services/stats copy,
 *   - uses a reserved-fiction phone (555-0100) and NO invented owner / founding
 *     year / street address / reviews,
 *   - is flagged `needs-review` with explicit "replace this" notes,
 * so the audit blocks it from shipping until you swap in the real details.
 *
 * Usage:
 *   node scripts/new-placeholder.mjs <slug> "Business Name" [category] [area]
 * Example:
 *   node scripts/new-placeholder.mjs built-rite-marine "Built Rite Marine" marina "Sonoma County, CA"
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');

const [slug, name, category = 'default', area = ''] = process.argv.slice(2);
if (!slug || !name) {
  console.error('Usage: node scripts/new-placeholder.mjs <slug> "Business Name" [category] [area]');
  process.exit(1);
}

// Representative, clearly-generic copy per category. NOT real claims — a starting
// point to replace with what the business actually does.
const TEMPLATES = {
  marina: {
    brand: '#1c5066',
    heading: 'Built right. Runs right.',
    sub: 'Boat, dock, and trailer repair — fixed right the first time so you get back on the water.',
    servicesHeading: 'What we fix',
    services: [
      ['Outboard & sterndrive service', 'Tune-ups, diagnostics, water pumps, and repower — keep your rig starting on the first turn.'],
      ['Hull, fiberglass & gelcoat', 'Fiberglass and gelcoat repair, blister work, and clean bottom paint.'],
      ['Docks, lifts & pilings', 'Build, re-deck, and repair docks and gangways; install and service boat lifts.'],
      ['Trailers, bearings & brakes', 'Bearings, lights, brakes, and frame work so the trip to the launch is easy.'],
      ['Winterizing & storage prep', 'Winterize, fog the engine, and shrink-wrap for a painless spring launch.'],
      ['Mobile dockside service', 'Most jobs handled on-site at your slip, dock, or driveway.'],
    ],
    stats: [['Mobile', 'We come to you'], ['24 hrs', 'Most quotes back within'], ['Up-front', 'Priced before we start']],
  },
  towing: {
    brand: '#d4452a',
    heading: 'Stuck? We roll now.',
    sub: 'Fast, fair towing and roadside help, day or night.',
    servicesHeading: 'What we do',
    services: [
      ['Light & medium-duty towing', 'Cars, trucks, and vans moved safely on a clean flatbed.'],
      ['Roadside assistance', 'Jump-starts, lockouts, fuel delivery, and tire changes.'],
      ['Accident recovery', 'Careful recovery and secure transport after a collision.'],
      ['Winch-outs', 'Off-road, ditch, and mud recovery without more damage.'],
      ['Secure impound & storage', 'Monitored lot with clear, fair release.'],
    ],
    stats: [['24/7', 'Always on call'], ['Fast', 'Quick ETA'], ['Fair', 'Up-front pricing']],
  },
  plumbing: {
    brand: '#1f6feb',
    heading: 'No surprises. Just plumbing done right.',
    sub: 'Honest diagnosis, an up-front price, and it is fixed right the first time.',
    servicesHeading: 'What we fix',
    services: [
      ['Leak detection & repair', 'Find the leak before opening a wall — less demo, lower cost.'],
      ['Drain & sewer cleaning', 'Clear clogs and camera-inspect the line so it stays clear.'],
      ['Water heaters', 'Tank and tankless repair, replacement, and same-day installs.'],
      ['Repipes & remodels', 'PEX or copper, permitted and inspected, cleaned up after.'],
    ],
    stats: [['Same-day', 'On most calls'], ['Up-front', 'Priced before we start'], ['Licensed', '& insured']],
  },
  default: {
    brand: '#2b3a55',
    heading: `Welcome to ${name}.`,
    sub: 'Honest work, fair prices, and the job done right the first time.',
    servicesHeading: 'What we do',
    services: [
      ['Our core service', 'Replace this with what you actually offer, described in real specifics.'],
      ['A second service', 'Replace this with a real service and the detail that makes it yours.'],
      ['A third service', 'Replace this with a real service customers actually ask for.'],
    ],
    stats: [['Local', 'Right here at home'], ['Fair', 'Up-front pricing'], ['Done right', 'The first time']],
  },
};

const t = TEMPLATES[category] || TEMPLATES.default;
const PHONE = '(555) 555-0100'; // reserved-fiction — unmistakably a placeholder

const services = t.services.map(([title, description]) => ({ title, description }));

const config = {
  name,
  category,
  tagline: t.sub,
  seoDescription: `${name} — ${t.sub} ${area ? `Serving ${area}.` : ''}`.trim(),
  area,
  established: '',
  contact: { phone: PHONE, email: '', address: '' },
  social: { facebook: '', instagram: '', google: '' },
  hero: { heading: t.heading, subheading: t.sub, ctaText: 'Get a quote', ctaHref: '#contact' },
  highlights: [area ? `Serving ${area}` : 'Locally owned', 'Up-front pricing', 'Done right the first time'],
  images: { hero: '', heroAlt: '', story: '', storyAlt: '', storyCaption: '', storyCredit: '', placeholder: '/images/library/default/hero.svg' },
  about: {
    heading: `About ${name}`,
    body: [
      `${name} is a placeholder demo — replace this with the real story: who they are, how long they have been at it, and what makes them the one to call${area ? ` in ${area}` : ''}.`,
      'Keep it about the work and the specifics — no invented facts until you can confirm them.',
    ],
    signature: '',
  },
  servicesHeading: t.servicesHeading,
  services,
  hours: [{ day: 'Mon – Sat', hours: 'By appointment — call to schedule' }],
  hoursNote: 'Call or text to book — replace with real hours.',
  sections: [
    { type: 'services-detailed', eyebrow: 'Services', heading: t.servicesHeading, items: services },
    { type: 'stats', items: t.stats.map(([value, label]) => ({ value, label })) },
    ...(area ? [{ type: 'service-area', heading: `Serving ${area}`, areas: area.split(/,|·/).map((s) => s.trim()).filter(Boolean) }] : []),
    {
      type: 'hours-contact',
      heading: 'Get a quote',
      hours: [{ day: 'Mon – Sat', hours: 'By appointment — call to schedule' }],
      phone: PHONE,
      cta: { text: 'Call or text', href: '#contact' },
    },
  ],
  heroVariant: 'statement',
  artDirection: { archetype: category === 'default' ? 'classic' : 'utility', shape: 'sharp', motion: 'subtle' },
  status: 'needs-review',
  flags: [
    'PLACEHOLDER DEMO — no website/listing found; shows the DESIGN only.',
    `Replace: phone (currently reserved-fiction ${PHONE}), email, hours, and address.`,
    'Replace copy + services with what they ACTUALLY do; add their real photos for the hero/gallery.',
    'No testimonials, founding year, or owner story invented — add real ones.',
  ],
  theme: { brand: t.brand, brandDark: '#10202f' },
};

const path = join(PROSPECTS, `${slug}.json`);
try {
  await readFile(path, 'utf8');
  console.error(`✗ ${slug}.json already exists — pick a new slug or edit it directly.`);
  process.exit(1);
} catch {
  /* doesn't exist — good */
}

await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log(`✓ wrote ${slug}.json  (${category}, flagged needs-review)`);
console.log('\nNext:');
console.log('  1. Replace the flagged placeholders with real facts as you get them.');
console.log('  2. Drop real photos in src/assets/prospects/' + slug + '/ (hero.jpg, story.jpg, …).');
console.log('  3. cd sites/demo-gallery && npm run build  &&  node ../../scripts/audit.mjs');
