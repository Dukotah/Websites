# Roadmap: 95%+ sites, zero needs-review (full-pipeline audit)

_Generated 2026-06-15 from a 3-stage read-only audit of `projects\Websites` (content-authoring, design/render, QA self-gate). No code was changed._

## The root cause (one sentence)

The factory is honestly built to **flag** weak sites, but it has **no way to reach the AVISP bar automatically**, and the **one gate that can actually see "AI slop" (the vision judge) is never wired into the pipeline** — so the system either ships generic-but-unflagged copy (the slop you're seeing) or floods needs-review.

Three findings, each independently fatal to the goal:

1. **Render throws away the identity it computes.** The brand engine (`palette.ts`, `fonts.ts`, `tokens.ts`) computes a rich per-business identity — density, shadows, archetype rhythm, texture, motion. `premium.css` consumes almost none of it (only color, fonts, type-scale, `--radius`). Every site ends up with identical whitespace, shadows, max-width, and section silhouettes — differing only in **hue + typeface**. That is the "samey template" tell.

2. **The "agent author" is deterministic filler when unattended.** With no `ANTHROPIC_API_KEY` / in-session agent (i.e. the 6am batch), `author-premium.mjs` writes the copy from a rules engine: "Reach out → We assess → We do the work → You're set", "{name} — {Category} you can count on", canned service descriptions. It's good at *not lying* but interchangeable across sites — exactly the AI-slop texture. The real AVISP-tier copy (`confirmed:true`) has **only ever been hand-written by a human/agent.**

3. **The quality gate is mechanical and fail-open.** A real vision/taste judge exists (`vision-qa.mjs` + `vision-judge.mjs`) and can score a site against the AVISP bar — but **nothing automated calls it.** There's no numeric score, no auto-fix loop, and missing status defaults to `ready`. So slop the scripts can't *see* sails through as "ready."

**Hard truth:** "fully automated, 9.5/10, zero needs-review" is **not reachable with today's code** — the deterministic skeleton is generic by design, and the only path to the bar is an LLM author + a vision gate, neither of which runs in the unattended pipeline. The roadmap below builds exactly those.

---

## Phase 0 — Stop the leaks (1 day, pure plumbing)

These don't improve quality but stop bad sites from being *labeled* good. Do first.

- **Fail-closed status.** `deriveStatus` / `normalizeDemoStatus` and the CRM boundary default unknown/missing status to `ready`. Flip every default to `needs-review`.
- **Carry status through `push-to-crm.mjs`.** Line ~139 sends only `{name, link}` — status is stripped, so HTTP-pushed sites become `ready` in the CRM regardless. Include `status` (and make ready-only the default, not the opt-in `--only-ready`).
- **CRM read-side filter.** New-tab feed should drop anything `status !== 'ready'` so needs-review can never even *appear* on the board.

## Phase 1 — Kill sameness (2–3 days, highest ROI, low risk)

The engine already computes everything; the render just has to use it.

- **Wire the discarded tokens into `premium.css`.** Replace hardcoded `.section` padding → `var(--section-pad)`; container `72rem` → `var(--maxw)`; the three `--p-shadow-*` → engine `--shadow-sm/md/lg`; grid gaps → `var(--grid-gap)`. A compact towing site and an airy winery site instantly read structurally different — for free.
- **Make `archetype` drive layout.** Pass `ad.archetype` into the page route + `PremiumSection`; branch 3 section "skins" (utility = dense/sharp dividers; editorial = airy/hairline; magazine = asymmetric/overlap). Today every category is the same component stack.
- **Add asymmetry + 2–3 silhouettes per section.** Vary the symmetric `1.05/0.95` grids; give stats/story/hero more than one shape, seed-selected. Add a hero treatment library beyond the current 3.
- **Port AVISP's `.prose` system** into `premium.css` (lead paragraph, pull-quotes, brand `li::marker`) and route story/about through it. "Type carries the quality" demands this and it's already proven in AVISP.
- **Use the emitted `--noise-url` / `--pattern-opacity`** as subtle grain on dark bands — computed today, rendered nowhere.

## Phase 2 — Real automated author (the actual quality unlock, 1–2 weeks)

This is the only way to hit the bar without a human. Requires an LLM key in the pipeline.

- **Add a research agent** (web search: founding year, owner story, real reviews, awards) that writes a *rich* research file — the documented "research each business" step that currently has **no code**.
- **Upgrade `upgradeCopyWithClaude`** from "polish scraped text" to "write headline + about story from researched specifics," and **gate its output** (reject generic phrasing) instead of silently falling back to the equally-generic skeleton.
- **Replace the volume-only richness gate.** `scoreRichness` rewards word count, so junk passes (e.g. `yerba-madre` ships e-comm copy "Get lifted. Stay lifted." + a "Customer Service" service + `.js`/`.pdf` photo URLs at richness 65). Add content-quality flags: e-comm patterns, nav-items-as-services, asset-URL photos.
- **Make filler trip needs-review.** `author-premium.mjs` hardcodes `templated = []`, so the existing `deriveStatus` template flags can never fire on the premium path. Populate it whenever the author falls back to `deriveServiceDesc`/`buildSteps`/`defaultHeroHeading`. Add "you can count on" to the cliché regex.

## Phase 3 — The self-gate the owner actually wants (3–5 days)

- **Wire the vision judge into `morning-batch.mjs`.** Run capture → `vision-judge` → `vision-qa --gate-manifest` *before* computing the ready set. This is the single most impactful gate connection — the slop detector that's built but unplugged.
- **Introduce a numeric `qualityScore` (0–100)** per slug, vision-grade-dominant (~50%) + mechanical/photo/lighthouse/richness. Gate CRM delivery on `score >= 95 AND vision verdict = send`.
- **Require a positive verdict, not just absence of failure.** A slug with no vision finding = `needs-review`, not `ready`.
- **Add the auto-fix loop.** On a fixable failure, attempt one remediation and re-gate (≤N attempts), then quarantine: low-res/mismatched hero → re-acquire photo or drop to editorial text hero; cliché copy → re-author; sameness collision → re-seed brand. Today it's only "flag or quarantine" — the "auto-fix to bar" half is missing.
- **Provide `ANTHROPIC_API_KEY` in `run-morning-batch.cmd`**, or accept the honest contract: capture at 6am, hold the batch until an agent session runs the judge — never auto-publish unjudged.

## What's already good (don't touch)

- **The photo gate is strong.** Sharpness/fade scoring on real bytes, congruence/provenance check (kills the "salon with a mountain photo" bug), and "omit the photo" is a clean first-class path — no empty frames, real monogram/motif fallbacks. This requirement is essentially met.
- **The color engine** (`derivePalette`) is AVISP-caliber: hue jitter, chroma floors, brand-tinted neutrals, WCAG correction.
- **The send-route 422 guard** in the CRM correctly blocks emailing needs-review demos. Keep it as the backstop.

## Sequencing

Phase 0 → Phase 1 give the fastest visible win (sites stop looking same-y, bad ones stop mislabeling). Phase 2 is the real quality ceiling-raiser but is the biggest build and needs an LLM key. Phase 3 makes the 95%/no-needs-review guarantee real. You cannot get "zero needs-review, fully automated" without Phase 2 **and** Phase 3 — Phase 1 alone makes prettier templates, not bespoke sites.
