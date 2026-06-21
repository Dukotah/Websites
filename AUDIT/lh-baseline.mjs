#!/usr/bin/env node
/**
 * AUDIT/lh-baseline.mjs — Phase-0 baseline measurement.
 *
 * Runs Lighthouse (DEFAULT mobile emulation + simulated Slow-4G throttling — the
 * rural-LTE scenario) against a representative sample of built premium pages and
 * dumps the raw Core Web Vitals lab metrics the audit prompt wants: LCP, CLS,
 * TBT, FCP, Speed Index, total byte weight, DOM size, main-thread work, unused
 * CSS/JS. Reports per-page + a median row, and writes AUDIT/lh-baseline.json.
 *
 * INP is intentionally NOT reported: it is a FIELD metric (requires real user
 * interaction / CrUX). Lab Lighthouse has no INP; TBT is the lab proxy.
 *
 * Usage: CHROME_PATH=<chrome> node AUDIT/lh-baseline.mjs [slug...]
 */
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIST = join(ROOT, 'sites', 'demo-gallery', 'dist');
const PAGES = join(DIST, 's');

// Representative spread across sectors (trades, food, wellness) — sweeping, not 3 pilots.
const DEFAULT_SAMPLE = [
  'golden-gear-automotive', 'joon-hair', 'petaluma-pie-company',
  'warpigs-craft-kitchen', 'emj-builders', 'rea-roofing-inc',
  'elevate-fitness', 'designer-smiles-santa-rosa',
];

const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.xml':'application/xml','.txt':'text/plain' };

async function resolvePath(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = join(DIST, rel);
  if (abs !== DIST && !abs.startsWith(DIST + '/')) return null;
  try {
    const s = await stat(abs);
    if (s.isDirectory()) { const idx = join(abs, 'index.html'); await stat(idx); return idx; }
    if (s.isFile()) return abs;
  } catch {
    if (!extname(abs)) { try { const idx = join(abs,'index.html'); await stat(idx); return idx; } catch {} }
  }
  return null;
}
function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const file = await resolvePath(req.url || '/');
      if (!file) { res.writeHead(404); res.end('not found'); return; }
      try { const body = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(body); }
      catch { res.writeHead(500); res.end('err'); }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise(r => server.close(() => r())) }));
  });
}

function median(xs) { const s = xs.filter(x => x != null).sort((a,b)=>a-b); if (!s.length) return null; const m = Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }

async function main() {
  let all = [];
  try { all = (await readdir(PAGES, { withFileTypes:true })).filter(e=>e.isDirectory()).map(e=>e.name).sort(); }
  catch { console.error('No dist/s — build first.'); process.exit(1); }
  const args = process.argv.slice(2);
  const want = args.length ? args : DEFAULT_SAMPLE;
  const targets = want.filter(s => all.includes(s));
  if (!targets.length) { console.error('None of the sample slugs built. Built:', all.slice(0,8)); process.exit(1); }

  const { launch } = await import('chrome-launcher');
  const chrome = await launch({ chromeFlags:['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage'], chromePath: process.env.CHROME_PATH });
  const lh = (await import('lighthouse')).default;
  const server = await startServer();
  const base = `http://127.0.0.1:${server.port}`;

  const rows = [];
  for (const slug of targets) {
    try {
      const r = await lh(`${base}/s/${slug}/`, { port: chrome.port, output:'json', logLevel:'error',
        onlyCategories:['performance','accessibility','seo','best-practices'], skipAudits:['is-crawlable'] });
      const c = r.lhr.categories, a = r.lhr.audits;
      const pct = k => c[k]?.score!=null ? Math.round(c[k].score*100) : null;
      const num = k => a[k]?.numericValue!=null ? Math.round(a[k].numericValue) : null;
      rows.push({ slug, perf:pct('performance'), a11y:pct('accessibility'), seo:pct('seo'), bp:pct('best-practices'),
        lcp:num('largest-contentful-paint'), cls:a['cumulative-layout-shift']?.numericValue ?? null,
        tbt:num('total-blocking-time'), fcp:num('first-contentful-paint'), si:num('speed-index'),
        bytes:num('total-byte-weight'), dom:num('dom-size'), mainthread:num('mainthread-work-breakdown'),
        unusedCss:num('unused-css-rules'), unusedJs:num('unused-javascript') });
    } catch (e) { rows.push({ slug, error: e?.message || String(e) }); }
  }
  await server.close(); try { await chrome.kill(); } catch {}

  const ok = rows.filter(r=>!r.error);
  const P=(n,w)=>String(n??'—').padStart(w);
  console.log('\n# Lighthouse baseline — MOBILE, simulated Slow-4G (lab). INP omitted (field-only).\n');
  console.log(`  ${'slug'.padEnd(30)} ${P('perf',4)} ${P('a11y',4)} ${P('seo',3)} ${P('bp',3)} ${P('LCPms',6)} ${P('CLS',5)} ${P('TBTms',6)} ${P('FCPms',6)} ${P('SIms',6)} ${P('KB',6)}`);
  console.log('  '+'─'.repeat(96));
  for (const r of rows) {
    if (r.error) { console.log(`  ${r.slug.padEnd(30)} ERROR ${r.error}`); continue; }
    console.log(`  ${r.slug.padEnd(30)} ${P(r.perf,4)} ${P(r.a11y,4)} ${P(r.seo,3)} ${P(r.bp,3)} ${P(r.lcp,6)} ${P(r.cls?.toFixed(3),5)} ${P(r.tbt,6)} ${P(r.fcp,6)} ${P(r.si,6)} ${P(r.bytes?Math.round(r.bytes/1024):null,6)}`);
  }
  console.log('  '+'─'.repeat(96));
  console.log(`  ${'MEDIAN'.padEnd(30)} ${P(median(ok.map(r=>r.perf)),4)} ${P(median(ok.map(r=>r.a11y)),4)} ${P(median(ok.map(r=>r.seo)),3)} ${P(median(ok.map(r=>r.bp)),3)} ${P(median(ok.map(r=>r.lcp)),6)} ${P(median(ok.map(r=>r.cls))?.toFixed?.(3)??median(ok.map(r=>r.cls)),5)} ${P(median(ok.map(r=>r.tbt)),6)} ${P(median(ok.map(r=>r.fcp)),6)} ${P(median(ok.map(r=>r.si)),6)} ${P(Math.round(median(ok.map(r=>r.bytes))/1024),6)}`);
  await writeFile(join(HERE,'lh-baseline.json'), JSON.stringify({ when:'baseline', sample:targets, rows }, null, 2));
  console.log('\n  → AUDIT/lh-baseline.json written');
}
main().catch(e => { console.error('crashed:', e?.stack||e); process.exit(1); });
