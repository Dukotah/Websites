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
   Required header: `name`; optional: `website` (or `existing_website`),
   `category, city, state, phone, email, address, established`. **The `website`
   column is the single biggest quality lever** — the generator scrapes it for
   real facts and the business's own photos. Sparse rows are fine. Known
   `category` values (drive theme + fallback art): `towing, cafe, plumbing,
   salon, landscaping, auto-repair`; anything else uses a neutral default.

   > The generator now does the research step for you when a `website` is given:
   > `scripts/lib/scrape-site.mjs` pulls the real name, phone, address, hours,
   > about-story, services, reviews, and photos off their existing site, and
   > `scripts/lib/images.mjs` downloads their actual photos (logo/icon-filtered).
   > Your job shifts from "write everything" to "verify the scrape + polish the
   > prose the script couldn't fully write." Sites lacking research or real
   > photos are auto-flagged `needs-review` on the dashboard — never send those
   > as-is.

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
      `sites/demo-gallery/src/assets/prospects/<slug>/` as `hero.<ext>` /
      `story.<ext>`. The generator and the gallery auto-detect anything you drop
      there, and `astro:assets` optimizes it (responsive WebP + blur-up). Keep
      the JSON path in its `/images/<slug>/<file>` form — the asset registry
      (`src/lib/assets.ts`) maps it to the real file at build.
   2. If you can't, **Wikimedia Commons** (free, no key) — often town/area shots.
   3. Else the **built-in category library** art.
   > Web search reaches the live web even where raw downloads are blocked; if
   > `curl` to image hosts is blocked in this environment, note it and rely on
   > tiers 2–3. Never invent that a photo is theirs when it isn't.

4. **Build each site — bespoke, not a filled-in template.** Two paths, same bar:
   - **Bulk scaffold (research-driven):** `npm run generate-prospects -- data/<file>.csv`.
     With a `website` column it scrapes each business's real facts + photos,
     writes copy from them, varies the `layout`, emits depth `sections`, and
     flags weak sites `needs-review`.
   - **Custom:** write `sites/demo-gallery/src/data/prospects/<slug>.json`
     directly (schema = `src/types.ts`).
   Either way, every site must:
   - **Pick a `design` kit** (font): `bold` (Oswald — towing/auto/trades),
     `elegant` (Fraunces — winery/cafe/salon), or `clean` (Inter).
   - **Pick a `layout`** (hero + section order): `classic` / `split` / `editorial`.
   - **Compose 4–6 `sections`** from research — `stats`, `steps`, `testimonials`
     (REAL quotes), `list` (menu / wine list / services), `faq`, `cta`.
   - Set `theme` and write all copy from research.
   Then open the dashboard and fix every `needs-review`. See `the-hole-thing.json`
   (bold) and `honey-hole-winery.json` (elegant) for the bar. Never ship template
   copy or a sectionless page.

5. **Sanity-check the build:**
   ```bash
   cd sites/demo-gallery && npm install && npm run build && cd ../..
   ```

6. **Launch = commit + push.** Vercel's Git integration rebuilds the gallery on
   push, so pushing IS deploying:
   ```bash
   git add sites/demo-gallery/src/data/prospects sites/demo-gallery/src/assets/prospects data/<file>.csv
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
- Per-prospect images live in `sites/demo-gallery/src/assets/prospects/<slug>/`
  (so `astro:assets` optimizes them — responsive WebP + blur-up; rendered via
  `<SiteImage>`). JSON keeps the `/images/<slug>/<file>` path; `src/lib/assets.ts`
  resolves it. Shared SVG fallback art stays in
  `sites/demo-gallery/public/images/library/<category>/` (served as-is).
- `data/outreach-links.json` is gitignored (may contain real emails).
- Full walkthrough: `docs/outreach-pipeline.md`.

## Framework quality tools (the anti-cookie-cutter layer)

The factory is deterministic, so its weak spot is JUDGMENT — same-category sites
looking alike, and photos/layout that "don't look right." These close that gap:

- **Batch divergence** (`scripts/lib/divergence.mjs`, auto-run by
  `generate-prospects.mjs`): after all configs are built, it groups the batch by
  category and gives each same-category sibling a DISTINCT `artDirection.fontId`,
  `heroVariant`, `neutralTemp` (warm/cool), and rotated section order — so five
  wineries can't be mistaken for one template. Deterministic; respects explicit
  pins; leaves single-member categories untouched. Pools must stay in sync with
  `fonts.ts` FONT_REGISTRY and the HeroVariant union.
- **Vision QA** (`npm run shots` → `scripts/screenshot-audit.mjs`): builds,
  previews, and screenshots every prospect's fold + full page into `.shots/`.
  Build-success and grep hide visual breakage — REVIEW `.shots/fold/<slug>.png`
  (the cold-link first impression) before sending. The in-session agent is the
  vision reviewer (no API key needed on Pro).
- **Mechanical QA** (`node scripts/audit.mjs`, from repo root): dead-token +
  measured WCAG contrast + empty-section + templated-copy + missing-email gate;
  understands intentional text heroes (statement/editorial/panel). Non-zero exit
  on criticals → can gate deploy.
- Heroes are length-robust: `HeroEditorial` wraps long (full-sentence) headlines
  instead of clipping them off the right edge.
