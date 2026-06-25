#!/usr/bin/env node
/**
 * flagship-build.mjs — the FLAGSHIP build pipeline (deep research → build →
 * vision auto-improve loop → flow polish), for ONE or a few hand-picked leads.
 *
 * The factory's normal path is one deterministic pass: scrape → author → flag.
 * The flagship path spends tokens to push a small number of leads to the AVISP
 * bar by chaining the tools the repo already ships and CLOSING the vision loop
 * that was built but never wired:
 *
 *   1) DEEP RESEARCH  — build-research --flagship (deeper photo crawl + a per-lead
 *      web-research BRIEF), then surface that brief so the agent web-verifies the
 *      gaps (Yelp/Google/FB/BBB/news) and promotes the file toward confirmed.
 *      A confirmed/rich lead bypasses the thin-research guardrails, so research
 *      DEPTH is the highest-leverage lever — that is why this stage is first and
 *      loud. (Honesty stays the line: the brief only points at sources; it never
 *      invents a fact.)
 *   2) BUILD          — shells `generate.mjs` per lead in single-lead mode
 *      (`--only <slug> --no-manifest --no-crm-sync`) so the shared outreach
 *      manifest + CRM are never touched by an in-progress flagship run.
 *   3) VISION LOOP    — build + screenshot (vision-qa capture) → vision-judge
 *      SCORES each /s/<slug> against docs/vision-qa-rubric.md → if a page is a
 *      `hold` / has a critical / is below the grade bar, the judge's feedback is
 *      applied to the research file (drop the offending hero/gallery photo →
 *      the sanctioned editorial fallback, rewrite copy when keyed) and the lead
 *      is REBUILT. Repeats up to --max-loops. This is the auto-improve loop that
 *      vision-judge.mjs was missing.
 *   4) FLOW POLISH    — once a lead clears the bar, emit the hook to summon the
 *      `flow` agent (premium motion) on its page. (HOOK/STUB: a Claude subagent
 *      can't be spawned from node — see "WIRED vs STUBBED" below.)
 *
 * WIRED vs STUBBED
 *   WIRED:   research → brief → build → capture → judge → evaluate → apply
 *            feedback → rebuild loop → per-lead pass/quarantine report.
 *   KEY-GATED: vision-judge writes findings automatically only with
 *            ANTHROPIC_API_KEY. Key-free (the Pro path) it prints the judge
 *            instructions and this script PAUSES (exit 2) with a `--resume`
 *            command; the in-session agent writes findings, then resumes the loop.
 *            Likewise, deep external-source research + confirmed:true promotion
 *            are agent/keyed steps (this script targets them; it doesn't fake them).
 *   STUBBED: the flow-agent invocation (printed hook only) and any auto-publish
 *            (flagship NEVER flips the manifest to ready or syncs the CRM — that
 *            stays a human go-ahead via the normal gate).
 *
 * Heavy builds: the demo-gallery build/preview/Chrome capture needs the Astro
 * toolchain, whose node_modules are Linux-only on this machine — so on win32 the
 * capture step is run through WSL Ubuntu automatically (disable with --no-wsl).
 * The pure-node steps (research/generate/judge) run on native node directly.
 *
 * Usage:
 *   node scripts/flagship-build.mjs <leads.csv> [options]
 *   node scripts/flagship-build.mjs --help
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { formatBrief, researchGaps } from './lib/research-targets.mjs';
// NOTE: facts.mjs is imported LAZILY (inside slugsFromCsv) — it pulls in `sharp`
// via the photo layer, which isn't present in lightweight/worktree checkouts.
// Keeping it out of the module top level lets the pure helpers (and their unit
// tests) load with zero heavy deps.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RESEARCH_DIR = join(REPO_ROOT, 'data', 'research');
const GALLERY_DIR = join(REPO_ROOT, 'sites', 'demo-gallery');
const PREMIUM_DIR = join(GALLERY_DIR, 'src', 'data', 'premium');
const FINDINGS_DIR = join(REPO_ROOT, '.shots', 'qa', 'findings');

const GRADES = ['A', 'B', 'C', 'D', 'F'];
const gradeRank = (g) => {
  const i = GRADES.indexOf(String(g || '').trim().toUpperCase()[0]);
  return i === -1 ? GRADES.length : i; // unknown grade = worst
};

// ── arg parsing (pure, exported for tests) ──────────────────────────────────
export function parseFlagshipArgs(argv) {
  const o = {
    csv: '', state: '', only: [], limit: 0, maxLoops: 2, bar: 'B',
    research: true, promote: false, flow: false, resume: false,
    wsl: process.platform === 'win32', dryRun: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--state') o.state = argv[++i] || '';
    else if (a === '--only') o.only.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--limit') o.limit = Number(argv[++i]) || 0;
    else if (a === '--max-loops') o.maxLoops = Math.max(1, Number(argv[++i]) || 2);
    else if (a === '--bar') o.bar = String(argv[++i] || 'B').toUpperCase();
    else if (a === '--no-research') o.research = false;
    else if (a === '--promote') o.promote = true;
    else if (a === '--flow') o.flow = true;
    else if (a === '--resume') o.resume = true;
    else if (a === '--no-wsl') o.wsl = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else if (!o.csv) o.csv = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return o;
}

const HELP = `flagship-build — deep research → build → vision auto-loop → flow polish

USAGE
  node scripts/flagship-build.mjs <leads.csv> [options]

OPTIONS
  --only <slug[,slug]>   build only these slug(s) (default: every lead in the CSV)
  --state <CC>           default state for leads with no state column
  --limit <N>            only the first N leads
  --max-loops <N>        vision auto-improve iterations            (default 2)
  --bar <A|B|C>          minimum acceptable vision grade           (default B)
  --no-research          skip build-research (reuse existing data/research files)
  --promote              run verify-research --promote (needs ANTHROPIC_API_KEY)
  --flow                 print the flow-agent polish hook for passing leads
  --resume               re-enter the vision loop using findings just written
                         (the key-free path after you judge the shots by eye)
  --no-wsl               run the gallery build/capture natively (not via WSL)
  --dry-run              print the plan and exit; run nothing
  -h, --help             this help

NOTES
  • Key-free (Pro) the vision JUDGE is YOU: the loop captures shots, prints the
    judge instructions, and PAUSES (exit 2). Open .shots/qa/shots/<slug>-fold.png
    + -full.png, score against docs/vision-qa-rubric.md, write
    .shots/qa/findings/<slug>.json, then re-run with --resume.
  • With ANTHROPIC_API_KEY set, vision-judge scores automatically and the loop
    runs end to end.
  • Flagship NEVER publishes: it won't touch data/outreach-links.json or the CRM.
    After leads pass, gate + ship via the normal path (a human go-ahead).`;

// ── child-process helpers ───────────────────────────────────────────────────
function toMnt(winPath) {
  // C:\Users\x → /mnt/c/Users/x  (also tolerates forward slashes)
  const p = winPath.replace(/\\/g, '/');
  const m = p.match(/^([A-Za-z]):\/(.*)$/);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : p;
}

// Run a pure-node repo script on native node.
function runNode(scriptRel, args, { quiet = false } = {}) {
  const r = spawnSync(process.execPath, [join(REPO_ROOT, scriptRel), ...args], {
    cwd: REPO_ROOT, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8',
  });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Run a command in the gallery dir, through WSL on win32 (Linux-only deps).
function runGallery(cmd, { wsl }) {
  if (wsl) {
    const bash = `cd '${toMnt(GALLERY_DIR)}' && ${cmd}`;
    const r = spawnSync('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', bash], { stdio: 'inherit' });
    return r.status ?? 1;
  }
  const r = spawnSync(cmd, { cwd: GALLERY_DIR, stdio: 'inherit', shell: true });
  return r.status ?? 1;
}

// ── research-file IO ────────────────────────────────────────────────────────
function researchPath(slug) { return join(RESEARCH_DIR, `${slug}.json`); }
function loadResearchFile(slug) {
  try { return JSON.parse(readFileSync(researchPath(slug), 'utf8')); } catch { return null; }
}
function loadFinding(slug) {
  const fp = join(FINDINGS_DIR, `${slug}.json`);
  if (!existsSync(fp)) return null;
  try { return JSON.parse(readFileSync(fp, 'utf8')); } catch { return null; }
}

// ── vision evaluation (pure, exported for tests) ────────────────────────────
export function evaluateFinding(finding, bar = 'B') {
  if (!finding) return { pass: false, reason: 'no finding yet' };
  const crit = (finding.findings ?? []).filter((f) => f.severity === 'critical');
  if (finding.verdict === 'hold') return { pass: false, reason: `verdict hold — ${finding.summary || ''}`.trim() };
  if (crit.length) return { pass: false, reason: `${crit.length} critical finding(s)` };
  if (gradeRank(finding.grade) > gradeRank(bar)) return { pass: false, reason: `grade ${finding.grade} below bar ${bar}` };
  return { pass: true, reason: `grade ${finding.grade}` };
}

// Parse "gallery, 3rd image" / "photo-2" / "image 4" → zero-based index, or -1.
export function photoIndexFromLocation(loc = '') {
  const m = String(loc).match(/(\d+)\s*(?:st|nd|rd|th)?\b/);
  if (!m) return -1;
  const n = Number(m[1]);
  return n >= 1 ? n - 1 : -1;
}

const PHOTO_DIMS = new Set(['hero-congruence', 'photo-congruence', 'photo-quality', 'hero-legibility']);
const heroLike = (f) => /hero/i.test(`${f.dimension} ${f.location || ''}`);
const galleryLike = (f) => /gallery|service|card|story|photo|image/i.test(f.location || '');

/**
 * Translate vision findings into deterministic research-file mutations + a list
 * of human-readable actions. PURE: returns a NEW research object; caller writes
 * it. The only photo levers we own (without editing the author) are the research
 * file's realPhotoUrls — so:
 *   • a HERO photo flagged critical/warn for congruence/quality → clear the photo
 *     pool so the generator routes to the sanctioned editorial (photo-less) hero,
 *     which the rubric says is CORRECT, not a defect.
 *   • a buried gallery/card photo flagged → drop that one URL by index.
 * Copy/richness findings are recorded for the copy-rewrite step (verify-research
 * --promote) and surfaced for the agent; honesty stays the line — we only ever
 * REMOVE a doubtful photo, never invent one.
 */
