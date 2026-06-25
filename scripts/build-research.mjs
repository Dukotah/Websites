#!/usr/bin/env node
/**
 * build-research.mjs — the lead-scraper → website-factory bridge.
 *
 * Problem it solves: the scraper finds WHO to pitch (contact + qualification);
 * the site generator needs WHAT a business is (services, hours, reviews, photos,
 * "since 1982"). Today the generator re-scrapes every site itself at build time
 * and, when a site blocks it or is thin, falls back to generic template copy and
 * flags the result needs-review. That's the quality ceiling.
 *
 * This script does the deep research pass ONCE, up front, over a whole lead CSV
 * and caches each result as data/research/<slug>.json — the rich-fact file the
 * generator already prefers over a live scrape. It also fuses fields the scraper
 * already found (owner name, socials) that a live scrape would miss, and emits a
 * clean builder-shaped CSV you feed straight to `npm run generate`.
 *
 * The files are written confirmed:false — honest, auto-extracted facts. The
 * generator treats those as a CACHED SCRAPE: real quality gates still apply, so a
 * thin extraction is still flagged needs-review (it does NOT masquerade as
 * verified prose). A later human/agent pass can upgrade a file to confirmed:true
 * with polished, web-verified copy — that's the authoritative tier and the
 * quality bar (see the hand-built files already in data/research/).
 *
 * Key-free, dependency-free, idempotent: never clobbers an existing
 * confirmed:true file, and skips files that already exist unless --force.
 *
 * Usage:
 *   node scripts/build-research.mjs <scraper.csv> [options]
 *     --out <path>        builder CSV to write   (default data/<stem>-leads.csv)
 *     --state <CC>        default state when the CSV has no state column
 *     --limit <N>         only process the first N leads
 *     --concurrency <N>   parallel site fetches   (default 6)
 *     --no-images         skip the deep photo crawl (faster)
 *     --force             rebuild research files that already exist
 *                         (still never overwrites a confirmed:true file)
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/facts.mjs';
import { parseScraperCsv, toBuilderCsv } from './lib/scraper-csv.mjs';
import { scrapeSite, collectSiteImages } from './lib/scrape-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH_DIR = join(ROOT, 'data', 'research');

// --- tiny arg parser --------------------------------------------------------
function parseArgs(argv) {
  const o = { positional: [], concurrency: 6, images: true, force: false, state: '', limit: 0, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-images') o.images = false;
    else if (a === '--force') o.force = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--state') o.state = argv[++i];
    else if (a === '--limit') o.limit = Number(argv[++i]) || 0;
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(argv[++i]) || 6);
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(1); }
    else o.positional.push(a);
  }
  return o;
}

// Run `fn` over `items` with at most `limit` in flight at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// --- name ↔ website sanity check ---------------------------------------------
// The `website` column is the #1 quality lever, but scraper CSVs sometimes pair a
// business with the WRONG site. Building from a mismatched site would put another
// company's services/photos on the page — worse than no research. We compare the
// lead's significant name tokens against the scraped site's name/description/host.
const NAME_STOP = new Set(['the', 'and', 'inc', 'llc', 'co', 'company', 'corp', 'ltd', 'services', 'service', 'group']);
const sigTokens = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 4 && !NAME_STOP.has(t));

// Returns { ok, siteName }. ok=false ⇒ likely wrong website. We key on the
// DISTINCTIVE brand token (the first significant word of the business name, e.g.
// "lysell", "guardian") rather than generic category words — otherwise any
// plumber's site "matches" any other plumber. Bias toward flagging: for an
// outreach tool, building from the wrong site (then emailing it) is far worse
// than a quick re-check, and a flagged lead is recoverable (thin file + note),
// never silently wrong.
function nameMatchesSite(leadName, e) {
  const tokens = sigTokens(leadName);
  if (!tokens.length || !e) return { ok: true, siteName: e?.name || '' };
  const hay = [e.name, e.description, e.sourceUrl].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
  const brand = tokens[0]; // distinctive lead word
  // Pass if the brand appears, OR if the brand is short/generic (<=3 sig chars
  // already filtered) and ALL remaining tokens hit (strong overall overlap).
  const brandHit = hay.includes(brand);
  const allHit = tokens.every((t) => hay.includes(t));
  return { ok: brandHit || allHit, siteName: e.name || '' };
}

// Honest "what still needs a human" note — the scraper's owner field is surfaced
// here so a later verification pass can name the owner in the about/signature.
function buildNotes(e, lead, photoUrls, mismatchName) {
  const notes = [];
  if (mismatchName) {
    notes.push(`⚠ WEBSITE MISMATCH: the URL identifies as "${mismatchName}", not "${lead.name}" — the website column is probably wrong. Facts/photos from it were DISCARDED. Verify the correct URL before building.`);
  }
  if (lead.owner) notes.push(`Owner (per scraper): ${lead.owner} — use in the about story / signature once confirmed.`);
  if (e?.aggregatorHost) notes.push(`⚠ The website is an aggregator/listing/booking page (${e.aggregatorHost}), not the business's own site — facts & photos here are likely thin. Web-search for their real site, services, and photos.`);
  if (!e) {
    notes.push('Live site was unreachable during research — facts here are thin; web-search to confirm everything before sending.');
  } else {
    if ((e.richness ?? 0) < 35) notes.push('Thin auto-extraction (site may block scraping). Web-search Yelp/Google/BBB to confirm services, hours, reviews.');
    if (!e.established) notes.push('Founding year not found — check the About page / BBB.');
    if (!e.testimonials?.length) notes.push('No reviews scraped — pull 2–3 real ones from Google/Yelp.');
    if (!photoUrls.length) notes.push('No usable photos found on the site — source real ones or rely on the photo fallbacks.');
  }
  notes.push('Auto-generated by build-research.mjs (confirmed:false). Verify + write the prose, then set confirmed:true to make it authoritative.');
  return notes.join(' ');
}

/**
 * Shape a deep scrape + the scraper's own fields into the research-file schema
 * the generator consumes. Prose fields (tagline/heroHeading/aboutHeading/
 * highlights) are intentionally left blank: for confirmed:false the generator
 * writes copy from these FACTS through its normal (gated) path, so empty prose
 * here can't masquerade as authored copy.
 */
