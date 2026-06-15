#!/usr/bin/env node
/**
 * mobile-shot.mjs — TRUE mobile-viewport screenshots via the Chrome DevTools
 * Protocol. `--window-size` does NOT emulate a mobile layout viewport (Chrome
 * clamps tiny window widths), so it gives misleading results below ~500px. CDP
 * `Emulation.setDeviceMetricsOverride` sets a real 390-CSS-px mobile viewport.
 *
 *   node scripts/mobile-shot.mjs <baseUrl> <slug> [slug...]
 * Writes .shots/mobile/<slug>.png (full page). Needs Chrome (CHROME_PATH or auto).
 * Also reports document scrollWidth vs viewport so horizontal overflow is obvious.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../.shots/mobile');
const [baseUrl, ...slugArgs] = process.argv.slice(2);
if (!baseUrl) {
  console.error('usage: node scripts/mobile-shot.mjs <baseUrl> [slug...]   (no slugs = all prospects)');
  process.exit(1);
}
// Default to every prospect so a bare run is a full-batch mobile overflow check.
let slugs = slugArgs;
if (!slugs.length) {
  const { readdirSync } = await import('node:fs');
  slugs = readdirSync(resolve(__dirname, '../src/data/prospects'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));
if (!CHROME) { console.error('Chrome not found; set CHROME_PATH'); process.exit(1); }

mkdirSync(SHOTS, { recursive: true });
const PORT = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(SHOTS, '.profile')}`,
], { stdio: 'ignore' });

async function cdp(ws, method, params = {}, id) {
  return new Promise((res) => {
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); res(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  // wait for CDP to come up
  let ver;
  for (let i = 0; i < 30; i++) {
    try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; }
    catch { await sleep(300); }
  }
  if (!ver) throw new Error('CDP did not start');

  for (const slug of slugs) {
    const tab = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    await cdp(ws, 'Page.enable', {}, ++id);
    await cdp(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, ++id);
    await cdp(ws, 'Page.navigate', { url: `${baseUrl}/s/${slug}` }, ++id);
    await sleep(1800);
    const metrics = await cdp(ws, 'Runtime.evaluate', {
      expression: 'JSON.stringify({sw:document.documentElement.scrollWidth, vw:window.innerWidth})',
      returnByValue: true,
    }, ++id);
    const { sw, vw } = JSON.parse(metrics.result.value);
    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: undefined }, ++id);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(SHOTS, `${slug}.png`), Buffer.from(shot.data, 'base64'));
    const overflow = sw > vw + 1 ? `⚠ OVERFLOW scrollWidth=${sw} > viewport=${vw}` : `ok (${sw}=${vw})`;
    console.log(`${slug}: ${overflow}`);
    ws.close();
  }
} finally {
  chrome.kill();
}
