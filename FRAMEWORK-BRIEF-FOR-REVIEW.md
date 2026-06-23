# Lead-Gen Website Factory — Architecture Brief for Outside Review

**You are reviewing a system you cannot see the code of.** Below is a complete description of what it does and the design decisions behind it. At the end are the specific questions I want your help on: **what to alter, upgrade, or remove to get better results.** Be opinionated. Challenge the premises.

---

## 1. What it is and what it's for

A **website factory for local-business outreach**. The operator runs a chat agent and says *"build me N demo websites from this CSV of local businesses."* The agent researches each business, generates a polished multi-page demo site, finds photos, and produces live demo links to cold-email the business owner. The pitch: *"We built you a free demo site — want it?"* Demos convert prospects into paying clients (a hosted plan, or a standalone site).

- **Market:** small local businesses in one US county (Sonoma County, CA) — wineries, cafes, trades (plumbing/roofing/electrical/HVAC/auto), salons/spas, dentists, restaurants, etc.
- **North-star UX:** a phone visitor on weak rural LTE can call / text / book within ~15 seconds. Mobile-first, fast, accessible.
- **Hard constraint:** the headline workflow requires **no API keys** — it must produce quality deterministically. (An optional LLM copy-upgrade step exists if a key is present, but is not assumed.)
- **Scale goal:** spin up many sites quickly and consistently; quality must hold as volume grows.

## 2. Architecture

- **One Astro 5 app** hosts *every* prospect's demo. A new site = **ONE JSON file** (`<slug>.json`) conforming to a typed schema, auto-discovered at build, rendered as a **multi-page site at `/s/<slug>`** by a shared component layer. One deploy (Vercel, git-push-to-deploy) serves all demos on one domain.
- **Shared rendering layer** (layout, header/footer, ~14 section components, one CSS file, minimal client JS). Changing it once upgrades every generated site simultaneously. This is deliberately the leverage point.
- **Internal scoring dashboard** at `/` ranks every demo (photo richness, section richness, contact completeness, trust signals, SEO) and surfaces weak/"needs-review" ones first — the operator's triage view.
- **A legacy single-page builder was deleted**; the multi-page system is the only one.

**The site config schema** (per business) carries: `name, slug, category, area, tagline, seoDescription, established, contact, hours[], rating, brand{color,fontId}, images, pages[]`, plus `status: ready|needs-review|draft` and `flags[]`. Each page is an ordered list of **sections**, where section `kind` ∈ `hero, story, services, features, stats, steps, testimonials, faq, callout, pricing, gallery, team, cta, contact`.

## 3. The end-to-end pipeline (per business)

Input is a CSV row: `name` (required) + optional `website, category, city, state, phone, email, address, established`. **The `website` column is the single biggest quality lever.**

1. **Facts / research.** In priority order:
   - A **confirmed research file** (hand- or agent-authored JSON with real, verified facts: hero/about/services copy, highlights, hours, testimonials, rating) — authoritative, overrides everything.
   - Else a **live scrape** of the business's own website (pulls name, phone, address, hours, about-story, services, reviews, and their photos).
   - There are bridge tools to normalize a third-party scraper's CSV into research files, and a "verify/clean/promote" step that scrubs scrape noise and (only with an LLM key) rewrites copy.
   - **Per-category presets** supply a theme + the *kind* of services/highlights typical for that category, as a skeleton when research is thin.
