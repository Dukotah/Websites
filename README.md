# Websites

A collection of websites for local businesses, built with [Astro](https://astro.build)
and deployed on [Vercel](https://vercel.com). Each business gets its own
self-contained folder under `sites/` — they share nothing at runtime, so one
site can never break another.

## Repository layout

```
websites/
├── sites/                ← one folder per client website
│   ├── _template/        ← starter you copy to begin a new site
│   └── example-cafe/     ← a complete, working example to learn from
├── shared/               ← assets/snippets you reuse across sites (optional)
└── docs/
    ├── new-site-checklist.md   ← step-by-step for starting a new site
    └── deploy-to-vercel.md     ← how to put a site live on Vercel
```

## Starting a new site

The short version (full details in [`docs/new-site-checklist.md`](docs/new-site-checklist.md)):

```bash
# 1. Copy the template to a new folder named after the business
cp -r sites/_template sites/joes-plumbing

# 2. Install dependencies and start the dev server
cd sites/joes-plumbing
npm install
npm run dev          # opens http://localhost:4321
```

Then edit **`src/config.ts`** — that one file holds the business name, phone,
address, hours, colors, and services. Most of a new site is filled in there
before you touch any layout.

## Running a site locally

```bash
cd sites/<site-name>
npm install          # first time only
npm run dev          # live-reloading preview
npm run build        # production build into dist/
npm run preview      # preview the production build
```

## Deploying to Vercel

Each site is a **separate Vercel project pointing at this same repo**, with its
**Root Directory** set to that site's folder (e.g. `sites/joes-plumbing`).
Push to GitHub and Vercel rebuilds automatically. Full walkthrough in
[`docs/deploy-to-vercel.md`](docs/deploy-to-vercel.md).

## Why this structure?

- **One repo, many sites** — everything in one place, easy to manage with Claude.
- **Each site is independent** — its own dependencies and build; no shared
  breakage, and you can use a different stack for a site later if you ever need to.
- **Astro by default** — fast-loading and SEO-friendly, which is what local
  businesses actually need to get found on Google. Free to host on Vercel.
