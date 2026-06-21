#!/usr/bin/env node
/**
 * screenshot-audit.mjs — the VISION half of the pre-send QA gate.
 *
 * `audit.mjs` catches MECHANICAL problems (dead tokens, contrast, empty
 * sections). It cannot see that a hero photo is an oil refinery on a plumber's
 * site, that a headline overflows the fold, or that a layout just looks "off".
 * Only eyes can — and on the Pro plan, those eyes are the in-session agent.
 *
 * This script is the evidence-gatherer for that review: it builds the gallery,
 * boots `astro preview`, and screenshots every prospect at the fold (1440×900,
 * the cold-link first impression) AND full-page (1440 wide) into `.shots/`.
 * Then the agent (or you) opens `.shots/fold/<slug>.png` and judges each one.
 *
 *   npm run shots              # all prospects
 *   npm run shots -- vasquez   # just matching slugs
 *   npm run shots -- --no-build # skip the rebuild (faster re-run)
 *
 * Key-free. Needs Chrome installed (auto-detected; override with $CHROME_PATH).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..'); // sites/demo-gallery
const REPO_ROOT = resolve(ROOT, '../..');
const SHOTS = join(REPO_ROOT, '.shots');
// PREMIUM multi-page configs — each renders at /s/<slug>/.
const PROSPECTS = join(ROOT, 'src/data/premium');

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const filters = args.filter((a) => !a.startsWith('--'));

// ── Locate Chrome ────────────────────────────────────────────────────────────
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => existsSync(p));
}

const CHROME = findChrome();
if (!CHROME) {
  console.error(
    'Chrome not found. Set $CHROME_PATH to your Chrome/Chromium binary and re-run.',
  );
  process.exit(1);
}

// ── Resolve prospect slugs ───────────────────────────────────────────────────
let slugs = readdirSync(PROSPECTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));
if (filters.length) {
  slugs = slugs.filter((s) => filters.some((f) => s.includes(f)));
}
if (!slugs.length) {
  console.error('No matching prospects.');
  process.exit(1);
}

// ── Build ────────────────────────────────────────────────────────────────────
if (!noBuild) {
  console.log('▶ building gallery…');
  const b = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (b.status !== 0) {
    console.error('Build failed — fix it before auditing.');
    process.exit(1);
  }
}

// ── Boot preview, capture its port ───────────────────────────────────────────
console.log('▶ starting preview…');
const preview = spawn('npm', ['run', 'preview'], {
  cwd: ROOT,
  shell: true,
});

const port = await new Promise((res, rej) => {
  let buf = '';
  const to = setTimeout(() => rej(new Error('preview did not start in 30s')), 30000);
  preview.stdout.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/localhost:(\d+)/);
    if (m) {
      clearTimeout(to);
      res(Number(m[1]));
    }
  });
  preview.stderr.on('data', () => {});
});
console.log(`▶ preview on :${port}`);
await sleep(800); // let it settle

// ── Screenshot ───────────────────────────────────────────────────────────────
rmSync(join(SHOTS, 'fold'), { recursive: true, force: true });
rmSync(join(SHOTS, 'full'), { recursive: true, force: true });
mkdirSync(join(SHOTS, 'fold'), { recursive: true });
mkdirSync(join(SHOTS, 'full'), { recursive: true });

function shot(slug, kind, size) {
  const out = join(SHOTS, kind, `${slug}.png`);
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      // Emulate reduced-motion so the static capture shows the page at its FINAL
      // rested state: the premium CSS reveals every [data-reveal] section
      // immediately under reduced-motion (opacity:1), and the hero renders
      // fully-arrived instead of mid-entrance. Without this a single screenshot
      // (no scroll, no IntersectionObserver firing) leaves the whole page below
      // the hero blank — the vision-QA pass was effectively blind below the fold.
      '--force-prefers-reduced-motion',
      `--window-size=${size}`,
      `--screenshot=${out}`,
      `http://localhost:${port}/s/${slug}`,
    ],
    { stdio: 'ignore' },
  );
  return r.status === 0 && existsSync(out);
}

for (const slug of slugs) {
  const ok = shot(slug, 'fold', '1440,900') && shot(slug, 'full', '1440,3600');
  console.log(`${ok ? '✓' : '✗'} ${slug}`);
}

preview.kill();
console.log(
  `\n▶ done → ${SHOTS}\n  fold/  = above-the-fold (the cold-link first impression)\n  full/  = whole page\nReview every fold/<slug>.png before sending links.`,
);
process.exit(0);