2. **Photos** (a route-agnostic media pipeline). Source priority:
   - **agent-dropped** (a human/agent manually placed real photos in the business's asset folder) →
   - **the business's own site** (scraped, logo/icon-filtered) →
   - **[stock: Wikimedia Commons → OpenStreetMap image tags]** →
   - **built-in category SVG art** (last resort).
   - Photos are scored for **faded / blurry(fuzzy) / low-resolution**; a resolution *tier* is computed from true pixel width (full-bleed ≥1600w / side-column 1000–1599w / drop <1000w). The framework optimizes images (responsive WebP + blur-up placeholders) at build.
   - **RECENT POLICY CHANGE (important for your review):** stock fallbacks (Wikimedia/OSM) are now **OFF by default** — only the business's *own* photos are used. If there are no good own photos, the site goes **photo-less** (clean type-forward structure) rather than show generic stock. This was triggered by 5 generated wineries all getting the *identical* stock vineyard header. A flag re-enables stock.
3. **Authoring** (turns facts + photos into the config):
   - Copy is written **deterministically from the real facts** (optional LLM upgrade if a key exists).
   - **Brand identity** is seeded deterministically from `slug + category` → a distinct brand color + font pairing; the generator re-seeds two siblings that collide on the **same font+color combo**.
   - **Hero variant** is chosen as `editorial` (type-forward, no photo) / `split` (side photo) / `fullbleed` (background photo) — clamped by the real on-disk photo width so a too-small image is never upscaled into a pixelated header (degrades full-bleed→side→text).
   - A **provenance/congruence gate** decides whether a photo may headline: only the business's *own* photo for "indoor place" categories (salon/cafe/dental…); regional stock was previously allowed for "outdoorsy" categories (winery/marina/landscaping…). Faded/fuzzy heroes are suppressed.
   - **Multi-page composition:** home + a services/menu page + about + contact, with section order varied per-site by a seed.
   - **Photo-less pages** render a text hero + structured non-photo bands (story/services/stats/faq/cta). To count as "ready," a photo-less page must carry a **real trust signal** (a rating, a real testimonial, or a credential like an award / "NN points" / certification) — heritage lines ("family-owned since 1990") deliberately don't count.
4. **Quality gates** (the "anti-cookie-cutter" layer; key-free, deterministic):
   - **Schema + photo-existence validator** (inline in generate; flags `needs-review`).
   - **Content audit:** dead CSS-token check, measured WCAG contrast, empty-section, **templated-copy** detection, **scraped-junk** detection (e-comm/nav boilerplate, leaked JS template literals, coupon fine-print), photo sharpness/resolution (a below-floor full-bleed hero is a hard failure), and the photo-less "needs a trust signal" gate. Non-zero exit blocks deploy.
   - **Image-QA:** a LOCKED source-resolution floor per slot (hero-fullbleed 1600w, hero-split 1000w, story 900w, gallery 640w) — anything under floor hard-fails.
   - **Sameness check:** perceptual hash of the hero "fold" across sites to catch templated-looking duplicates.
   - **Vision QA:** screenshots the fold + full page of every site for human/agent visual review (a headless capture that forces reduced-motion so below-the-fold reveals render).
   - **Performance budget:** runs built pages in headless Chrome under mobile Slow-4G; fails if perf <90 / LCP >2.5s / CLS >0.1 / TBT >200ms / page >~684KB. Current sites sit ~96–99 perf, LCP ~2s, CLS 0.
5. **Launch & CRM seam.** `git push` → Vercel rebuilds (push = deploy). A manifest file (`name, slug, link, status, email, category, area, thumbnail`) is consumed by a separate CRM that matches demos to leads by normalized name and **refuses to send any demo whose `status` is `needs-review`.**

## 4. Operating philosophy / constraints

- **Deterministic + key-free by default.** Same input → same output. Quality comes from *gates and heuristics*, not from an LLM in the loop (the LLM upgrade is optional).
- **Quality enforced by machine gates**, because the operator can't hand-review at scale. The bar: a demo can't be marked sendable unless it passes.
- **`needs-review` is a first-class state** — a thin/unverified demo is generated but withheld from outreach until a human verifies.
- **Performance is sacred** (rural mobile): minimal client JS, aggressive image optimization, mobile sticky tap-to-call bar, no heavy frameworks.
- ~25 pipeline scripts + ~13 shared libs, ~11,000 LOC of Node tooling (separate from the Astro app).

## 5. Recent changes (context — already done, don't re-suggest)

- Removed an "AI-looking" photo-less hero treatment (an animated gradient/aurora canvas + giant monogram) in favor of a clean, restrained editorial text hero.
- Hero variant now clamps to true image resolution (no pixelated headers); content-audit and image-QA gates were aligned so both hard-fail under-resolution heroes.
- Stock photos off by default (structure-first), as described above.
- Added real, verified trust signals (ratings/awards/testimonials) to photo-less demos so they read as solid.

## 6. Known tensions / where I want your critique

Please pressure-test these and propose **alter / upgrade / remove** changes. Prioritize by impact.

1. **Photo sourcing is the weak link.** Many real prospects (e.g. thin-site wineries) yield *no usable own photos*; scraping their site and third-party sites (Yelp/Instagram) is often blocked. Result: many demos go photo-less. Is photo-less the right answer, or should we invest in a better acquisition path (licensed stock matched per-business, AI image generation, a vision model curating the best scraped frames, asking the client for photos as part of outreach)? What would *you* do?
2. **Deterministic vs. LLM copy.** Copy is template-deterministic unless an API key is present. Given LLM costs are now low, should copy authoring (and research extraction) lean on an LLM by default? What's the right division between deterministic structure and LLM-written prose to maximize "feels custom" without hallucination?
3. **Sameness within a category.** Sites in the same category can still look alike (e.g., a narrow brand-color palette → multiple wineries in near-identical burgundy; sibling de-dup only triggers on color+font *combos*, not color alone). How should brand/visual differentiation actually be driven?
4. **Scraped-junk fragility.** Third-party widgets leak coupon fine-print and JS template literals into scraped copy; we catch it with regex gates but it still requires re-runs. Better extraction strategy?
5. **Pipeline weight.** ~25 scripts / ~11k LOC. Where is the likely dead weight or over-engineering? What would you consolidate or delete?
6. **Gate calibration.** Is "photo-less requires a hard trust signal (rating/testimonial/credential)" the right bar? Are the resolution floors (1600/1000/900/640) and the perf budget sensible? Any gate that's likely to produce false negatives (good sites flagged) or false positives (bad sites passed)?
7. **The core premise.** Is "generate a polished demo and cold-email it" even the highest-leverage shape? Is there a fundamentally better way to use this asset (the one-JSON-file, multi-page, gated generator) for local-business lead-gen?

For each suggestion, note the expected impact (conversion / quality / speed / cost / maintenance) and the rough effort. Don't be shy about saying a whole subsystem should be cut or rebuilt.
