# Path to top-tier — honest assessment + plan (2026-06-07)

## Verdict

The **framework is top-tier** (beats Durable/Wix-ADI-class tools). The **automatic
output is not yet** — today it's "top-tier skeleton + a required polish pass."

Grounded in a live cold test: ran the generator on a real business (holething.net)
with no human help. It produced a great skeleton (real hero photo, OKLab palette,
sticky header, sectioned layout) and the QA gate correctly flagged `needs-review`.
But the raw output had:
- **Services = literal "Service one / Service two / Service three"** (extraction
  failed even at richness 68 → placeholders shipped).
- **Headline = generic default** ("…trusted, and proud of it.") because `tattoo`
  isn't in the headline bank.
- **Subheading off-key** ("your next bit of bodywork") — real scraped copy the
  factory has no judgment to catch.
- No email; no testimonials.

The gap from raw → sendable is currently bridged by human/in-session-agent polish.
So at *volume*, it's not top-tier yet.

## Root-cause gaps

1. **Photo judgment** — heuristic (Sharp stats), not vision. The #1 ceiling.
2. **Copy/service extraction** — placeholders ship when the scrape misses.
3. **Category coverage** — headline bank + presets miss categories (tattoo, etc.).
4. **No automated quality GATE** proving top-tier (perf/a11y/SEO/visual).
5. **Judgment tier not enforced** — vision-qa exists but isn't a hard gate.
6. **Copy is assembled, not authored; "beats their site" is asserted, not measured.**

## The plan (prioritized, key-free first)

### Quick wins (key-free, directly fix the test failures)
- **Never ship "Service one."** Category-specific service presets (tattoo →
  Custom tattoos / Piercing / …); the needs-review gate should suppress placeholder
  service rendering entirely.
- **Expand the headline bank + presets** to all categories; smarter default.

### Move 1 — Quality gate + reliable tooling (key-free, S, 1–2 days)
- **Playwright + @axe-core/playwright** replaces fragile headless-chrome screenshots
  (sets viewport programmatically → no Windows min-width bug; inject CSS to force-
  reveal `data-reveal` before shooting; full-page screenshot + WCAG scan in one launch).
- **Lighthouse CI (`@lhci/cli`)** per-page gate + **Unlighthouse (`@unlighthouse/cli`)**
  whole-site gate (`--budget`, exits 1 on fail). Deploy `.unlighthouse/` as a client proof.
- DoD: perf ≥90, a11y ≥95, SEO ≥90, 0 critical/serious axe violations.

### Move 2 — Photo judgment (biggest visual jump; needs a key — M, 3–5 days)
- **Pexels API** (free key; supports hex-color match → feed the OKLab palette) +
  Unsplash fallback for genuine photo gaps.
- **LAION aesthetic predictor** (key-free Python) pre-filter → **Claude vision API**
  congruence scoring of the top candidates (~$1–2 per 20-business batch). Or the
  in-session agent as the vision judge (key-free, low volume).
- **smartcrop-sharp** (key-free) for content-aware hero/card crops; **rembg** (key-free)
  for product/headshot cutouts.
- DoD: agent-as-judge "no stock-photo tells" ≥8/10.

### Move 3 — Grounded bespoke copy (key-free in-session, M)
- Scrape → structured `business.json` fact-sheet → LLM writes ONLY from facts →
  **post-gen noun/number verifier** (every proper noun/number/service must appear in
  the fact-sheet, else `[NEEDS FACT]`). In-session now; Haiku API (<$5/mo) when >10 builds/wk.
- DoD: every claim traces to a fact; agent-as-judge "sounds like this specific business" ≥8/10.

### Bonus — "Beats their site" proof (key-free, S)
- Playwright screenshot of their current site + Lighthouse delta + axe audit →
  static before/after proof artifact for the cold email. Lifts the demo from pretty
  to data-backed.

## Definition of "top-tier / done" (measurable, per shipped site)

| Metric | Threshold |
|---|---|
| Lighthouse Performance | ≥90 (hard gate) |
| Lighthouse Accessibility | ≥95 (hard gate) |
| Lighthouse SEO | ≥90 (hard gate) |
| Core Web Vitals | LCP ≤2.5s · CLS ≤0.1 · INP ≤200ms |
| WCAG critical/serious (axe) | 0 |
| Zero placeholder copy | required |
| Agent-as-judge: photo congruence | ≥8/10 |
| Agent-as-judge: copy "this business" | ≥8/10 |
| Beats their site | Lighthouse ≥+20 perf AND ≥+10 a11y |
| JS payload / page weight | ≤300 KB / ≤1.5 MB |

## The one decision that's the owner's
Photo judgment (Move 2) is the biggest quality unlock and the one place a paid key
clearly pays for itself: **Pexels (free key)** + optionally **Claude vision (~$1–2/batch)**.
Everything else (gate, copy, proof, quick wins) is key-free.
