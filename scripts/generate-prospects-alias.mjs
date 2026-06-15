#!/usr/bin/env node
/**
 * generate-prospects-alias.mjs — DEPRECATION shim for one release.
 *
 * The factory now authors PREMIUM multi-page sites at /s/<slug> via
 * scripts/generate.mjs (npm run generate). `npm run generate-prospects` used to
 * build the legacy single-page /p/<slug> sites; it now WARNS and FORWARDS to the
 * premium pipeline so existing muscle memory / scripts keep working. This shim is
 * scheduled for removal after one release — switch to `npm run generate`.
 *
 * To run the OLD single-page builder directly (not recommended), call
 * `node scripts/generate-prospects.mjs <csv>` — it is still on disk and exports
 * its facts/photo layers, which the premium author reuses.
 */
console.warn(
  '\n⚠ `generate-prospects` is deprecated and now forwards to the PREMIUM pipeline\n' +
  '   (multi-page /s/<slug>). Use `npm run generate` going forward.\n' +
  '   The legacy single-page builder still lives at scripts/generate-prospects.mjs.\n',
);
await import('./generate.mjs').then((m) => m.main());
