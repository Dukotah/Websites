#!/usr/bin/env node
/**
 * verify-research.mjs — clean up auto-generated research, and (optionally) write
 * polished prose and promote it to confirmed.
 *
 * build-research.mjs caches a deep scrape per lead as data/research/<slug>.json
 * with confirmed:false. Scrape heuristics are noisy: form fields land in
 * `services` ("Service Type * Residential Commercial"), section headings land in
 * `testimonials` ("Licensed Electrical Contractor Serving…"), and `aboutBody`
 * picks up "Call us at 707-…" lines. This pass scrubs that noise so the facts
 * the generator builds from are clean — a key-free win on its own.
 *
 * Tiers of trust (deliberate) — `confirmed` is a three-state flag:
 *   • confirmed:false (default clean) ... scrub noise, keep confirmed:false. The
 *       site still goes through the generator's gated copy path on its HONEST
 *       _richness, so a thin scrape can still flag needs-review — but from clean
 *       facts now.
 *   • confirmed:"auto" (--promote, needs ANTHROPIC_API_KEY) ... ALSO write
 *       tagline/hero/about/service-descriptions with Claude FROM THE CLEANED
 *       FACTS. This is polished prose, but it is still derived from the site's
 *       OWN unverified scrape — so we DELIBERATELY do NOT set confirmed:true.
 *       Downstream (generate-prospects.mjs) treats anything other than the
 *       literal `true` as non-authoritative: it keeps the honest _richness, so
 *       the thin-research gate STILL FIRES and a thin scrape can't masquerade as
 *       authoritative just because prose was generated over it.
 *   • confirmed:true ... RESERVED for independently web-verified files (reviews,
 *       awards, founding year, licenses cross-checked off-site). This script
 *       NEVER sets confirmed:true and NEVER touches a file that already has it
 *       (those are human-verified). Promote to true by hand after verifying.
 *
 * IMPORTANT: --promote writes copy from the SITE'S OWN scraped facts. That is
 * not the same as independent web verification. It removes the blank-page
 * problem and the template-copy look, but the file stays gated (confirmed:"auto")
 * until an agent cross-checks the facts and flips it to true. The tier + caveat
 * are annotated in `notes`.
 *
 * Usage:
 *   node scripts/verify-research.mjs                 # clean every confirmed:false file
 *   node scripts/verify-research.mjs <slug…>         # clean only these slugs
 *   node scripts/verify-research.mjs --promote       # + write copy, confirmed:"auto" (needs key, still gated)
 *   node scripts/verify-research.mjs --dry-run       # report only, write nothing
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, normCat, enrichmentFromResearch, generateCopyWithClaude } from './generate-prospects.mjs';
import { scoreRichness } from './lib/scrape-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH_DIR = join(ROOT, 'data', 'research');

// --- noise scrubbers --------------------------------------------------------

const SERVICE_JUNK = /(\*|select|choose|service type|required field|submit|sign in|log ?in|http|@|©|all rights|privacy|^home$|^menu$|^contact$|^about$|^gallery$|^reviews?$|^blog$)/i;

// Collapse a runaway title like "Residential Electrician All Residential
// Electrician Services" by removing immediately-repeated words.
function dedupeWords(s) {
  const words = s.split(/\s+/);
  const out = [];
  for (const w of words) if (out[out.length - 1]?.toLowerCase() !== w.toLowerCase()) out.push(w);
  return out.join(' ');
}

function cleanServices(services = []) {
  const seen = new Set();
  const out = [];
  for (const s of services) {
    let title = dedupeWords((s?.title || '').trim());
    if (!title || title.length < 4 || title.length > 64) continue;
    if (SERVICE_JUNK.test(title)) continue;
    const k = title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, description: s.description || '' });
    if (out.length >= 6) break;
  }
  return out;
}

const TESTIMONIAL_HEADING = /^(testimonials?|reviews?|our reviews|what (our )?clients|licensed|serving|welcome|home|about us|contact)/i;

// A real review reads like a sentence: has terminal punctuation or enough words,
// and isn't title-case heading-y. Drop the rest.
function looksLikeReview(quote) {
  const q = (quote || '').trim();
  if (q.length < 40 || TESTIMONIAL_HEADING.test(q)) return false;
  const words = q.split(/\s+/);
  if (words.length < 7) return false;
  const titleCaseRatio = words.filter((w) => /^[A-Z]/.test(w)).length / words.length;
  const hasSentence = /[.!?]/.test(q);
  // Heading-like: mostly Capitalized words and no sentence punctuation.
  if (titleCaseRatio > 0.6 && !hasSentence) return false;
  return true;
}

function cleanTestimonials(testimonials = []) {
  const seen = new Set();
  const out = [];
  for (const t of testimonials) {
    // Strip a leading "Testimonials"/"Reviews" section-label artifact so a real
    // review that got the heading glued to its front isn't thrown away.
    const quote = (t?.quote || '').replace(/^(testimonials?|reviews?|our reviews?)\b[:\s—-]*/i, '').trim();
    if (!looksLikeReview(quote)) continue;
    const k = quote.toLowerCase().slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ quote, author: t.author || 'Local customer' });
    if (out.length >= 4) break;
  }
  return out;
}

const ABOUT_JUNK = /(call (us )?(at|now)|contact us at|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|cookie|privacy policy|all rights reserved)/i;

