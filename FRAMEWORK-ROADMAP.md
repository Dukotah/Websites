# Framework Roadmap — "Premium" → "Ultra Premium Deluxe"

Synthesis of a 74-finding, 7-agent deep review of the shared Astro website-factory
framework (`sites/demo-gallery/src/premium/**`, `src/lib/**`, `src/styles/**`, and
the `scripts/**` pipeline + QA gates). The goal is the **builder**, never the site
data. Every item below is a concrete, independently-shippable change to the SHARED
framework, scoped for one agent to implement AND verify in a single pass.

## The quality bar (what "ultra premium deluxe" means here)
- Hand-built reference: `copperbaytech.com` (owner-authored) and the AVISP pitch
  site at `../avisp/src` — layered depth, authored motion, type with personality,
  brand-tuned color, specific (never filler) copy.
- Awwwards-caliber agency polish: choreographed (not mechanical) motion, composed
  asymmetric layouts, visual hierarchy that guides the eye.
- **Hard constraints (anti-slop contract):** token-driven (`--p-*` only), generic
  across all categories, no per-business hardcoding, no new dependencies. Build
  green (`npm run build`, 160 pages) + `npx astro check` = 0 errors. Perf gate
  (`npm run perf-budget`): perf >= 90, LCP <= 2500ms, CLS <= 0.1, TBT <= 200ms,
  weight <= ~684KB. Reduced-motion safe at both JS and CSS layers. No FOUC (LCP
  hero paints immediately). **Never apply a perpetual transform/scale to a large
  photo** (one-time GPU-raster → upsampling = blur on real hardware).

## How findings were deduped
- Hero scrim variety: 3 findings ("Scrim Variants Lack Variety", "Hero Lacks Depth
  Variation Per Business", "focal-aware scrim") merged into **R3 (focal-aware scrim
  + per-site tonal shift)** — one CSS change solves all three.
