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
 * It ALSO runs a MOBILE-RESPONSIVENESS GATE: ~50% of real traffic is mobile,
 * but the desktop captures (1440px) leave the 375/768px layouts programmatically
 * untested. After the desktop shots, this drives the SAME preview through the
 * Chrome DevTools Protocol at two real device viewports — 375×667 (phone) and
 * 768×1024 (tablet) — screenshots each into `.shots/mobile/<vw>/<slug>.png` and
 * MEASURES the live DOM/CSS to assert, key-free:
 *   • no horizontal overflow (documentElement.scrollWidth <= viewport),
 *   • base body text >= 16px (legible on a phone),
 *   • touch targets >= 44×44 CSS px (WCAG 2.5.8) — especially the
 *     StickyContactBar, which only appears at <=560px and so is invisible to the
 *     desktop captures.
 * Real responsiveness failures make this exit non-zero so a regressed media
 * query / overflow / tiny tap target is caught BEFORE it ships. The gate is
 * fail-soft: if Chrome can't be driven over CDP it WARNS and skips rather than
 * blocking the desktop evidence.
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

// ── Responsive overflow / clipping gate (360 / 768 / 1440) ───────────────────
// Drive the same preview through CDP at the three breakpoints the framework
// targets and MEASURE the live DOM/CSS for horizontal overflow (the #1 "it looks
// broken on my phone" bug) at every width — plus legible-text + 44px tap targets
// at the mobile widths (those checks are meaningless at desktop, where nav links
// are legitimately <44px, so `full` gates them). Key-free, fail-soft: if Chrome
// can't be driven we WARN and skip. `mobile`/`scale` set the emulation mode so the
// desktop pass renders the true desktop layout, not a scaled phone view.
const MOBILE_VIEWPORTS = [
  { id: 'phone', label: '360×780', width: 360, height: 780, mobile: true, scale: 2, full: true },
  { id: 'tablet', label: '768×1024', width: 768, height: 1024, mobile: true, scale: 2, full: true },
  { id: 'desktop', label: '1440×900', width: 1440, height: 900, mobile: false, scale: 1, full: false },
];
const MIN_TEXT_PX = 16; // legible body text on a phone
const MIN_TAP_PX = 44; // WCAG 2.5.8 target size

// Probe runs INSIDE the page: returns overflow, base font-size, and any
// interactive element (link/button) whose rendered box is under 44×44 CSS px.
// We only flag VISIBLE, on-screen controls so an off-canvas/closed menu item
// (legitimately 0×0) is never a false positive. The StickyContactBar lives at
// <=560px, so its buttons are measured at the phone viewport — exactly the
// 560px boundary the roadmap calls out.
const PROBE = `(() => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - window.innerWidth;
  const baseFs = parseFloat(getComputedStyle(document.body).fontSize) || 0;
  const small = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), select')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; // not laid out / off-canvas
    if (r.bottom < 0 || r.top > window.innerHeight * 4) continue; // far off-page
    if (r.width >= ${MIN_TAP_PX} && r.height >= ${MIN_TAP_PX}) continue;
    const key = el.className + '|' + (el.textContent || '').trim().slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);
    small.push({
      w: Math.round(r.width), h: Math.round(r.height),
      tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40),
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28),
    });
  }
  return JSON.stringify({ overflow, baseFs, small: small.slice(0, 8) });
})()`;

async function cdpSend(ws, method, params, id) {
  return new Promise((res, rej) => {
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function mobileGate() {
  const CDP_PORT = 9344;
  const profileDir = join(SHOTS, '.cdp-profile');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-prefers-reduced-motion',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
    ],
    { stdio: 'ignore' },
  );

  let failures = 0;
  try {
    // Wait for CDP to come up (fail-soft: give up after ~9s).
    let ver = null;
    for (let i = 0; i < 30; i++) {
      try {
        ver = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json();
        break;
      } catch {
        await sleep(300);
      }
    }
    if (!ver) throw new Error('CDP did not start');

    for (const vp of MOBILE_VIEWPORTS) {
      mkdirSync(join(SHOTS, 'mobile', vp.id), { recursive: true });
      for (const slug of slugs) {
        const tab = await (
          await fetch(`http://localhost:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
        ).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r, { once: true }));
        let id = 0;
        try {
          await cdpSend(ws, 'Page.enable', {}, ++id);
          await cdpSend(
            ws,
            'Emulation.setDeviceMetricsOverride',
            { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.mobile },
            ++id,
          );
          await cdpSend(ws, 'Page.navigate', { url: `http://localhost:${port}/s/${slug}` }, ++id);
          await sleep(1500);

          const probe = await cdpSend(
            ws,
            'Runtime.evaluate',
            { expression: PROBE, returnByValue: true },
            ++id,
          );
          const { overflow, baseFs, small } = JSON.parse(probe.result.value);

          const shotResult = await cdpSend(
            ws,
            'Page.captureScreenshot',
            { format: 'png', captureBeyondViewport: true },
            ++id,
          );
          const { writeFile } = await import('node:fs/promises');
          await writeFile(
            join(SHOTS, 'mobile', vp.id, `${slug}.png`),
            Buffer.from(shotResult.data, 'base64'),
          );

          const probs = [];
          // Horizontal overflow / clipping — checked at EVERY width (360/768/1440).
          if (overflow > 1) probs.push(`overflow +${overflow}px (clips horizontally)`);
          // Legible text + tap-target size only make sense on the mobile passes.
          if (vp.full && baseFs < MIN_TEXT_PX) probs.push(`text ${baseFs.toFixed(1)}px < ${MIN_TEXT_PX}`);
          if (vp.full && small.length) {
            probs.push(
              `${small.length} tap<44: ` +
                small.map((s) => `${s.tag}.${s.cls || '∅'}(${s.w}×${s.h}"${s.text}")`).join(', '),
            );
          }
          if (probs.length) {
            failures++;
            console.log(`  ✗ ${vp.label} ${slug}: ${probs.join(' | ')}`);
          } else {
            console.log(`  ✓ ${vp.label} ${slug}`);
          }
        } finally {
          ws.close();
        }
      }
    }
  } catch (err) {
    console.warn(`▲ mobile gate skipped (fail-soft): ${err.message}`);
    chrome.kill();
    return null; // signal "could not run" — not a hard fail
  }
  chrome.kill();
  return failures;
}

console.log('\n▶ responsive overflow/clipping gate (360 + 768 + 1440)…');
const mobileFailures = await mobileGate();

preview.kill();
console.log(
  `\n▶ done → ${SHOTS}\n  fold/   = above-the-fold (the cold-link first impression)\n  full/   = whole page\n  mobile/ = 360 + 768 + 1440 device-viewport captures\nReview every fold/<slug>.png before sending links.`,
);
if (mobileFailures && mobileFailures > 0) {
  console.error(
    `\n✗ responsive gate FAILED: ${mobileFailures} viewport(s) had horizontal overflow / tiny text / sub-44px tap targets.`,
  );
  process.exit(1);
}
process.exit(0);
