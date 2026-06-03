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
   theme + fallback art): `towing, cafe, plumbing, salon, landscaping,
   auto-repair`; anything else uses a neutral default.

2. **RESEARCH each business first — this is the job, not an optional polish.**
   Every site must feel custom and be *accurate*. Generic template copy is a
   last resort, never the deliverable. For each row, use web search (and Yelp,
   Facebook, BBB, their own site, local news) to find:
   - **Real facts**: founding year, owner/family story, the specific services
     they actually offer, their real phone/address/hours, service area, what
     makes them distinct (fleet size, specialties, awards, reviews).
   - **Their real photos**: storefront, team, work, products.
   Write the copy from this research — headline, about story, and each service
   should reference real specifics. See `sites/demo-gallery/src/data/prospects/
   smittys-towing.json` for the quality bar (researched, not templated).
   > Verify before asserting. If you can't confirm a detail (e.g. exact email),
   > leave it generic rather than inventing something that could be wrong.

3. **Photos — pull their real ones (the whole point of "real effort").** In order:
   1. **The business's own photos online.** From the research above, download
      good, clearly-theirs images with `curl` into
      `sites/demo-gallery/public/images/<slug>/` as `hero.<ext>` / `story.<ext>`.
      The generator and the gallery auto-detect anything you drop there.
   2. If you can't, **Wikimedia Commons** (free, no key) — often town/area shots.
   3. Else the **built-in category library** art.
   > Web search reaches the live web even where raw downloads are blocked; if
   > `curl` to image hosts is blocked in this environment, note it and rely on
   > tiers 2–3. Never invent that a photo is theirs when it isn't.

4. **Build each site — aim for bespoke, not a filled-in template.** Write each
   `sites/demo-gallery/src/data/prospects/<slug>.json` directly (schema =
   `src/types.ts`). Every site should:
   - **Pick a `design` kit** that fits the business: `bold` (Oswald — towing,
     auto, trades), `elegant` (Fraunces — winery, cafe, salon, boutique), or
     `clean` (Inter — modern). This alone makes a winery look unlike a tow shop.
   - **Compose 4–6 `sections`** from the research — `stats`, `steps`,
     `testimonials` (use REAL review quotes), `list` (menu / wine list /
     services), `faq`, `cta`. Different businesses → different section sets.
     A flat hero+about+services page is the old, cookie-cutter bar — don't ship it.
   - Set a `theme` (brand + brandDark) and write all copy from research.
   See `the-hole-thing.json` (bold) and `honey-hole-winery.json` (elegant) for
   the quality bar. `npm run generate-prospects` can bulk-scaffold structure, but
   then you MUST deepen each one — never leave template copy or a sectionless site.

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

7. **Return the links.** Give the user a clean `name → link` list (full URLs if
   `GALLERY_BASE_URL` is set). Live propagation takes ~1 minute after the push.
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
