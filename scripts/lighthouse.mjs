#!/usr/bin/env node
/**
 * lighthouse.mjs — the LIGHTHOUSE QA GATE (SEO + a11y + best-practices floor).
 * Key-free, deterministic, fail-soft.
 *
 * `audit.mjs` catches dead tokens / contrast / empty sections statically, and
 * `screenshot-audit.mjs` (the vision pass) catches "looks wrong". Neither runs
 * the page in a real browser, so neither sees the things a search crawler and a
 * screen reader actually care about: a missing <title>/meta description, an image
 * with no alt, an un-labelled control, an http-resource on the page, a broken
 * heading order. Lighthouse runs the *built* page in headless Chrome and scores
 * exactly those. This gate makes a minimum SEO + accessibility bar permanent.
 *
 * It runs against the ALREADY-BUILT pages under
 *   sites/demo-gallery/dist/s/<slug>/index.html
 * (the Integrate phase builds once — this script never runs `astro build`). It
 * serves `dist/` with a tiny built-in static server so Lighthouse loads the real
 * compiled HTML/CSS/JS over http (Lighthouse needs an http(s) origin), launches
 * Chrome via chrome-launcher, audits a sample of pages, prints a per-page score
 * table, and FAILS (non-zero exit) if any sampled page scores SEO < 95 or
 * accessibility < 90.
 *
 * CRITICAL — fail-soft on no Chrome: in a headless CI/box where Chrome cannot be
 * launched, this gate SKIPS cleanly (clear message, exit 0). It must never block
 * a deploy just because a browser binary is unavailable. Set $CHROME_PATH to
 * point chrome-launcher at a specific Chrome/Chromium binary.
 *
 * Usage:
 *   node scripts/lighthouse.mjs                 # sample of built prospect pages
 *   node scripts/lighthouse.mjs vasquez smitty  # only matching slugs
 *   node scripts/lighthouse.mjs --all           # audit every built page (slow)
 *   node scripts/lighthouse.mjs --perf          # also report performance score
 *   node scripts/lighthouse.mjs --budget        # ENFORCE the perf/CWV budget gate
 *   LH_SAMPLE=8 node scripts/lighthouse.mjs     # change the sample size
 *   npm run perf-budget                         # the --budget gate via npm
 *
 * --budget adds a performance gate on top of the SEO/a11y floors: each sampled
 * page must score perf ≥ 90 and stay within LCP ≤ 2500ms / CLS ≤ 0.1 /
 * TBT ≤ 200ms / total weight ≤ 700KB (all env-overridable via LH_PERF_FLOOR,
 * LH_LCP_MS, LH_CLS, LH_TBT_MS, LH_BYTES). Still fail-soft on no-Chrome.
 */

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'sites', 'demo-gallery');
const DIST = join(APP, 'dist');
const PAGES = join(DIST, 's'); // built premium home pages: dist/s/<slug>/index.html

// ── Gate thresholds (0–100). A sampled page failing EITHER fails the gate. ─────
const SEO_FLOOR = 95;
const A11Y_FLOOR = 90;

// ── Performance / Core Web Vitals budget (opt-in via --budget). ────────────────
// The SEO + a11y floors above are always on; the perf budget is a SEPARATE,
// opt-in gate so the default run stays fast (it doesn't need the performance
// category, which is the slow part of a Lighthouse pass). When --budget is given
// we also run the `performance` category and assert each sampled page stays
// inside these ceilings — so a future change (a heavy hero, a blocking script,
// an un-optimized photo) that would quietly push a demo past the line FAILS the
// gate instead of shipping. Measured under Lighthouse's default simulated
// Slow-4G mobile throttling, which is the same config the AUDIT baseline used
// (perf 99, LCP ~2.0s, CLS ~0, TBT 0, ~210–360KB/page) — so these floors sit
// comfortably above today's numbers and only trip on a real regression. Each is
// env-overridable for a deliberate, documented budget change.
const PERF_FLOOR = Number(process.env.LH_PERF_FLOOR) || 90; // performance score
const LCP_BUDGET = Number(process.env.LH_LCP_MS) || 2500; // ms — "good" CWV bar
const CLS_BUDGET = Number(process.env.LH_CLS) || 0.1; // unitless — "good" CWV bar
const TBT_BUDGET = Number(process.env.LH_TBT_MS) || 200; // ms — interactivity proxy
const BYTES_BUDGET = Number(process.env.LH_BYTES) || 700_000; // total transfer ceiling

