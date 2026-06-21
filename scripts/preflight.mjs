#!/usr/bin/env node
/**
 * preflight — one-command pre-ship gate for the demo gallery.
 *
 * Runs, in order, each in its CORRECT working directory (nesting `npm --prefix`
 * from the repo root trips an esbuild `spawn UNKNOWN` on Windows, so we drive
 * each step with an explicit cwd instead):
 *   1. astro build           (in sites/demo-gallery)
 *   2. node scripts/audit.mjs (in repo root — it resolves paths from cwd)
 *   3. html-validate dist     (in sites/demo-gallery)
 *
 * Exits non-zero on the first failing step so it can gate a deploy.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gallery = path.join(root, 'sites', 'demo-gallery');

function run(label, cmd, args, cwd) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n✗ preflight failed at: ${label} (exit ${r.status ?? 'null'})`);
    process.exit(r.status ?? 1);
  }
}

run('build', 'npm', ['run', 'build'], gallery);
run('mechanical audit', 'node', ['scripts/audit.mjs'], root);
run('html-validate', 'npx', ['html-validate', '"dist/**/*.html"'], gallery);

console.log('\n✓ preflight passed — build green, audit clean, HTML valid.');
