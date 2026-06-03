# Winery Site Automation

This monorepo contains a complete pipeline for generating, deploying, and demoing winery websites as sales tools.

---

## Full Workflow

```
1. Add winery to data/wineries.json
2. Run: npm run generate-winery -- <slug>
3. (Optional) Download photos: node scripts/fetch-photos.mjs sites/<slug>/photos.json
4. Commit & push the new site folder
5. GitHub Actions auto-deploys a Vercel preview
6. Copy the preview URL → email/text the winery owner
```

---

## Step-by-step

### 1. Add winery data

Edit `data/wineries.json` and add a new object. Required fields:

| Field | Description |
|-------|-------------|
| `slug` | URL-safe identifier, e.g. `smith-family-winery` |
| `name` | Winery display name |
| `tagline` | Short tagline (shown in header/footer) |
| `seoDescription` | ~150-char Google description |
| `area` | City, CA |
| `established` | e.g. `"Est. 2004"` |
| `contact` | phone, email, address, note |
| `social` | facebook, instagram, yelp (empty string if not applicable) |
| `hero` | kicker, heading, subheading, ctaText, ctaHref |
| `story` | heading, paragraphs (array), signoff |
| `highlights` | Array of 3–4 short value-prop strings |
| `wines` | Array of wine objects (name, varietal, type, notes) |
| `tastingRoom` | available, note, hours, reservationRequired, reservationLink |
| `awards` | Array of award strings |
| `wikimediaCategory` | Wikimedia Commons category for vineyard photos |
| `theme` | brand (hex), brandDark (hex) |

### 2. Generate the site

```bash
npm run generate-winery -- smith-family-winery
```

This will:
- Copy `sites/_winery-template/` → `sites/smith-family-winery/`
- Write a fully-populated `src/config.ts` from the JSON data
- Create a `photos.json` configured for Wikimedia Commons downloads
- Set the `package.json` name to the slug

### 3. Download photos (optional but recommended)

```bash
node scripts/fetch-photos.mjs sites/smith-family-winery/photos.json
```

This downloads vineyard landscape images and wine bottle photos from Wikimedia Commons into `public/images/`.

### 4. Preview locally

```bash
cd sites/smith-family-winery
npm install
npm run dev
# Visit http://localhost:4321
```

### 5. Commit and push

```bash
git add sites/smith-family-winery
git commit -m "feat: scaffold smith-family-winery demo site"
git push origin your-branch-name
```

### 6. GitHub Actions auto-deploys

The workflow at `.github/workflows/deploy-winery-preview.yml` watches for pushes that change files under `sites/*/` (excluding template folders). For each changed site it:

1. Installs dependencies
2. Runs `vercel deploy --yes`
3. Captures the preview URL
4. Posts a summary table to the GitHub Actions job summary

**Required secrets** (set in repo Settings → Secrets → Actions):
- `VERCEL_TOKEN` — your Vercel API token
- `VERCEL_ORG_ID` — your Vercel organization/team ID

### 7. Send the preview URL

Once the Action completes, open the job summary (or the deploy job logs) to find the Vercel preview URL. Copy it and send it to the winery owner via email or text as a live demo link.

---

## Template structure

```
sites/_winery-template/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── vercel.json
├── photos.json          ← placeholder; replaced by generate script
├── public/
│   ├── favicon.svg
│   └── images/
│       ├── hero.svg     ← SVG placeholder (replaced by downloaded photo)
│       └── about.svg    ← SVG placeholder
└── src/
    ├── config.ts        ← THE file to edit; all content lives here
    ├── components/
    │   ├── Header.astro
    │   ├── Footer.astro
    │   └── WineCard.astro
    ├── layouts/
    │   └── BaseLayout.astro
    ├── pages/
    │   ├── index.astro
    │   ├── wines.astro
    │   ├── story.astro
    │   └── visit.astro
    └── styles/
        └── global.css
```

## Winery data file

```
data/
└── wineries.json    ← Source of truth for all prospect winery data
```

## Scripts

| Script | Usage |
|--------|-------|
| `npm run generate-winery -- <slug>` | Scaffold a new winery site from `data/wineries.json` |
| `npm run new-site -- <slug>` | Scaffold from the generic `_template` (non-winery) |
| `npm run fetch-photos` | Download Wikimedia Commons photos for a site |

---

## Customizing a generated site

After generation, the only file you normally need to touch is:

```
sites/<slug>/src/config.ts
```

All pages are driven from that config. For deeper customization:
- Edit individual `.astro` files under `src/pages/` or `src/components/`
- Swap out SVG placeholders in `public/images/` with real photos
- Change brand colors in `config.theme`
