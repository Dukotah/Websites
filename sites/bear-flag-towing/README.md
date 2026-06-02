# Site template

A single-page Astro starter for a local business. Copy this whole folder to
start a new site:

```bash
cp -r sites/_template sites/<business-name>
cd sites/<business-name>
npm install
npm run dev      # http://localhost:4321
```

## What to edit

1. **`src/config.ts`** — start here. Business name, contact info, hours,
   services, and brand colors all live in this one file. Most of a new site is
   done by filling this in.
2. **`public/favicon.svg`** — swap in the client's logo/initial.
3. **`astro.config.mjs`** — set `site` to the real domain before going live.
4. The components in `src/components/` if you need to change layout or add
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