// How many pages to sample when no slug filter / --all is given. Auditing every
// page is slow (one full Chrome run each), and same-template pages score alike,
// so a deterministic sample is enough to catch a regression. Override via env.
const DEFAULT_SAMPLE = Number(process.env.LH_SAMPLE) || 6;

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const wantBudget = args.includes('--budget');
// --budget implies collecting the performance category (the CWV audits live
// inside it); --perf alone just reports perf without enforcing the budget.
const wantPerf = args.includes('--perf') || wantBudget;
const filters = args.filter((a) => !a.startsWith('--'));

// ── Minimal static file server for dist/ ───────────────────────────────────────
// Lighthouse must load the page over an http origin (file:// breaks many audits),
// so we serve the already-built dist/ ourselves rather than depend on a separate
// `astro preview` process. Read-only, localhost, no dependencies.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve a request URL to a real file under dist/, mapping a directory to its
 *  index.html. Guards against path traversal — anything resolving outside dist
 *  is refused. Returns null when nothing servable is found. */
async function resolvePath(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  // Normalise + reject traversal: the joined path must stay inside DIST.
  const abs = join(DIST, rel);
  if (abs !== DIST && !abs.startsWith(DIST + (process.platform === 'win32' ? '\\' : '/'))) {
    return null;
  }
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      const idx = join(abs, 'index.html');
      await stat(idx);
      return idx;
    }
    if (s.isFile()) return abs;
  } catch {
    // Astro builds directory-style routes (p/<slug>/index.html); a bare path with
    // no extension is most likely one of those — try appending /index.html.
    if (!extname(abs)) {
      try {
        const idx = join(abs, 'index.html');
        await stat(idx);
        return idx;
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

/** Start the static server on an OS-assigned free port. Resolves to { port, close }. */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const file = await resolvePath(req.url || '/');
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('read error');
      }
    });
    server.on('error', reject);
    // Bind to loopback only — this is a local QA server, never exposed.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// ── Pick which built pages to audit ────────────────────────────────────────────
/** List the slugs that actually built (have dist/p/<slug>/index.html). */
async function builtSlugs() {
  let entries;
  try {
    entries = await readdir(PAGES, { withFileTypes: true });
  } catch {
    return null; // dist/p missing → not built yet (caller reports it)
  }
  const slugs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await stat(join(PAGES, e.name, 'index.html'));
      slugs.push(e.name);
    } catch {
      /* directory without an index.html — skip */
    }
  }
  return slugs.sort(); // sorted → deterministic sampling
}

/** Deterministically pick `n` slugs spread across the sorted list (not just the
 *  first n) so the sample isn't biased to one alphabetical cluster. */
function sample(slugs, n) {
  if (slugs.length <= n) return slugs;
  const step = slugs.length / n;
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(slugs[Math.floor(i * step)]);
  return picked;
}

// ── Detect whether Chrome can be launched (fail-soft otherwise) ─────────────────
/** Try to launch Chrome via chrome-launcher. Returns the chrome instance on
 *  success, or null if no browser is available / it won't start — in which case
 *  the gate SKIPS rather than fails.
 *
 *  chrome-launcher spawns Chrome asynchronously: a bad binary surfaces as an
 *  'error' event on the child process (an *unhandled* one would crash the whole
 *  gate), and a Chrome that starts but never opens its debug port rejects only
 *  after a long internal wait. We defend against both: validate $CHROME_PATH up
 *  front, swallow the launch rejection, and install a one-shot process guard so a
 *  late spawn ENOENT can't take the gate down — it just means "no Chrome → skip". */
async function tryLaunchChrome(launch) {
  // If the caller pointed us at a binary that isn't there, skip immediately
  // rather than letting chrome-launcher's async spawn blow up.
  if (process.env.CHROME_PATH && !existsSync(process.env.CHROME_PATH)) {
    return null;
  }
  const flags = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'];
  const opts = { chromeFlags: flags };
  // chrome-launcher honours $CHROME_PATH itself, but pass it explicitly when set
  // so the reason for a chosen binary is obvious.
  if (process.env.CHROME_PATH) opts.chromePath = process.env.CHROME_PATH;

  // Guard against an async spawn 'error' (e.g. ENOENT/EACCES) that chrome-launcher
  // emits *after* launch() settles — without this it becomes an unhandled
  // 'error'/rejection and crashes the gate. We just want to treat it as "no Chrome".
  let guardHit = false;
  const guard = () => {
    guardHit = true;
  };
  process.once('unhandledRejection', guard);
  process.once('uncaughtException', guard);
  try {
    const chrome = await launch(opts);
    // If the spawn already errored out from under us, don't hand back a dead handle.
    return guardHit ? null : chrome;
  } catch {
    return null;
  } finally {
    process.removeListener('unhandledRejection', guard);
    process.removeListener('uncaughtException', guard);
  }
}

