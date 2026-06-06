#!/usr/bin/env node
// Build data/demo-manifest.json — the public bridge the CRM (Duke) pulls to
// overlay each lead with its bespoke demo URL.
//
// Source of truth = the prospect JSONs themselves (every live demo), so the
// manifest always reflects exactly what's deployed, with no regen required.
// Run after generating/editing prospects, or standalone to refresh:
//
//   node scripts/build-crm-manifest.mjs        # or: npm run build-crm-manifest
//
// Duke joins a demo back to its lead on `host` (the business's existing-site
// hostname — the same key Duke's intake dedupes on), falling back to `name`,
// with `leadId` reserved for an exact 1:1 join later. The file carries NO emails
// or PII — only public business names + live demo links — so it's safe to commit.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS_DIR = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');

// Absolute base for emailable demo links. Defaults to the production demo domain
// so the manifest is useful even without GALLERY_BASE_URL set in the environment.
const BASE = (process.env.GALLERY_BASE_URL || 'https://demos.copperbaytech.com').replace(/\/$/, '');

// Bare, comparable hostname — mirrors Duke's hostLabel() and the generator's hostKey.
const hostKey = (u) => {
  if (!u) return '';
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
};

export async function buildCrmManifest() {
  let files;
  try {
    files = (await readdir(PROSPECTS_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }

  const demos = [];
  for (const file of files.sort()) {
    const slug = basename(file, '.json');
    let cfg;
    try {
      cfg = JSON.parse(await readFile(join(PROSPECTS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    const flags = Array.isArray(cfg.flags) ? cfg.flags : [];
    const status = cfg.status || (flags.length ? 'needs-review' : 'ready');
    demos.push({
      slug,
      name: cfg.name || slug,
      host: cfg.crm?.host || hostKey(cfg.website) || '',
      leadId: cfg.crm?.leadId || null,
      demoUrl: `${BASE}/p/${slug}`,
      status,
    });
  }

  const manifest = { generatedAt: new Date().toISOString(), base: BASE, demos };
  await writeFile(join(ROOT, 'data', 'demo-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// Run directly (not when imported by the generator).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { demos } = await buildCrmManifest();
  const review = demos.filter((d) => d.status === 'needs-review').length;
  console.log(`Wrote data/demo-manifest.json — ${demos.length} demo(s), base ${BASE}.`);
  if (review) console.log(`  ${review} flagged needs-review.`);
  console.log('Duke pulls this (raw GitHub) and overlays each lead with its demoUrl.');
}
