# AUDIT/findings.md — Gap analysis ledger (Phase 2)

> Severity: **P0** = breaks the PURPOSE · **P1** = hurts conversion or spin-up · **P2** = polish.
> Ranked by impact on PURPOSE (rural-LTE visitor calls/texts/books in 15s; faster/config-driven spin-up).
> "Measurable delta" must come from the SAME measurement as baseline.md, or the finding can't claim "better".

## Headline conclusion (skeptical senior engineer)

**There are no P0 findings.** On Slow-4G mobile the premium `/s` system already
scores perf 99 / a11y 100 / SEO 100, **LCP 1.97s**, **CLS 0.000**, **TBT 0 ms**,
has correct click-to-call, valid LocalBusiness+Breadcrumb JSON-LD, and (correctly)
no policy-violating review markup. It meets the PURPOSE on every axis we can
measure. **Therefore most "make it faster/prettier" work — including the armada's
10-day perf sprint and a `flow` motion pass — cannot earn a measurable delta and is
`won't-fix` by the anti-slop contract.** The real, defensible work is: (1) LOCK IN
this quality with enforceable gates so it can't regress as sites are stamped out
across all sectors; (2) DELETE-FIRST in the 10,900-LOC pipeline; (3) a few cheap
correctness wins. That is the honest ledger.

## Ledger

| # | Sev | Finding | Evidence | Proposed fix (smallest) | Expected measurable delta | In-loop measurable? |
|---|---|---|---|---|---|---|
| F1 | P1 | **No enforceable CWV/perf budget gate.** `lighthouse.mjs` is fail-soft and has no perf/LCP/byte budget — nothing stops a future change or a heavy-photo sector from pushing LCP > 2.5s. | baseline: LCP 1.97s is unprotected; research §5(1). | Extend `lighthouse.mjs` (no new dep) to assert perf ≥ 90, LCP ≤ 2500, CLS ≤ 0.1, TBT ≤ 200, page bytes ≤ budget on the sampled built pages; keep fail-soft on no-Chrome. (Or adopt `@lhci/cli` if you prefer the standard.) | Gate passes at current numbers; a seeded regression (e.g. lazy-load the hero) makes it FAIL. Protects the 1.97s asset across sectors. | ✅ yes |
| F2 | P1 | **Pipeline carries `smartcrop` + `smartcrop-sharp` that sharp already does.** | baseline deps; research §5(3): sharp has `position: sharp.strategy.attention`/`entropy`. | Replace smartcrop calls with sharp's `attention` strategy; remove both deps. | −2 deps; net LOC removed; build still green; hero crops visually equal/acceptable on the real photo set (screenshot-diff sample). | ✅ yes (deps/LOC + visual check) |
| F3 | P1 | **No type-check or lint gate.** `astro check` finds **1 error** — `src/scripts/motion.ts:36 'hdr' is possibly 'null'`, a latent null bug in the SHIPPED client JS the build doesn't catch — plus 4 unused-var hints. | `astro check`: 1 error / 4 hints / 44 files; no eslint. | Fix the `hdr` null guard; add `astro check` to the `qa` script as a gate (dep now present); eslint decided separately. | Type errors enforced at **0** (from 1); the visitor-facing motion bug fixed. | ✅ yes |
| F4 | P2 | **No AVIF.** Hero uses `<Image>` (webp only); 0 AVIF in dist. | baseline: avif 0 files; research §1: AVIF ~35% < webp. | Switch hero to `<Picture formats={['avif','webp']} fallbackFormat="jpeg">` (or `image` config). | Hero transfer bytes ↓. **BUT** LCP already 1.97s — if LCP/SI don't move on Slow-4G, this is `won't-fix: no measurable gain` (keep only if a number moves). | ✅ yes (re-run lh-baseline) |
| F5 | P2 | **Bare `LocalBusiness` JSON-LD type** — no subtype (`AutoRepair`/`HairSalon`/`Winery`/`Restaurant`). | sampled page: `"@type":"LocalBusiness"`; research §3(1). | Map prospect category → schema subtype in `structured-data.ts` (config-driven, deterministic). | Google Rich Results Test / schema validator shows the specific type; no errors. Cheap entity-match win. | ✅ yes (validator) |
| F6 | P2 | **`og:image` weight / verify absolute.** Raw JPEGs up to 833 KB in dist; share-preview break kills referrals. | baseline: 20 MB raw jpg/jpeg; research §3(13). | Verify `og:image` is an absolute production URL at 1200×630 and cap its bytes (~≤300 KB). | og bytes ↓; OG validator passes with absolute URL. | ✅ yes |
| F7 | P2 | **No `sameAs` / GBP link + no "Get directions" link.** | sampled JSON-LD has no `sameAs`; research §3(5,10). | When social/GBP present in config, emit `sameAs[]` + a plain Maps "Get directions" link. | Schema includes `sameAs`; validator OK. Config-driven, machine-readable. | partial (validator only) |
| F8 | P2 | **2 npm vulnerabilities (1 high).** | `npm install` output. | `npm audit`; bump/replace the offending dep if non-breaking. | vuln count → 0 (or documented why deferred). | ✅ yes |
| F9 | P1* | ✅ **DONE — sticky mobile tap-to-call bar** (PR #8). User-selected as "the one that makes a better website." Shipped Call (`tel:`) + the author's Contact CTA in the shared `PremiumBase`; dropped `sms:` (landline-fail risk). | sampled page had no sticky bar; research §4(1,3). | `StickyContactBar.astro` in `PremiumBase` (mobile-only ≤560px, zero JS, a11y-safe). | **Measured no-regression:** perf 99→99, a11y 100→100, LCP 1970→1973ms, CLS 0.000→0.000, TBT 0, +2KB. Conversion lift itself not in-loop measurable (honest caveat). | ✅ shipped |
| F10 | P1 | **Pipeline consolidation (`crawlee`+`cheerio`) — top remaining opportunity.** 10,900 LOC / 38 scripts hand-roll scraping/queue/retry/JSON-LD extraction. | baseline LOC; research §5(2). | Multi-day refactor (out of scope for "smallest change per finding"). | Large net LOC deletion + fewer bespoke bugs. | ⚠ too big for one PR — listed as a top-3 opportunity, not an in-loop finding. |

\* P1 by conversion impact, but de-prioritized in the loop because it fails the "measurable delta" rule.

## `flow` motion pass — explicit verdict

The runtime is already perf-maxed (TBT 0, LCP 1.97s, CLS 0). A motion/animation pass
adds main-thread work and CLS/INP risk for a **cosmetic** gain we cannot measure
(no A/B). Per the anti-slop contract it does **not** earn its place. *If* you want
the single highest-ROI micro-polish from the armada sheet (spring-curve `.btn` hover
+ reduced-motion-safe section reveals, ~40 lines CSS), it can ship as ONE optional
finding **only if** it passes the F1 perf gate with zero metric regression. Otherwise:
skip.

## Recommended Phase-3 order (P1 measurable first)

1. **F1** — perf-budget gate (protects the headline asset; unlocks safe iteration).
2. **F3** — type-check gate.
3. **F2** — delete `smartcrop` (delete-first win).
4. **F5** — LocalBusiness subtype (cheap correctness).
5. **F4** — AVIF (keep only if a number moves).
6. **F6 / F7 / F8** — og-image, sameAs+directions, vuln triage.
7. **F9 / F10** — surfaced as citation-backed / large-refactor opportunities, NOT worked blind in the loop.

## Net-lines stance

Target across the run is **negative or flat** net lines (delete-first). F2 deletes;
F1/F3/F5 add small, evidence-backed code. F9/F10 are deliberately not built.
