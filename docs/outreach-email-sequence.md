# Cold-outreach playbook — the demo-site sequence

The factory builds the demo; this is how you turn a live `/p/<slug>` link into a
paying client. Grounded in the 2026 research sweep (see `improvement-roadmap.md`).

## The core play

Build the demo **first**, then pitch *"I already built this for you — want to
claim it?"* This inverts the sales dynamic (you give before you ask) and
sidesteps "show me your portfolio" — the proof IS the pitch. You own the site
until they pay.

**Pre-qualify the list.** Prioritize businesses with **no website** or a visibly
broken/outdated one (check Google Maps, BuiltWith, Wayback). No site = no "we
already have one" objection. Practitioners report ~12% conversion on filtered
lists vs ~3% unfiltered.

## Sequencing rule that matters most

**42% of replies come from follow-ups, not email 1. ~60% of prospects only
respond after the second follow-up.** Send the whole sequence; don't quit after one.

| # | Day | Goal | Gist |
|---|-----|------|------|
| 1 | 1 | Earn a reply | Name 1–2 specific problems with their current presence; ask permission to send a 90-sec video. **No link yet.** |
| 2 | 4 | Deliver the asset | Demo URL + the walkthrough thumbnail/Loom. "I went ahead and built it." |
| 3 | 8 | Social proof | A result from a similar local business; soft re-ask. |
| 4 | 15 | Scarcity | One real slot left this month in [area]; the demo comes down if you don't hear back. |
| 5 | 21 | Break-up | "No worries on timing — I'll keep it live 30 days, then reclaim it." |

## Subject lines (curiosity + specificity, ≤9 words)

- `[Business Name] — I built something for you`
- `Fresh redesign idea for [Business Name]`
- `Quick question about [Business Name]'s website`

Avoid mass-send tells, urgency spam, and anything over 9 words (open rate drops ~39%→34%).

## Templates

> Replace `[...]`. Keep email 1 to ~80–100 words, plain text, no images, no link.

### Email 1 — Day 1 (problem + permission)
```
Subject: [Business Name] — quick idea

Hi [First Name],

I was looking up [businesses like yours / tow operators / wineries] in
[City] and came across [Business Name]. Two things jumped out: [specific
observation #1 — e.g. "your Google page has 60+ reviews but the site has no
photos of your work"] and [observation #2].

I actually put together a quick redesign concept to show what I mean. Mind if
I send over a 90-second video walking through it? No pitch — just want your
take.

— [Your name]
[phone]
```

### Email 2 — Day 4 (the demo)
```
Subject: Re: [Business Name] — quick idea

Hi [First Name], I went ahead and built it so you could see it live rather
than describe it:

[demo URL]   ← built for [Business Name]; works on your phone

90-second walkthrough: [Loom link]  (thumbnail attached)

Everything on it is real — your services, hours, and reviews, just presented
the way a [category] in [City] should look. Happy to hand it over if you like it.
```

### Email 3 — Day 8 (proof)
```
Subject: how [similar business] turned this around

Quick one — [similar local business] had the same gap and after switching to a
site like the one I built you, they [concrete result]. Same approach is sitting
ready for [Business Name] at the link from Tuesday: [demo URL]. Worth 10 minutes?
```

### Email 4 — Day 15 (scarcity)
```
Subject: one slot left in [City] this month

Hi [First Name] — I only take on a couple of [category] builds a month and have
one slot left for [City]. The demo I built for [Business Name] is still live
([demo URL]) but I'll take it down end of month if it's not a fit. Want it?
```

### Email 5 — Day 21 (break-up)
```
Subject: closing this out

No worries if the timing's off, [First Name]. I'll keep [demo URL] live for
another 30 days in case you circle back, then reclaim it. If anything changes,
just reply here. Thanks for the look.
```

## Objection one-liners

- **"We don't need a website."** → "When someone hears about you and Googles
  you, finding nothing costs you that referral. The site just catches them."
- **"How much?"** → "Let's look at what I built first — easier to price once you
  see it." (Never quote before the demo.)
- **"We're already building one."** → "Use mine as a free second opinion — no cost to look."
- **"Can't afford it."** → Offer the retainer (no upfront): $299–499/mo, yours while active.

## Pricing models

1. **Build + retainer:** $1.5k–3.5k build + $99–199/mo hosting (most common).
2. **Pure retainer:** $299–499/mo, no upfront — kills the price objection.
3. **"Claim it" discount:** transfer the demo for $500–800 if they sign within 7
   days, vs a full $2,500+ quote. The demo is the negotiating chip.

## Where the tooling fits

- **Live demo URL** = `/p/<slug>` (one Vercel deploy hosts all demos).
- **Claim banner** = the `outreach` block in each prospect JSON renders a
  "Claim this site" bar + keeps the page `noindex` until `published: true`.
  ```json
  "outreach": {
    "claimUrl": "https://calendly.com/you/15min",
    "claimByDate": "2026-07-15",
    "note": "1 build slot left in Sonoma County this month"
  }
  ```
- **Email thumbnail** = `npm run make-thumbnail -- <slug>` → `data/thumbnails/<slug>.png`
  (the prospect's site behind a play button). Embed it in email 2, linked to the demo.
- **CRM** = `npm run push-to-crm` attaches demo links to leads.

> The competitive gap (2026): Durable / Wix ADI / GoDaddy Airo / B12 / 10Web all
> **wait for the business to come to them**. None do outreach. A spec-site factory
> that ships a personalized live demo + this sequence is running a play no funded
> AI builder runs.