function researchFromScrape(slug, e, lead, photoUrls, mismatchName = '') {
  const social = {
    facebook: lead.facebook || e?.social?.facebook || '',
    instagram: lead.instagram || e?.social?.instagram || '',
    google: e?.social?.google || '',
  };
  const out = {
    slug,
    confirmed: false,
    established: e?.established ? `Est. ${e.established}` : '',
    tagline: '',
    // Full scraped blurb — the generator reads this as the fact source for copy;
    // it re-clips its own SEO string, so storing the whole thing is fine.
    seoDescription: e?.description || '',
    heroHeading: '',
    heroSubheading: '',
    highlights: [],
    aboutHeading: '',
    aboutBody: Array.isArray(e?.about) ? e.about : [],
    servicesHeading: '',
    services: (e?.services ?? []).map((title) => ({ title, description: '' })),
    hours: Array.isArray(e?.hours) ? e.hours : [],
    testimonials: Array.isArray(e?.testimonials) ? e.testimonials : [],
    social,
    realPhotoUrls: photoUrls,
    // OWN-SITE VALIDATION: when the lead URL resolved to an aggregator/booking/
    // listing/gov page (not the business's own site) the scrape is likely thin —
    // carried through so the generator/author can flag it (see facts.mjs).
    ...(e?.aggregatorHost ? { aggregatorHost: e.aggregatorHost } : {}),
    notes: buildNotes(e, lead, photoUrls, mismatchName),
    _richness: e?.richness ?? 0,
    _source: 'auto-scrape',
    // The lead's own identity, so the verification pass (verify-research.mjs) can
    // run standalone without re-joining the CSV. Ignored by the generator.
    _lead: {
      name: lead.name, category: lead.category, city: lead.city, state: lead.state,
      phone: lead.phone, email: lead.email, address: lead.address, owner: lead.owner || '',
    },
  };
  if (e?.rating) out.rating = { value: e.rating, count: e.reviewCount ?? 0, source: 'site' };
  return out;
}

