# AUDIT/research.md — External best practices (Phase 1)

> Synthesized from 5 parallel research passes (2026-06-20). Each finding names the
> specific practice, a real source, and why it serves the PURPOSE: a phone visitor
> on weak rural LTE calls/texts/books a local business within ~15 seconds, plus
> faster/more config-driven site spin-up. Mapping of "does THIS tool do it" is in
> findings.md (Phase 2), not here.

Scope adaptation: the tool is **Astro 5** (static), not Next.js — so App-Router/RSC
guidance is replaced by Astro islands / `astro:assets` / content-collection
equivalents. The framework-agnostic essentials (Core Web Vitals, WCAG 2.2 AA,
LocalBusiness JSON-LD, conversion patterns) carry over unchanged.

---

## 1. Mobile / slow-network performance (Astro 5 static)

- **Practice:** Use `<Picture src={hero} formats={['avif','webp']} fallbackFormat="jpeg" />` for the hero, AVIF first; `<Image>` emits only one format (default webp). · [Astro Images](https://docs.astro.build/en/guides/images/) — **Impact:** AVIF ~60% smaller than JPEG, ~35% smaller than WebP ([web.dev/compress-images-avif](https://web.dev/articles/compress-images-avif)).
- **Practice:** On the LCP hero only: `loading="eager"` + `fetchpriority="high"` + `decoding="async"`; never lazy-load it; keep URL in static `src`/`srcset` (no `data-src`). · [web.dev/optimize-lcp](https://web.dev/articles/optimize-lcp), [fetch-priority](https://web.dev/articles/fetch-priority) — highest-ROI single attribute for LCP.
- **Practice:** Always pass explicit `width`/`height` (or aspect-ratio); never a dimensionless `<img>`. · [web.dev/optimize-cls](https://web.dev/articles/optimize-cls) — eliminates image-driven CLS; target ≤ 0.1.
- **Practice:** Responsive images via the `layout` prop (`constrained`/`full-width`) so Astro auto-generates `srcset`+`sizes`; can set `image.layout` globally. · [Astro Images] — serving correctly-sized images is one of Lighthouse's largest byte-savings.
- **Practice:** Preload exactly ONE woff2 (the visible H1/CTA weight) with `crossorigin`; WOFF2 only. · [web.dev/font-best-practices](https://web.dev/articles/font-best-practices) — missing `crossorigin` = font fetched twice.
- **Practice:** `font-display: swap` + latin-subset font (@fontsource `*-latin.css`); limit weights. · [web.dev/font-display](https://web.dev/font-display/) — subsetting cuts a variable font to a fraction; `swap` removes FOIT.
- **Practice:** Metric-matched fallback `@font-face` with `size-adjust`/`ascent-override` to avoid swap reflow. · [web.dev/css-size-adjust](https://web.dev/articles/css-size-adjust) — removes the font-swap CLS spike.
- **Practice:** Keep Astro `build.inlineStylesheets:'auto'` (<4KB inlined); scoped styles + open-props over a big global sheet. · [Astro config] — removes a render-blocking CSS request.
- **Practice:** Static marketing site → prefer zero-JS. Gate any island with `client:visible`/`client:idle`, never `client:load` for non-critical UI. · [Astro islands](https://docs.astro.build/en/concepts/islands/) — keeps main thread free so first tap responds.
- **Practice:** Audit client JS for load/interaction work; `prefers-reduced-motion` should early-return the motion script. · [web.dev/optimize-inp](https://web.dev/articles/optimize-inp) — INP target ≤ 200ms.
- **Practice:** Be cautious with `<ClientRouter>` (View Transitions) — adds client JS + script re-init risk; cosmetic benefit for a 1–3 page site. · [Astro view transitions] — usually a net negative here.
- **Practice:** `prefetch: true` and tag only the primary conversion link (`data-astro-prefetch`), default `hover`/`tap`. · [Astro prefetch] — auto-downgrades on Save-Data/slow connection, protecting metered LTE.
- **Practice:** Long-lived immutable caching for hashed assets in `vercel.json` (`/_astro/(.*)` → `max-age=31536000, immutable`); short-TTL HTML with SWR. · [Vercel caching](https://vercel.com/docs/edge-network/caching) — near-zero bytes on repeat/multi-page hops.
- **Practice:** Verify the LCP is a real `<img>`/`<Picture>`, not a CSS `background-image` (not preloadable/discoverable). · [web.dev/common-misconceptions-lcp](https://web.dev/blog/common-misconceptions-lcp).

## 2. WCAG 2.2 AA for a mobile lead-gen site

- **2.5.8 Target Size (Min, NEW):** every tap target ≥ 24×24 CSS px (or spaced); primary phone CTA ≥ 44×44. axe `target-size`.
- **2.4.11 Focus Not Obscured (NEW):** sticky call/footer bars must not bury the focused element — use `scroll-padding-top/bottom`. Manual test.
- **2.4.7 Focus Visible:** never `outline:none` without a replacement (≥2px, 3:1). Grep templates.
- **1.4.3 Contrast:** body ≥ 4.5:1, large text ≥ 3:1 — check hero text over photos and muted secondary text. axe `color-contrast`.
- **1.4.11 Non-text Contrast:** button/field borders, focus ring, icon-only controls ≥ 3:1 (ghost "Call" buttons fail). Manual.
- **1.1.1 Alt text:** every `<img>` has alt; decorative `alt=""`; icon-only buttons (phone/map/hamburger) have an accessible name. axe `image-alt`,`button-name`,`link-name`.
- **2.1.1 Keyboard:** all controls keyboard-operable, no trap; `div role=button` handles Enter/Space + `tabindex=0`. axe `nested-interactive`.
- **1.3.1 Info & Relationships:** landmarks (one `<main>`), single `<h1>`, no skipped heading levels, real `<label>`s. axe `landmark-one-main`,`heading-order`,`region`.
- **2.4.4 Link Purpose:** phone CTA reads "Call (707) …", not bare "Click here" / naked icon. axe `link-name`.
- **3.3.2 Labels or Instructions:** visible persistent labels, not placeholder-only. axe `label`.
- **2.5.3 Label in Name:** visible text is a substring of the accessible name (voice control says "tap Call Now"). axe `label-content-name-mismatch`.
- **1.4.10 Reflow:** content reflows to 320px, no horizontal scroll / `overflow-x` leak. Manual.
- **1.4.4 Resize Text:** scales to 200%; never `user-scalable=no`/`maximum-scale=1`. axe `meta-viewport`.
- **2.3.3 / 2.2.2 Motion:** honor `prefers-reduced-motion`; auto-moving >5s needs pause. Also saves CPU/battery on weak LTE.
- **2.5.7 Dragging (NEW):** before/after sliders & swipe-only carousels need a single-tap alternative.
- **Caveat:** axe/Lighthouse catch ~30–40% of issues; 2.4.11, 1.4.11, 2.5.7, focus visibility are largely manual. Recommend `@axe-core/playwright` in CI + a short manual mobile-keyboard checklist.

## 3. Local SEO + LocalBusiness JSON-LD

- **Reality check:** Google requires only `name` + `address` for LocalBusiness; plain LocalBusiness/Organization markup **does not earn a visual rich card** — it feeds entity/Knowledge-Graph understanding + NAP corroboration. Only `BreadcrumbList` (desktop) and registration-gated `Restaurant` carousels render. Don't oversell "rich results."
- **Use the specific subtype** (`AutoRepair`,`HairSalon`,`Winery`,`Restaurant`), not bare `LocalBusiness`. · [Google LocalBusiness](https://developers.google.com/search/docs/appearance/structured-data/local-business)
- **Required:** `name` + structured `PostalAddress` (street/locality/region/postal/country).
- **Recommended:** `telephone`,`url`,`image`,`geo` (≥5-dp GeoCoordinates),`openingHoursSpecification` (`dayOfWeek`+`opens`/`closes` hh:mm:ss),`priceRange` (<100 chars).
- **`@id`** stable node identity referenced across pages; **`sameAs`** array → GBP/Maps/Yelp/FB/IG (reconciles site entity with GBP).
- **`areaServed`** for service-area businesses (towing/trades) that may not show a street address (GBP is authoritative for service area).
- **⚠ Do NOT** put self-authored `aggregateRating`/`review` on your own LocalBusiness/Organization markup — Google: such pages are **"ineligible for the star review feature"** and it risks a manual action. Review snippets are for *third-party* reviews or eligible types (Product/Event). · [Google review-snippet](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)
- **NAP consistency:** name/address/phone in **selectable text** (not in an image), matching GBP char-for-char; JSON-LD `telephone`/`address` identical to visible text. A mismatch erodes ranking.
- **Click-to-call:** `<a href="tel:+1-707-555-0123">` E.164, visible number as link text; pair with `sms:` + booking link; offer a non-call fallback. · [web.dev/click-to-call](https://web.dev/articles/click-to-call)
- **Map:** keyless static Maps `iframe` (lazy-loaded, below the CTAs) + a plain "Get directions" link to the Maps place URL (the lightweight primary path).
- **Multi-page:** `BreadcrumbList` (≥2 ListItems) — one of the few desktop rich results (removed from mobile snippets).
- **`rel=canonical`** self-referencing on the production domain (not the Vercel preview host); XML sitemap + robots allow + sitemap pointer.
- **Open Graph** (`og:title/description/url/type`, absolute `og:image` 1200×630) + `twitter:card=summary_large_image` — locals share trades over text/FB.
- **Perf is local-SEO:** LCP ≤ 2.5s p75 mobile; CWV is a ranking input; never lazy-load the LCP image.
- **Food/winery:** add `menu` (absolute URL), `servesCuisine`, `department` for nested units.
- **Three things that actually serve the purpose:** NAP-in-text matching GBP · click-to-call in E.164 · LCP ≤ 2.5s on LTE.

## 4. Conversion patterns that turn a visitor into a call

(Numbers as cited; vendor stats treated skeptically. Strongest primary sources: NN/g, Think with Google, Unbounce, BrightLocal.)

- **Phone call as primary conversion, not the form** — vendors cite phone leads 10–12× form leads (directional).
- **Above-the-fold tap-to-call with the number visible** — above-fold gets 57% of viewing time, >65% in the top half ([NN/g Scrolling & Attention](https://www.nngroup.com/articles/scrolling-and-attention/)).
- **Persistent sticky mobile call/text bar** — [CRE](https://conversion-rate-experts.com/sticky-cta-win-report/): +25% sales / +22% revenue per visitor (single case study).
- **Speed is the conversion gate** — 53% of mobile visits abandoned if load >3s; bounce +32% (1s→3s), +90% at 5s ([Think with Google](https://blog.google/products/admanager/the-need-for-mobile-speed/)).
- **Page bloat suppresses conversion** — P(conversion) drops 95% as elements go 400→6,000 (SOASTA/Google).
- **Star rating + visible review count near the CTA** — 71% read reviews; 38% require ≥4★ ([BrightLocal 2025](https://www.brightlocal.com/research/local-consumer-review-survey-2025/)). (NOTE: display as text/widget, NOT self-serving JSON-LD — see §3.)
- **Real photos of team/trucks/work, not stock** — qualitative trust signal for trades.
- **"Licensed & Insured" / certified / bonded badges** — table-stakes credibility (qualitative).
- **Single primary CTA per page** — single 13.5% vs two 11.9% vs 3+ 10.5% conversion across 18,639 pages ([Unbounce](https://unbounce.com/conversion-rate-optimization/cta-buttons-that-convert/)). Strongest single number.
- **Short fallback form** (name+phone) — but "fewer fields" is non-linear; A/B test, don't dogmatically minimize ([CXL](https://cxl.com/blog/reduce-form-fields/)).
- **Hours + "Open now"** — "open now near me" grew ~400% YoY (Think with Google).
- **Service-area statement + map** — ~76% of near-me searchers contact within 24h; 46% of searches have local intent.
- **Speed-to-answer promise** ("we answer in person / text back in minutes") — removes voicemail fear.
- **Social proof at the decision point** (1–2 named local testimonials beside the CTA), not on a buried Reviews page.
- **What mainstream builders get WRONG:** bloat over speed, generic stock imagery, form-first/call-buried, multiple competing CTAs, no "open now"/service-area line.

## 5. Adopt vs. build (delete-first OSS survey)

Priority order (highest delete-first / north-star leverage first):

1. **ADOPT-AS-GATE:** [`@lhci/cli`](https://github.com/GoogleChrome/lighthouse-ci/) (encode 15s/rural-LTE as CI budgets: LCP/TBT/total-bytes, slow-4G) + [`@axe-core/playwright`](https://playwright.dev/docs/accessibility-testing) (tap-to-call a11y). Turns the north-star into pass/fail. Also [Unlighthouse](https://unlighthouse.dev/) for fast all-page local review.
2. **ADOPT:** [`crawlee`](https://github.com/apify/crawlee) + [`cheerio`](https://github.com/cheeriojs/cheerio) — collapses scraping/queue/retry boilerplate across the 38 scripts; extract JSON-LD with a ~10-line Cheerio one-liner (the abandoned `web-auto-extractor`/`microdata-node` libs are SKIP).
3. **DELETE:** `smartcrop`/`smartcrop-sharp` → sharp has built-in `position: sharp.strategy.attention`/`entropy`; drop the extra dep unless `attention` measurably crops worse on the real photo set.
4. **ADOPT:** [`astro-seo`](https://github.com/jonasmerlin/astro-seo) + [`@astrojs/sitemap`](https://docs.astro.build/en/guides/integrations-guide/sitemap/) (first-party). KEEP `schema-dts` but validate emitted JSON-LD in CI.
5. **ADOPT (selective):** [Starwind UI](https://github.com/starwind-ui/starwind-ui) primitives (copy-in, you own the code) for a11y plumbing inside existing sections; keep bespoke section layouts.
6. **SKIP:** AstroWind/Accessible-Astro as wholesale theme swaps, `@unpic/astro` (you own photos at build), `pa11y` (redundant), abandoned JSON-LD libs, and ALL "AI website builder" frameworks (Dyad/GrapesJS/Mobirise) — none output a perf-budgeted Astro site from a business profile.
- **Layer 5 honest verdict:** there is **no production-grade OSS that replaces the generator** (scrape→research→author→score→CRM). Keep the bespoke orchestration; win on the *layers around* it (gates, scraping, crop, SEO components).
