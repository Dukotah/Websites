# Framework Resources — External Patterns to Adopt

_Generated 2026-06-20 from six research-agent sweeps. Covers architecture,
section libraries, theming, Astro integrations, data extraction, copy, and QA._

---

## 1. The Framework Re-Architecture: Ending the Duplicate-Section Seam

### The exact problem in this codebase

`sites/demo-gallery/src/pages/p/[slug].astro` hardcodes four structural
components that are invisible to the compose engine:

```
<About config={config} />
<Contact config={config} />   ← renders address + phone + hours + map + CTA
```

Meanwhile `SectionRenderer` can also render `hours-contact`, `map`, and `cta`
sections that `composePage()` emits. When a recipe includes any of those (and
most do — towing, cafe, plumbing, salon all include `hours-contact` and/or `cta`),
the page gets contact info twice, map iframes twice, and CTA buttons twice or
three times. The two systems have no knowledge of each other.

### The pattern to adopt: capability-flagged block registry

Every production page builder (TinaCMS, Payload CMS, Puck, Keystatic) converges
on the same fix: **a single ordered array of typed blocks is the only source of
truth for page content**. The layout template becomes a dumb renderer with no
hardcoded sections. This project already has 80% of the infrastructure (the
`SectionRenderer` switch map, the `composePage` output, the `Section` discriminated
union in `types.ts`). The remaining 20% is the migration.

**The single best open-source model for this codebase:**
**TinaCMS `tina-astro-starter` pattern** (MIT, Apache-2.0 core)
https://github.com/tinacms/tina-astro-starter

Why this one specifically: it ships a zero-React Astro frontend where each page
is an ordered array of typed block objects rendered by a `switch(block.__typename)`
— exactly the pattern `SectionRenderer` already implements. Study `.tina/config.ts`
for the block template schema structure, and `src/components/blocks/` for the
per-block Astro renderer pattern. You do not need to adopt TinaCMS as a dependency;
the pattern is the value.

### Concrete changes to make

**Step 1 — Extend the `Section` union in `types.ts` to cover the two connective
components.**

Add two new block types:

```typescript
// In types.ts, add to the Section discriminated union:
| { type: 'about' }          // renders About.astro content (no new fields needed;
                              //   data comes from config.about as today)
| { type: 'contact-block' }  // renders the full Contact panel (address + phone +
                              //   hours table + form + map + directions CTA)
```

`ContactBlock` replaces the standalone `<Contact>` component. `AboutBlock`
replaces the standalone `<About>` component. Both read the same `config` prop
they already receive.

**Step 2 — Add `provides` flags to the `instantiateSection` switch in
`compose.ts`.**

Inspired by the WordPress Gutenberg `block.json providesContext` pattern (MIT):
https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/

Add a static map of which blocks cover which capability domains:

```typescript
// In compose.ts:
const PROVIDES: Partial<Record<RecipeSectionType, string[]>> = {
  'contact-block': ['contact', 'map', 'hours', 'address', 'phone'],
  'hours-contact': ['hours', 'phone'],
  'map':           ['map', 'address'],
  'cta':           ['cta'],
};
```

At the end of `composePage`, before returning, build a `provided` set and use
it to suppress connective-component rendering:

```typescript
// In composePage() return value, add:
const provided = new Set(
  sections.flatMap((s) => PROVIDES[s.type as RecipeSectionType] ?? [])
);
return { hero, sections, provided };
```

Add `provided: Set<string>` to the `PagePlan` interface.

**Step 3 — Gut `[slug].astro`'s hardcoded components.**

Change the page template from:

```astro
<About config={config} />
<SectionRenderer sections={plan.sections} />
<Contact config={config} />
```

to:

```astro
<SectionRenderer sections={plan.sections} config={config} />
```

`SectionRenderer` handles everything, including the new `about` and
`contact-block` cases in its switch. The layout keeps only chrome (head, fonts,
palette CSS vars, footer shell, skip link, call FAB).

**Step 4 — Add the two new cases to `SectionRenderer.astro`.**

```astro
case 'about':
  return <About config={config} />;
case 'contact-block':
  return <Contact config={config} />;
```

