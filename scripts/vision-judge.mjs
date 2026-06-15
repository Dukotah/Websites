#!/usr/bin/env node
/**
 * vision-judge.mjs — the JUDGE step of the vision-QA harness.
 *
 * vision-qa.mjs (in sites/demo-gallery/scripts) is the CAPTURE + REPORT + GATE
 * harness: it screenshots every /s/<slug> premium page and writes a review
 * packet pairing each shot with the business's ground-truth facts + provenance.
 * THIS script is the JUDGMENT tier that turns those packets into findings.
 *
 * Be explicit about the key-free ceiling:
 *   • The deterministic gates (photo-score.mjs faded detection, author-premium's
 *     provenance/congruence gate) RAISE THE FLOOR — they reject washed photos
 *     from the hero/gallery and route off-domain heroes on indoor place-based
 *     categories to a composed editorial text hero. They can never CONFIRM that
 *     a photo hero actually depicts a salon interior. That is a vision judgment.
 *   • Only THIS pass — an agent's eyes, or a Claude vision model when keyed —
 *     can authoritatively confirm "the hero depicts a salon." So:
 *       - NO KEY (default on Pro): this script prints the same instruction block
 *         the capture step prints and exits 0, leaving the in-session AGENT to
 *         open each shot + packet, score against docs/vision-qa-rubric.md, and
 *         write .shots/qa/findings/<slug>.json. This is the documented key-free
 *         path and must stay.
 *       - ANTHROPIC_API_KEY set: this script sends each <slug>-fold.png + its
 *         review packet to a Claude vision model and writes findings/<slug>.json
 *         automatically. Same capture+report harness either way.
 *
 * After findings exist (by agent or API), run the gate:
 *   node sites/demo-gallery/scripts/vision-qa.mjs --report          # aggregate + exit non-zero on hold/critical
 *   node sites/demo-gallery/scripts/vision-qa.mjs --gate-manifest   # flip held slugs to needs-review in outreach-links.json
 *
 *   node scripts/vision-judge.mjs                 # all captured slugs
 *   node scripts/vision-judge.mjs joon petaluma   # only matching slugs
 *
 * The model id is current Opus/Sonnet vision-capable (claude-opus-4-8). Uses the
 * official @anthropic-ai/sdk when keyed; if the SDK isn't installed it tells you
 * to `npm i @anthropic-ai/sdk` rather than guessing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const QA = join(REPO_ROOT, '.shots/qa');
const SHOTS = join(QA, 'shots');
const REVIEW = join(QA, 'review');
const FINDINGS = join(QA, 'findings');
const RUBRIC = join(REPO_ROOT, 'docs/vision-qa-rubric.md');

const MODEL = 'claude-opus-4-8'; // current vision-capable Opus; claude-sonnet-4-6 also works

const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));

function reviewSlugs() {
  if (!existsSync(REVIEW)) return [];
  let slugs = readdirSync(REVIEW).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  if (filters.length) slugs = slugs.filter((s) => filters.some((f) => s.includes(f)));
  return slugs;
}

function printAgentInstructions(slugs) {
  console.log('▶ vision-judge: NO ANTHROPIC_API_KEY — agent-in-the-loop mode (key-free, the Pro path).');
  console.log('');
  console.log('  Key-free deterministic gates already raised the floor: washed photos are');
  console.log('  rejected from the hero + gallery, and off-domain heroes on indoor place-based');
  console.log('  categories were routed to a composed editorial text hero. But ONLY this vision');
  console.log('  pass can authoritatively confirm "the hero depicts a salon." You are that pass.');
  console.log('');
  console.log(`  For each of ${slugs.length} review packet(s) in .shots/qa/review/<slug>.json:`);
  console.log('    1. Open .shots/qa/shots/<slug>-fold.png and <slug>-full.png.');
  console.log('    2. Compare what you SEE to the packet facts + photoSource + generatorFlags.');
  console.log(`    3. Score against ${RUBRIC} — be the AUTHORITY on hero-congruence + photo-quality.`);
  console.log('    4. Write .shots/qa/findings/<slug>.json per the rubric contract.');
  console.log('       (An editorial photo-less hero is CORRECT, not a defect — see heroIsEditorial.)');
  console.log('');
  console.log('  Then gate:');
  console.log('    node sites/demo-gallery/scripts/vision-qa.mjs --report');
  console.log('    node sites/demo-gallery/scripts/vision-qa.mjs --gate-manifest');
  if (slugs.length) console.log(`\n  Slugs awaiting judgment: ${slugs.join(', ')}`);
}

function mediaTypeFor(file) {
  if (/\.png$/i.test(file)) return 'image/png';
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg';
  if (/\.webp$/i.test(file)) return 'image/webp';
  return 'image/png';
}

async function judgeWithApi(slugs) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    console.error('✗ ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed.');
    console.error('  Install it (npm i @anthropic-ai/sdk) or unset the key to use the agent-in-the-loop path.');
    process.exit(1);
  }
  const client = new Anthropic();
  const rubric = existsSync(RUBRIC) ? readFileSync(RUBRIC, 'utf8') : '(rubric file missing)';
  mkdirSync(FINDINGS, { recursive: true });

  let ok = 0;
  for (const slug of slugs) {
    const packet = JSON.parse(readFileSync(join(REVIEW, `${slug}.json`), 'utf8'));
    const foldFile = `${slug}-fold.png`;
    const foldPath = join(SHOTS, foldFile);
    if (!existsSync(foldPath)) { console.log(`✗ ${slug} — no fold screenshot, skipping`); continue; }
    const b64 = readFileSync(foldPath).toString('base64');

    const sys = [
      'You are the vision judge for a website-factory QA gate. You are the AUTHORITY on the two',
      'things the key-free deterministic gates cannot confirm: hero-congruence (does the hero depict',
      'THIS business/category?) and photo-quality (washed/faded/low-contrast). An editorial photo-less',
      'hero (heroIsEditorial:true) is CORRECT, not a defect. Score against this rubric:',
      '', rubric, '',
      'Return ONLY a JSON object matching the findings contract (slug, grade, verdict, summary, findings[]).',
      'No prose, no code fences.',
    ].join('\n');

    let text = '';
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: sys,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(foldFile), data: b64 } },
            { type: 'text', text: `Review packet (ground truth):\n${JSON.stringify(packet, null, 2)}\n\nJudge the screenshot above. Return the findings JSON for slug "${slug}".` },
          ],
        }],
      });
      for (const block of resp.content) if (block.type === 'text') text += block.text;
    } catch (e) {
      console.log(`✗ ${slug} — API error: ${e.message}`);
      continue;
    }

    let finding;
    try {
      finding = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      console.log(`✗ ${slug} — model did not return valid JSON; skipping`);
      continue;
    }
    finding.slug = finding.slug || slug; // ensure the gate can index it
    writeFileSync(join(FINDINGS, `${slug}.json`), JSON.stringify(finding, null, 2) + '\n');
    console.log(`✓ ${slug} — ${finding.verdict ?? '?'} (grade ${finding.grade ?? '?'})`);
    ok++;
  }
  console.log(`\n▶ wrote ${ok}/${slugs.length} findings → ${FINDINGS}`);
  console.log('  Next: node sites/demo-gallery/scripts/vision-qa.mjs --report  (then --gate-manifest)');
}

const slugs = reviewSlugs();
if (!slugs.length) {
  console.error('No review packets found. Run the capture step first:');
  console.error('  cd sites/demo-gallery && npm run vision-qa');
  process.exit(1);
}
if (process.env.ANTHROPIC_API_KEY) {
  await judgeWithApi(slugs);
} else {
  printAgentInstructions(slugs);
  process.exit(0);
}