export function applyVisionFeedback(research, finding, { loop = 1 } = {}) {
  const r = JSON.parse(JSON.stringify(research || {}));
  const actions = [];
  const photos = Array.isArray(r.realPhotoUrls) ? [...r.realPhotoUrls] : [];
  const bad = (finding?.findings ?? []).filter(
    (f) => PHOTO_DIMS.has(f.dimension) && (f.severity === 'critical' || f.severity === 'warn'),
  );

  let clearedHero = false;
  const dropIdx = new Set();
  for (const f of bad) {
    if (heroLike(f)) {
      if (!clearedHero) { clearedHero = true; actions.push(`cleared photo pool → editorial hero (${f.dimension}: ${f.issue})`); }
      continue;
    }
    if (galleryLike(f)) {
      const idx = photoIndexFromLocation(f.location);
      if (idx >= 0 && idx < photos.length) { dropIdx.add(idx); actions.push(`dropped photo #${idx + 1} (${f.dimension}: ${f.issue})`); }
    }
  }

  if (clearedHero) r.realPhotoUrls = [];
  else if (dropIdx.size) r.realPhotoUrls = photos.filter((_, i) => !dropIdx.has(i));

  // Copy / richness / layout findings → flag the copy-rewrite path.
  const copyish = (finding?.findings ?? []).filter(
    (f) => !PHOTO_DIMS.has(f.dimension) && (f.severity === 'critical' || f.severity === 'warn'),
  );
  const needsCopy = copyish.some((f) => /richness|credibility|copy|slop|generic|layout/i.test(`${f.dimension} ${f.issue}`));
  if (needsCopy) actions.push('copy/richness flagged → rewrite copy (verify-research --promote when keyed, else agent)');

  // Record the feedback trail honestly on the file.
  r._visionFeedback = Array.isArray(r._visionFeedback) ? r._visionFeedback : [];
  r._visionFeedback.push({
    loop, grade: finding?.grade, verdict: finding?.verdict, summary: finding?.summary,
    actions, findings: finding?.findings ?? [],
  });
  const note = `Vision loop ${loop}: ${actions.length ? actions.join('; ') : 'no auto-fix applied — needs agent/manual attention'}.`;
  r.notes = [r.notes, note].filter(Boolean).join(' ');
  return { research: r, actions, needsCopy, clearedHero };
}