Pass `config` as a second prop to `SectionRenderer` (it already gets `sections`).

**Step 5 — Update all recipes in `compose.ts`** to explicitly include
`'about'` and `'contact-block'` where they belong, replacing the current
`'about'` stub that returns `null`. Now `instantiateSection('about', config)`
returns `{ type: 'about' }` instead of `null`, and the compose engine controls
whether and where About and Contact appear.

**Why capability flags instead of just deduplication by type:**
`hours-contact` covers hours + phone but NOT the full map iframe or address
panel. `contact-block` covers all of those. The `provided` set lets the engine
check `!provided.has('map')` before emitting a standalone `map` section — more
precise than checking for duplicate type strings.

**Result:** The generator decides which blocks to include. The layout renders
exactly those blocks. Nothing else. Maps and contact info can never render twice
because `composePage` controls the full list.

---

## 2. Resources to Adopt Now (Key-Free, High Value)

### Composition Layer

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| Astro Content Collections + Zod `discriminatedUnion` (built-in) | Schema-typed block arrays validated at build time; zero extra deps | https://docs.astro.build/en/guides/content-collections/ | MIT | Already in `types.ts`; formalizes the Section union as a Content Collection schema for compile-time block validation | Low — rename the `Section` union to match Astro's collection schema |
| TinaCMS `tina-astro-starter` pattern | Reference implementation of Astro switch-renderer over typed block array | https://github.com/tinacms/tina-astro-starter | MIT | Architectural reference for the `SectionRenderer` refactor above | Reference only — no npm install |
| Puck v0.19 Slots API data model | JSON shape for nested block composition; `content[]` array + inline slot nesting | https://github.com/puckeditor/puck | MIT | Adopt the data model shape if we ever need blocks-within-blocks (e.g. two-column layout containing sub-blocks) | Low — data model only, no React dependency |

### Section Library

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| **Fulldev UI** | Astro-native block registry; installs as `.astro` files via CLI; 13+ hero variants, features, FAQs, CTAs, contact, footers | https://github.com/fulldotdev/ui | MIT | Directly replaces hand-rolled section components; same `.astro` architecture we already use; slot into the existing `SectionRenderer` map | Low — install blocks, adapt CSS vars to our OKLab tokens |
| **HyperUI** | 226+ copy-paste Tailwind v4 HTML components; pure HTML, zero framework; heroes, features, testimonials, pricing, CTAs, FAQ, team, banners, footers | https://github.com/markmead/hyperui | MIT | Primary mining source for new section variants when divergence pass needs a fresh layout; wrap in `.astro` component with typed props | Low per block — HTML to Astro in ~10 min |
| **Meraki UI** | 74 small-business-relevant Tailwind CSS blocks: hero (11), features (7), testimonials (8), pricing (7), team (7), FAQ (5), CTA (6), contact (13) | https://github.com/merakiuilabs/merakiui | MIT | Secondary source for section variants in exactly the categories the factory generates; plain HTML+Tailwind | Low per block |
| Flowbite (free tier) | 120+ free marketing block sections on Tailwind CSS; gallery/portfolio blocks are the specific gap in our library | https://github.com/themesberg/flowbite | MIT (free core) | Gallery and portfolio section variants, which are thin in our current library | Low (minor vanilla JS plugin friction on modal/accordion types) |
| accessible-astro-components | 20+ WCAG/ARIA-compliant Astro components: Accordion, Modal, Tabs, Breadcrumbs, Pagination, Card, DarkMode, SkipLinks | https://github.com/incluud/accessible-astro-components | MIT | Replaces hand-rolled interactive elements where ARIA is commonly wrong; SkipLinks already exists in `BaseLayout.astro` but can be standardized | Low — drop-in import |

_Note on Preline UI: Fair Use License prohibits use in generators/redistributors. Do not embed verbatim code in generated output. CodeStitch is subscription/proprietary. Cruip and Astroship are GPL-3.0 — skip as code sources._

