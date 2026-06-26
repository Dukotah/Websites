# Bespoke Flagship Playbook

How we build outreach demos that **wow** — designer-grade, one-off sites, not
template fills. This is the standard for any lead we actually pitch. The
deterministic factory (`generate.mjs` + the `PremiumConfig` template) drops to a
**cheap fallback for true bulk only**.

> Reference bar (the exemplar to match or beat): `C:\Users\dukot\projects\_bespoke-csi`
> (the California State Insulation build) — and AVISP / Stripe / Linear caliber.

## Why bespoke

The template factory makes every site share one design DNA, so recoloring it /
swapping a font / adding stock photos still reads as *a generated template*.
Prospects perceive that as a "less intelligent" site. A site **designed for that one
business** — its own concept, identity, components, and motion — is what wows. We
pitch a handful of high-value leads, so per-site cost is worth it.

## Hard rules (non-negotiable)

- **Max membership only.** The agent designs and writes everything itself. NEVER use
  the Anthropic API / `ANTHROPIC_API_KEY` / `generateCopyWithClaude`.
- **Honesty.** Only real, verifiable facts. No invented reviews/awards/numbers. Any
  non-owned image is tagged *illustrative* and never implied to be their own
  shop/work/team. Lead with verifiable credentials when social proof is thin.
- **Email stays human-only, in the CRM.** Bespoke builds never draft or send email.
- **Branch + PR for shared code; local-preview/own-project for the bespoke site.**
  Never publish without the owner's go-ahead.

## The method

1. **Research (deep).** The business's site (if any) + Yelp/Google/Facebook/BBB/news +
   licensing/registries. Pull real specifics: owner story, founding year, exact
   services, credentials, service area, the one thing that makes them distinct. The
   *concept* comes from here.
2. **Concept + identity brief (one line + a palette/type direction).** Find the single
   idea the whole site hangs on (e.g. CSI's "one licensed shop owns the whole building
   envelope" → a wall-section cutaway tagged by license class). Then a real art
   direction: custom palette, type pairing, grid, motion personality. Distinct per
   business — not the factory's seeds.
3. **Build custom.** A standalone Astro app (scaffold a fresh minimal app or gut
   `sites/_template`); your OWN components + design tokens. Do NOT use the gallery's
   `PremiumConfig`/14-section system. Compose what THIS business needs.
4. **Motion & craft.** Wire effects from the `flow` library (`C:\Users\dukot\demos\flow`
   — read `FEATURES.md`, adapt `library/<slug>/astro.astro`): clip-reveal headlines,
   scroll-reveal, count-up stats, magnetic buttons, tilt, mesh-gradient/glow, sticky
   storytelling. Tasteful and fast — premium, not a circus. Always
   `prefers-reduced-motion`-gated.
5. **VISUAL QA GATE — mandatory (see below).** The site is not "ready" until it passes.
6. **Host / deploy.** Local preview for review; on the owner's go-ahead, deploy the
   standalone site (its own Vercel project / preview URL) — which also graduates
   cleanly to a paying-client site when they sign.

## VISUAL QA GATE (the part the factory's gates can't do)

Mechanical validators (`premium-validate`, `audit`) only understand the template
config — they are **blind to visual glitches in hand-coded CSS/motion**. So every
bespoke site MUST pass a real visual review:

- **Capture the BUILT site** (not just dev) at **desktop ~1440px** and **mobile
  ~390px**, both **fold** and **full-page**. Capture the full-page shot under
  `prefers-reduced-motion` so scroll-reveal sections aren't stuck at `opacity:0`.
  Tooling: a small Playwright/headless-Chromium script (or `gstack`).
- **Actually look at the pixels** (the in-session agent reads the screenshots). Hunt
  for: horizontal overflow / scrollbars, element overlap, broken spacing or alignment,
  weak text contrast, motion artifacts (flash, jank, stuck-hidden sections), layout
  shift, oversized/blurry/broken images, mobile reflow breaks, z-index/nav issues.
- **Fix → rebuild → re-shoot** until both breakpoints are clean.
- Optional automation: wire `vision-judge` to score against this bar and loop.

A bespoke site only reaches a prospect after a clean visual review at **both**
breakpoints. No exceptions — this is where the "slight glitches" get caught.

## When the template fallback is OK

Only for genuine bulk where quantity matters more than wow (rare under the
quality-over-volume bar). Otherwise: bespoke.
