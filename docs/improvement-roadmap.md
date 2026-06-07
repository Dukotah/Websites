# Improvement Roadmap — research sweep + polish audit (2026-06-07)

Synthesized from a 9-agent sweep: 5 web-research agents (design trends, CRO, the
cold-outreach business model, Astro/perf/SEO, local SEO + schema) + 3 read-only
codebase-audit agents (design system, generator/scrape pipeline, a11y/perf/SEO of
built output). Ranked by impact-per-hour, biased toward key-free changes that are
safe to ship on the existing demos.

## Executive summary

Architecturally solid — token layer, OKLab palettes, per-slug divergence, and the
scrape→compose pipeline all work across ~10 live demos. The recurring enemy
(cookie-cutter slop) is partially beaten by the photo scorer + real-facts scraping,
but leaks remain. Biggest verified gaps: (1) the motion system has a hard
invisible-page failure when JS is blocked/slow; (2) winery/marina/restaurant fall to
a generic orange/blue default preset in the generator; (3) Wikimedia/Openverse photo
tiers bypass the quality scorer; (4) a clutch of <10-line structural bugs (wrong
schema @type, missing @id, no skip-nav, HeroStatement missing fetchpriority, stats
numbers in body-text color); (5) the outreach layer is absent from the demo pages
themselves (no "Claim This Site", no noindex guard, no urgency).

## Quick wins (high impact, small effort, safe)

1. **No-JS fallback for `data-reveal`** — content is `opacity:0` until JS fires; if the
   bundle is slow/blocked the whole page is white. Gate the hidden state behind a
   `.js-reveal-ready` class set by a tiny inline `<head>` script. (global.css, BaseLayout)
2. **bear-flag-towing schema `@type`** `TowingService` → `AutomotiveBusiness` (the
   former isn't a real schema.org type; Google ignores it).
3. **Add `@id`** to `structured-data.ts` (`canonical + '#business'`) — entity anchor.
4. **StatsSection value color** `var(--text)` → `var(--brand)` (looks like a data table).
5. **HeroStatement** missing `fetchpriority="high"` + `loading="eager"` → LCP penalty.
6. **Skip-nav link** in BaseLayout + `id="main"` on `<main>` (WCAG 2.4.1 Level A).
7. **FaqSection** remove `role="list"` on `<dl>` (clobbers description-list semantics).
8. **noindex + "Claim This Site" banner** *(business decision — see below)*.
9. **CATEGORIES presets** for winery / marina / restaurant in generate-prospects (they
   silently fall to the generic default theme today).
10. **Flag default-fallback hours** in generator (Mon–Fri 8–6 is wrong for wineries etc.).
11. **og:type** `business.business` → `website` (former breaks non-FB link previews).
12. **`twitter:image:alt`** companion tag.
13. **Vary testimonial author** — all "Verified customer" reads fabricated.
14. **24/7 hours fallback** in structured-data openingHours (Smitty's emits empty today).
15. **Decorative hero `alt=""`** where the container is `aria-hidden` (dup announcements).
16. **Remove `window.location.reload()`** from motion.ts reduced-motion handler (CSS handles it).
17. **`sandbox` attr** on the Google Maps iframe (cuts 400–800ms third-party main-thread).
18. **`@astrojs/sitemap` + robots.txt** *(pairs with the index/noindex decision)*.
19. **Score Wikimedia/Openverse photos** — these tiers bypass `scorePhoto()` + size check.

## Medium bets (medium effort, high value)

- CSS **grain/noise** texture token + section modifier (fastest agency-vs-template tell).
- **MarqueeStrip** section (brand-phrase ticker; absent from the library).
- Wire **ServicesDetailedBento** into art-direction (built but never selected).
- **Mobile hamburger drawer** in Header (nav vanishes ≤720px today — looks broken on phones).
- Upgrade **Footer** to a real 3-column conversion zone (currently placeholder).
- **Sticky header** + hero phone CTA as a 48px button on mobile + review badge.
- **ratingSource guard** in structured data (don't mark up self-reported Google ratings).
- Activate **BeforeAfter** for trades categories (built but dead).
- Wire **Openverse** into `acquirePhotos()` as a photo tier (built, never called).
- ProcessSection mobile connector + HeroCollage 2-image badge position fixes.
- **`--brand-tint` / `--surface-3` tokens** to replace 5 ad-hoc `color-mix` calls.
- **Font preload** for the active display font (kills hero FOUT).
- Hero images **`<Picture>` AVIF+WebP** (30–50% smaller than WebP).
- **AggregateRating header + source** on testimonials.
- **Inject CTA after testimonials** in compose (+14% conversion at the credibility peak).
- 3-field inline lead form variant; benefit-driven CTA copy; urgency/availability line.

## Big bets (strategic — owner decision)

- **OKLab hue math** in palette.ts (accent/neutral/contrast still HSL → muddy accents
  for saturated brand hues like winery reds / landscaping greens).
- **HeroTypographicFill + HeroEditorialAsym** variants + trades/boutique font pairings
  (type-as-hero is *the* premium differentiator; balanced 50/50 split is the template tell).
- **Outreach system**: 5-email sequence doc, before/after demo slider, Loom-thumbnail
  generator (Sharp). Turns the factory from a site-builder into a conversion funnel.
- **CSS Scroll-Driven Animations** + **photo-blend** art-direction token (unifies scraped
  photos into the brand palette — addresses the photo-judgment problem with no new photos).

## Cold-outreach intel (for the business play)

- The play: build the demo first, pitch "I already built this — want to claim it?"
- Reply rates: generic 3–8.5%, personalized 5–15%, +Loom 2–3×, live demo URL → 10–25%.
- Don't send the Loom in email 1 — reference 1–2 specific problems, gate the video behind a reply.
- 5-email cadence (Day 1/4/8/15/21); **42% of replies come from follow-ups**, not email 1.
- Pricing tiers: $1.5–3.5k build + $99–199/mo, or $299–499/mo pure retainer, or
  "claim it for $500–800 if you sign in 7 days."
- Competitor gap: Durable/Wix ADI/GoDaddy Airo/B12/10Web **none do outreach** — they wait
  for the business to show up. A spec-site factory doing personalized outreach with a live
  demo URL runs a play no funded AI builder runs.

_Full source list and per-finding detail captured in the workflow output (run wf_bf952fcc-480)._
