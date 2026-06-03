# Pecota Vineyard

Marketing website for **Pecota Vineyard** — a small family micro-winery in Shingle
Springs, El Dorado County, CA ("Handcrafted wines, sustainably grown"). Built with
[Astro](https://astro.build) and deployed on [Vercel](https://vercel.com).

Source domain rebuilt from: https://pecotavineyard.com

## Pages

- `/` — home (hero, story intro, sustainability, featured wines, awards, CTA)
- `/wines/` — full wine list (reds & blends, whites)
- `/story/` — the family story + sustainable farming + by-the-numbers
- `/visit/` — how to buy, contact, map, 21+ notice

## Editing content

Almost everything is driven from **`src/config.ts`** — business details, navigation,
the full wine list (name, type, tasting notes, bottle image), the story/sustainability
copy, and brand colors. Edit that file for day-to-day updates.

- Photos live in `src/assets/images/` (optimized at build via `astro:assets`).
  Wine bottle images are matched by the `image` filename in each `wines[]` entry.
- `public/favicon.svg` — burgundy "P" monogram. `public/og.jpg` — link-preview image.
- `astro.config.mjs` — `site` is set to the production domain.

### Notes / still to confirm with the client

- **Tasting notes** for each wine are tasteful, varietal-appropriate placeholders —
  swap in the winery's own descriptions when available.
- No public **email** was listed (inquiries via phone / Instagram), so the contact
  flow is phone-first. Add an email in `config.contact.email` if they want one.
- The old site mentioned a **Shop** and **Recipes** — not included in this first cut.
  Easy to add later as new pages under `src/pages/`.

## Structure

```
src/
├── config.ts                 ← all content + wine list + theme (edit first)
├── layouts/BaseLayout.astro  ← <head>, SEO, OpenGraph, Winery JSON-LD, Header+Footer
├── components/               ← Header, Footer, WineCard
├── pages/                    ← index, wines, story, visit
├── assets/images/            ← photos + bottle shots (optimized at build)
└── styles/global.css         ← design tokens + reusable .btn / .section helpers
```

## Commands

| Command           | Action                              |
| ----------------- | ----------------------------------- |
| `npm install`     | Install dependencies (first time)   |
| `npm run dev`     | Local dev server with live reload   |
| `npm run build`   | Build the production site to `dist/` |
| `npm run preview` | Preview the production build         |

## Deploying

Its own Vercel project on the `dukotahs-projects` team, **Root Directory**
`sites/pecota-vineyard`, isolated from every other site in the repo.
