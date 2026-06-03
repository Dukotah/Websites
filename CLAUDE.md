# CLAUDE.md — agent guide for this repo

This repo is a **website factory for local-business outreach**. The headline
workflow is agent-driven and **needs no API keys**: a user opens a chat and says
*"build me N websites from this CSV"*, and you (the agent) generate the sites,
find photos, and launch them so the user gets live demo links to email.

## Repo shape (what matters)

- `sites/demo-gallery/` — ONE Astro app that renders every outreach prospect at
  `/p/<slug>`. One deploy hosts all demos. This is where batch outreach sites go.
- `sites/<business>/` — standalone one-off sites (paying clients), each its own
  Vercel project. Scaffolded with `npm run new-site`.
- `sites/_template/` — the starter a standalone site is copied from.
- `scripts/generate-prospects.mjs` — CSV → prospect sites (the factory, key-free).
- `scripts/lib/photos.mjs` — Wikimedia Commons photo fetch (free, no key).
- `scripts/build-image-library.mjs` — regenerates the built-in fallback art.
- `data/` — input CSVs and the generated `outreach-links.json` manifest.

## THE MAIN TASK: "build me N sites from this CSV"

No keys, no external setup beyond the one-time Vercel connection. Do this:

1. **Locate the CSV.** Save/confirm it under `data/` (e.g. `data/leads.csv`).
   Required header: `name`; optional: `category, city, state, phone, email,
   address, established`. Sparse rows are fine. Known `category` values (drive
   theme + services + fallback art): `towing, cafe, plumbing, salon,
   landscaping, auto-repair`; anything else uses a neutral default.

2. **Photos — do the strongest tier yourself first (this is the point of being
   an agent).** For each business, BEFORE or AFTER generating, try in order:
   1. **The business's own photos already online.** Use web search to find the
      business (their site, Facebook, Yelp, news). If you find good, clearly
      theirs images, download them with `curl` into
      `sites/demo-gallery/public/images/<slug>/` as `hero.<ext>` and
      `story.<ext>`. The generator auto-detects and uses anything you drop there.
   2. If you can't, the generator tries **Wikimedia Commons** (free, no key).
   3. If that misses too, it uses the **built-in category library** art.
   > Network access depends on the environment's policy; if web/curl is blocked,
   > just rely on tiers 2–3. Always prefer real, clearly-theirs photos.

3. **Generate.** From the repo root:
   ```bash
   npm run generate-prospects -- data/<file>.csv
   ```
   Writes `sites/demo-gallery/src/data/prospects/<slug>.json` per row and
   `data/outreach-links.json`. Each line prints which photo tier was used.
   (Use `-- data/<file>.csv --no-photos` to skip the Wikimedia step.)

4. **Personalize the copy (you're the agent — make it good).** The generator
   seeds each `<slug>.json` with solid template copy. For real sends, open each
   prospect JSON and rewrite `tagline`, `hero.heading/subheading`, `about.body`,
   and `services` so they sound specific to that business. Don't hand-edit
   structure — just improve the copy fields. (An optional `ANTHROPIC_API_KEY`
   will auto-write copy, but nothing requires it.)

5. **Sanity-check the build:**
   ```bash
   cd sites/demo-gallery && npm install && npm run build && cd ../..
   ```

6. **Launch = commit + push.** Vercel's Git integration rebuilds the gallery on
   push, so pushing IS deploying:
   ```bash
   git add sites/demo-gallery/src/data/prospects sites/demo-gallery/public/images data/<file>.csv
   git commit -m "Add outreach prospects: <short note>"
   git push
   ```
   > Production is the branch Vercel watches (`main`). If you're on a feature
   > branch, say so and ask whether to merge to `main` or push the batch there.

7. **Return the links.** Read `data/outreach-links.json` and give the user a
   clean `name → link` list. If `GALLERY_BASE_URL` is set they're full URLs.
   Live propagation takes ~1 minute after the push.

## One-time setup the user owns (you can't do these)

- **Vercel project**: connect this repo, Root Directory `sites/demo-gallery`,
  production branch `main`, add domain `demos.yourdomain.com`. See
  `docs/deploy-to-vercel.md`. After this, the agent's `git push` is the deploy.
- That's it. **No API keys are required.** Optional env vars if ever wanted:
  `GALLERY_BASE_URL` (absolute emailable links), `ANTHROPIC_API_KEY` (auto-copy).

## Converting a prospect to a paying client

When a prospect signs, graduate them to a standalone site + their own domain:
```bash
npm run new-site -- <slug> "Business Name"
```
Port values from `sites/demo-gallery/src/data/prospects/<slug>.json` into
`sites/<slug>/src/config.ts`, add their real photos, deploy as its own Vercel
project, and attach their domain.

## Conventions

- Don't hand-edit prospect JSON *structure* — regenerate; copy fields are fine
  to improve by hand.
- Per-prospect images live in `sites/demo-gallery/public/images/<slug>/`;
  shared fallback art in `sites/demo-gallery/public/images/library/<category>/`.
- `data/outreach-links.json` is gitignored (may contain real emails).
- Full walkthrough: `docs/outreach-pipeline.md`.
