# Vision-QA rubric (the judge's standard)

This is the standard the **vision judge** applies in the `vision-qa` harness
(`sites/demo-gallery/scripts/vision-qa.mjs`). The judge is the in-session agent
(no API key on Pro) — you, or a fan-out of subagents. The harness captures the
evidence and gates on the verdict; this file is what turns "looks off" into a
consistent, repeatable score.

## The flow

1. `npm run vision-qa` → builds, screenshots every page, writes a **review
   packet** per prospect to `.shots/qa/review/<slug>.json` (facts + shot paths).
2. **You judge.** For each packet: open `shots/<slug>-fold.png` (the cold-link
   first impression) and `shots/<slug>-full.png` (the whole page), compare what
   you SEE against the packet's ground-truth facts, and write findings to
   `.shots/qa/findings/<slug>.json` (schema below).
3. `npm run vision-qa -- --report` → aggregates into `.shots/qa/VISION-QA.md`
   and exits non-zero if any page is a `hold` or has a `critical` finding.

The packet gives you the ground truth so you can judge **congruence**, which is
the whole point — a script can't tell that a winery's hero is a parking lot, but
you can, because the packet says it's a winery and you can see the photo.

## Dimensions to score

Judge every page on these. Each issue you find becomes one entry in `findings`.

1. **hero-legibility** — Is the headline readable? Enough contrast of text vs the
   photo/scrim behind it? Light text on a light image = critical.
2. **photo-congruence** — Does each `claimed-real` photo actually depict THIS
   business / category? A marina hero must look like a marina, not a snack shelf.
   A service card labelled "Kayaks" must not be a logo. Mismatched stock is the
   #1 "fake site" tell → critical when it's the hero, warn for a buried card.
3. **photo-quality** — Any logo-on-white, UI screenshot, blurry, distorted,
   wrong-aspect, or duplicate-looking photo? Stretched/squashed images → warn.
4. **layout-integrity** — Clipping, text overflow, blank gaps (a section stuck
   invisible), overlapping elements, a hero that under/over-fills its box,
   broken grids. Visible breakage → critical.
5. **richness-credibility** — Does it read like a real, specific business or like
   thin templated AI slop? Too few sections, generic filler copy, repeated
   boilerplate → warn.
6. **conversion** — Is there a clear primary CTA above the fold and a real
   contact path? Dead-end CTAs → warn.
7. **identity** — Type + palette + hero feel intentional and on-brand for the
   category (not the default-looking template). Weak/generic identity → info.

## Grade + verdict

- **grade**: `A`–`F` overall. A = send as-is; B = send, minor polish; C = needs
  work; D/F = embarrassing, do not send.
- **verdict**: `"send"` or `"hold"`. **Hold** if grade is C or worse, OR there is
  any `critical` finding (a mismatched hero, illegible text, or visible breakage
  is always a hold).

## Findings JSON contract

Write exactly this shape to `.shots/qa/findings/<slug>.json`:

```json
{
  "slug": "lake-sonoma-marina",
  "grade": "B",
  "verdict": "send",
  "summary": "Strong aerial hero; one buried gallery shot is a store interior.",
  "findings": [
    {
      "dimension": "photo-congruence",
      "severity": "warn",
      "issue": "Gallery photo-3 is a dim store-interior shot, off-tone for a lake marina.",
      "location": "gallery, 3rd image",
      "fix": "Drop it or swap for a lake/boat/aerial shot."
    }
  ]
}
```

- `severity` ∈ `critical | warn | info`. Be honest — `critical` means do-not-send.
- One finding per distinct issue. `location` and `fix` are short and specific.
- A clean page is `{ "slug": "...", "grade": "A", "verdict": "send",
  "summary": "...", "findings": [] }`.

## Scaling the judge

- A few pages: judge inline.
- A whole batch: fan out one subagent per page (or batch 2–3 per agent), each
  given its packet + shots + this rubric, returning the findings JSON. Keep it
  lean (Sonnet, batched) per the cost budget. The harness doesn't care how the
  findings files get written — only that they match the contract.

This is the JUDGMENT tier; it complements the MECHANICAL tier (`audit.mjs`).
Run both before sending links.