async function main() {
  console.log('# LIGHTHOUSE QA GATE — SEO + accessibility floor (built pages)\n');

  // 1. The pages must already be built (the Integrate phase builds once).
  const all = await builtSlugs();
  if (all === null || all.length === 0) {
    console.log(`✗ No built pages found under ${PAGES}`);
    console.log('  Build the gallery first (the Integrate phase runs `astro build`).');
    // No built pages is a real problem for THIS gate, but the surrounding qa
    // chain already builds before reaching here; treat as a hard miss.
    process.exitCode = 1;
    return;
  }

  // 2. Choose the sample (filters > --all > deterministic sample).
  let targets;
  if (filters.length) {
    targets = all.filter((s) => filters.some((f) => s.includes(f)));
    if (!targets.length) {
      console.log(`✗ No built page matched: ${filters.join(', ')}`);
      process.exitCode = 1;
      return;
    }
  } else if (wantAll) {
    targets = all;
  } else {
    targets = sample(all, DEFAULT_SAMPLE);
  }
  console.log(`Auditing ${targets.length} of ${all.length} built page(s); thresholds: SEO ≥ ${SEO_FLOOR}, a11y ≥ ${A11Y_FLOOR}.`);
  if (wantBudget) {
    console.log(`Perf budget ON: perf ≥ ${PERF_FLOOR}, LCP ≤ ${LCP_BUDGET}ms, CLS ≤ ${CLS_BUDGET}, TBT ≤ ${TBT_BUDGET}ms, weight ≤ ${Math.round(BYTES_BUDGET / 1024)}KB.`);
  }
  console.log('');

  // 3. Try to bring up Chrome. If we can't, SKIP cleanly (exit 0) — a missing
  //    headless browser must never hard-fail the gate.
  const { launch } = await import('chrome-launcher');
  const chrome = await tryLaunchChrome(launch);
  if (!chrome) {
    console.log('⚠ Chrome could not be launched in this environment — SKIPPING the Lighthouse gate.');
    console.log('  (Set $CHROME_PATH to a Chrome/Chromium binary to enable it.) Treated as a pass.');
    process.exitCode = 0;
    return;
  }

  // 4. Serve dist/ and run Lighthouse against each sampled page over http.
  const lighthouseMod = await import('lighthouse');
  const lighthouse = lighthouseMod.default;
  const server = await startServer();
  const base = `http://127.0.0.1:${server.port}`;

  const onlyCategories = ['seo', 'accessibility', 'best-practices'];
  if (wantPerf) onlyCategories.push('performance');

  // The prospect demos ship `<meta name="robots" content="noindex, nofollow">`
  // ON PURPOSE — they're outreach demos on a shared gallery domain that must stay
  // out of search indexes. Lighthouse's `is-crawlable` audit therefore scores 0
  // for the noindex on EVERY page, which would peg SEO below the floor forever and
  // make this gate a permanent red light over an intentional design choice. We
  // skip that one audit so the SEO score reflects the things we DO care about
  // (title, meta description, valid hreflang, link text, font sizes, etc.).
  const skipAudits = ['is-crawlable'];

  const rows = []; // { slug, seo, a11y, bp, perf, error }
  let failures = 0;
  let errored = 0;

  for (const slug of targets) {
    const url = `${base}/s/${slug}/`;
    try {
      const runnerResult = await lighthouse(
        url,
        {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories,
          skipAudits,
        },
      );
      const lhr = runnerResult?.lhr || {};
      const cats = lhr.categories || {};
      // Lighthouse scores are 0–1 (null if a category couldn't be computed).
      const pct = (c) => (cats[c] && cats[c].score != null ? Math.round(cats[c].score * 100) : null);
      const seo = pct('seo');
      const a11y = pct('accessibility');
      const bp = pct('best-practices');
      const perf = wantPerf ? pct('performance') : null;

      // A null score can't be judged against the floor — flag it, don't pass it.
      const seoBad = seo == null || seo < SEO_FLOOR;
      const a11yBad = a11y == null || a11y < A11Y_FLOOR;
      let fail = seoBad || a11yBad;

      // Core Web Vitals + page weight, pulled from the raw audits (only meaningful
      // when the performance category ran). numericValue is ms for LCP/TBT, a
      // unitless score for CLS, bytes for total weight.
      let lcp = null, cls = null, tbt = null, bytes = null, budgetBad = false;
      if (wantBudget) {
        const num = (id) => {
          const v = lhr.audits?.[id]?.numericValue;
          return typeof v === 'number' ? v : null;
        };
        lcp = num('largest-contentful-paint');
        cls = num('cumulative-layout-shift');
        tbt = num('total-blocking-time');
        bytes = num('total-byte-weight');
        // A null metric can't be proven within budget → treat as a budget miss.
        budgetBad =
          perf == null || perf < PERF_FLOOR ||
          lcp == null || lcp > LCP_BUDGET ||
          cls == null || cls > CLS_BUDGET ||
          tbt == null || tbt > TBT_BUDGET ||
          bytes == null || bytes > BYTES_BUDGET;
        fail = fail || budgetBad;
      }
      if (fail) failures++;

      rows.push({ slug, seo, a11y, bp, perf, lcp, cls, tbt, bytes, budgetBad, fail });
    } catch (err) {
      // A single page erroring shouldn't crash the whole gate, but it IS a
      // failure for that page (we couldn't prove it meets the bar).
      errored++;
      failures++;
      rows.push({ slug, error: (err && err.message) || String(err), fail: true });
    }
  }

  // 5. Tear everything down (always) before printing the verdict.
  await server.close();
  try {
    await chrome.kill();
  } catch {
    /* best-effort */
  }

  // 6. Per-page score table.
  const cell = (v, floor) => {
    if (v == null) return '  — ';
    const s = String(v).padStart(3, ' ');
    return floor != null && v < floor ? `${s}✗` : `${s} `;
  };
  // Budget cell: show the metric, marked ✗ when it exceeds (or undershoots) its
  // ceiling. `over` is true when "bigger is worse" (LCP/CLS/TBT/bytes); false for
  // the perf score where smaller is worse.
  const bcell = (v, limit, over, fmt, width) => {
    if (v == null) return '—'.padStart(width);
    const bad = over ? v > limit : v < limit;
    return `${fmt(v)}${bad ? '✗' : ' '}`.padStart(width);
  };
  const head = `  ${'slug'.padEnd(34)} ${'SEO'.padStart(4)} ${'a11y'.padStart(5)} ${'best'.padStart(5)}${wantPerf ? ` ${'perf'.padStart(5)}` : ''}${wantBudget ? ` ${'LCP'.padStart(7)} ${'CLS'.padStart(6)} ${'TBT'.padStart(6)} ${'KB'.padStart(6)}` : ''}`;
  console.log(head);
  console.log('  ' + '─'.repeat(head.length - 2));
  for (const r of rows) {
    if (r.error) {
      console.log(`  ✗ ${r.slug.padEnd(32)} ERROR: ${r.error}`);
      continue;
    }
    const mark = r.fail ? '✗' : '✓';
    let line = `  ${mark} ${r.slug.padEnd(32)} ${cell(r.seo, SEO_FLOOR)} ${cell(r.a11y, A11Y_FLOOR)}  ${cell(r.bp, null)}`;
    if (wantPerf) line += `  ${cell(r.perf, wantBudget ? PERF_FLOOR : null)}`;
    if (wantBudget) {
      line += ` ${bcell(r.lcp, LCP_BUDGET, true, (v) => Math.round(v) + 'ms', 7)}`;
      line += ` ${bcell(r.cls, CLS_BUDGET, true, (v) => v.toFixed(3), 6)}`;
      line += ` ${bcell(r.tbt, TBT_BUDGET, true, (v) => Math.round(v) + 'ms', 6)}`;
      line += ` ${bcell(r.bytes, BYTES_BUDGET, true, (v) => Math.round(v / 1024), 6)}`;
    }
    console.log(line);
  }

  // 7. Verdict.
  console.log('\n' + '─'.repeat(56));
  if (errored) console.log(`${errored} page(s) errored during audit (counted as failures).`);
  const floorMsg = wantBudget
    ? `SEO ≥ ${SEO_FLOOR}, a11y ≥ ${A11Y_FLOOR}, perf ≥ ${PERF_FLOOR}, LCP ≤ ${LCP_BUDGET}ms, CLS ≤ ${CLS_BUDGET}, TBT ≤ ${TBT_BUDGET}ms, weight ≤ ${Math.round(BYTES_BUDGET / 1024)}KB`
    : `SEO ≥ ${SEO_FLOOR} and a11y ≥ ${A11Y_FLOOR}`;
  if (failures) {
    console.log(`✗ ${failures} of ${rows.length} sampled page(s) failed the gate (${floorMsg}).`);
    process.exitCode = 1;
  } else {
    console.log(`✓ All ${rows.length} sampled page(s) meet ${floorMsg}.`);
    process.exitCode = 0;
  }
}

main().catch((err) => {
  // An unexpected crash in the gate itself shouldn't masquerade as a content
  // failure, but it also shouldn't silently pass — surface it and fail.
  console.error('✗ lighthouse gate crashed:', (err && err.stack) || err);
  process.exitCode = 1;
});