// ── flow polish hook (STUB — printed, not auto-invoked) ─────────────────────
export function buildFlowHook(slug, grade) {
  return [
    `  FLOW POLISH HOOK — ${slug} (passed, grade ${grade})`,
    '    A Claude subagent cannot be spawned from node, so this is a manual hook.',
    '    In the in-session agent, summon flow on this page:',
    `      > flow: review sites/demo-gallery /s/${slug} and add premium motion`,
    '    flow reads its catalog at C:\\Users\\dukot\\demos\\flow\\FEATURES.md and adapts',
    `    the .astro recipes into the premium layer. Re-run vision-qa on ${slug} after.`,
  ].join('\n');
}

// ── slug resolution ─────────────────────────────────────────────────────────
async function slugsFromCsv(csvPath, opts) {
  const { parseCsv, slugify } = await import('./lib/facts.mjs');
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  let names = rows.map((r) => r.name).filter(Boolean);
  if (opts.limit) names = names.slice(0, opts.limit);
  let slugs = names.map(slugify);
  if (opts.only.length) slugs = slugs.filter((s) => opts.only.some((o) => s === o || s.includes(o)));
  return [...new Set(slugs)];
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  let opts;
  try { opts = parseFlagshipArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); console.error('Run with --help.'); process.exit(1); }

  if (opts.help) { console.log(HELP); return; }
  if (!opts.csv) { console.error('Missing <leads.csv>. Run with --help.'); process.exit(1); }

  const csvPath = resolve(REPO_ROOT, opts.csv);
  if (!existsSync(csvPath)) { console.error(`CSV not found: ${csvPath}`); process.exit(1); }

  const builderCsv = join(REPO_ROOT, 'data', `${basename(csvPath).replace(/\.[^.]+$/, '')}-flagship-leads.csv`);
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  console.log('━'.repeat(60));
  console.log('FLAGSHIP BUILD');
  console.log(`  leads CSV : ${csvPath}`);
  console.log(`  bar       : grade ${opts.bar}   max-loops: ${opts.maxLoops}`);
  console.log(`  key       : ${hasKey ? 'ANTHROPIC_API_KEY set (auto vision-judge + copy)' : 'key-free (agent is the vision judge)'}`);
  console.log(`  capture   : ${opts.wsl ? 'via WSL Ubuntu' : 'native'}`);
  console.log('━'.repeat(60));

  // ── STAGE 1: DEEP RESEARCH ────────────────────────────────────────────────
  if (opts.research && !opts.resume) {
    console.log('\n[1/4] DEEP RESEARCH');
    if (opts.dryRun) {
      console.log(`  would run: build-research ${opts.csv} --flagship${opts.state ? ` --state ${opts.state}` : ''}${opts.limit ? ` --limit ${opts.limit}` : ''} --out ${builderCsv}`);
    } else {
      const args = [opts.csv, '--flagship', '--out', builderCsv];
      if (opts.state) args.push('--state', opts.state);
      if (opts.limit) args.push('--limit', String(opts.limit));
      const res = runNode('scripts/build-research.mjs', args);
      if (res.status !== 0) { console.error('  build-research failed.'); process.exit(1); }
      // Clean noise; optionally write copy (keyed).
      const vrArgs = opts.promote && hasKey ? ['--promote'] : [];
      runNode('scripts/verify-research.mjs', vrArgs);
    }
  } else {
    console.log(`\n[1/4] DEEP RESEARCH — skipped (${opts.resume ? 'resume' : '--no-research'}); using existing data/research files.`);
  }

  // Resolve the target slugs (prefer the builder CSV when it exists).
  const sourceCsv = existsSync(builderCsv) ? builderCsv : csvPath;
  const slugs = opts.dryRun && !existsSync(sourceCsv) ? await slugsFromCsv(csvPath, opts) : await slugsFromCsv(sourceCsv, opts);
  if (!slugs.length) { console.error('No target slugs resolved from the CSV (check --only).'); process.exit(1); }
  console.log(`  targets: ${slugs.join(', ')}`);

  // Research brief — the deep, agent/keyed part. Loud on purpose: a confirmed
  // lead bypasses the guardrails, so this is the highest-leverage step.
  console.log('\n  WEB-RESEARCH BRIEF (verify these → set confirmed:true for the strongest result):');
  for (const slug of slugs) {
    const r = loadResearchFile(slug);
    if (!r) { console.log(`    · ${slug}: no research file yet.`); continue; }
    if (r.confirmed === true) { console.log(`    · ${slug}: confirmed:true — authoritative, no brief needed.`); continue; }
    console.log(formatBrief(r));
    const gaps = researchGaps(r);
    if (gaps.length) console.log(`      → ${gaps.length} open gap(s); fill them for the flagship bar.`);
  }

  if (opts.dryRun) {
    console.log('\n[2/4] BUILD — would generate (single-lead) each target.');
    console.log('[3/4] VISION LOOP — would capture → judge → evaluate → rebuild.');
    console.log('[4/4] FLOW — would print the flow hook for passing leads.');
    console.log('\nDry run complete; nothing was written.');
    return;
  }

  // ── STAGE 2+3: BUILD + VISION AUTO-LOOP ───────────────────────────────────
  let pending = [...slugs];
  const passed = new Map();      // slug → grade
  const quarantined = new Map(); // slug → reason

  for (let loop = 1; loop <= opts.maxLoops && pending.length; loop++) {
    console.log(`\n[2/4] BUILD — loop ${loop}/${opts.maxLoops} (${pending.length} lead(s))`);
    for (const slug of pending) {
      // Re-run the copy writer first when this slug's last finding asked for it.
      const prev = loadResearchFile(slug);
      const wantCopy = prev?._visionFeedback?.some((v) => (v.actions || []).some((a) => /rewrite copy/.test(a)));
      if (wantCopy && hasKey) runNode('scripts/verify-research.mjs', ['--promote', slug]);

      const gen = runNode('scripts/generate.mjs', [
        existsSync(builderCsv) ? builderCsv : csvPath, '--only', slug, '--no-manifest', '--no-crm-sync', '--flagship',
      ]);
      if (gen.status !== 0) { quarantined.set(slug, 'generate failed'); }
    }
    pending = pending.filter((s) => !quarantined.has(s));
    if (!pending.length) break;

    console.log(`\n[3/4] VISION LOOP — capture + judge — loop ${loop}`);
    const capCmd = `node scripts/vision-qa.mjs ${pending.join(' ')}`;
    const capStatus = runGallery(capCmd, { wsl: opts.wsl });
    if (capStatus !== 0) {
      console.error('  vision-qa capture failed (build/preview/Chrome). Cannot score this loop.');
      console.error(opts.wsl ? '  Tip: ensure WSL Ubuntu has the gallery deps + Chrome, or use --no-wsl.' : '  Tip: on win32 the gallery needs WSL — drop --no-wsl.');
      for (const s of pending) quarantined.set(s, 'capture failed');
      break;
    }

    // Judge: keyed → writes findings; key-free → prints instructions (no findings).
    runNode('scripts/vision-judge.mjs', pending);

    const missing = pending.filter((s) => !loadFinding(s));
    if (missing.length) {
      // Key-free path: pause for the in-session agent to judge by eye, then resume.
      console.log('\n' + '─'.repeat(60));
      console.log('PAUSED — vision judgment needed (key-free path).');
      console.log(`  Awaiting your findings for: ${missing.join(', ')}`);
      console.log('  For each: open .shots/qa/shots/<slug>-fold.png + -full.png, score');
      console.log('  against docs/vision-qa-rubric.md, write .shots/qa/findings/<slug>.json.');
      console.log('  Then resume the loop:');
      const resumeOnly = missing.length ? ` --only ${missing.join(',')}` : '';
      console.log(`    node scripts/flagship-build.mjs ${opts.csv} --resume --no-research${resumeOnly} --max-loops ${opts.maxLoops} --bar ${opts.bar}${opts.flow ? ' --flow' : ''}`);
      console.log('─'.repeat(60));
      process.exit(2);
    }

    // Evaluate + apply feedback to the failures.
    const stillFailing = [];
    for (const slug of pending) {
      const finding = loadFinding(slug);
      const verdict = evaluateFinding(finding, opts.bar);
      if (verdict.pass) { passed.set(slug, finding.grade); console.log(`  ✓ ${slug} — PASS (${verdict.reason})`); continue; }
      console.log(`  ✗ ${slug} — ${verdict.reason}`);
      if (loop >= opts.maxLoops) { quarantined.set(slug, verdict.reason); continue; }
      const r = loadResearchFile(slug);
      if (!r) { quarantined.set(slug, 'no research file to revise'); continue; }
      const { research, actions } = applyVisionFeedback(r, finding, { loop });
      writeFileSync(researchPath(slug), JSON.stringify(research, null, 2) + '\n');
      console.log(`     ↻ applied: ${actions.length ? actions.join('; ') : 'feedback recorded (no auto-fix)'}`);
      stillFailing.push(slug);
    }
    pending = stillFailing;
  }

  // ── STAGE 4: FLOW POLISH (hook) ───────────────────────────────────────────
  if (passed.size && opts.flow) {
    console.log('\n[4/4] FLOW POLISH');
    for (const [slug, grade] of passed) console.log(buildFlowHook(slug, grade));
  } else if (passed.size) {
    console.log('\n[4/4] FLOW POLISH — skipped (pass --flow to print the flow hooks).');
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  const base = (process.env.GALLERY_BASE_URL || 'https://demos.copperbaytech.com').replace(/\/$/, '');
  console.log('\n' + '━'.repeat(60));
  console.log('FLAGSHIP SUMMARY');
  if (passed.size) {
    console.log(`  PASSED (${passed.size}) — clears the grade-${opts.bar} bar:`);
    for (const [slug, grade] of passed) console.log(`    ✓ ${slug} (grade ${grade})  ${base}/s/${slug}`);
  }
  if (quarantined.size) {
    console.log(`  QUARANTINED (${quarantined.size}) — NOT ready:`);
    for (const [slug, reason] of quarantined) console.log(`    ✗ ${slug} — ${reason}`);
  }
  console.log('');
  console.log('  Flagship does NOT publish. To ship the passers (human go-ahead):');
  console.log('    1) full `npm run generate -- <csv>` to rebuild the shared manifest, then');
  console.log('    2) gate: cd sites/demo-gallery && npm run vision-qa -- --gate-manifest');
  console.log('    3) commit + push (Vercel deploy) → CRM sync by id.');
  console.log('━'.repeat(60));
  process.exit(quarantined.size && !passed.size ? 1 : 0);
}

// Only run main when invoked directly (so tests can import the pure helpers).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
