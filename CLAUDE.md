# CLAUDE.md — agent guide for this repo

This repo is a **website factory for local-business outreach**. The headline
workflow is agent-driven and **needs no API keys**: a user opens a chat and says
*"build me N websites from this CSV"*, and you (the agent) generate the sites,
find photos, and launch them so the user gets live demo links to email.

## Repo shape (what matters)

- `sites/demo-gallery/` — ONE Astro app that renders every outreach prospect as
  a **premium, multi-page** site at `/s/<slug>` from `src/data/premium/<slug>.json`
  (schema `src/premium/lib/premium-types.ts`, validator
  `scripts/premium-validate.mjs`). This is the ONLY render system — the legacy
  single-page `/p/<slug>` builder has been removed. One deploy hosts all demos.
- `sites/<business>/` — standalone one-off sites (paying clients), each its own
  Vercel project. Scaffolded with `npm run new-site`.
- `sites/_template/` — the starter a standalone site is copied from.
- `scripts/generate.mjs` — CSV → **premium multi-page** sites (the factory entry,
  `npm run generate`). It draws the shared facts + photo layer from
  `scripts/lib/facts.mjs` and authors each site with `scripts/author-premium.mjs`,
  which emits `src/data/premium/<slug>.json` rendering at `/s/<slug>`. Brand seed
  (color + fontId) is picked deterministically in `scripts/lib/brand-seed.mjs`.
- `scripts/lib/facts.mjs` — the shared facts/photo CORE the whole factory stands
  on (`parseCsv`, `slugify`, `loadResearch`, `enrichmentFromResearch`,
  `acquireMediaFor`, `deriveStatus`, `normCat`, `nameMatchesSite`,
  `generateCopyWithClaude`). Imported by `generate.mjs`, `author-premium.mjs`,
  `build-research.mjs`, `verify-research.mjs`, and `lib/scraper-csv.mjs`.
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

   > **From the lead-scraper?** If the CSV came from the scraper (a wide
   > `…_ENRICHED_crm.csv` or trimmed `…_FOCUS.csv`), run the bridge FIRST:
   > `npm run build-research -- <scraper.csv> --state CA`. It normalizes the
   > scraper's Title-Case columns into the lean builder set, does the deep
   > research pass ONCE per lead up front (services, hours, reviews, photos —
   > deeper than the inline build-time scrape), fuses in the owner/socials the
   > scraper already found, and caches each as `data/research/<slug>.json`
   > (`confirmed:false`). It prints the clean builder CSV to feed step 4. Those
   > auto files are treated as a *cached scrape* — real quality gates still
   > apply, so thin ones still flag `needs-review`. Promote a file to
   > `confirmed:true` (with verified prose) after the research pass in step 2 to
   > make it authoritative. Never overwrites a `confirmed:true` file.

   > **Then clean + promote:** `npm run verify-research` scrubs scrape noise from
   > the `confirmed:false` files (form fields mis-extracted as services, section
   > headings as testimonials, "call us at…" about lines) and recomputes honest
   > richness — a key-free quality win on its own. With `ANTHROPIC_API_KEY`,
   > `npm run verify-research -- --promote` ALSO writes tagline/hero/about/service
   > copy from the cleaned facts and flips `confirmed:true`. (Copy is written from
   > the site's OWN facts — still independently verify reviews/awards/founding
   > year for the top bar.) `--dry-run` reports without writing. Skips
   > `confirmed:true` files. Full chain: `build-research` → `verify-research`
   > [→ `--promote`] → `generate` → review dashboard → `push-to-crm`.

2. **RESEARCH each business first — this is the job, not an optional polish.**
   Every site must feel custom and be *accurate*. Generic template copy is a
   last resort, never the deliverable. For each row, use web search (and Yelp,
   Facebook, BBB, their own site, local news) to find:
   - **Real facts**: founding year, owner/family story, the specific services
     they actually offer, their real phone/address/hours, service area, what
     makes them distinct (fleet size, specialties, awards, reviews).
   - **Their real photos**: storefront, team, work, products.
   Write the copy from this research — headline, about story, and each service
   should reference real specifics. See `sites/demo-gallery/src/data/premium/
   warpigs-craft-kitchen.json` for the quality bar (researched, not templated).
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
   - **Bulk (research-driven, PREMIUM):** `npm run generate -- data/<file>.csv`.
     With a `website` column (or a `data/research/<slug>.json` file) it gathers
     each business's real facts + photos, then `scripts/author-premium.mjs` writes
     a multi-page `PremiumConfig` to `sites/demo-gallery/src/data/premium/<slug>.json`
     (rendered at `/s/<slug>`), picks a deterministic brand seed (color + fontId),
     runs `premium-validate` as a gate, and flags weak sites `needs-review`.
   - **Custom:** write `sites/demo-gallery/src/data/premium/<slug>.json`
     directly (schema = `src/premium/lib/premium-types.ts`); validate with
     `npm run premium-validate`.
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
   git add sites/demo-gallery/src/data/premium sites/demo-gallery/src/assets/prospects data/<file>.csv
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
Port values from `sites/demo-gallery/src/data/premium/<slug>.json` into
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

