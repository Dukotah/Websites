#!/usr/bin/env node
/**
 * new-site.mjs — scaffold a new client site from the template.
 *
 * Usage:
 *   node scripts/new-site.mjs <folder-slug> ["Business Name"]
 *   # e.g.
 *   node scripts/new-site.mjs joes-plumbing "Joe's Plumbing"
 *
 * It copies sites/_template to sites/<folder-slug>, sets the package name, and
 * (if a business name is given) drops it into src/config.ts. Then it prints the
 * next steps.
 */

import { cp, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const slug = process.argv[2];
const name = process.argv[3];

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: node scripts/new-site.mjs <folder-slug> ["Business Name"]');
  console.error('  <folder-slug> must be lowercase words separated by dashes, e.g. joes-plumbing');
  process.exit(1);
}

const src = join(ROOT, 'sites', '_template');
const dest = join(ROOT, 'sites', slug);

const exists = await access(dest).then(() => true).catch(() => false);
if (exists) {
  console.error(`sites/${slug} already exists — pick another name or delete it first.`);
  process.exit(1);
}

// Don't copy local-only / generated folders from the template.
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vercel']);
await cp(src, dest, {
  recursive: true,
  filter: (source) => !SKIP.has(basename(source)),
});

// Set the package name.
const pkgPath = join(dest, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
pkg.name = slug;
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Optionally set the business name in config.ts.
if (name) {
  const cfgPath = join(dest, 'src', 'config.ts');
  let cfg = await readFile(cfgPath, 'utf8');
  cfg = cfg.replace(/name:\s*'Business Name'/, `name: '${name.replace(/'/g, "\\'")}'`);
  await writeFile(cfgPath, cfg);
}

console.log(`Created sites/${slug}${name ? ` for "${name}"` : ''}\n`);
console.log('Next steps:');
console.log(`  cd sites/${slug}`);
console.log('  npm install');
console.log('  npm run dev        # http://localhost:4321');
console.log('\nThen edit src/config.ts (name, contact, hours, services, colors).');
console.log('See docs/new-site-checklist.md for the full checklist.');
