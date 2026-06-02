# Site template

A polished, photo-driven single-page Astro starter for a local business.
Don't copy this by hand — scaffold from the repo root:

```bash
npm run new-site -- <business-slug> "Business Name"
cd sites/<business-slug>
npm install
npm run dev      # http://localhost:4321
```

## What to edit

1. **`src/config.ts`** — start here. Business name, contact info, hours,
   services, photos, and brand colors all live in this one file. Most of a new
   site is done by filling this in.
2. **`public/images/`** — drop in real photos and point `images` in
   `config.ts` at them (or run `npm run fetch-photos -- <business-slug>`).
   Until then, committed SVG placeholders keep the page looking finished.
3. **`public/favicon.svg`** — swap in the client's logo/initial.
4. **`astro.config.mjs`** — set `site` to the real domain before going live.
5. The components in `src/components/` if you need to change layout or add
   sections.

## Structure

```
src/
├── config.ts              ← all business content + theme (edit this first)
├── layouts/BaseLayout.astro
├── components/            ← Header, Hero, About, Services, Contact, Footer
├── pages/index.astro      ← assembles the components into the page
└── styles/global.css      ← base styles + reusable .btn / .section helpers
```

## Commands

| Command           | Action                              |
| ----------------- | ----------------------------------- |
| `npm run dev`     | Local dev server with live reload   |
| `npm run build`   | Build the production site to `dist/` |
| `npm run preview` | Preview the production build        |
