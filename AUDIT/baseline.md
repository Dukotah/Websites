# AUDIT/baseline.md — Phase 0 baseline (real numbers)

> Subject: the **premium `/s` system** on `origin/main` (the only render system; the
> legacy `/p` builder was deleted). Branch `audit/builder-improve` @ origin/main.
> Measured 2026-06-20 under WSL (deps reinstalled for Linux binaries).
> The armada branch was built on the retired `/p` architecture and is treated as an
> idea/doc source only, not part of this baseline.

## Headline: the tool already meets its PURPOSE on the measurable axis

On **simulated Slow-4G mobile** (Lighthouse lab — the rural-LTE scenario), a
representative spread of 7 sectors:

| slug | perf | a11y | seo | best | LCP ms | CLS | TBT ms | FCP ms | page KB |
|---|---|---|---|---|---|---|---|---|---|
| joon-hair (salon) | 99 | 100 | 100 | 100 | 1972 | 0.023 | 0 | 1522 | 353 |
| petaluma-pie (cafe) | 99 | 96 | 100 | 100 | 1970 | 0.000 | 0 | 1520 | 307 |
| warpigs (restaurant) | 98 | 100 | 100 | 100 | 2200 | 0.000 | 0 | 1525 | 238 |
| emj-builders (contractor) | 99 | 95 | 100 | 100 | 1822 | 0.000 | 0 | 1522 | 155 |
| rea-roofing (roofing) | 99 | 100 | 100 | 100 | 1969 | 0.000 | 0 | 1519 | 151 |
| elevate-fitness | 98 | 100 | 100 | 100 | 2201 | 0.001 | 0 | 1826 | 188 |
| designer-smiles (dental) | 99 | 100 | 100 | 100 | 1968 | 0.000 | 0 | 1518 | 207 |
| **MEDIAN** | **99** | **100** | **100** | **100** | **1970** | **0.000** | **0** | **1522** | **207** |

- **LCP median 1.97s** < the 2.5s "good" threshold, on Slow-4G. **CLS 0.000.** **TBT 0 ms** (no blocking JS).
- a11y / SEO / best-practices effectively maxed.
- Caveats (honest): Lighthouse lab simulated throttling can be rosier than real rural LTE; **INP is not measured** (field-only metric — needs CrUX); Lighthouse a11y catches ~30–40% of WCAG (no full axe run yet); sample is QA'd demo prospects, not the worst-case thin-data site.

## Build & bundle

- **156 pages** built from **40 prospect JSON configs** in **~43s** (`astro build`).
- **dist = 68 MB total**, composed of:
  - **JS: 15 KB** (1 file) — near-zero client JS. ✅
  - **CSS: 84 KB** (2 files).
  - **Fonts: 1.5 MB** (67 woff2, latin-subset variable) — *dist-only*; a given page fetches only its 1–2 kit fonts (per-page transfer ~207 KB confirms this). Not a runtime problem.
  - **Images: 57.5 MB** — 687 webp (41.5 MB) + 82 jpg (16 MB) + 22 jpeg (4 MB) + 66 svg. **AVIF: 0 files.** Raw originals up to **833 KB** present (largely per-page `og:image` JPEGs for social crawlers).
- Source client JS: **271 LOC** (`scripts/motion.ts` 180 + `reveal.ts` 91).

## Config-driven spin-up score

- **Launching a new premium site = 1 file**: drop `src/data/premium/<slug>.json` (schema `premium-types.ts`). `import.meta.glob` auto-discovers it; **0 code/wiring changes**, one build emits its multi-page site. ✅ Excellent.
- The cost is **authoring that JSON well**, handled by the pipeline: **38 Node scripts / ~10,900 LOC** (scrape → research → `author-premium` → validate → photos → QA → push-to-CRM). This is the real complexity & maintenance surface (delete-first target).

## Dependencies

- Root: 5 devDeps — `chrome-launcher`, `lighthouse`, `sharp`, **`smartcrop`**, **`smartcrop-sharp`**.
- `demo-gallery`: 20 deps (17 `@fontsource*` families [all used by 10 design-kit pairings], `astro` 5.4, `open-props`, `utopia-core`) + `schema-dts` (typed JSON-LD ✅).
- `npm install` reported **2 vulnerabilities (1 low, 1 high)** — to triage.

## Code quality signals

- **TODO/FIXME/HACK: 0** across `scripts/` + `src/premium/`.
- **Type-check gate: NONE** — `@astrojs/check` was not installed (added for measurement; result in findings).
- **Lint: NONE** — no eslint config at root or in demo-gallery.
- **Type coverage:** TS strict via `tsconfig`; typed JSON-LD via schema-dts; typed premium config (`premium-types.ts`, 31 interfaces).

## Existing quality gates (already good)

- `premium-validate.mjs` — schema + every referenced photo exists on disk.
- `audit.mjs` — dead-token, **measured WCAG contrast**, empty-section, templated-copy (fallback-aware).
- `lighthouse.mjs` — SEO ≥ 95 / a11y ≥ 90 floor on built pages, **but fail-soft (skips with no Chrome) and has NO performance/CWV budget**.
- `sameness-check` (perceptual fold-hash), `image-qa` (resolution floor), `vision-qa`/`shots` (screenshots).
- Gap: no enforceable **CWV/perf budget** gate, no **type/lint** gate, no full **axe** a11y gate — quality is currently protected by human review + soft gates, which won't hold as sites are stamped out across all sectors.

## Structured data & conversion (per built page, sampled)

- JSON-LD present: `LocalBusiness` (⚠ **bare type**, not subtype) + `PostalAddress` + `GeoCoordinates` + `OpeningHoursSpecification` + `BreadcrumbList`.
- **No `aggregateRating`/`review` in JSON-LD** ✅ (correctly avoids Google's self-serving-review ineligibility/policy risk).
- Click-to-call: **5 `tel:` links/page** ✅. **No `sms:` (text) option.** No sticky mobile call bar observed.
- Viewport: `width=device-width, initial-scale=1.0` ✅ (not zoom-locked).
- Hero `<img>`: correct `srcset` (320–1200w) + `sizes` + `loading="eager"` + `fetchpriority="high"` + `decoding="async"` + explicit `width`/`height` + descriptive `alt`. ✅ Textbook.

## Implication for Phases 2–3

The runtime is **already excellent at the PURPOSE** (LCP < 2.5s on Slow-4G, a11y/SEO 100). Per the anti-slop contract ("every 'better' backed by a number from the same measurement"), most per-page perf/motion work — including the armada's 10-day perf sprint and a `flow` motion pass — **cannot show a meaningful measurable gain** and should be `won't-fix` unless a specific number moves. The genuine, defensible opportunities are: (a) **lock in** the quality with enforceable CWV/a11y/type gates so it can't regress across sectors; (b) **delete-first** in the 10,900-LOC pipeline (e.g. drop `smartcrop`); (c) small **correctness** wins (LocalBusiness subtype, AVIF, og-image weight, `sms:`); (d) conversion adds that are citation-backed but **not in-loop measurable** (flagged honestly, not claimed as "better").
