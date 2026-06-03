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

### Keys (all optional — the script degrades gracefully)

Copy `.env.example` to `.env` and fill in what you have:

```bash
cp .env.example .env
set -a && . ./.env && set +a               # load into your shell
npm run generate-prospects -- data/prospects.csv
```

| Variable | Effect when set | When unset |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude writes tagline/hero/about/services | Per-category template copy |
| `GOOGLE_MAPS_API_KEY` | Real photos + address/phone/hours/website-check from Google | SVG placeholder art |
| `ANTHROPIC_MODEL` | Override model (default `claude-sonnet-4-6`) | default |
| `GALLERY_BASE_URL` | Prefixes outreach links, e.g. `https://demos.yourdomain.com` | links are relative `/p/<slug>` |

The Claude system prompt is cached, so generating many rows in one run is cheap.

### Google Places enrichment + photos

With `GOOGLE_MAPS_API_KEY` set (a Google Maps Platform key with **Places API
(New)** enabled), each row is looked up by name + whatever location it has, and
the generator pulls:

- **Real storefront photos** → downloaded to
  `sites/demo-gallery/public/images/<slug>/` and used as the hero + story images
  (with photographer attribution captured in the story caption).
- **Address, phone, and real opening hours** → fill any blanks the CSV left.
- **Existing-website check** → recorded per prospect in
  `data/outreach-links.json` as `hasWebsite`, and the run prints how many
  prospects have **no** website (your hottest "needs a site" leads).

This means your CSV can be sparse — even just `name,category,city` per row —
and Google fills in the rest. CSV values always win when present; Google only
fills gaps.

> **Attribution:** Google Places photos carry author attribution and usage
> terms. The generator stores the photographer name in the story caption. For
> production outreach, review Google's Places photo policy; for a prospect's
> hot lead, their own uploaded photos are ideal.

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

## Photos

Photo source, best to worst:

1. **The prospect's own Google photos** — automatic when `GOOGLE_MAPS_API_KEY`
   is set (see above). This is the default path now.
2. **Hand-dropped real photos** for a hot lead — drop files into
   `sites/demo-gallery/public/images/<slug>/` and point that prospect's JSON
   `images.hero` / `images.story` at them.
3. **SVG placeholders** — the fallback when there's no key and no match. The
   page still looks finished, just generic.

## Next steps / ideas

- **Auto-qualify "shit websites"**: the generator already records `hasWebsite`
  per prospect (from Google). A next step is to fetch the existing site and
  score it (no HTTPS, no mobile viewport, dead/slow, no title) so you can cite
  specifics in the email.
- **Direct CRM pull**: replace the CSV step with an API client (Airtable, Google
  Sheets, HubSpot) writing the same normalized rows.
- **More category presets**: extend the `CATEGORIES` map in
  `scripts/generate-prospects.mjs` with new verticals (theme + services).