### Theming and Typography

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| **culori** | MIT color library for OKLab/OKLCH/P3; pure functions, tree-shakeable; `culori-scales` companion for N-step palettes | https://github.com/Evercoder/culori | MIT | Replaces the hand-rolled OKLab palette math in `art-direction.ts`; cleaner, more complete, CSS Color Level 4 | Low — `npm install culori` and swap palette functions |
| **postcss-utopia** | PostCSS plugin that generates fluid `clamp()` type and space scale as CSS custom properties (`--step-0` through `--step-5`, `--space-s` through `--space-xl`) | https://github.com/trys/postcss-utopia | MIT | Replaces hardcoded font-size and spacing values across 35+ section components; one `@utopia typeScale` declaration covers all of them | Low — add to `postcss.config.cjs` |
| **Fontsource (`@fontsource-variable/*`)** | Self-hosted variable fonts via npm; Astro native font provider reads them from `package.json` automatically; 1500+ OFL/Apache fonts | https://github.com/fontsource/fontsource | MIT (infrastructure); OFL/Apache (fonts) | Replaces any Google Fonts CDN calls with zero-network, zero-tracking, zero-request variable fonts; maps cleanly to the factory's `fontPair` token per business category | Low — `npm install @fontsource-variable/inter` etc. |
| Style Dictionary v5 | Apache-2.0 build system that takes token JSON and emits CSS custom properties, SCSS, etc.; v5 has OKLCH transformer built in | https://github.com/style-dictionary/style-dictionary | Apache-2.0 | Per-business token bundle: palette + scale + font tokens in one scoped CSS file; composePaage emits token JSON, Style Dictionary emits the CSS | Medium — add prebuild step, define token schema |

_Radix Colors and Panda CSS are strong picks if you want semantic step semantics or codegen multi-brand enforcement respectively — both MIT, key-free. Adopt after the above four._

### Astro Integrations

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| **astro-seo** | Single typed `<SEO>` component for all title/meta/OG/Twitter/canonical tags from one props interface | https://github.com/jonasmerlin/astro-seo | MIT | Replaces scattered `<head>` construction across `BaseLayout.astro` and the standalone-site `BaseLayout.astro` | Trivial — replace `<head>` meta block |
| **@astrojs/sitemap** | Official integration; generates `sitemap-index.xml` at build time; v3.7.3 | https://docs.astro.build/en/guides/integrations-guide/sitemap/ | MIT | No sitemap currently generated; essential for gallery SEO | Trivial — `npx astro add sitemap` |
| **astro-og-canvas** | Per-business 1200×630 OG images at build time using CanvasKit; no API, no server | https://github.com/delucis/astro-og-canvas | MIT | Each demo site gets a business-name OG card with the OKLab palette brand color as background; replaces static `og.jpg` | Low — add route, pipe config data |
| **@unpic/astro** | Multi-CDN responsive image component; auto-detects Imgix/Cloudinary/20+ CDN URLs and generates correct srcset; falls back to sharp for local images | https://github.com/ascorbic/unpic-img | MIT | Handles both scraped CDN photo URLs and Pexels fallbacks in one config line as the Astro image service; AstroWind already ships this | Low — configure in `astro.config.mjs` |
| astro-robots | Generates `robots.txt`; zero-config Disallow option for demo sites pending prospect conversion | https://github.com/ACP-CODE/astro-robots | ISC | No robots.txt currently; pair with sitemap | Trivial |
| @playform/compress | Post-build HTML/JS/SVG/image compression; add last in integrations array | https://github.com/PlayForm/Compress | Check LICENSE file before adopting | Adds final compression pass across all generated sites; check license before committing | Low |

