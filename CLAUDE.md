# CLAUDE.md — agent guide for this repo

This repo is a **website factory for local-business outreach**. The headline
workflow is agent-driven: a user opens a chat and says *"build me N websites
from this CSV"*, and you (the agent) generate the sites and launch them so the
user gets live demo links to email.

## Repo shape (what matters)

- `sites/demo-gallery/` — ONE Astro app that renders every outreach prospect at
  `/p/<slug>`. One deploy hosts all demos. This is where batch outreach sites go.
- `sites/<business>/` — standalone one-off sites (real/paying clients), each its
  own Vercel project. Scaffolded with `npm run new-site`.
- `sites/_template/` — the starter a standalone site is copied from.
- `scripts/generate-prospects.mjs` — CSV → prospect sites (the factory).
- `scripts/lib/google-places.mjs` — Google Places enrichment + photo download.
- `data/` — input CSVs and the generated `outreach-links.json` manifest.

## THE MAIN TASK: "build me N sites from this CSV"

When the user asks to build/generate/launch outreach sites from a CSV, do this
exact sequence:

1. **Locate the CSV.** If the user attached or named one, save/confirm it under
   `data/` (e.g. `data/leads.csv`). Required header: `name`; optional:
   `category, city, state, phone, email, address, established, existing_website`.
   Sparse rows are fine — Google fills the gaps. Known `category` values (drive
   theme + services): `towing, cafe, plumbing, salon, landscaping, auto-repair`;
   anything else uses a neutral default.

2. **Generate.** Run from the repo root:
   ```bash
   npm run generate-prospects -- data/<file>.csv
   ```
   This writes `sites/demo-gallery/src/data/prospects/<slug>.json` per row,
   downloads real photos to `sites/demo-gallery/public/images/<slug>/` (if
   Google is configured), and writes `data/outreach-links.json`.

   Copy/photos depend on env keys (all optional, graceful fallback):
   - `ANTHROPIC_API_KEY` → Claude writes the marketing copy.
   - `GOOGLE_MAPS_API_KEY` → real photos + address/phone/hours/website-check.
   - `GALLERY_BASE_URL` → makes manifest links absolute and emailable, e.g.
     `https://demos.yourdomain.com`.

3. **Sanity-check the build** (catches a bad row before deploying):
   ```bash
   cd sites/demo-gallery && npm install && npm run build && cd ../..
   ```

4. **Launch = commit + push.** Vercel's Git integration rebuilds the gallery on
   push, so pushing IS deploying. Commit the generated JSON + any downloaded
   images, then push to the branch Vercel watches (production is `main`):
   ```bash
   git add sites/demo-gallery/src/data/prospects sites/demo-gallery/public/images data/<file>.csv
   git commit -m "Add outreach prospects: <short note>"
   git push
   ```
   > NOTE: A session may be told to work on a feature branch. For sites to go
   > LIVE at the production domain, the work must land on the branch Vercel
   > deploys (`main`). If you're on a feature branch, say so and ask whether to
   > open a PR / merge to `main`, or push the batch straight to `main`.

5. **Return the links.** Read `data/outreach-links.json` and give the user a
   clean list of `name → link`. If `GALLERY_BASE_URL` was set, the links are
   already full URLs they can paste into email. Tell them live propagation
   takes ~1 minute after the push.

## One-time setup the user owns (you can't do these)

- **Vercel project**: connect this repo, Root Directory `sites/demo-gallery`,
  production branch `main`, add domain `demos.yourdomain.com`. See
  `docs/deploy-to-vercel.md`.
- **Env secrets** for the agent environment: `ANTHROPIC_API_KEY`,
  `GOOGLE_MAPS_API_KEY`, `GALLERY_BASE_URL`. (Set in the Claude Code on the web
  environment settings; see `.env.example` for the list.) Without these the
  factory still runs but with placeholder photos / template copy.

## Converting a prospect to a paying client

When a prospect signs, graduate them to a standalone site + their own domain:
```bash
npm run new-site -- <slug> "Business Name"
```
Then port values from `sites/demo-gallery/src/data/prospects/<slug>.json` into
`sites/<slug>/src/config.ts`, add their real photos, deploy as its own Vercel
project, and attach their domain.

## Conventions

- Don't hand-edit `sites/demo-gallery/src/data/prospects/*.json` — regenerate.
- Per-prospect images live in `sites/demo-gallery/public/images/<slug>/`.
- `data/outreach-links.json` is gitignored (may contain real emails).
- Full walkthrough: `docs/outreach-pipeline.md`.
