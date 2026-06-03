# Design System Spec — Website Factory v2 ("Unique-by-Default")

Status: build contract. This document is the authoritative spec for the ground-up
redesign of the demo-gallery factory. It supersedes the ad-hoc 2-color / 3-layout
system described in `CLAUDE.md` and `src/types.ts`.

The problem we are killing: every generated site shares one page skeleton, one
typographic identity, two brand colors, and a tiny section vocabulary that the
generator barely uses. Output looks like AI slop. This spec replaces that with a
**per-business design system**: self-hosted fonts, a full generated palette, a
per-business shape + motion language, a large library of rich composable sections,
and a **deterministic composition engine** that assembles a distinct site for each
slug from its REAL scraped research.

Hard constraints honored throughout:

- Astro 5, fully static output, deploys via `git push` to Vercel.
- **No paid API keys at build time.** Fonts are self-hosted via `@fontsource*`
  (npm, no key). Palette/shape/motion are computed in pure JS at build.
- Fast (good Lighthouse) and accessible (WCAG AA contrast, `prefers-reduced-motion`
  safe, keyboard reachable).
- **Backward compatible.** Every existing prospect JSON (which has only
  `theme.brand` / `theme.brandDark` and no `fontId`/`artDirection`) must still
  render with sensible auto-derived defaults. New fields are all optional.
- **Real data only.** The composition engine and every "rich" section render only
  from facts present in the config (which the generator fills from the scrape).
  No section is emitted when its data is absent — no fabricated stats/teams/menus.

---

## 1. Architecture overview

```
prospect JSON (config)
   │  theme.brand (+ optional artDirection, fontId, tokens, palette, sections[])
   ▼
art-direction.ts  ──►  resolveArtDirection(config)  → ArtDirection (palette, fontId, shape, motion, density)
   │                         (deterministic: seeded by slug + brand + category)
   ▼
tokens.ts         ──►  artDirectionToCss(ad)        → string of CSS custom properties
   │
   ▼
BaseLayout.astro  ──►  injects <style>:root{…tokens…}</style>  +  @fontsource imports for fontId
   │
   ▼
compose.ts        ──►  composePage(config, ad)      → PagePlan { hero variant, ordered SectionInstance[] }
   │                         (deterministic: seeded by slug; gated by available real data)
   ▼
[slug].astro      ──►  renders Header → HeroX → Section components (from PagePlan) → Footer
   │
   ▼
SectionRenderer.astro  ──►  switch on section.type → the right rich component
```

Two seeds, one source of determinism: a 32-bit FNV-style hash of the slug (already
present as `layoutFor`'s hash). All "random but stable" choices (font when not set,
shape family, motion level, hero variant tie-breaks, section ordering jitter) derive
from this seed so a re-run produces the identical site, but two different slugs get
visibly different sites.

---

## 2. Design tokens (`src/lib/tokens.ts` + injected `:root`)

Today there is ONE global token set in `global.css` (one serif, one sans, radius
4px, one palette). v2 moves all *visual-identity* tokens to **per-site injected
custom properties**, computed from the resolved `ArtDirection`. `global.css` keeps
only structural/reset rules and consumes the tokens via `var()`.

### 2.1 Token registry

Each token is a CSS custom property set on `:root` by `BaseLayout`. Column "source"
= how it is generated.

