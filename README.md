# Websites

A collection of independent websites for local businesses, built with
[Astro](https://astro.build) and deployed on [Vercel](https://vercel.com). Each
business gets its own self-contained folder under `sites/` — they share nothing
at runtime, so one site can never break another, and each deploys as its own
Vercel project.

## Repository layout

```
websites/
├── sites/                    ← one folder per client website
│   ├── _template/            ← starter you copy to begin a new site
│   ├── example-cafe/         ← a simple, complete example
│   └── bodega-country-store/ ← a richer, photo-driven example
├── scripts/                  ← repo helpers (scaffold a site, fetch photos)
│   ├── new-site.mjs
│   └── fetch-photos.mjs
├── shared/                   ← optional assets/snippets you reuse (not auto-imported)
└── docs/
    ├── new-site-checklist.md ← step-by-step for starting a new site
    └── deploy-to-vercel.md   ← how to put a site live on Vercel
```

## The sample sites

| Site | Folder | Deploy |
| --- | --- | --- |
| The Corner Cup (example café) | `sites/example-cafe` | [![Deploy](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/dukotah/websites&root-directory=sites/example-cafe&project-name=example-cafe) |
| Bodega Country Store | `sites/bodega-country-store` | [![Deploy](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/dukotah/websites&root-directory=sites/bodega-country-store&project-name=bodega-country-store) |

> The **Deploy** buttons import the repo into Vercel with the site's **Root
> Directory** pre-filled — the one setting that makes a monorepo work. See
> [`docs/deploy-to-vercel.md`](docs/deploy-to-vercel.md) for the full walkthrough
> and custom domains.

## Starting a new site

Use the scaffolding script (copies the template and wires up the name):

```bash
npm run new-site -- joes-plumbing "Joe's Plumbing"

cd sites/joes-plumbing
npm install
npm run dev          # http://localhost:4321
```

Then edit **`src/config.ts`** — that one file holds the business name, phone,
address, hours, colors, services, and photo paths. Most of a new site is filled
in there before you touch any layout.

New sites start from the same polished, photo-driven design as the
Bodega example. For the fast start-to-live loop, follow the
[**launch playbook**](docs/launch-playbook.md); for the detailed checklist see
[`docs/new-site-checklist.md`](docs/new-site-checklist.md).

## Adding real photos

Photos make or break these pages. Two ways to get them in:

1. **Drop in the client's own photos** — put them in the site's `public/images/`
   and point the image paths in `src/config.ts` at them. (Best for real clients.)
2. **Pull freely-licensed photos** of the location from Wikimedia Commons:

   ```bash
   npm run fetch-photos -- bodega-country-store
   ```

   This reads `sites/<site>/photos.json`, downloads the images into the site's
   `public/images/`, and writes a `CREDITS.md` with attribution. Then point the
   `images` paths in `src/config.ts` at the downloaded files.

> Note: the photo fetcher needs normal internet access — run it on your machine,
> not inside a restricted CI/sandbox.

## Running a site locally

```bash
cd sites/<site-name>
npm install          # first time only
npm run dev          # live-reloading preview
npm run build        # production build into dist/
npm run preview      # preview the production build
```

## Why this structure?

- **One repo, many sites** — everything in one place, easy to manage.
- **Each site is independent** — its own dependencies, build, and Vercel
  project; no shared breakage. You could even use a different stack for one site.
- **Astro by default** — fast-loading and SEO-friendly, which is what local
  businesses need to get found on Google. Free to host on Vercel.