- **Brand divergence** (`scripts/lib/brand-seed.mjs`, used by
  `author-premium.mjs`): each site is seeded a DISTINCT brand color + font pairing
  deterministically from its slug + category, and `generate.mjs` re-seeds any two
  siblings that collide on the same fontId+color — so five wineries can't be
  mistaken for one template.
- **Vision QA** (`npm run shots` → `sites/demo-gallery/scripts/screenshot-audit.mjs`):
  builds, previews, and screenshots every premium site's `/s/<slug>` fold + full
  page into `.shots/`. Build-success and grep hide visual breakage — REVIEW
  `.shots/fold/<slug>.png` (the cold-link first impression) AND `.shots/full/<slug>.png`
  (the whole scroll) before sending. The in-session agent is the vision reviewer
  (no API key needed on Pro).
  > The capture emulates `prefers-reduced-motion` (`--force-prefers-reduced-motion`)
  > so the static `full/` shot shows EVERY section at its final visible state. A
  > plain headless screenshot never scrolls, so the scroll-reveal (`[data-reveal]`)
  > sections stay `opacity:0` and the page below the hero renders BLANK — which
  > silently blinded below-the-fold review. Keep this flag, or `full/` lies.
- **Mechanical QA** (`node scripts/audit.mjs`, from repo root): dead-token (now
  fallback-aware — `var(--x, fb)` is safe) + measured WCAG contrast +
  empty-section + templated-copy gate over the premium configs (`pages[].sections`
  by `kind`); understands the intentional `editorial` text hero. Non-zero exit on
  criticals → can gate deploy. Pair with `npm run premium-validate` (schema +
  every photo exists on disk) — both run in `npm run qa`.
- **Sameness + image floors** (`npm run sameness-check` / `image-qa`): perceptual
  fold-hash sameness gate and the LOCKED source-resolution floor, both reading the
  premium configs.
- **Perf / Core Web Vitals gate** (`npm run lighthouse` = SEO + a11y floor;
  `npm run perf-budget` = `scripts/lighthouse.mjs --budget` = CWV budget): runs the
  BUILT pages in headless Chrome. `perf-budget` FAILS if any sampled page crosses
  perf 90 / LCP 2500ms / CLS 0.1 / TBT 200ms / ~684KB (env-overridable via
  `LH_PERF_FLOOR`/`LH_LCP_MS`/`LH_CLS`/`LH_TBT_MS`/`LH_BYTES`). Fail-soft when Chrome
  can't launch. RUN THIS after any change to the shared `src/premium/**` layer —
  motion/JS added there can quietly add TBT (a design pass once pushed TBT 0→218ms;
  the fix was deferring non-critical JS to `requestIdleCallback`, see the `idle(...)`
  helper in `premium/layouts/PremiumBase.astro`). Measured under Lighthouse's default
  Slow-4G mobile throttling; current sites sit at perf 96–99 / LCP ~2.0–2.4s / CLS 0.

## Seam contract — `data/outreach-links.json` (DO NOT BREAK)

The Copper Bay CRM (`projects/Duke`) consumes this manifest to attach demos to
leads and to gate outreach. It matches demos to leads by **normalized business
name** and refuses to send any lead whose demo `status` is `needs-review`. If you
rename these fields or change the `status` vocabulary, the CRM silently stops
matching — it will attach nothing, or (worse) let an unreviewed demo get emailed.

**Each entry MUST keep these keys and meanings. Add fields freely; never rename or
repurpose these:**

| Field | Meaning | Why the CRM needs it |
|---|---|---|
| `name` | business name | the join key (`previewKey(name)` match) |
| `slug` | stable demo id | preview link + thumbnail path |
| `link` | `https://demos.copperbaytech.com/s/<slug>` | the URL emailed to the prospect (premium multi-page) |
| `status` | `ready` \| `needs_review` \| `needs-review` | **the send gate** — both spellings are honored; keep them |
| `email`, `category`, `area`, `thumbnailUrl` | lead enrichment | the CRM lead card |

A demo only becomes sendable when `status: "ready"`. The CRM sync
(`Duke/scripts/sync-demos-to-crm.mjs --only-ready`) and the server-side gate both
key off this exact string. See `Duke/ACTIVATION-RUNBOOK.md` for the full pipeline.