function cleanAbout(about = []) {
  const seen = new Set();
  const out = [];
  for (const p of about) {
    const para = (p || '').trim();
    if (para.length < 40 || ABOUT_JUNK.test(para)) continue;
    const k = para.toLowerCase().slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(para);
    if (out.length >= 4) break;
  }
  return out;
}

// --- main -------------------------------------------------------------------

async function listConfirmedFalse(slugs) {
  const files = slugs.length
    ? slugs.map((s) => `${s.replace(/\.json$/, '')}.json`)
    : (await readdir(RESEARCH_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await readFile(join(RESEARCH_DIR, f), 'utf8'));
      if (r.confirmed === true) continue; // never touch verified files
      out.push({ file: f, r });
    } catch { /* skip unreadable */ }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const promote = argv.includes('--promote');
  const slugs = argv.filter((a) => !a.startsWith('--'));
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  if (promote && !hasKey) {
    console.error('--promote needs ANTHROPIC_API_KEY (it writes prose with Claude). Run without --promote to clean only.');
    process.exit(1);
  }

  const targets = await listConfirmedFalse(slugs);
  if (!targets.length) { console.log('No confirmed:false research files to process.'); return; }

  console.log(
    `Verifying ${targets.length} auto-research file(s).\n` +
      `  Mode: ${promote ? 'clean + write copy → confirmed:"auto" (Claude, still gated)' : 'clean noise only'}` +
      `${dryRun ? ' · DRY RUN' : ''}\n`,
  );

  let cleaned = 0, promoted = 0, stillThin = 0;
  for (const { file, r } of targets) {
    const lead = r._lead || {};
    const beforeS = (r.services || []).length;
    const beforeT = (r.testimonials || []).length;

    r.services = cleanServices(r.services);
    r.testimonials = cleanTestimonials(r.testimonials);
    r.aboutBody = cleanAbout(r.aboutBody);

    // Recompute honest richness on the cleaned facts.
    const e = enrichmentFromResearch(r, lead, { authoritative: false });
    r._richness = scoreRichness(e);

    let note = `Cleaned by verify-research.mjs (services ${beforeS}→${r.services.length}, reviews ${beforeT}→${r.testimonials.length}).`;

    if (promote) {
      const preset = CATEGORIES[normCat(lead.category)] || CATEGORIES.default;
      try {
        const copy = await generateCopyWithClaude(
          { name: lead.name, category: lead.category, city: lead.city, state: lead.state },
          preset,
          e,
        );
        r.tagline = copy.tagline ?? r.tagline;
        r.seoDescription = copy.seoDescription ?? r.seoDescription;
        r.heroHeading = copy.heroHeading ?? '';
        r.heroSubheading = copy.heroSubheading ?? '';
        r.highlights = Array.isArray(copy.highlights) ? copy.highlights : [];
        r.aboutHeading = copy.aboutHeading || `About ${lead.name}`;
        r.aboutBody = Array.isArray(copy.aboutBody) && copy.aboutBody.length ? copy.aboutBody : r.aboutBody;
        r.servicesHeading = copy.servicesHeading || 'What we do';
        if (Array.isArray(copy.services) && copy.services.length) r.services = copy.services;
        // The prose is polished but still derived from the SITE'S OWN unverified
        // scrape. Mark the intermediate "auto" tier — NOT true — so downstream
        // keeps the honest _richness (preserved above) and the thin-research gate
        // still fires. confirmed:true is reserved for independently-verified files.
        r.confirmed = 'auto';
        note += ' Copy written by Claude from the cleaned scraped facts and marked confirmed:"auto" (gated, not authoritative) — web-verify reviews/awards/founding year, then set confirmed:true by hand.';
        promoted++;
        console.log(`  ✓ ${lead.name || file}: cleaned + copy written → confirmed:"auto" (still gated)`);
      } catch (err) {
        note += ` Copy step failed (${err.message}); left confirmed:false.`;
        console.log(`  · ${lead.name || file}: cleaned (copy step failed: ${err.message})`);
      }
    } else {
      const thin = r._richness < 35;
      if (thin) stillThin++;
      console.log(`  · ${lead.name || file}: cleaned (richness ${r._richness}${thin ? ' — thin, web-verify' : ''})`);
    }

    // Keep the mismatch / owner warnings; append the cleaning note.
    r.notes = [r.notes, note].filter(Boolean).join(' ');
    cleaned++;

    if (!dryRun) await writeFile(join(RESEARCH_DIR, file), JSON.stringify(r, null, 2) + '\n');
  }

  console.log(`\nDone. ${cleaned} file(s) cleaned${promoted ? `, ${promoted} given polished copy at confirmed:"auto" (still gated)` : ''}${dryRun ? ' (dry run — nothing written)' : ''}.`);
  if (promote) {
    console.log(
      `  confirmed:"auto" files have prose but are NOT authoritative — they keep their\n` +
        `  honest richness and still flag needs-review if thin. To finish them:\n` +
        `    • web-verify reviews/awards/founding year, then set confirmed:true by hand.`,
    );
  } else {
    console.log(
      `  These stay confirmed:false (gated). To finish them:\n` +
        `    • set ANTHROPIC_API_KEY and rerun with --promote to auto-write prose (→ confirmed:"auto"), OR\n` +
        `    • have an agent web-verify facts + write the copy, then set confirmed:true by hand.`,
    );
    if (stillThin) console.log(`  ${stillThin} are still thin even after cleaning — those most need a web-research pass.`);
  }
}

main().catch((err) => { console.error(err?.message || err); process.exit(1); });
