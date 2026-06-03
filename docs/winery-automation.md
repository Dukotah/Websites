# Winery Site Automation

Turn a winery lead into a live preview link in under 10 minutes. Send them the link and you've already made your pitch.

## The full workflow

### 1. Add the winery to `data/wineries.json`

Open `data/wineries.json` and add a new entry. Copy the shape from an existing entry — you need:

- Basic info: `name`, `slug`, `tagline`, `area`, `established`
- Contact: `phone`, `email`, `address`, `note`
- Social: `instagram`, `facebook`, `yelp` (leave blank if unknown)
- Hero copy, story paragraphs, highlights
- Wine list (name, varietal, type, tasting notes)
- Tasting room: hours, reservation policy
- Awards and accolades
- `wikimediaCategory` for photo fetching (e.g. `"Vineyards in Napa County"`)
- `theme`: brand color and dark accent (match their existing branding if possible)

**Tip:** Most of this info is on their existing website, Google Business Profile, Yelp page, or Instagram. A 5-minute browse is usually enough.

### 2. Generate the site

```bash
npm run generate-winery <slug>
# e.g.
npm run generate-winery sierra-ridge-winery
```

This copies the `_winery-template`, writes a fully-populated `src/config.ts` with all their data, and sets up `photos.json` for image fetching.

### 3. Fetch photos (optional but recommended)

```bash
node scripts/fetch-photos.mjs <slug>
```

This downloads freely-licensed images from Wikimedia Commons: vineyard landscapes for the hero/about sections, and wine bottle photos where available. After fetching, rename or move the downloaded images to match what the site expects:

- `public/images/hero.jpg` — the vineyard hero photo (used on every page)
- `public/images/about.jpg` — founders or barn/winery photo for the story section
- `public/images/wine-<slug>.jpg` — bottle shots (auto-named by the generator)

The `CREDITS.md` file saved next to the images handles attribution.

### 4. Preview locally

```bash
cd sites/<slug>
npm install
npm run dev
```

Open `http://localhost:4321` — the full site is there with the winery's real copy, wines, contact info, and colors. Check it looks good before deploying.

### 5. Deploy to Vercel

**Option A — Push to GitHub (recommended)**

```bash
git add sites/<slug> data/wineries.json
git commit -m "Add <winery name> demo site"
git push
```

GitHub Actions automatically detects the new site, builds it, deploys to Vercel, and posts the preview URL in the **Actions → Summary** tab. Takes about 2 minutes.

**Prerequisites:** Set these repo secrets once:
- `VERCEL_TOKEN` — from vercel.com/account/tokens
- `VERCEL_ORG_ID` — from vercel.com/account (the "Team ID" or personal account ID)

**Option B — Deploy manually**

```bash
cd sites/<slug>
npm install && npm run build
npx vercel deploy --yes
# The URL prints to stdout
```

### 6. Send the link

Copy the Vercel preview URL and send it to the winery owner:

> "Hi [Name], I put together a quick demo of what a modern website could look like for [Winery]. Take a look: https://xyz.vercel.app — happy to hop on a call if you want to walk through it."

That's your pitch. The site is already built with their wines, story, contact info, and colors. They just need to say yes.

---

## Customizing a generated site

After generating, you can edit `sites/<slug>/src/config.ts` directly for quick copy tweaks. For layout changes, edit the `.astro` page files. The entire visual style comes from `src/styles/global.css` and the two theme colors in config — change `brand` and `brandDark` to re-theme the whole site.

## Adding a new winery to the data file

The `data/wineries.json` file is the single source of truth for all prospects. Keep it up to date — even if you don't generate a site immediately, having the data structured makes it fast when you're ready.

## Updating an existing site

Edit `data/wineries.json` with new info, then re-run the generator (you'll need to delete the old site folder first), **or** edit `src/config.ts` directly in the site folder. Either works.