### Data / Extraction

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| **metascraper** (+ `metascraper-address`) | Rule-based metadata extraction with 95.54% accuracy; OG → JSON-LD → RDFa → HTML fallback chain; official rules: author, description, image, logo, publisher; community rule for address | https://github.com/microlinkhq/metascraper | MIT | Replaces ad-hoc OG/meta extraction in `scrape-site.mjs`; the `image` and `logo` rules surface the business's own photos without heuristic guessing | Low — `npm install metascraper metascraper-{title,description,image,url}` |
| **open-graph-scraper** | Focused scraper for OG/Twitter/Dublin Core/JSON-LD; returns `ogImage` with dimensions; raw JSON-LD passthrough | https://github.com/jshemas/openGraphScraper | MIT | Photo source problem: `og:image` is the image the business owner deliberately chose; use as photo candidate #1 before in-page crawling | Low |
| **@mozilla/readability** | Mozilla's Firefox Reader Mode port; returns title, excerpt, siteName, publishedTime from any HTML DOM; prioritizes JSON-LD | https://github.com/mozilla/readability | Apache-2.0 | Replaces ad-hoc content scraping in `scrape-site.mjs`; excerpt feeds copy seeds; siteName validates the business name | Low — works with jsdom which we likely have |
| **web-auto-extractor** (`@rane/web-auto-extractor`) | JS extraction of Microdata, RDFa-lite, JSON-LD, and meta tags in one call; returns `{ microdata, rdfa, jsonld, metatags }` | https://github.com/indix/web-auto-extractor | MIT | Single-call extraction of all LocalBusiness JSON-LD fields (name, address, telephone, openingHoursSpecification); eliminates per-field selector scraping | Low — use the `@rane` fork (maintained) |
| **opening_hours.js** | Parses and evaluates OSM opening_hours strings; 99.3% real-world coverage; v3.13.0 (June 2026) | https://github.com/opening-hours/opening_hours.js/ | LGPL-3.0 | Normalizes any openingHoursSpecification string from JSON-LD into structured day/time slots for `HoursContactSection`; replaces ad-hoc regex | Low — LGPL fine for build-time tool use |
| Openverse API (`@openverse/api-client`) | 600M+ CC0/CC-BY openly-licensed photos from Flickr/Wikimedia Commons; anonymous tier: 100 req/day (enough for ~50-site batch); typed JS client | https://github.com/WordPress/openverse | MIT (client); CC (media) | Fallback photo source when scraper finds nothing usable; query by business category keyword; supplements our existing Wikimedia Commons fetch | Low — add to `photos.mjs` fallback chain |

_`extruct` (BSD-3, Python) is the strongest single-call structured-data extractor if you add a Python preprocessing step. `jsonld.js` (BSD-3) is the right post-processing tool for irregular JSON-LD graphs. `opening_hours.js` is LGPL-3.0: fine as a build-time script dependency, not a distributed binary._

### Copy

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| **Instructor** (`jxnl/instructor`) | MIT Python library wrapping any LLM (including Ollama local models) with Pydantic schemas; auto-retries on validation failure; 6M+ monthly PyPI downloads | https://github.com/jxnl/instructor/ | MIT | Implements the Schema-Constrained Grounding Pattern: scraped `BusinessFacts` JSON goes in, validated `CopyBlock` typed fields come out, null where no source data exists — physically prevents fabricating addresses or phone numbers not in the scrape | Medium — add Python script to pipeline; install Ollama locally |
| **Outlines** (`dottxt-ai/outlines`) | Apache-2.0 Python framework enforcing structured generation at the token-logit level; model cannot emit tokens that violate your JSON Schema | https://github.com/dottxt-ai/outlines | Apache-2.0 | Stronger than Instructor: prevents invalid tokens from being generated (not just retried); use for the copy-generation step where schema compliance is the quality ceiling | Medium — Python preprocessing |
| StoryBrand SB7 Framework (pattern, not a library) | 7-slot narrative scaffold (Character→Problem→Guide→Plan→CTA→Avoid→Success); encode as copy-generation prompt template | https://storybrand.com/ | None (prompt pattern) | Gives the LLM a proven narrative skeleton while Instructor/Outlines constrain it to scraped facts; hero slot = Character+Problem, about slot = Guide+Plan, CTA slot = Call to Action | None — prompt engineering only |

_DSPy (MIT, Stanford) is the right investment for auto-optimizing copy prompts once you have ~20 rated examples. Adopt after Instructor is running._

### QA / Media

