#!/usr/bin/env node
/**
 * build-batch.mjs — the walk-away factory loop.
 *
 * One command runs the whole closed loop so you NEVER hand-review 15 fields per
 * site again:
 *
 *   1. GENERATE   scrape each business → build a site from real facts (the slop
 *                 filter now refuses meta-tag boilerplate as copy).
 *   2. GATE       scan every site for remaining slop (truncation, leaked code,
 *                 store/coupon text, unresolved {TOKENS}) + dead tokens + empty
 *                 sections.
 *   3. WORKLIST   write an exact, per-field "fix this, here's why, here are the
 *                 facts to write it from" list to data/agent-worklist.json — the
 *                 handful of fields that genuinely need a human/agent sentence.
 *
 * The agent (in-session, key-free on Pro) then writes ONLY the flagged fields,
 * and `npm run gate` re-checks. A site can't be marked status:"ready" while the
 * gate trips — so "ready" is an honest promise the site is send-able.
 *
 * Usage:
 *   node scripts/build-batch.mjs [data/file.csv] [--no-photos]   # generate + gate
 *   node scripts/build-batch.mjs --gate-only                     # re-check only
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { scanProspect } from './lib/copy-quality.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROSPECTS = join(ROOT, 'sites', 'demo-gallery', 'src', 'data', 'prospects');
const WORKLIST = join(ROOT, 'data', 'agent-worklist.json');

const run = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('close', (code) => res(code ?? 0));
  });

async function buildWorklist() {
  const files = (await readdir(PROSPECTS)).filter((f) => f.endsWith('.json'));
  const jobs = [];
  for (const f of files) {
    const slug = f.replace(/\.json$/, '');
    const c = JSON.parse(await readFile(join(PROSPECTS, f), 'utf8'));
    const slop = scanProspect(c);
    const flags = (c.flags ?? []).filter((x) => /agent|rewrite|template|verify/i.test(x));
    if (!slop.length && !flags.length) continue;
    jobs.push({
      slug,
      name: c.name,
      status: c.status,
      // The real facts the agent should write FROM — so it never invents.
      facts: {
        category: c.category,
        area: c.area,
        about: c.about?.body ?? [],
        services: (c.services ?? []).map((s) => s.title),
        hours: c.hours ?? [],
      },
      fix: [
        ...slop.map((s) => ({ field: s.where, why: s.msg, current: s.text })),
        ...flags.map((x) => ({ field: 'flag', why: x })),
      ],
    });
  }
  await writeFile(WORKLIST, JSON.stringify(jobs, null, 2));
  return jobs;
}

async function main() {
  const args = process.argv.slice(2);
  const gateOnly = args.includes('--gate-only');

  if (!gateOnly) {
    const csv = args.find((a) => a.endsWith('.csv')) ?? 'data/prospects.sample.csv';
    console.log(`\n▶ 1/3 GENERATE — ${csv}`);
    const genArgs = ['scripts/generate-prospects.mjs', csv, ...args.filter((a) => a.startsWith('--'))];
    const code = await run('node', genArgs);
    if (code !== 0) {
      console.error('✗ generate failed — stopping.');
      process.exitCode = 1;
      return;
    }
  }

  console.log('\n▶ 2/3 GATE — slop + tokens + contrast');
  const gateCode = await run('node', ['scripts/audit.mjs']);

  console.log('\n▶ 3/3 WORKLIST — fields that need an agent-written sentence');
  const jobs = await buildWorklist();
  if (!jobs.length) {
    console.log('  ✓ nothing flagged — every site is gate-clean and send-able.');
  } else {
    const fixes = jobs.reduce((n, j) => n + j.fix.length, 0);
    console.log(`  ⚠ ${jobs.length} site(s), ${fixes} field(s) need attention → ${WORKLIST.replace(ROOT, '.')}`);
    for (const j of jobs) {
      console.log(`    • ${j.slug} (${j.status}): ${j.fix.map((x) => x.field).join(', ')}`);
    }
    console.log('\n  Next: the in-session agent writes those fields from each job\'s `facts`,');
    console.log('        then `npm run gate` confirms clean before status flips to "ready".');
  }

  // Gate failure is the hard signal (matches audit's exit code).
  process.exitCode = gateCode ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