| Token | Controls | Source |
|---|---|---|
| `--brand` | primary brand color | config.theme.brand |
| `--brand-dark` | deep brand / dark surfaces | palette (derived) |
| `--brand-contrast` | text color that sits on `--brand` | palette (AA-picked black/white) |
| `--accent` | secondary accent (links hover, small flourishes) | palette (analogous/complementary) |
| `--accent-contrast` | text on `--accent` | palette |
| `--bg` | page background | palette (tinted neutral) |
| `--bg-alt` | alternating section background | palette (tinted neutral, 1 step) |
| `--bg-deep` | dark feature background (dark sections) | palette |
| `--surface` | card/panel background | palette (paper) |
| `--surface-2` | nested panel | palette |
| `--text` | body text | palette (AA on `--bg`) |
| `--text-muted` | secondary text | palette (AA-min on `--bg`) |
| `--text-on-dark` | text on `--bg-deep`/scrims | palette |
| `--border` | hairlines, dividers | palette (low-contrast tint) |
| `--ring` | focus ring color | `--accent` at full sat |
| `--font-display` | headings | fontRegistry[fontId].display stack |
| `--font-body` | body + UI | fontRegistry[fontId].body stack |
| `--fw-display` | display weight | fontRegistry typeScale |
| `--fw-body` / `--fw-bold` | body / bold weights | fontRegistry |
| `--tracking-display` | display letter-spacing | typeScale |
| `--tracking-eyebrow` | eyebrow tracking | typeScale |
| `--leading-display` | display line-height | typeScale |
| `--leading-body` | body line-height | typeScale |
| `--step--1 … --step-6` | modular type scale steps (clamp()) | typeScale ratio (see 2.2) |
| `--radius` | base corner radius | shape language |
| `--radius-lg` | large radius (cards, media) | shape language |
| `--radius-pill` | pill radius | shape (999px or sharp) |
| `--border-weight` | default hairline px | shape |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | elevation | shape (soft vs hard vs none) |
| `--section-pad` | vertical section rhythm | density |
| `--gutter` | horizontal page gutter | density |
| `--maxw` | content max width | density |
| `--grid-gap` | grid gaps | density |
| `--motion-fade` | base fade duration | motion level (0 if reduce) |
| `--motion-rise` | translate distance for reveal | motion level |
| `--motion-ease` | easing curve | motion language |
| `--frame-style` | media frame treatment selector (used by `[data-frame]`) | shape |
| `--pattern-opacity` | decorative pattern intensity | art direction |

### 2.2 Modular type scale

`typeScale` defines a ratio (1.2 minor-third → 1.333 perfect-fourth → 1.5) and a
base. Steps are emitted as fluid `clamp()` values:

```
--step-0:  clamp(<min>, <vw>, <base>);            /* body */
--step-N:  base * ratio^N                          /* headings ascending */
--step--1: base / ratio                            /* small print */
```

Tight/editorial scales use a larger ratio + negative display tracking; friendly
scales use a smaller ratio + neutral tracking. This is what makes a winery and a
tow company typographically different even before color.

### 2.3 Backward compatibility

`global.css` retains fallback values for every token so a page that somehow renders
without the injected block still looks intact. `resolveArtDirection` always returns
a complete ArtDirection, even for a config that has only `theme.brand` — so legacy
JSON renders with a full computed identity (derived from brand + category + slug).

---

## 3. Fonts (`src/lib/fonts.ts`, self-hosted via `@fontsource`)

No Google Fonts CDN, no API key. We add `@fontsource` / `@fontsource-variable`
packages as dependencies; `BaseLayout` imports only the families for the resolved
`fontId` (Astro tree-shakes/bundles the woff2 into the build). Each pairing is a
display face + a body face chosen to feel native to a *kind* of business.

### 3.1 Registry shape

```ts
interface FontPairing {
  id: string;
  display: string;          // CSS font-family stack for headings
  body: string;             // CSS font-family stack for body
  fontsourcePackages: string[]; // npm packages to import (variable preferred)
  mood: string;             // human label
  categories: string[];     // business categories this suits (matchmaking)
  typeScale: 'tight' | 'editorial' | 'friendly' | 'geometric' | 'humanist';
}
```

### 3.2 Pairings (10)

