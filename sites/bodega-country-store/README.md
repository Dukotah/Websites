# Bodega Country Store

A redesigned landing page for the **Bodega Country Store** — a historic general
store in Bodega, CA (the original at [alwayssunnyinbodega.com](https://www.alwayssunnyinbodega.com/)).

Built with [Astro](https://astro.build) and ready to deploy on
[Vercel](https://vercel.com).

## Quick start

```bash
cd sites/bodega-country-store
npm install
npm run dev          # http://localhost:4321
npm run build        # production build into dist/
npm run preview      # preview the production build
```

## Editing content

Almost everything on the page is driven from **`src/config.ts`** — business
name, tagline, hours, address, the "what's inside" cards, the "Our Story"
copy, and the brand colors. Change that one file to update most of the site.

## Sections

- **Hero** — "It's always sunny in Bodega" with a sunny coastal scene.
- **Our Story** — the 1850s history (McCaughey Brothers Mercantile).
- **What's Inside** — deli, produce, coffee, cheese, wine, gifts.
- **Landmark** — the Alfred Hitchcock "The Birds" film connection.
- **Visit** — hours, address, embedded Google Map, and directions.

## Notes before going live

The content was assembled from the store's existing site and public listings.
Confirm these with the owner before launch:

- Phone, email, and exact opening hours (`src/config.ts` → `contact` / `hours`).
- Social links (`src/config.ts` → `social`).
- Swap in real store photography for the hero/offerings if available.

## Deploying

Create a Vercel project pointing at this repo with **Root Directory** set to
`sites/bodega-country-store`. See `docs/deploy-to-vercel.md` in the repo root.