| Resource | What it is | URL | License | Replaces / Strengthens | Effort |
|---|---|---|---|---|---|
| **Transformers.js** (CLIP + BLIP in Node.js) | Runs ONNX transformer models server-side in Node with no API key; CLIP for semantic photo-business matching (cosine similarity); BLIP-base for photo captions to feed copy engine | https://github.com/huggingface/transformers.js | Apache-2.0 | Directly replaces heuristic photo judgment (architecture debt #3); CLIP base model ~152 MB total; use BLIP-base (~450 MB) not SmolVLM-2B (too heavy for 7.35 GB RAM machine) | Medium — add to `score-photos.mjs`; one-time model download |
| **html-validate** | Offline HTML5 validator/linter; runs on `dist/**/*.html` post-build; checks semantics, ARIA, attribute validity; no network required | https://gitlab.com/html-validate/html-validate | MIT | Adds a fast first-pass QA gate before Playwright runs; catches broken nesting, missing alt attributes across all generated pages; run as CLI on `dist/` | Low — `npx html-validate dist/**/*.html` |
| **Lost Pixel** | Self-hosted visual regression; headless Chromium screenshots, pixel-diff vs baselines, HTML diff report; zero cloud | https://github.com/lost-pixel/lost-pixel | MIT | Replaces ad-hoc visual review of `.shots/`; gates on pixel differences when section library or compose engine changes; run in CI after `astro build` | Low — `npx lost-pixel` against served `dist/` |
| **linkinator** | Broken-link crawler for static sites; checks all href/src/link elements in `dist/`; Apache-2.0 | https://github.com/JustinBeckwith/linkinator | Apache-2.0 | Catches dead scraped URLs (business site URLs that 404 by deploy time); essential for a scrape-based factory; one command covers the whole `dist/` | Trivial — `npx linkinator ./dist --recurse` |
| **axe-core / @axe-core/cli** | Industry-standard accessibility engine; MPL-2.0; different WCAG 2.2 rule set from pa11y, catches ARIA/role-structure issues pa11y misses | https://github.com/dequelabs/axe-core | MPL-2.0 | Complements the planned pa11y gate with a second a11y engine; run both for full coverage | Low — `npx @axe-core/cli <url>` after `npx serve dist` |
| **reg-cli** | Lightweight CLI for pixel-diff of two local screenshot directories; produces self-contained HTML report; zero cloud | https://github.com/reg-viz/reg-cli | MIT | Pairs with Playwright screenshots (already planned): capture to `actual/`, diff vs `baseline/`, archive HTML report as build artifact | Low — `npx reg-cli actual/ baseline/ diff/` |

---

## 3. Optional Paid / Key Accelerators

| Resource | Cost | What it adds |
|---|---|---|
| Flowbite Blocks Pro | $149 one-time | 459 total blocks including locked gallery/portfolio/publisher sections; Figma design system; exhaust free sources first |
| Pexels API | Free (key required) | 3M+ high-quality stock photos; already on roadmap; free tier is generous |
| SmolVLM-2B (via Transformers.js) | Free model, requires ~5 GB RAM | Stronger semantic photo judgment than BLIP-base; defer until running on higher-RAM machine or cloud CI |

_LAION Aesthetic Predictor (MIT) is key-free but requires a one-time Python ONNX export of the predictor weights; adds a 1-10 aesthetic quality score on top of the CLIP embedding. Worth doing after CLIP is running — the predictor is a tiny 5-layer MLP._

_`@imgly/background-removal-node` (AGPL-3.0) removes scraped-photo backgrounds in Node.js; key-free and useful for hero photo quality. License note: AGPL is fine for a local CLI generator but requires attention if the factory ever becomes a hosted web service. If that happens, get a commercial license from IMG.LY or use the browser-only MIT alternative._

---

## 4. Recommended Adoption Order

**Phase 1 — Architecture (ends duplicate-section seam; nothing else matters until this is done)**

1. Migrate `types.ts`: add `about` and `contact-block` to the `Section` union.
2. Add `provides` capability flags to `compose.ts` and add `provided: Set<string>` to `PagePlan`.
3. Update all `RECIPES` to emit `about` and `contact-block` explicitly.
4. Update `instantiateSection` to return `{ type: 'about' }` and `{ type: 'contact-block' }`.
5. Add `about` and `contact-block` cases to `SectionRenderer.astro`; pass `config` prop.
6. Strip `<About>` and `<Contact>` from `[slug].astro`.
7. Add `astro-seo` to `BaseLayout.astro` (replaces scattered head tags; effort is trivial and unblocks SEO work).