async function loadExisting(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const csvPath = opts.positional[0];
  if (!csvPath) {
    console.error('Usage: node scripts/build-research.mjs <scraper.csv> [--out f] [--state CC] [--limit N] [--concurrency N] [--no-images] [--force]');
    process.exit(1);
  }

  let raw;
  try { raw = await readFile(csvPath, 'utf8'); }
  catch { console.error(`Could not read CSV: ${csvPath}`); process.exit(1); }

  let leads = parseScraperCsv(raw, { state: opts.state });
  if (!leads.length) { console.error('No lead rows with a name found in the CSV.'); process.exit(1); }
  if (opts.limit) leads = leads.slice(0, opts.limit);

  await mkdir(RESEARCH_DIR, { recursive: true });

  // 1) Emit a clean builder CSV (the 8 standard columns) the generator can run.
  const outCsv = opts.out || join(ROOT, 'data', `${basename(csvPath).replace(/\.[^.]+$/, '')}-leads.csv`);
  await writeFile(outCsv, toBuilderCsv(leads));

  const withSite = leads.filter((l) => l.website);
  console.log(
    `Bridging ${leads.length} lead(s) → research files.\n` +
      `  ${withSite.length} have a website (deep-scraped); ${leads.length - withSite.length} have none (left for the generator's fallbacks).\n` +
      `  Photos: ${opts.images ? 'deep crawl on' : 'off (--no-images)'} · concurrency ${opts.concurrency}\n` +
      `  Builder CSV: ${outCsv}\n`,
  );

  const stats = { written: 0, skipped: 0, thin: 0, unreachable: 0, nosite: 0, kept_confirmed: 0, mismatch: 0 };

  await mapLimit(leads, opts.concurrency, async (lead) => {
    const slug = slugify(lead.name);
    const path = join(RESEARCH_DIR, `${slug}.json`);

    const existing = await loadExisting(path);
    if (existing?.confirmed === true) { console.log(`  · ${lead.name}: keeping verified file (confirmed:true)`); stats.kept_confirmed++; return; }
    if (existing && !opts.force) { console.log(`  · ${lead.name}: research file exists (use --force to rebuild)`); stats.skipped++; return; }

    if (!lead.website) { stats.nosite++; return; }

    process.stdout.write(`  · ${lead.name}: scraping ${lead.website} … `);
    let e = null;
    try { e = await scrapeSite(lead.website); } catch { e = null; }

    // Guard the #1 quality lever: if the site clearly belongs to a different
    // business, discard its facts/photos rather than building from the wrong one.
    const match = nameMatchesSite(lead.name, e);
    const mismatchName = e && !match.ok ? (match.siteName || lead.website) : '';

    let photoUrls = [];
    if (e && !mismatchName) {
      photoUrls = Array.isArray(e.images) ? [...e.images] : [];
      if (opts.images) {
        try {
          const more = await collectSiteImages(lead.website);
          photoUrls = [...new Set([...photoUrls, ...more])];
        } catch { /* best-effort */ }
      }
    }

    if (!e) { console.log('unreachable'); stats.unreachable++; }
    else if (mismatchName) { console.log(`⚠ wrong site? identifies as "${mismatchName}" — facts discarded`); stats.mismatch++; }
    else { console.log(`ok (richness ${e.richness}, ${photoUrls.length} photo${photoUrls.length === 1 ? '' : 's'})`); if ((e.richness ?? 0) < 35) stats.thin++; }

    // On a mismatch, write a thin file that carries ONLY the lead's own fields +
    // a loud note — never the foreign site's content.
    const research = researchFromScrape(slug, mismatchName ? null : e, lead, photoUrls, mismatchName);
    await writeFile(path, JSON.stringify(research, null, 2) + '\n');
    stats.written++;
  });

  console.log(
    `\nDone. ${stats.written} research file(s) written` +
      `${stats.skipped ? `, ${stats.skipped} skipped (already existed)` : ''}` +
      `${stats.kept_confirmed ? `, ${stats.kept_confirmed} verified file(s) preserved` : ''}.`,
  );
  if (stats.mismatch) console.log(`  ${stats.mismatch} likely WRONG-WEBSITE mismatch(es) — content discarded, flagged in notes; fix the URL in the scraper data.`);
  if (stats.thin) console.log(`  ${stats.thin} came back thin (site blocked or sparse) — those will flag needs-review; web-verify them.`);
  if (stats.unreachable) console.log(`  ${stats.unreachable} site(s) unreachable — research files written from scraper fields only.`);
  if (stats.nosite) console.log(`  ${stats.nosite} lead(s) had no website — no research file; the generator uses category fallbacks.`);
  console.log(`\nNext: npm run generate -- ${outCsv.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
}

main();
