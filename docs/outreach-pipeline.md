# Outreach demo pipeline

Turn a CRM list of businesses into live, one-link-each demo websites you can
drop into a cold outreach email — without hand-building a site per prospect.

## The idea

A whole site in this repo is just the template + a filled-in config. So
"build a site from a database row" becomes "generate a config from a database
row." For cold outreach we render all of those configs from **one** app —
the **demo gallery** (`sites/demo-gallery/`) — where each prospect lives at
`/p/<slug>`. One deploy hosts every demo. When a prospect says yes, you
"graduate" them to their own standalone site + custom domain.

```
CRM ─▶ CSV ─▶ generate-prospects ─▶ src/data/prospects/*.json ─▶ git push ─▶ Vercel
                                                                              │
                                              demos.yourdomain.com/p/<slug> ◀─┘
```

## 1. Export your CRM to CSV

Export the businesses you want to target to `data/prospects.csv` with this
header row (extra columns are ignored, blanks are fine):

```
name,category,city,state,phone,email,address,existing_website
```

- **category** drives the theme colors and the starter service list. Known
  values: `towing`, `cafe`, `plumbing`, `salon`, `landscaping`, `auto-repair`.
  Anything else falls back to a neutral default — add new presets in
  `scripts/generate-prospects.mjs` (the `CATEGORIES` map).
- **existing_website** is just for your own filtering/notes today (the
  "no website or shit website" qualifier). See "Next steps" for auto-scoring.

`data/prospects.sample.csv` is a working example.

## 2. Generate the prospect sites

```bash
npm run generate-prospects                 # uses data/prospects.sample.csv
npm run generate-prospects -- data/prospects.csv
```

This writes one `sites/demo-gallery/src/data/prospects/<slug>.json` per row and
a `data/outreach-links.json` manifest (`name`, `email`, `link`) you can
mail-merge from. The slug comes from the business name.

### Marketing copy: Claude API vs. fallback

The tagline, hero, about paragraphs, and service descriptions are written by the
Claude API when an API key is present; otherwise a deterministic per-category
template is used so you always get a complete page.

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # turns on Claude-written copy
export ANTHROPIC_MODEL=claude-sonnet-4-6   # optional, this is the default
export GALLERY_BASE_URL=https://demos.yourdomain.com   # optional, prefixes links
```

The system prompt is cached, so generating many rows in one run is cheap.

## 3. Preview locally

```bash
cd sites/demo-gallery
npm install        # first time only
npm run dev        # http://localhost:4321  → index lists every demo
```

The home page (`/`) is your private dashboard of all demos (marked `noindex`).
Each prospect site is at `/p/<slug>`.

## 4. Deploy

The gallery is one Vercel project like any other site in this repo — set its
**Root Directory** to `sites/demo-gallery` (see `docs/deploy-to-vercel.md`).
After that, every `git push` rebuilds it and all prospect links update. Add a
custom domain like `demos.yourdomain.com` so the links look professional.

```bash
git add sites/demo-gallery/src/data/prospects data/prospects.csv
git commit -m "Add this week's outreach prospects"
git push
```

## 5. Send the outreach

Pull the link for each prospect from `data/outreach-links.json` and merge it
into your email — e.g. "I built you a quick homepage, take a look:
{{link}}".

## 6. When a prospect converts

Graduate them to a real, standalone site with its own project and domain — the
JSON already matches the single-site config schema:

```bash
npm run new-site -- <slug> "Business Name"
# then copy the values from sites/demo-gallery/src/data/prospects/<slug>.json
# into sites/<slug>/src/config.ts, add real photos, and deploy + add their domain
```

## Photos (the honest gap)

Generated demos use the committed SVG placeholders, which look finished but
generic. To make a demo feel like *theirs*, best to worst:

1. Pull the prospect's own photos from their Google Business Profile (Places
   API) — a future enhancement to the generator.
2. A curated stock image per category, committed once and referenced by the
   generator.
3. The SVG placeholders (current default).

For a hot prospect, drop their real photos into
`sites/demo-gallery/public/images/` and point that prospect's JSON at them.

## Next steps / ideas

- **Auto-qualify** "shit websites": have the generator fetch `existing_website`
  and score it (no HTTPS, no mobile viewport, dead/slow, no title) so you can
  filter and cite specifics in the email.
- **Direct CRM pull**: replace the CSV step with an API client (Airtable, Google
  Sheets, HubSpot) writing the same normalized rows.
- **Per-category stock photos** as described above.