| id | display | body | mood | categories | typeScale |
|---|---|---|---|---|---|
| `editorial-serif` | Fraunces (var) | Newsreader / Source Serif | refined editorial | winery, cafe, salon, default | editorial |
| `modern-grotesk` | Space Grotesk | Inter (var) | crisp modern | plumbing, auto-repair, tech, default | geometric |
| `warm-humanist` | Bricolage Grotesque | Figtree | friendly, approachable | cafe, salon, landscaping | humanist |
| `rugged-slab` | Bitter / Zilla Slab | Inter | sturdy, blue-collar | towing, auto-repair, construction | tight |
| `classic-trad` | Playfair Display | Lora | established, traditional | salon, winery, law, default | editorial |
| `clean-sans` | Albert Sans | Albert Sans | minimal, neutral | plumbing, default, tech | geometric |
| `organic-serif` | Spectral | Spectral | botanical, calm | landscaping, winery, wellness | humanist |
| `bold-display` | Archivo (var) | Archivo | confident, loud | auto-repair, towing, fitness | tight |
| `boutique-contrast` | Cormorant Garamond | Mulish | luxe, high-contrast | salon, winery, boutique | editorial |
| `handcrafted` | Schibsted Grotesk | Schibsted Grotesk | crafted, indie | cafe, bakery, makers | friendly |

(8–12 range satisfied; all are on @fontsource. Variable packages preferred to keep
weight axes flexible with one file.)

### 3.3 Selection

`resolveArtDirection` picks `fontId` in this order:
1. `config.fontId` if explicitly set (author override).
2. The pairing whose `categories` includes the business category, choosing
   deterministically among matches by slug seed (so two cafes differ).
3. Fallback to a default-tagged pairing by seed.

Self-hosted import pattern in `BaseLayout` (only the resolved family loads):

```astro
---
import { FONT_IMPORTS } from '../lib/fonts';
const ad = resolveArtDirection(config);
---
{/* Astro statically resolves these; only used families ship */}
```
Because Astro needs static imports, we import all variable packages once in a
central `src/lib/font-faces.ts` (variable fonts are small; ~10 families variable ≈
acceptable, and unused subsets are not requested by any page so the browser only
downloads the family referenced by `--font-display`/`--font-body`). The CSS
`font-family` cascade plus `font-display: swap` (default in @fontsource) means only
referenced families are actually fetched by the browser.

---

## 4. Palette system (`src/lib/palette.ts`)

A full, accessible palette derived from a single brand seed. Pure JS color math
(no deps): hex → OKLCH-ish via sRGB→linear→Lab approximation, or a compact HSL
implementation. We use **HSL + WCAG luminance** (sufficient, dependency-free).

### 4.1 Derivation rules

Given `brand` (and optional `theme.brandDark`):

1. Parse brand → H, S, L.
2. `brand-dark` = brand at L≈18–24%, S boosted slightly (or use provided
   `brandDark`).
3. `accent` = analogous (H ± 25–40°) OR complementary (H + 180°) depending on the
   site's `accentStrategy` (seeded): analogous = harmonious, complementary = punchy.
4. Neutrals are **brand-tinted**, not pure gray: `bg`/`bg-alt`/`surface` use the
   brand hue at very low saturation (4–8%) and high lightness; this is what makes a
   green-brand site feel different from a red-brand site in its whites.
5. `bg-deep` = a near-black tinted with brand hue (L 10–16%).
6. **Contrast pass (mandatory):** for every text-on-bg pair, compute WCAG contrast
   ratio; nudge text lightness until ≥ 4.5:1 (body) / ≥ 3:1 (large display).
   `brand-contrast`/`accent-contrast` pick black or white by luminance.
7. Two neutral "temperaments" (seeded): warm (cream/paper) vs cool (porcelain) —
   adds variety beyond hue.

`derivePalette(brand, opts)` returns a `Palette` object whose keys map 1:1 to the
color tokens in §2.1. It is fully deterministic and never throws (bad hex → safe
default neutral palette).

### 4.2 Presets (curated seeds for the generator's category fallback)

When the scrape yields no brand color, the generator seeds from a category preset
(below) instead of the old flat 2-color presets. These are *seeds* — `derivePalette`
still builds the full palette around them.

