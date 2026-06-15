#!/usr/bin/env node
/**
 * vision-qa.mjs — the JUDGMENT tier of pre-send QA.
 *
 * `audit.mjs` catches MECHANICAL defects (dead tokens, measured contrast, empty
 * sections). It is blind to the things that actually make a demo "look wrong":
 * a hero photo that doesn't match the business, a stock shot of a lawn captioned
 * "Water Heaters", a layout that clips, a page that reads as AI slop. Only EYES
 * catch those — and on the Pro plan (no API key) the eyes are the in-session
 * agent, not a script calling a vision API.
 *
 * So this harness splits the work the only way that works here:
 *
 *   1. CAPTURE  (this script, `vision-qa`):    build → screenshot every page →
 *      write a per-page REVIEW PACKET that pairs the screenshots with the
 *      business's GROUND-TRUTH facts (so a judge can check photo congruence:
 *      "the hero should depict a marina — does it?").
 *   2. JUDGE    (the agent — you, or a subagent fleet):   read each packet +
 *      its shots, score against the rubric in docs/vision-qa-rubric.md, and
 *      write findings to .shots/qa/findings/<slug>.json (the JSON contract).
 *   3. REPORT   (this script, `vision-qa --report`):   aggregate the findings
 *      into a prioritized fix-list and EXIT NON-ZERO if any page is a "hold" or
 *      has a critical finding — so it can gate a deploy exactly like audit.mjs.
 *
 *   npm run vision-qa                 # capture all → review packets + shots
 *   npm run vision-qa -- vasquez kog  # capture matching slugs only
 *   npm run vision-qa -- --no-build   # reuse existing dist (faster)
 *   npm run vision-qa -- --report     # aggregate findings → report + gate
 *
 * Key-free. Needs Chrome (auto-detected; override with $CHROME_PATH).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { withChrome, capturePage } from './lib/cdp-capture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..'); // sites/demo-gallery
const REPO_ROOT = resolve(ROOT, '../..');
// PREMIUM multi-page configs — each renders at /s/<slug>/. (Was the legacy
// single-page src/data/prospects, which mismatched the /s/<slug> screenshots and
// fed the judge stale 11-file packets — the single biggest blocker. Now matches
// screenshot-audit.mjs.)
const PROSPECTS = join(ROOT, 'src/data/premium');
const OUTREACH_LINKS = join(REPO_ROOT, 'data/outreach-links.json');
const QA = join(REPO_ROOT, '.shots/qa');
const SHOTS = join(QA, 'shots');
const REVIEW = join(QA, 'review');
const FINDINGS = join(QA, 'findings');

const args = process.argv.slice(2);
const reportMode = args.includes('--report');
const gateManifestMode = args.includes('--gate-manifest');
const noBuild = args.includes('--no-build');
const filters = args.filter((a) => !a.startsWith('--'));

// ── Ground-truth fact extraction (what a judge needs to spot incongruity) ─────
// Reads the PREMIUM multi-page PremiumConfig shape: pages[].sections discriminated
// by `kind`. The hero/about page is pages[0].
const isLibrary = (p) => !p || p.includes('/images/library/') || p.endsWith('.svg');
function classifyPhoto(src, credit) {
  if (isLibrary(src)) return 'fallback-art';
  return credit ? 'stock-credited' : 'claimed-real';
}
function packetFor(slug) {
  const cfg = JSON.parse(readFileSync(join(PROSPECTS, `${slug}.json`), 'utf8'));
  const homeSections = cfg.pages?.[0]?.sections ?? [];
  const allSections = (cfg.pages ?? []).flatMap((p) => p.sections ?? []);
  const hero = homeSections.find((s) => s.kind === 'hero');
  const gallery = allSections.find((s) => s.kind === 'gallery');
  const story = allSections.find((s) => s.kind === 'story');
  const services = allSections.find((s) => s.kind === 'services');

  // Every photo the judge should eyeball for congruence + quality.
  const photos = [];
  if (hero?.image?.src) photos.push({ role: 'hero', src: hero.image.src, kind: classifyPhoto(hero.image.src) });
  if (story?.image?.src) photos.push({ role: 'story', src: story.image.src, kind: classifyPhoto(story.image.src) });
  for (const g of gallery?.images ?? [])
    photos.push({ role: 'gallery', src: g.src, kind: classifyPhoto(g.src, g.credit) });

  return {
    slug,
    name: cfg.name,
    category: cfg.category ?? '(inferred)',
    area: cfg.area ?? '',
    whatTheyDo: (services?.items ?? []).map((s) => s.title),
    heroHeading: hero?.heading ?? '',
    // An editorial hero is photo-less by design (motif/aside fill the column) —
    // surface it so the judge does NOT flag "missing hero photo" as a defect.
    heroVariant: hero?.variant ?? '(auto)',
    heroIsEditorial: hero?.variant === 'editorial',
    sectionKinds: allSections.map((s) => s.kind),
    photos, // ← the judge checks each photo matches the business + isn't a logo/screenshot/dupe
    // Provenance + generator flags so the judge SEES why a hero may have been
    // routed to editorial ('Off-domain hero suppressed', 'faded', etc.).
    photoSource: cfg.photoSource ?? '(unknown)',
    generatorFlags: cfg.flags ?? [],
    shots: { fold: `shots/${slug}-fold.png`, full: `shots/${slug}-full.png` },
    url: `/s/${slug}`,
  };
}

// ── Chrome ────────────────────────────────────────────────────────────────────
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].find((p) => existsSync(p));
}

function resolveSlugs() {
  let slugs = readdirSync(PROSPECTS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  if (filters.length) slugs = slugs.filter((s) => filters.some((f) => s.includes(f)));
  return slugs;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT MODE — aggregate agent findings into a prioritized fix-list + gate.
// ─────────────────────────────────────────────────────────────────────────────
const SEV_RANK = { critical: 0, warn: 1, info: 2 };
function runReport() {
  const slugs = resolveSlugs();
  const pages = [];
  const missing = [];
  for (const slug of slugs) {
    const fp = join(FINDINGS, `${slug}.json`);
    if (!existsSync(fp)) { missing.push(slug); continue; }
    try { pages.push(JSON.parse(readFileSync(fp, 'utf8'))); }
    catch (e) { console.error(`  ✗ ${slug}: findings JSON is malformed — ${e.message}`); process.exitCode = 1; }
  }

  const lines = ['# Vision-QA report', ''];
  if (missing.length) lines.push(`> ⚠ No findings yet for: ${missing.join(', ')} — run the judge step first.`, '');

  const holds = pages.filter((p) => p.verdict === 'hold');
  const criticals = pages.flatMap((p) => (p.findings ?? []).filter((f) => f.severity === 'critical').map((f) => ({ ...f, slug: p.slug })));

  lines.push('## Verdicts', '');
  for (const p of [...pages].sort((a, b) => (a.verdict === 'hold' ? -1 : 1) - (b.verdict === 'hold' ? -1 : 1) || String(a.grade).localeCompare(String(b.grade)))) {
    const mark = p.verdict === 'hold' ? '✗ HOLD' : '✓ send';
    lines.push(`- ${mark}  **${p.slug}**  grade ${p.grade ?? '?'}${p.summary ? ` — ${p.summary}` : ''}`);
  }

  lines.push('', '## Fix-list (by severity)', '');
  for (const p of pages) {
    const fs = [...(p.findings ?? [])].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
    if (!fs.length) continue;
    lines.push(`### ${p.slug}`);
    for (const f of fs) {
      const tag = f.severity === 'critical' ? '🔴' : f.severity === 'warn' ? '🟡' : '⚪';
      lines.push(`- ${tag} **${f.dimension}**${f.location ? ` (${f.location})` : ''}: ${f.issue}${f.fix ? `  → _fix:_ ${f.fix}` : ''}`);
    }
    lines.push('');
  }

  const reportPath = join(QA, 'VISION-QA.md');
  writeFileSync(reportPath, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\n▶ written → ${reportPath}`);
  console.log('─'.repeat(52));
  if (holds.length || criticals.length) {
    console.log(`✗ ${holds.length} page(s) on HOLD, ${criticals.length} critical finding(s) — do not send until resolved.`);
    process.exit(1);
  }
  if (missing.length) { console.log(`• ${missing.length} page(s) not yet reviewed.`); process.exit(2); }
  console.log('✓ All reviewed pages cleared to send.');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE MODE — build, screenshot, write review packets for the judge.
// ─────────────────────────────────────────────────────────────────────────────
async function runCapture() {
  const CHROME = findChrome();
  if (!CHROME) { console.error('Chrome not found. Set $CHROME_PATH and re-run.'); process.exit(1); }
  const slugs = resolveSlugs();
  if (!slugs.length) { console.error('No matching prospects.'); process.exit(1); }

  if (!noBuild) {
    console.log('▶ building gallery…');
    const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (b.status !== 0) { console.error('Build failed — fix it before QA.'); process.exit(1); }
  }

  console.log('▶ starting preview…');
  const preview = spawn('npm', ['run', 'preview'], { cwd: ROOT, shell: true });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('preview did not start in 30s')), 30000);
    preview.stdout.on('data', (d) => { buf += d.toString(); const m = buf.match(/localhost:(\d+)/); if (m) { clearTimeout(to); res(Number(m[1])); } });
    preview.stderr.on('data', () => {});
  });
  await sleep(800);

  // Fresh dirs each run so stale shots/packets never mislead a judge.
  rmSync(SHOTS, { recursive: true, force: true });
  rmSync(REVIEW, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(REVIEW, { recursive: true });
  mkdirSync(FINDINGS, { recursive: true });

  // One Chrome PER PAGE (not one for the whole batch): a page that wedges the
  // renderer — e.g. a very tall winery page stalling captureBeyondViewport —
  // would otherwise poison every page after it (Target.createTarget then times
  // out forever). Per-page isolation costs ~1s of browser boot but guarantees
  // one bad page can't sink the other ten. Full-page shots still get no height
  // cap beyond the renderer's own limit, so contact + footer stay in frame.
  let ok = 0;
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const dbgPort = port + 1000 + i; // fresh port per page; avoids reuse races
    try {
      await withChrome(CHROME, dbgPort, async (conn) => {
        const { foldPng, fullPng, fullHeight } = await capturePage(conn, `http://localhost:${port}/s/${slug}`);
        writeFileSync(join(SHOTS, `${slug}-fold.png`), foldPng);
        writeFileSync(join(SHOTS, `${slug}-full.png`), fullPng);
        writeFileSync(join(REVIEW, `${slug}.json`), JSON.stringify(packetFor(slug), null, 2));
        console.log(`✓ ${slug}  (full ${fullHeight}px)`);
        ok++;
      });
    } catch (e) {
      console.log(`✗ ${slug}  — ${e.message}`);
    }
  }
  console.log(`\n▶ captured ${ok}/${slugs.length} pages`);
  preview.kill();

  console.log(`\n▶ review packets → ${REVIEW}`);
  console.log(`▶ screenshots    → ${SHOTS}`);
  console.log('\nNEXT — the JUDGE step (the in-session agent is the vision judge):');
  console.log('  For each .shots/qa/review/<slug>.json: open its fold+full shots, score');
  console.log('  against docs/vision-qa-rubric.md, and write .shots/qa/findings/<slug>.json.');
  console.log('  Then: npm run vision-qa -- --report   (aggregates + gates).');
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE-MANIFEST MODE — the missing hook: push vision verdicts into the send gate.
// After findings exist, rewrite data/outreach-links.json so any slug whose vision
// finding is verdict:'hold' or carries a critical flips to status:'needs-review'.
// This is what stops a site shipping `ready` while its hero is the Joon mountain.
// Preserves BOTH status spellings already present (generate.mjs:151 / CLAUDE.md
// seam) — never invents a new value; only TIGHTENS ready → needs-review.
// ─────────────────────────────────────────────────────────────────────────────
function runGateManifest() {
  if (!existsSync(OUTREACH_LINKS)) {
    console.error(`✗ ${OUTREACH_LINKS} not found — run the factory (generate) first.`);
    process.exit(1);
  }
  const links = JSON.parse(readFileSync(OUTREACH_LINKS, 'utf8'));
  if (!Array.isArray(links)) { console.error('✗ outreach-links.json is not an array.'); process.exit(1); }

  // Index findings by slug.
  const held = new Set();
  if (existsSync(FINDINGS)) {
    for (const f of readdirSync(FINDINGS).filter((x) => x.endsWith('.json'))) {
      let finding;
      try { finding = JSON.parse(readFileSync(join(FINDINGS, f), 'utf8')); } catch { continue; }
      const slug = finding.slug || f.replace(/\.json$/, '');
      const hasCritical = (finding.findings ?? []).some((x) => x.severity === 'critical');
      if (finding.verdict === 'hold' || hasCritical) held.add(slug);
    }
  }

  let flipped = 0;
  for (const entry of links) {
    if (!held.has(entry.slug)) continue;
    // Only TIGHTEN: a ready demo becomes needs-review. Never loosen an existing
    // needs-review back to ready. Honor either spelling already in the file.
    if (entry.status === 'ready') { entry.status = 'needs-review'; flipped++; console.log(`  ✗ ${entry.slug} → needs-review (vision hold/critical)`); }
  }

  writeFileSync(OUTREACH_LINKS, JSON.stringify(links, null, 2) + '\n');
  console.log(`\n▶ gate-manifest: ${held.size} slug(s) held by vision, ${flipped} flipped ready → needs-review.`);
  console.log(`▶ written → ${OUTREACH_LINKS}`);
  process.exit(0);
}

if (gateManifestMode) runGateManifest();
else if (reportMode) runReport();
else runCapture();
