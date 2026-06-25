#!/usr/bin/env node
/**
 * design-pass.mjs — AI design-director pass that lifts a prospect from
 * "configured" to "designed."
 *
 * For each prospect JSON (or one by --slug arg), calls the Anthropic Messages
 * API with the business's real facts and asks for:
 *   - A one-line concept/angle
 *   - A chosen archetype (classic|editorial|utility|magazine)
 *   - Optional fontId + accentStrategy + shape overrides (valid per src/lib/)
 *   - Rewritten copy in a distinct brand voice using ONLY real facts
 *
 * Merges the result into the JSON:
 *   - config.artDirection.archetype + overrides
 *   - config.hero / config.about / config.tagline
 *   - config.services[].description
 *
 * WITHOUT a key: prints clear setup guidance and exits 0 (no-op).
 * Key-free-safe; never throws on a single failure (skip + continue).
 *
 * Usage:
 *   node scripts/design-pass.mjs [--slug <slug>] [--dry-run]
 *
 * Options:
 *   --slug <slug>   Process only the prospect with this slug
 *   --dry-run       Print what would change without writing files
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const slugArg = (() => {
  const i = args.indexOf('--slug');
  return i !== -1 ? args[i + 1] : null;
})();
const dryRun = args.includes('--dry-run');

// ---------------------------------------------------------------------------
// Valid values — must match src/lib/ definitions so the engine can consume them
// ---------------------------------------------------------------------------
const VALID_ARCHETYPES = new Set(['classic', 'editorial', 'utility', 'magazine']);
const VALID_FONT_IDS = new Set([
  'editorial-serif',
  'modern-grotesk',
  'warm-humanist',
  'rugged-slab',
  'classic-trad',
  'clean-sans',
  'organic-serif',
  'bold-display',
  'boutique-contrast',
  'handcrafted',
]);
const VALID_ACCENT_STRATEGIES = new Set(['analogous', 'complementary']);
const VALID_SHAPES = new Set(['soft', 'sharp', 'editorial', 'rounded-pill', 'framed']);

// ---------------------------------------------------------------------------
// No-key path: print guidance and exit 0
// ---------------------------------------------------------------------------
if (!process.env.ANTHROPIC_API_KEY) {
  console.log(`
design-pass.mjs — AI design-director for prospect sites
─────────────────────────────────────────────────────────
No ANTHROPIC_API_KEY found. This script needs an Anthropic API key to run.

Setup (one-time):
  1. Get a key at https://console.anthropic.com/
  2. Set it in your shell session:
       export ANTHROPIC_API_KEY=sk-ant-…          (macOS / Linux)
       $env:ANTHROPIC_API_KEY = "sk-ant-…"        (PowerShell / Windows)
     Or add it permanently to your shell profile (~/.bashrc, ~/.zshrc, etc.)
     Or create a .env file at the repo root and use a loader like dotenv-cli.
  3. Optional: pin a model (default: claude-sonnet-4-6):
       export ANTHROPIC_MODEL=claude-opus-4-5

What the pass does when a key IS present:
  • Reads each prospect JSON from sites/demo-gallery/src/data/prospects/
  • Calls Claude with the business's real name, area, story, and services
  • Receives: concept angle, archetype, optional font/accent/shape overrides,
    and fully rewritten copy in a distinct brand voice (ONLY from real facts)
  • Writes back: config.artDirection.archetype + overrides, hero heading +
    subheading, tagline, about body paragraphs, and service descriptions
  • Marks each file with "_designPass" metadata for the dashboard to show

Run one site:   node scripts/design-pass.mjs --slug smittys-towing
Run all sites:  node scripts/design-pass.mjs
Dry-run:        node scripts/design-pass.mjs --dry-run
`);
  process.exit(0);
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clip(s, max) {
  if (!s || typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1).trim() : cut.replace(/\s+\S*$/, '').trim();
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Build a concise real-facts brief from the prospect config. */
function buildFactsBrief(config) {
  const lines = [];
  lines.push(`Business name: ${config.name}`);
  if (config.area) lines.push(`Location: ${config.area}`);
  if (config.established) lines.push(`Established: ${config.established}`);
  if (config.tagline) lines.push(`Current tagline: ${clip(config.tagline, 150)}`);
  if (config.hero?.heading) lines.push(`Current hero heading: ${config.hero.heading}`);
  if (config.hero?.subheading) lines.push(`Current hero subheading: ${clip(config.hero.subheading, 200)}`);
  if (config.about?.body?.length) {
    lines.push(`About copy:\n  ${config.about.body.map((p) => clip(p, 300)).join('\n  ')}`);
  }
  if (config.highlights?.length) {
    lines.push(`Highlights: ${config.highlights.slice(0, 4).join(' · ')}`);
  }
  if (config.services?.length) {
    lines.push(
      `Services (${config.services.length}):\n` +
        config.services
          .slice(0, 6)
          .map((s) => `  - ${s.title}${s.description ? ': ' + clip(s.description, 120) : ''}`)
          .join('\n'),
    );
  }
  if (config.contact?.phone) lines.push(`Phone: ${config.contact.phone}`);
  // Pull real testimonials if any
  const testSection = (config.sections ?? []).find((s) => s.type === 'testimonials');
  if (testSection?.items?.length) {
    const first = testSection.items[0];
    lines.push(`Real customer quote: "${clip(first.quote, 200)}" — ${first.author ?? ''}`);
  }
  // Pull stats if any (signals authenticity)
  const statsSection = (config.sections ?? []).find((s) => s.type === 'stats');
  if (statsSection?.items?.length) {
    lines.push(`Stats: ${statsSection.items.map((i) => `${i.value} ${i.label}`).join(' · ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Claude call — prompt-cached system prompt, per-business user message
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = [
  {
    type: 'text',
    // The system block is cached: all per-business facts go in the user turn
    text:
      'You are a creative director and copywriter specializing in local-business websites.\n' +
      'Given REAL facts about a business, return ONLY valid minified JSON (no markdown fences,\n' +
      'no explanation) with this exact shape:\n\n' +
      '{\n' +
      '  "concept": string,         // one-line design angle / creative hook for this business\n' +
      '  "archetype": "classic"|"editorial"|"utility"|"magazine",  // page layout archetype\n' +
      '  "archetypeReason": string, // one-sentence justification\n' +
      '  "fontId": string|null,     // optional: one of the valid font IDs listed below, or null\n' +
      '  "accentStrategy": "analogous"|"complementary"|null,  // optional palette accent mode\n' +
      '  "shape": "soft"|"sharp"|"editorial"|"rounded-pill"|"framed"|null,  // optional\n' +
      '  "tagline": string,         // short brand tagline (<=120 chars)\n' +
      '  "heroHeading": string,     // promise headline (<=8 words, no period)\n' +
      '  "heroSubheading": string,  // 1–2 sentence expansion (<=200 chars)\n' +
      '  "aboutBody": [string, string],  // exactly 2 paragraphs, each 40–120 words\n' +
      '  "services": [{"title": string, "description": string}]  // same count as input services\n' +
      '}\n\n' +
      'Critical rules:\n' +
      '- Use ONLY the real facts provided. Never invent awards, numbers, certifications, or\n' +
      '  services not mentioned in the input.\n' +
      '- Descriptions must be concrete and specific to THIS business, not generic.\n' +
      '- Voice must be distinct: warm & editorial for lifestyle (cafe/salon/winery),\n' +
      '  confident & direct for trades (towing/plumbing/auto), clean & trustworthy for default.\n' +
      '- heroHeading: short punchy promise, <=8 words, NO trailing period, capitalize first word only.\n' +
      '- aboutBody[0]: the origin / story paragraph. aboutBody[1]: the today / what-makes-us-different paragraph.\n' +
      '- services array must have the SAME number of items as the input services array, in the same order.\n' +
      '- Service descriptions: 1 short sentence, 15–25 words, concrete, no generic filler.\n' +
      '- tagline: punchy, under 120 chars, sounds like a human wrote it for this specific business.\n\n' +
      'Valid fontId values (pick the best match for the business, or null to keep auto-selection):\n' +
      '  editorial-serif  (refined editorial — winery, cafe, salon)\n' +
      '  modern-grotesk   (crisp modern — plumbing, auto-repair, tech)\n' +
      '  warm-humanist    (friendly — cafe, salon, landscaping)\n' +
      '  rugged-slab      (sturdy, blue-collar — towing, auto-repair, construction)\n' +
      '  classic-trad     (established, traditional — salon, winery, law)\n' +
      '  clean-sans       (minimal, neutral — plumbing, default, tech)\n' +
      '  organic-serif    (botanical, calm — landscaping, winery, wellness)\n' +
      '  bold-display     (confident, loud — auto-repair, towing, fitness)\n' +
      '  boutique-contrast (luxe, high-contrast — salon, winery, boutique)\n' +
      '  handcrafted      (crafted, indie — cafe, bakery, makers)\n',
    cache_control: { type: 'ephemeral' },
  },
];

async function callClaude(factsBrief, numServices) {
  const userContent =
    'Here are the REAL facts for this business. Analyze them and return the JSON design brief.\n\n' +
    factsBrief +
    `\n\nThe services array in your response MUST have exactly ${numServices} item(s).`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();

  if (!text) throw new Error('Empty response from Claude');

  // Strip any accidental markdown fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return { parsed, usage: data.usage };
}

// ---------------------------------------------------------------------------
// Validation + sanitization of Claude's response
// ---------------------------------------------------------------------------
function validateAndSanitize(parsed, config) {
  const out = {};

  // concept
  out.concept = typeof parsed.concept === 'string' ? parsed.concept.trim().slice(0, 250) : '';

  // archetype (must be one of the valid values)
  out.archetype = VALID_ARCHETYPES.has(parsed.archetype) ? parsed.archetype : 'classic';

  // archetypeReason
  out.archetypeReason =
    typeof parsed.archetypeReason === 'string' ? parsed.archetypeReason.trim().slice(0, 300) : '';

  // fontId (must be in the registry or null)
  out.fontId = parsed.fontId && VALID_FONT_IDS.has(parsed.fontId) ? parsed.fontId : null;

  // accentStrategy
  out.accentStrategy =
    parsed.accentStrategy && VALID_ACCENT_STRATEGIES.has(parsed.accentStrategy)
      ? parsed.accentStrategy
      : null;

  // shape
  out.shape = parsed.shape && VALID_SHAPES.has(parsed.shape) ? parsed.shape : null;

  // copy fields
  out.tagline =
    typeof parsed.tagline === 'string' && parsed.tagline.trim().length > 3
      ? parsed.tagline.trim().slice(0, 160)
      : config.tagline;

  out.heroHeading =
    typeof parsed.heroHeading === 'string' && parsed.heroHeading.trim().length > 3
      ? parsed.heroHeading.trim().slice(0, 100)
      : config.hero?.heading;

  out.heroSubheading =
    typeof parsed.heroSubheading === 'string' && parsed.heroSubheading.trim().length > 10
      ? parsed.heroSubheading.trim().slice(0, 300)
      : config.hero?.subheading;

  // aboutBody: expect exactly 2 paragraphs
  if (Array.isArray(parsed.aboutBody) && parsed.aboutBody.length >= 1) {
    out.aboutBody = parsed.aboutBody
      .slice(0, 2)
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean);
    // If Claude returned only 1, keep the second original
    if (out.aboutBody.length < 2 && config.about?.body?.length > 1) {
      out.aboutBody.push(config.about.body[1]);
    }
    // Ensure at least 1
    if (!out.aboutBody.length) out.aboutBody = config.about?.body ?? [];
  } else {
    out.aboutBody = config.about?.body ?? [];
  }

  // services: must match count of original
  const origServices = config.services ?? [];
  if (Array.isArray(parsed.services) && parsed.services.length > 0) {
    out.services = origServices.map((orig, i) => {
      const ai = parsed.services[i];
      if (!ai || typeof ai.description !== 'string' || ai.description.trim().length < 10) {
        return orig; // fall back to original for this slot
      }
      return {
        ...orig,
        // Preserve original title (trust the scrape; AI may hallucinate renaming)
        description: ai.description.trim().slice(0, 300),
      };
    });
  } else {
    out.services = origServices;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Merge the design pass result into a prospect config
// ---------------------------------------------------------------------------
function mergeIntoConfig(config, result) {
  const merged = { ...config };

  // 1. artDirection block — set archetype + optional overrides
  const existingAd = config.artDirection ?? {};
  const newAd = { ...existingAd, archetype: result.archetype };
  if (result.fontId) newAd.fontId = result.fontId;
  if (result.accentStrategy) newAd.accentStrategy = result.accentStrategy;
  if (result.shape) newAd.shape = result.shape;
  merged.artDirection = newAd;

  // 2. top-level tagline
  if (result.tagline) merged.tagline = result.tagline;

  // 3. hero copy
  if (merged.hero) {
    merged.hero = {
      ...merged.hero,
      heading: result.heroHeading ?? merged.hero.heading,
      subheading: result.heroSubheading ?? merged.hero.subheading,
    };
  }

  // 4. about copy
  if (result.aboutBody?.length && merged.about) {
    merged.about = { ...merged.about, body: result.aboutBody };
  }

  // 5. service descriptions
  if (result.services?.length) {
    merged.services = result.services;
  }

  // 6. design-pass metadata (not rendered; used by dashboard / scoring)
  merged._designPass = {
    ranAt: new Date().toISOString(),
    model: MODEL,
    concept: result.concept,
    archetypeReason: result.archetypeReason,
  };

  return merged;
}

// ---------------------------------------------------------------------------
// Process a single prospect file
// ---------------------------------------------------------------------------
async function processProspect(filePath, slug) {
  let config;
  try {
    config = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    console.warn(`  ! ${slug}: failed to read/parse JSON (${err.message}) — skipping`);
    return false;
  }

  const numServices = (config.services ?? []).length;
  if (numServices === 0) {
    console.log(`  · ${slug}: no services defined — skipping`);
    return false;
  }

  const factsBrief = buildFactsBrief(config);

  let parsed, usage;
  try {
    ({ parsed, usage } = await callClaude(factsBrief, numServices));
  } catch (err) {
    console.warn(`  ! ${slug}: Claude call failed (${err.message}) — skipping`);
    return false;
  }

  let result;
  try {
    result = validateAndSanitize(parsed, config);
  } catch (err) {
    console.warn(`  ! ${slug}: response validation failed (${err.message}) — skipping`);
    return false;
  }

  const merged = mergeIntoConfig(config, result);

  // Show a brief summary of what changed
  const cacheHit = usage?.cache_read_input_tokens ?? 0;
  const newTokens = usage?.input_tokens ?? 0;
  console.log(
    `  ✓ ${slug}  [archetype: ${result.archetype}${result.fontId ? ' · font: ' + result.fontId : ''}` +
      `${result.shape ? ' · shape: ' + result.shape : ''}]` +
      `  tokens: ${newTokens} in / ${usage?.output_tokens ?? 0} out` +
      (cacheHit ? ` / ${cacheHit} cached` : ''),
  );
  console.log(`    concept: "${result.concept}"`);

  if (dryRun) {
    console.log('    (dry-run: not writing file)');
    return true;
  }

  try {
    await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`  ! ${slug}: failed to write file (${err.message})`);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const model = MODEL;
  const mode = dryRun ? 'dry-run' : 'live';
  console.log(`design-pass.mjs — AI design director   [model: ${model}]  [mode: ${mode}]`);
  console.log(`Prospects dir: ${PROSPECTS_DIR}\n`);

  // Discover prospect files
  let files;
  try {
    const all = await readdir(PROSPECTS_DIR);
    files = all
      .filter((f) => extname(f) === '.json')
      .map((f) => ({
        slug: basename(f, '.json'),
        path: join(PROSPECTS_DIR, f),
      }));
  } catch (err) {
    console.error(`Could not read prospects directory: ${err.message}`);
    process.exit(1);
  }

  if (!files.length) {
    console.log('No prospect JSON files found. Run `npm run generate` first.');
    process.exit(0);
  }

  // Filter to a single slug if --slug was given
  if (slugArg) {
    const target = files.find((f) => f.slug === slugArg);
    if (!target) {
      console.error(
        `Prospect slug "${slugArg}" not found.\n` +
          `Available: ${files.map((f) => f.slug).join(', ')}`,
      );
      process.exit(1);
    }
    files = [target];
  }

  console.log(`Processing ${files.length} prospect(s)…\n`);

  let ok = 0;
  let skipped = 0;
  for (const { slug, path } of files) {
    const success = await processProspect(path, slug);
    if (success) ok++;
    else skipped++;
  }

  console.log(
    `\nDesign pass complete: ${ok} updated${skipped ? `, ${skipped} skipped` : ''}.`,
  );
  if (!dryRun && ok > 0) {
    console.log('\nNext steps:');
    console.log('  cd sites/demo-gallery && npm run dev   # preview at /s/<slug>');
    console.log('  git add sites/demo-gallery/src/data/prospects && git commit -m "design-pass"');
    console.log('  git push   # Vercel rebuilds the gallery');
  }
}

// Run only when invoked directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}

export { buildFactsBrief, validateAndSanitize, mergeIntoConfig };