| id | mood | colors (brand, accent, deep, paper) |
|---|---|---|
| `clay-warm` | earthy, cafe | `#c2683a`, `#3f7d6e`, `#2b211b`, `#f7f1e8` |
| `vineyard` | winery, deep | `#7b2d3a`, `#b9893f`, `#241318`, `#f6efe6` |
| `slate-utility` | plumbing/utility | `#1f6feb`, `#f08a24`, `#14233a`, `#f3f6fb` |
| `recovery-red` | towing/auto | `#d4452a`, `#f2b417`, `#191d22`, `#f4f2ef` |
| `garden` | landscaping | `#2f8f3e`, `#caa43a`, `#16241a`, `#f1f5ee` |
| `boutique-rose` | salon | `#b5557f`, `#6a7bb0`, `#241a22`, `#f8eff3` |
| `ink-neutral` | default/pro | `#2b2b2b`, `#b6794a`, `#141414`, `#f6f4f1` |
| `coastal` | hospitality | `#1f7a8c`, `#e08a3c`, `#0f2a30`, `#eef6f6` |

### 4.3 Tokens emitted

All color tokens in §2.1 (`--brand`, `--brand-dark`, `--brand-contrast`,
`--accent`, `--accent-contrast`, `--bg`, `--bg-alt`, `--bg-deep`, `--surface`,
`--surface-2`, `--text`, `--text-muted`, `--text-on-dark`, `--border`, `--ring`).

---

## 5. Shape & motion language (`src/lib/art-direction.ts`)

### 5.1 Shape families (seeded)

| family | radius | borders | shadow | media frame |
|---|---|---|---|---|
| `soft` | 14px / 24px | thin | soft layered | rounded, soft shadow |
| `sharp` | 0 | 1–2px solid | none/hard | square, hairline rule |
| `editorial` | 2px | hairline + rules | none | full-bleed + caption |
| `rounded-pill` | 999px controls, 18px cards | thin | soft | rounded with thin frame |
| `framed` | 4px | 2px solid frame | hard offset | bordered "gallery" frame |

Each family sets `--radius*`, `--border-weight`, `--shadow-*`, and `--frame-style`
(consumed by `[data-frame]` media wrappers). Family chosen from shape preference per
category + slug seed.

### 5.2 Motion language (reduced-motion safe)

Three levels, seeded but capped by category seriousness (towing/plumbing default to
`subtle`; cafe/salon/winery may use `expressive`):

- `none` — no transitions beyond focus.
- `subtle` — 160–220ms fades, 8–12px rise on scroll-in.
- `expressive` — 240–360ms, 16–24px rise, slight parallax on hero media, staggered
  reveals.

Implementation: a single tiny `src/scripts/reveal.ts` using `IntersectionObserver`
to add `data-revealed` (CSS does the animation via tokens). Hard rule at the top of
`global.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  [data-reveal] { opacity: 1 !important; transform: none !important; }
}
```
`--motion-*` tokens are zeroed when motion is `none`. No parallax/JS effect runs if
the media query matches (the script checks `matchMedia('(prefers-reduced-motion: reduce)')`
and no-ops).

### 5.3 Density

`compact` / `standard` / `spacious` set `--section-pad`, `--gutter`, `--maxw`,
`--grid-gap`. Editorial/luxury fonts → spacious; utility → standard/compact.

---

## 6. Section catalog (`src/components/sections/*`)