**Phase 2 — Section library quality (ride on the new registry)**

8. Add Fulldev UI blocks as the primary source of new section variants (Astro-native, MIT).
9. Mine HyperUI and Meraki UI for additional variant layouts; wrap in `.astro` with typed props.
10. Add `accessible-astro-components` for Accordion, Modal, and any interactive blocks.

**Phase 3 — Theming and tokens**

11. Replace hand-rolled OKLab math with `culori` (drop-in, npm install).
12. Add `postcss-utopia` for fluid type and space scales; remove hardcoded sizes from section CSS.
13. Switch Google Fonts CDN calls to `@fontsource-variable/*` via Astro native font provider.

**Phase 4 — Data extraction and copy quality**

14. Replace ad-hoc `scrape-site.mjs` metadata extraction with `metascraper` + `open-graph-scraper` + `@mozilla/readability` + `web-auto-extractor`.
15. Add `opening_hours.js` for hours string normalization.
16. Add Openverse API to the fallback photo chain (`photos.mjs`), after Wikimedia Commons.
17. Add Instructor + Ollama for schema-constrained copy generation (grounded BusinessFacts → validated CopyBlock).

**Phase 5 — QA pipeline**

18. Add `html-validate` as a fast post-build gate on `dist/`.
19. Add `linkinator` to catch dead scraped URLs.
20. Add `axe-core/cli` alongside pa11y for second-engine accessibility coverage.
21. Add `Lost Pixel` or `reg-cli` for visual regression; set baselines after Phase 1-2 stabilize.
22. Add Transformers.js (CLIP + BLIP-base) to `score-photos.mjs` for semantic photo judgment.

**Phase 6 — Build infrastructure**

23. Add `@astrojs/sitemap` and `astro-robots`.
24. Add `astro-og-canvas` for per-business OG cards.
25. Add `@unpic/astro` as the Astro image service to unify scraped CDN + Pexels photo handling.
26. Consider Style Dictionary v5 for per-business token bundles if multi-brand token management becomes complex.

---

## 5. If You Adopt Only Three

**1. Fulldev UI** (https://github.com/fulldotdev/ui — MIT, Astro-native)

The single highest-leverage section library choice. It installs blocks as `.astro`
files — the same architecture already in use. Richer, more professionally built
blocks slot directly into the existing `SectionRenderer` switch map. Addresses
architecture debt #2 (uneven hand-rolled section library) with zero friction.

**2. Transformers.js with CLIP + BLIP-base** (https://github.com/huggingface/transformers.js — Apache-2.0)

Directly fixes the #1 quality ceiling: photo judgment is currently heuristic.
CLIP computes a semantic similarity score between a candidate photo and a text
description of the business category (e.g. "interior of a marina with boats") —
no API key, runs in Node.js at generate time, ~152 MB model download once.
BLIP-base adds captions for the scraped photos, which feed into copy assembly
as semantic descriptions instead of filename guesses. These two models together
address architecture debts #3 and #4.

**3. The capability-flagged block registry migration** (pattern, no library required)

The architecture fix described in section 1 above costs nothing in external
dependencies. The `provides` Set and the migration of `<About>`/`<Contact>` into
the `SectionRenderer` switch eliminates the entire class of duplicate-render bugs
permanently. This unblocks everything else: once the page template is a dumb
renderer over a complete sections array, section library improvements (Fulldev
UI, new HyperUI variants) slot in cleanly without risk of double-rendering.

---

_All resources in sections 2 and 4-5 are MIT, Apache-2.0, ISC, or BSD-3 unless noted.
Flag before adopting: LGPL-3.0 on `opening_hours.js` (fine for build-time tool use);
MPL-2.0 on `axe-core` (fine for CLI use in CI); AGPL-3.0 on `@imgly/background-removal-node`
(fine for local CLI generator, requires attention if factory becomes a hosted service)._
