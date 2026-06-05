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

### No API keys required

The pipeline runs fully free. Copy (tagline/hero/about/services) comes from a
built-in per-category template that the agent personalizes per business; photos
come from the free chain below. The only **optional** env vars are
`GALLERY_BASE_URL` (prefixes the outreach links with your live domain so they're
click-ready) and `ANTHROPIC_API_KEY` (auto-writes copy instead of the template).
See `.env.example`.

### Photos — the free, key-free chain

Each prospect's hero + story image is resolved in priority order:

1. **The business's own photos already online** *(best — done by the agent)*.
   When run conversationally, the agent web-searches the business and, if it
   finds clearly-theirs photos, downloads them into
   `sites/demo-gallery/src/assets/prospects/<slug>/` as `hero.<ext>` /
   `story.<ext>` (so `astro:assets` optimizes them). The generator auto-detects
   anything there and uses it first.
2. **Wikimedia Commons** *(free, no key)* — `scripts/lib/photos.mjs` searches by
   business name → category + town → town, downloads CC-licensed matches, and
   captures attribution. Best-effort: skipped silently if the environment can't
   reach Commons. Add `--no-photos` to the generate command to skip this step.
3. **Built-in category library** — polished, theme-matched art shipped in
   `sites/demo-gallery/public/images/library/<category>/`. Always works, no
   network. Regenerate with `node scripts/build-image-library.mjs`.

The run prints which tier each prospect used, and `data/outreach-links.json`
records it as `photoSource`. CSV can be sparse — even just `name,category,city`.

> **Attribution & rights:** Wikimedia images carry CC license + author info
> (captured in the story caption). A business's own photos used in a demo you're
> pitching *to that business* are low-risk; still, swap in their supplied photos
> once they engage.

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
   `sites/demo-gallery/src/assets/prospects/<slug>/` and point that prospect's
   JSON `images.hero` / `images.story` at the `/images/<slug>/<file>` path (the
   asset registry resolves it; `astro:assets` optimizes it).
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
