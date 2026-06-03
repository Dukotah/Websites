#!/usr/bin/env node
/**
 * export-standalone.mjs — turn built gallery pages into self-contained HTML
 * files you can open directly in a browser (no server, no Vercel) as a proof
 * of concept. Inlines linked CSS and embeds /images + /favicon as data URIs.
 *
 * Usage: node scripts/export-standalone.mjs
 * Output: proof/<slug>.html
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'sites', 'demo-gallery', 'dist');
const OUT = join(ROOT, 'proof');

const mime = (f) =>
  f.endsWith('.svg')
    ? 'image/svg+xml'
    : f.endsWith('.png')
      ? 'image/png'
      : f.endsWith('.woff2')
        ? 'font/woff2'
        : 'application/octet-stream';

async function dataUri(absPath) {
  const buf = await readFile(absPath);
  return `data:${mime(absPath)};base64,${buf.toString('base64')}`;
}

async function inline(html) {
  // 1) Inline linked stylesheets (href="/_astro/....css")
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)];
  for (const m of links) {
    const css = await readFile(join(DIST, m[1].replace(/^\//, '')), 'utf8');
    html = html.replace(m[0], `<style>${css}</style>`);
  }
  // 2) Embed images referenced by absolute path (src/href="/images/..", "/favicon.svg")
  const refs = new Set([...html.matchAll(/(?:src|href)="(\/(?:images\/[^"]+|favicon\.svg))"/g)].map((m) => m[1]));
  for (const ref of refs) {
    const uri = await dataUri(join(DIST, ref.replace(/^\//, '')));
    html = html.replaceAll(`"${ref}"`, `"${uri}"`);
  }
  // 3) Inline the latin font subsets so fonts render in a standalone file.
  //    (Non-latin subsets are unicode-range gated and not needed for English.)
  const fonts = new Set(
    [...html.matchAll(/url\((\/_astro\/[^)]+\.woff2)\)/g)]
      .map((m) => m[1])
      .filter((u) => /-latin-/.test(u) && !/-latin-ext-/.test(u)),
  );
  for (const ref of fonts) {
    const uri = await dataUri(join(DIST, ref.replace(/^\//, '')));
    html = html.replaceAll(`url(${ref})`, `url(${uri})`);
  }
  return html;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const out = [];

  // index.html
  out.push(['index.html', await inline(await readFile(join(DIST, 'index.html'), 'utf8'))]);

  // p/<slug>/index.html  ->  <slug>.html
  const pDir = join(DIST, 'p');
  for (const slug of await readdir(pDir)) {
    const html = await readFile(join(pDir, slug, 'index.html'), 'utf8');
    out.push([`${slug}.html`, await inline(html)]);
  }

  for (const [name, html] of out) {
    await writeFile(join(OUT, name), html);
    console.log(`  ✓ proof/${name}`);
  }
  console.log(`\nOpen any file in proof/ directly in a browser.`);
}

main();