- Editorial/photo-less hero presence: 4 findings ("bespoke anchors", "portrait
  variation", "motif color adapt", "monogram/motif opacity") merged into **R2**.
- Motion choreography: word-reveal stagger (3 findings) + hero cascade rhythm +
  aurora sync + skew damping merged into **R1 (motion choreography pass)** and
  **R6 (aurora/parallax tuning)**.
- Per-vertical/per-archetype binding: type rhythm, spacing cadence, motion voice,
  shadow flavor merged into **R8 (brand-driven depth ladder)** and **R12
  (archetype/vertical motion + rhythm binding)**.
- Deterministic copy clichés: hero "count on" + service-desc "Count on us" +
  richness gate merged into **R4 (kill the cliché copy fallbacks)** and **R10
  (richness-quality gate)**.
- New QA gates (mobile, link-validity, duplicate-content, layout-coherence, axe,
  bundle, font-render, motion-regression, social-proof, vision-congruence) ranked
  individually by impact-per-effort under **R7, R11, R14–R18**.
- The 4 "green / no change" motion findings (reduced-motion completeness, aurora
  fallback chain, parallax ratio safety, magnetic reduce-gate) are **already
  correct** — no roadmap item; preserve them.

---

## Tier 1 — framework-wide wins, low risk, high impact (do first)

### R1 — Motion choreography pass: semantic stagger + tightened word-reveal
**Area:** motion · **Risk:** low · **Files:** `HeroSection.astro`, `premium.css`
The hero word-reveal uses a flat 55ms linear stagger with a 0.7em Y-offset
(HeroSection ~line 334-341); the content cascade uses even 90ms steps. Both read
"software default," not authored, and the long durations flatten on Slow-4G.
**Specific changes:** reduce word stagger 55ms→40ms; reduce Y-offset 0.7em→0.45em;
add a primary-CTA emphasis (it lands last with a subtle scale-in). Keep
transform/opacity-only (compositor-gated, zero CLS). Verify `perf-budget` (no
regression — transform-only) and reduced-motion still collapses to instant.
**Impact:** the signature motion moment reads choreographed and snappier on real
networks across every site.

### R2 — Photo-less editorial hero: confident brand anchors + adaptive motif color
**Area:** hero · **Risk:** low · **Files:** `HeroSection.astro`, `tokens.ts`/`PremiumBase.astro`
~30% of sites use the photo-less editorial hero; today the monogram is 0.5 opacity
with a thin stroke and the motif is a 0.22-opacity ghost that vanishes on dark
brands and over-saturates on bright ones (HeroSection ~line 499, 534).
**Specific changes:** (1) bump monogram opacity to ~0.6 with a stronger gradient
fill; (2) bump motif opacity to ~0.34; (3) emit a computed `--p-motif-opacity` and
`--p-motif-blend` token from brand HSL lightness (>50% → lower opacity/`multiply`,
<50% → higher opacity/`screen`) so the motif reads on every palette; (4) add
deterministic per-slug variation (motif rotate ±12deg via seeded data-attr) so
five same-category sites stop looking stamped. Reduced-motion: no rotation.
**Impact:** elevates the perceived bespoke-ness of a third of the gallery; removes
the "missing photo" read and the invisible/harsh-motif failure modes.

### R3 — Focal-point-aware scrim with per-site tonal shift
**Area:** hero · **Risk:** low · **Files:** `HeroSection.astro`
The 3 scrim variants are near-identical dark navy washes; flat opacity can wash out
sky-heavy crops. The hero already stores `image.focal` but the scrim ignores it.
**Specific changes:** compute a `--scrim-bias` from the focal Y (focal high → bias
darkening to bottom; focal low → bias top) and feed it into the gradient anchors;
give each of the 3 deterministic variants a real tonal identity (warm navy / cool +
accent radial / extra-warm). Pure CSS, compositor-only, no JS, ~10-12 lines.
**Impact:** every hero photo reads with intentional, protective depth; low-contrast
sources stop looking washed; the 3 variants finally differ perceptibly.

### R4 — Kill the cliché copy fallbacks (gate the "count on" family)
**Area:** pipeline · **Risk:** low · **Files:** `author-premium.mjs`, `audit.mjs`
`defaultHeroHeading` ships `"<name> — <category> you can count on"` (line 738) and
`SERVICE_DESC[2]` ships `"Count on us for…"` (line 744) — the #1 "AI batch" tell,
already caught by `audit.mjs` HEADLINE_CLICHES but only as a warning.
**Specific changes:** (1) replace the hero fallback with a slug-hash rotation of
2-3 specific, category-aware alternatives AND require an established year OR a real
research file for `ready` (else force `needs-review`); (2) replace the "Count on
us" service template with category-specific copy; (3) promote HEADLINE_CLICHES from
warn → critical gate when no research file backs the site. Build green; gate exits
non-zero only on un-backed cliché.
**Impact:** removes the most visible batch tell; raises the floor on every
research-thin site without an API key.

### R5 — Universal tactile button lift (close the AVISP hover gap)
**Area:** design-system · **Risk:** low · **Files:** `premium.css`
Only the magnetic CTA and `.btn--primary:hover` lift; AVISP's buttons have a
confident lift+shadow+micro-scale on every primary button. The base lift is already
hover/reduced-motion gated (premium.css ~line 219).
**Specific changes:** add `scale(1.02)` to the existing `.btn--primary:hover` lift
(already `(hover:hover)`-gated and compositor-only); keep magnetic drift
`data-magnetic`-only. No perf cost (transform + already-optimized shadow).
**Impact:** every interaction feels more intentional; closes a clear "feels less
polished than AVISP" gap on desktop.

### R6 — Aurora + parallax tuning: faster sync, visible depth, smooth skew
**Area:** motion · **Risk:** med · **Files:** `hero-cinematic.ts`, `premium.css`
Three small perceptual misses: aurora idle timeout is 800ms + 900ms fade (long
static pause on slow nets, line 457/708); parallax is 0.18x — perceptually inert;
velocity skew hard-clamps at ±3.2deg (mechanical snap, line 398).
**Specific changes:** (1) idle timeout 800ms→450ms and aurora fade 900ms→600ms so
it syncs with the word-reveal; (2) raise hero-bg parallax 0.18→0.26 (stays well
under the GPU-raster-trap threshold — it's translate-only, photo still rests at
scale(1)); (3) ease the skew toward target (`lerp(skewCurrent, target, 0.18)`)
instead of a hard clamp. **MUST** re-run `perf-budget` (one extra lerp/frame is
negligible but TBT-sensitive). Reduced-motion: unchanged no-op.
**Impact:** the hero feels weighted and alive in sync; parallax becomes perceptible
on real devices without touching the known blur trap.

---

## Tier 2 — section depth + composition (the "all sections look the same" fix)

### R7 — Mobile responsiveness gate (highest-value missing gate)
**Area:** gate · **Risk:** low · **Files:** `sites/demo-gallery/scripts/screenshot-audit.mjs`
Screenshots are desktop-only (1440px); the 480/560/820px breakpoints are
programmatically untested. ~50% of real traffic is mobile.
**Specific changes:** extend the existing headless-Chrome harness to also shoot
375x667 + 768x1024 and assert: no horizontal overflow, base text >= 16px on mobile,
touch targets >= 44x44 (esp. StickyContactBar at its 560px boundary). Key-free,
DOM/CSS measurement. Fail-soft when Chrome can't launch.
**Impact:** catches regressed media queries / overflow / tiny tap targets before
they ship — currently invisible.

### R8 — Brand-driven depth ladder (5-6 shadow levels, palette-tinted)
**Area:** design-system · **Risk:** med · **Files:** `tokens.ts`, `premium.css`
`--p-shadow-sm/md/lg` are hard-coded on a fixed blue tint (premium.css 70-72) — a
medical site and a tattoo site cast identical shadows.
**Specific changes:** in `tokens.ts`, derive shadow color from the brand palette via
`color-mix` and emit a 5-6 step ladder (`--shadow-xs`…`--shadow-2xl`) parametrized
by depth; re-point the `--p-shadow-*` aliases at it. Keep existing names working
(back-compat). Verify contrast/legibility unchanged and no CLS.
**Impact:** per-site shadow flavor → instant cross-site distinctiveness at zero
per-component cost; raises mid-page depth toward AVISP caliber.

### R9 — "Featured" variant for grids + directional reveal choreography
**Area:** sections · **Risk:** low · **Files:** `FeaturesSection.astro`, `ServicesSection.astro`, `PricingSection.astro`, `TestimonialsSection.astro`, `premium.css`
The directional reveal primitives (`[data-reveal='left'|'right'|'scale']`) exist but
only the hero figure uses them; Features/Services/Pricing/Testimonials grids are
visually uniform (no lead-card anchor, no row alternation).
**Specific changes:** (1) add a token-driven "featured/lead" treatment (larger
tile, deeper shadow via R8, brand-tint panel) applied to the first item of
Features/Pricing; (2) rotate reveal direction per row/card (rows alternate
left/right, grids checkerboard). All seeded/deterministic, compositor-only.
**Impact:** kills the "flat grid = template" read on the highest-traffic sections;
uses primitives the framework already ships for free.

### R10 — Richness-quality gate (close the "scraped but generic" loophole)
**Area:** pipeline · **Risk:** med · **Files:** `scrape-site.mjs`, `facts.mjs`, `audit.mjs`
`scoreRichness` sums quantity, not quality — a thin plumbing site with 3 one-word
services + a stock pipe photo + one-sentence about scores ~55 and ships `ready`.
**Specific changes:** (1) add a QUALITY dimension — about paragraphs must be
substantial (>~150 chars) and not match the templated/cliché regex; (2) only award
photo points for HIGH-quality photos (existing `scorePhoto` > 0.6); (3) require a
`confirmed:true` research file for `ready` when richness lands 35-65 (below 35 →
needs-review as today; 65+ → ready). Gate via audit cross-check.
**Impact:** holds ~10-15% of monthly batches for review instead of shipping a
generic scrape — the single biggest deliver-quality lever in the pipeline.

### R11 — Layout-coherence + composition gate
**Area:** gate · **Risk:** low · **Files:** `audit.mjs`
No gate validates composition quality: a page can be >50% CTA sections, a "rows"
services layout with no images, or an editorial-hero + callout + cta weak first
scroll, and still pass.
**Specific changes:** extend `audit.mjs` to flag: pages >50% CTA/low-content
sections; rows-layout services with zero images (unless `fallbackOk`); first 3
sections all non-photo-dependent; repeated section kinds (3+ stats, 2+
testimonials) within one page. Info/warn for soft cases, critical for blank-hero.
**Impact:** catches the templated/low-effort composition that mechanical gates miss
— exactly where "sameness" hides.

---

## Tier 3 — section polish + remaining gates (steady craft gains)

### R12 — Per-archetype / per-vertical motion voice + spacing cadence
**Area:** design-system · **Risk:** med · **Files:** `art-direction.ts`, `tokens.ts`
Motion easing/duration is one global value per level; spacing falls back to static
density tokens even though per-vertical `--space-*` is emitted. A towing site and a
winery move and breathe identically.
**Specific changes:** bind motion curve to archetype/vertical (utility → snappier
spring, editorial → slower ease-out, medical → ultra-smooth restrained); make
section padding/gap compose from the emitted `--space-*` ladder. Token-only,
verify perf + reduced-motion.
**Impact:** motion + rhythm become brand voice, not a global lever — pages read
distinct beyond color/font.

### R13 — Section depth + tonal variation: Story/Stats/Testimonials/Gallery
**Area:** sections · **Risk:** low · **Files:** `StorySection.astro`, `StatsSection.astro`, `TestimonialsSection.astro`, `GallerySection.astro`, `premium.css`
Mid-page sections are flat: no depth devices, all-equal cards, story always on
plain paper, testimonials over-clamped to 7 lines (cuts authentic 60-100 word
reviews), gallery photos under-saturated.
**Specific changes:** (1) optional `tone='light-deep'` on Story (whisper-tinted
band); (2) featured-testimonial treatment + clamp 7→10 lines with max-height; (3)
gallery saturation floor 1.04→~1.08 with a category-aware warm nudge; (4) stronger
featured-image shadow + staggered tile rhythm. All token-driven, GPU-cheap.
**Impact:** mid-page reads composed and inviting; real reviews render complete.

### R14 — Link-validity gate (internal + format)
**Area:** gate · **Risk:** low · **Files:** `premium-validate.mjs`
A CTA pointing at a non-existent page, or a malformed `tel:`/`mailto:`, ships
silently and 404s at runtime.
**Specific changes:** extend `premium-validate.mjs` to parse every href in configs,
assert internal links match `/s/<slug>/<page>/` and the page exists in `pages[]`,
and validate `mailto:`/`tel:` formats. Static, key-free; optional `--deep` for
live 200 checks.
**Impact:** eliminates a class of silent runtime-404s before publish.

### R15 — Duplicate-content gate (across sites)
**Area:** gate · **Risk:** low · **Files:** `sameness-check.mjs`
`sameness-check` catches identical fold *images* but not identical *text* — a
copy-paste author mistake can propagate testimonials/service copy across 20+ sites.
**Specific changes:** add a copy-dup pass — SHA256 every text field across all
configs (flag exact matches) + Jaccard/cosine on long fields (flag >85% similar) +
verbatim section copy reused across a single site's pages. Hashing only, key-free.
**Impact:** catches bulk-generation copy bleed that's currently invisible.

### R16 — Type/font rendering gate
**Area:** gate · **Risk:** low · **Files:** `audit.mjs`, `font-faces.ts`
A 404'd woff2 silently falls back to system serif (breaks brand); a requested
weight that doesn't exist ships unaudited.
**Specific changes:** verify every `@font-face` URL resolves on disk, assert >=400
and one bold weight exist, and flag headlines whose rendered line-height < 1.4 on
mobile. Read dist CSS/HTML directly; key-free.
**Impact:** prevents silent brand-font failures.

### R17 — Bundle / per-asset-type budget gate
**Area:** gate · **Risk:** low · **Files:** `lighthouse.mjs`
The 684KB budget is a single total; a leaky full-res JPG or CSS drift erodes it
with no per-type alarm.
**Specific changes:** measure per-type bytes in `dist/s/<slug>/` (warn images
>500KB, CSS >50KB, JS >100KB) and report `premium.css` LOC as a drift metric.
Key-free.
**Impact:** early warning on weight regressions before they cross the hard gate.

### R18 — Motion-regression gate (protect the TBT budget)
**Area:** gate · **Risk:** med · **Files:** `lighthouse.mjs`, harness
A future component adding a parallax/scale effect without the visibility gate could
push TBT 0→180ms intermittently — not reliably caught by Lighthouse sampling.
**Specific changes:** add a gate that scans built CSS for perpetual `transform:
scale` on large elements (the Ken-Burns trap) and verifies rAF loops tear down on
`astro:before-swap`. Static scan + optional throttled frame check. Key-free.
**Impact:** locks in the hard-won TBT discipline against future motion additions.

---

## Already correct — preserve, do not regress (audit trail)
- Reduced-motion is gated at BOTH JS init and CSS `@media` layers (model pattern).
- Aurora fallback chain WebGL → 2D canvas → static gradient = zero FOUC.
- Parallax 0.18/-0.06 + photo settling to `scale(1)` avoids the GPU-raster trap.
- Magnetic CTA bails under reduced-motion. Count-up is idle-deferred.

When changing any motion/JS/image code in `src/premium/**`, ALWAYS re-run
`npm run perf-budget` and confirm `npx astro check` = 0 errors before handing off.
