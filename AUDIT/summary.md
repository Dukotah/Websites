# AUDIT/summary.md — Website-builder audit & improve

> Subject: the premium `/s` Astro factory on `origin/main`. Run 2026-06-20.
> Status: **paused after 1 user-selected finding**, not a stopping-condition exit —
> open measurable P1/P2 findings remain (see findings.md). This is not `LOOP_DONE`.

## The most important finding

The tool **already meets its PURPOSE on every axis we can measure.** On simulated
Slow-4G mobile across 7 sectors: **perf 99 / a11y 100 / SEO 100 / best-practices 100,
LCP 1.97s, CLS 0.000, TBT 0 ms, ~207 KB/page**, with correct click-to-call, valid
LocalBusiness + Breadcrumb JSON-LD, and (correctly) no policy-violating review
markup. The runtime is not where the wins are. This means the armada's 10-day perf
sprint and a `flow` motion pass would mostly add risk for cosmetic, unmeasurable
gain — `won't-fix` by the anti-slop contract.

## What moved (with numbers)

**F9 — mobile sticky tap-to-call bar (PR #8, merged-pending).** The one change the
user picked as "what makes a better website." A shared `StickyContactBar` in
`PremiumBase` puts a persistent **Call** button (+ the author's Contact CTA) at the
bottom of every demo on phones — exactly where the header CTA hides (≤560px) — so a
rural-LTE visitor can call at any scroll depth.

| metric (Slow-4G, 7-sector median) | before | after |
|---|---|---|
| performance | 99 | 99 |
| accessibility | 100 | 100 |
| LCP | 1970 ms | 1973 ms |
| CLS | 0.000 | 0.000 |
| TBT | 0 ms | 0 ms |
| page weight | 207 KB | 209 KB |

Cost: **+~2 KB CSS/page, zero client JS, zero new dependencies.** a11y held at 100
(56px targets, label-in-name, focus-not-obscured via scroll-padding). Green-gated:
`astro check` added no new type errors; build clean (156 pages). Lives in the shared
layer, so **all 40 current sites + every future one** get it from one file.

## What I cut / did NOT do (and why)

- **`flow` motion pass / armada perf sprint** — runtime is already perf-maxed; can't earn a measurable delta. Skipped.
- **`sms:` text button** — most scraped numbers are landlines where texting silently fails; a broken button is worse than none. Used Call + Contact CTA instead.
- **Merging the armada branch** — it was built on the retired `/p` architecture (its centerpiece `generate-prospects.mjs` doesn't even exist on `main`). Harvested as ideas/docs only, not merged.

## Net lines

This iteration: **+131 / −0** (one new component + 2-line wire-in). The delete-first
wins (F2 drop `smartcrop`) are queued, not yet taken.

## Top remaining opportunities (evidence/ledger in findings.md)

1. **F1 — enforceable CWV/perf-budget gate** (no new dep): lock in LCP ≤ 2500 / CLS ≤ 0.1 so no future change or heavy-photo sector regresses the 1.97s. Highest-leverage *protective* change.
2. **F3 — type-check gate + fix the real `motion.ts` null bug** (`'hdr' is possibly null`) that currently ships in the one client script. `astro check` finds 1 error today.
3. **F2 — delete `smartcrop`/`smartcrop-sharp`** (sharp has built-in `attention`/`entropy`) — delete-first, −2 deps.
4. **F10 — consolidate the 38-script / ~10,900-LOC pipeline onto `crawlee`+`cheerio`** — the largest *engineering* win (big net-line deletion), but a multi-day refactor, not a one-PR finding.

(F4 AVIF, F5 LocalBusiness subtype, F6 og-image weight, F7 sameAs/directions, F8 npm-vuln triage are smaller measurable items also in the ledger.)

## Honest bottom line

The website builder is in genuinely good shape for what it's for. The biggest future
value is **engineering hygiene that keeps it good as it scales across all sectors**
(gates F1/F3, delete-first F2/F10) — not adding features. The one visitor-facing
"better website" change (F9) is shipped and measured.