A large library of rich, composable sections. Each is an Astro component that
renders only from its own props (real data) and styles itself with the global
tokens. The `Section` discriminated union in `types.ts` is expanded; legacy types
keep working. `SectionRenderer.astro` (replaces today's `Sections.astro`) switches
on `type`.

Every section accepts a shared optional envelope: `{ eyebrow?, heading?, intro?,
tone?: 'default'|'alt'|'deep'|'brand', align?: 'left'|'center' }` plus type-specific
fields. `tone` chooses the surface (maps to bg tokens) so adjacent sections
alternate without the renderer hardcoding it.

Existing (kept, restyled to tokens): `stats`, `testimonials`, `faq`, `list`, `cta`.

New rich sections:

| type | component | purpose | when to use (real-data gate) |
|---|---|---|---|
| `gallery` | `GallerySection` | photo-forward masonry/grid of their real photos | ≥3 real (non-stock) images |
| `feature-split` | `FeatureSplit` | alternating image + copy rows (each a real service/specialty) | ≥1 service w/ description + an image |
| `timeline` | `TimelineSection` | founding → milestones story | established year and/or about milestones |
| `menu` | `MenuSection` | priced/grouped menu (cafe/winery list) | scraped menu/price groups |
| `team` | `TeamSection` | owner/staff cards | named people from scrape |
| `map` | `MapSection` | static map embed + address + hours | address present (uses static OSM tile / no-key embed) |
| `press` | `PressSection` | logos/quotes from press or awards | press mentions/awards scraped |
| `bigquote` | `BigQuoteSection` | one oversized pull-quote (best review or mission line) | a strong testimonial or mission line |
| `services-detailed` | `ServicesDetailed` | richer service cards w/ icons + descriptions | services with real descriptions |
| `service-area` | `ServiceAreaSection` | list of towns/areas served (chips + map) | multi-town service area |
| `hours-contact` | `HoursContactSection` | hours table + contact + CTA combo | hours present |
| `process` | `ProcessSection` | numbered "how we work" steps | scraped/inferable process steps |
| `logos` | `LogosStrip` | certifications/brands they service | scraped certs/brands |
| `before-after` | `BeforeAfter` | paired transformation images | two paired images (landscaping/auto/salon) |
| `feature-grid` | `FeatureGrid` | 3–6 highlight cards (icon + label + line) | highlights present (always available) |

Hero is treated separately (see §7) but lives alongside.

Component conventions (match existing code): top-level `<section class="section">`,
inner `.container`, scoped `<style>`, `tone` → `data-tone` attribute styled by token;
all colors/spacing via `var(--…)`; media wrapped in `[data-frame]`; reveal via
`data-reveal`.

---

## 7. Hero variants (`src/components/heroes/*`)

Today: 3 heroes selected by `layout`. v2: a set of hero *variants* selected by the
composition engine from art direction + available media, decoupled from section
order.

| variant | description | needs |
|---|---|---|
| `cinematic` | full-bleed photo, bottom-anchored copy, scrim (today's `Hero`) | strong hero image |
| `split` | text panel + photo (today's `HeroSplit`) | hero image |
| `editorial` | centered magazine type, thin rules, small image or none (today's `HeroEditorial`) | works without photo |
| `panel` | solid brand/deep color panel, oversized type, no photo | no usable photo |
| `collage` | 2–3 photo collage + headline | ≥2 real images |
| `statement` | huge type + single keyline + CTA, minimal | luxury/editorial fonts |

Selection: if no real photo → `panel`/`editorial`/`statement` (by seed); if 1 photo
→ `cinematic`/`split`; if ≥2 → may pick `collage`. Each hero reads tokens so the
same variant looks different per business.

---

## 8. Composition engine (`src/lib/compose.ts`)

Deterministic, data-gated assembly of a distinct page per slug.

### 8.1 Algorithm

```
composePage(config, ad):
  seed = hash(slug)
  inventory = detectAvailableData(config)   // which sections CAN exist (real data)
  hero = pickHero(ad, inventory, seed)
  recipe = RECIPES[category] ?? RECIPES.default   // ordered preferred section types
  plan = []
  for type in recipe:
     if inventory.supports(type):
        plan.push(instantiate(type, config))      // pulls the real fields
  // Always-available connective sections (about, services, contact) are slotted
  // per recipe; tone alternates default/alt/deep deterministically.
  plan = assignTones(plan, seed)
  plan = ensureMinimum(plan)   // never emit a 2-section page; backfill from highlights/feature-grid/cta
  return { hero, sections: plan }
```

Key rules:
- **Data-gated:** a section is only added if `inventory` proves the real data exists.
  No fabricated content, ever. (`detectAvailableData` checks images count, service
  descriptions, hours, testimonials, established, social, etc.)
- **Deterministic:** ordering jitter, tone assignment, and ties all use `seed`.
- **Distinct silhouette:** recipes differ by category; seed shuffles within
  swap-safe groups so two same-category sites still differ.
- **Backward compatible:** if `config.sections` is explicitly authored, the engine
  respects it (author override) and only fills hero + connective tissue. Legacy
  configs with no new fields still produce a full, varied page from derived art
  direction + their existing about/services/highlights.

### 8.2 Recipes (per category)

Each recipe: a hero default + an ordered list of preferred section types. The engine
keeps only those whose data exists, so thin businesses naturally get shorter sites.

| category | heroVariant | sectionOrder (preferred) |
|---|---|---|
| winery | cinematic | about, gallery, bigquote, menu, feature-split, stats, testimonials, map, cta |
| cafe | collage | about, menu, gallery, feature-grid, testimonials, hours-contact, map, cta |
| towing | panel | feature-grid, services-detailed, stats, service-area, testimonials, process, hours-contact, cta |
| plumbing | split | services-detailed, feature-grid, process, stats, service-area, testimonials, faq, hours-contact, cta |
| auto-repair | split | services-detailed, stats, before-after, feature-grid, testimonials, logos, faq, hours-contact, cta |
| salon | editorial | about, gallery, services-detailed, bigquote, team, testimonials, hours-contact, cta |
| landscaping | cinematic | feature-split, before-after, gallery, stats, process, testimonials, service-area, cta |
| default | split | about, feature-grid, services-detailed, stats, testimonials, gallery, faq, hours-contact, cta |

(`about`/`services`/`contact` always render via connective slotting even if a recipe
omits them, preserving the old guaranteed sections.)

---

## 9. Schema changes (`src/types.ts`)

All additions optional → backward compatible.

```ts
// NEW: art direction overrides (all optional; engine fills the rest)
export interface ArtDirectionConfig {
  fontId?: string;                 // pin a FontPairing id
  paletteId?: string;             // pin a palette preset id
  accentStrategy?: 'analogous' | 'complementary';
  shape?: 'soft' | 'sharp' | 'editorial' | 'rounded-pill' | 'framed';
  motion?: 'none' | 'subtle' | 'expressive';
  density?: 'compact' | 'standard' | 'spacious';
  neutralTemp?: 'warm' | 'cool';
}

// NEW: optional explicit token overrides (escape hatch)
export type TokenOverrides = Partial<Record<string, string>>;

// EXPANDED Section union — add the new rich types (each renders only from real data):
export type Section =
  | { type: 'stats'; tone?: Tone; items: { value: string; label: string }[] }
  | { type: 'testimonials'; /* …existing… */ }
  | { type: 'faq'; /* …existing… */ }
  | { type: 'list'; /* …existing… */ }
  | { type: 'cta'; /* …existing… */ }
  | { type: 'gallery'; eyebrow?; heading?; images: { src: string; alt: string; caption?: string }[] }
  | { type: 'feature-split'; rows: { heading: string; body: string; image?: string; imageAlt?: string }[] }
  | { type: 'timeline'; items: { year?: string; title: string; body?: string }[] }
  | { type: 'menu'; groups: { title: string; items: { name: string; price?: string; note?: string }[] }[] }
  | { type: 'team'; members: { name: string; role?: string; photo?: string; bio?: string }[] }
  | { type: 'map'; address: string; lat?: number; lng?: number; hours?: BusinessHours[] }
  | { type: 'press'; items: { quote?: string; source: string; logo?: string; href?: string }[] }
  | { type: 'bigquote'; quote: string; author?: string; source?: string }
  | { type: 'services-detailed'; items: { title: string; description: string; icon?: string }[] }
  | { type: 'service-area'; areas: string[]; note?: string }
  | { type: 'hours-contact'; hours: BusinessHours[]; phone?: string; cta?: { text: string; href: string } }
  | { type: 'process'; steps: { title: string; body?: string }[] }
  | { type: 'logos'; items: { label: string; logo?: string }[] }
  | { type: 'before-after'; pairs: { before: string; after: string; label?: string }[] }
  | { type: 'feature-grid'; items: { label: string; note?: string; icon?: string }[] };

export type Tone = 'default' | 'alt' | 'deep' | 'brand';

export interface ProspectConfig {
  // …all existing fields unchanged…
  layout?: 'classic' | 'split' | 'editorial';   // KEPT for back-compat; superseded by artDirection + compose
  artDirection?: ArtDirectionConfig;            // NEW
  tokens?: TokenOverrides;                       // NEW
  heroVariant?: 'cinematic'|'split'|'editorial'|'panel'|'collage'|'statement'; // NEW optional pin
  galleryImages?: { src: string; alt: string }[]; // NEW: extra real photos the generator collected
  theme: { brand: string; brandDark: string };  // unchanged
}
```

`resolveArtDirection(config)` reads `artDirection`/`tokens`/`fontId` if present,
else derives everything from `theme.brand` + category (inferred) + slug seed.

---

## 10. Dashboard scoring (`src/pages/index.astro` upgrade)

Replace the binary ready/needs-review with a **0–100 quality score** per demo plus a
letter grade, computed from real signals already present in the config. The card
shows score, grade, the brand/font/shape identity at a glance, and the specific
gaps. Sorted worst-first.

### 10.1 Dimensions

| dimension | weight | compute |
|---|---|---|
| Real photos | 25 | +25 if hero image is NOT under `/images/library/`; +bonus if `galleryImages`/multiple real images; 0 if stock SVG |
| Copy authenticity | 20 | full if no `/service (one\|two\|three\|four)/` titles AND about body isn't the templated fallback AND service descriptions aren't the "Professional X for Y and nearby" pattern; partial otherwise |
| Section richness | 20 | scaled by count + diversity of rich sections actually rendered (composePage output), capped; 0 for none |
| Contact completeness | 10 | phone + real email (not `hello@slug.com`) + address + hours each contribute |
| Identity strength | 10 | distinct fontId + non-default palette + shape (i.e. it actually differs from defaults) |
| Trust signals | 10 | testimonials present + established year + rating |
| SEO/meta | 5 | seoDescription length 80–160 + names the town + tagline not templated |

Score = Σ. Grade: A ≥85, B ≥70, C ≥55, D ≥40, F <40.
`status`: `ready` if score ≥70 AND real photos present AND copy authentic, else
`needs-review`. Flags remain (human-readable reasons), now generated from whichever
dimensions scored low, so the message is specific ("Service descriptions templated",
"Stock art — no real photos", "Thin — only 1 rich section").

### 10.2 Card spec

A richer card per demo: left color spine = `--brand`; header row = name + grade
chip (color-coded A–F); a **mini identity strip** (font name, palette swatches: brand
/ accent / bg / deep, shape tag); a horizontal score bar (0–100) with the dimension
breakdown on hover/expand; the flag list (specific gaps); footer = `View demo →`
and `/p/<slug>`. Summary header shows counts per grade and average score. The
dashboard imports `resolveArtDirection` + `composePage` + a `scoreProspect()` from a
shared `src/lib/score.ts` so the score reflects the ACTUAL composed page, not a guess.

---

## 11. File-by-file build plan

New library (`src/lib/`):
1. `src/lib/seed.ts` — `hash(str)` + seeded helpers (`pick`, `shuffle`, `chance`).
2. `src/lib/color.ts` — dependency-free hex/HSL parse, luminance, WCAG contrast,
   lighten/darken/mix, ensureContrast.
3. `src/lib/palette.ts` — `derivePalette(brand, opts)`, `PALETTE_PRESETS`.
4. `src/lib/fonts.ts` — `FONT_REGISTRY`, `pickFont()`, family stacks.
5. `src/lib/font-faces.ts` — central `@fontsource*` variable imports (side-effect).
6. `src/lib/art-direction.ts` — `resolveArtDirection(config)` → ArtDirection
   (palette + fontId + shape + motion + density + neutralTemp), pure + deterministic.
7. `src/lib/tokens.ts` — `artDirectionToCss(ad)` → `:root{…}` string (all §2 tokens),
   applies `config.tokens` overrides last.
8. `src/lib/compose.ts` — `detectAvailableData`, `RECIPES`, `pickHero`,
   `composePage(config, ad)`.
9. `src/lib/score.ts` — `scoreProspect(config, ad, plan)` → {score, grade, dims, flags}.

Scripts:
10. `src/scripts/reveal.ts` — IntersectionObserver reveal, reduced-motion no-op.

Schema/styles:
11. `src/types.ts` — add ArtDirectionConfig, TokenOverrides, Tone, heroVariant,
    galleryImages; expand Section union (modify).
12. `src/styles/global.css` — strip per-site identity to token `var()`s; keep reset,
    structural rules, fallback token values, reduced-motion block, `[data-tone]`,
    `[data-frame]`, `[data-reveal]` base styles (modify).

Layout/pages:
13. `src/layouts/BaseLayout.astro` — call `resolveArtDirection`, inject
    `artDirectionToCss` block, import `font-faces`, add reveal script,
    `<meta theme-color>` from palette (modify).
14. `src/pages/p/[slug].astro` — call `composePage`, render hero variant + ordered
    sections via `SectionRenderer`; drop the hardcoded ORDER map (modify).
15. `src/pages/index.astro` — new scored dashboard cards using `score.ts` (modify).

Heroes (`src/components/heroes/`):
16. `HeroCinematic.astro` (port of Hero), 17. `HeroSplit.astro` (port),
18. `HeroEditorial.astro` (port), 19. `HeroPanel.astro` (new),
20. `HeroCollage.astro` (new), 21. `HeroStatement.astro` (new),
22. `HeroRenderer.astro` — switch on heroVariant.

Sections (`src/components/sections/`) — port existing + add new:
23. `SectionRenderer.astro` (replaces Sections.astro; switch over expanded union).
24. `StatsSection.astro`, 25. `TestimonialsSection.astro`, 26. `FaqSection.astro`,
27. `ListSection.astro`, 28. `CtaSection.astro` (ports, tokenized).
29. `GallerySection.astro`, 30. `FeatureSplit.astro`, 31. `TimelineSection.astro`,
32. `MenuSection.astro`, 33. `TeamSection.astro`, 34. `MapSection.astro`,
35. `PressSection.astro`, 36. `BigQuoteSection.astro`, 37. `ServicesDetailed.astro`,
38. `ServiceAreaSection.astro`, 39. `HoursContactSection.astro`,
40. `ProcessSection.astro`, 41. `LogosStrip.astro`, 42. `BeforeAfter.astro`,
43. `FeatureGrid.astro`.

Connective components (modify to tokens): About.astro, Services.astro,
Header.astro, Contact.astro, Footer.astro.

Generator (`scripts/`):
44. `scripts/generate-prospects.mjs` — emit `artDirection` (or leave to engine),
    `galleryImages` from extra scraped photos, and richer `sections[]` from real
    data using the new types (menu, gallery, feature-split, team, etc.); replace
    flat 2-color presets with palette-preset seeds (modify).
45. `package.json` (demo-gallery) — add `@fontsource*` deps for the 10 pairings.

Docs:
46. `docs/design-system-spec.md` — this file (create).

Build order: lib (1–9) → styles/schema (11–12) → layout (13) → heroes (16–22) →
sections (23–43) → pages (14–15) → connective restyle → generator (44) → deps (45).
lib + each section/hero file are parallel-safe; shared files (types.ts, global.css,
BaseLayout, both pages, generator) are serial integration points.
