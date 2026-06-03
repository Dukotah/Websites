# Bear Flag Towing

Marketing website for **Bear Flag Towing** — 24/7 towing, roadside assistance,
and vehicle recovery in Santa Rosa & Sonoma County, CA. Built with
[Astro](https://astro.build) and deployed on [Vercel](https://vercel.com).

Live domain: **https://www.bearflagtowing.com**

## Editing content

Almost everything on the page is driven from **`src/config.ts`** — business name,
phone, email, address, services, service area, reviews, FAQ, hours, and brand
colors. Edit that one file to update the site; no layout changes needed for
day-to-day content.

A few things live outside the config:

- **`public/favicon.svg`** — the browser-tab icon (California-flag red star).
- **`public/og.jpg`** — the image shown when the site is shared in texts/social.
- **`src/assets/images/`** — the photos used on the page (optimized at build).
- **`astro.config.mjs`** — `site` is set to the production domain.

### Adding real photos

Drop new `.jpg`/`.png` files into `src/assets/images/`, then reference them from
`src/config.ts` (services) or import them in the relevant component. Astro
automatically compresses and serves them as responsive WebP.

### Still to do (optional)

- Add the real Facebook / Instagram / Google Business Profile links in
  `config.social` (they were Wix placeholders on the old site, so they're hidden).
- Swap in any additional real truck/job photos as they become available.

## Structure

```
src/
├── config.ts                 ← all business content + theme (edit this first)
├── layouts/BaseLayout.astro  ← <head>, SEO, OpenGraph, LocalBusiness schema
├── components/               ← Header, Hero, Services, About, Steps,
│                                ServiceArea, Testimonials, Faq, CtaBand,
│                                Contact, Footer
├── pages/index.astro         ← assembles the components into the page
├── assets/images/            ← photos (optimized at build via astro:assets)
└── styles/global.css         ← design tokens + reusable .btn / .section helpers
```

## Commands

| Command           | Action                               |
| ----------------- | ------------------------------------ |
| `npm install`     | Install dependencies (first time)    |
| `npm run dev`     | Local dev server with live reload    |
| `npm run build`   | Build the production site to `dist/`  |
| `npm run preview` | Preview the production build          |

## Deploying

This site is its own Vercel project pointing at the `websites` repo with **Root
Directory** set to `sites/bear-flag-towing` and the production branch set to
`bear-flag-towing`. Pushing to GitHub triggers an automatic rebuild. Full
walkthrough in [`../../docs/deploy-to-vercel.md`](../../docs/deploy-to-vercel.md).
