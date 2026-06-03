# Demo gallery

One Astro app that renders **many** prospect demo sites — one per JSON file in
`src/data/prospects/`, served at `/p/<slug>`. Built for cold outreach: generate
a batch, deploy once, and every prospect gets their own link.

- `src/data/prospects/*.json` — one prospect per file (shape = `src/types.ts`,
  the same schema as a single site's `src/config.ts`).
- `src/pages/p/[slug].astro` — renders a prospect by slug.
- `src/pages/index.astro` — your private dashboard listing every demo (`noindex`).
- `src/components/`, `src/layouts/` — the template's components, made
  prop-driven so they render any prospect's config.

Don't hand-edit the JSON files — generate them from the repo root:

```bash
npm run generate-prospects -- data/prospects.csv
```

Full workflow: [`docs/outreach-pipeline.md`](../../docs/outreach-pipeline.md).

## Local preview

```bash
npm install      # first time only
npm run dev      # http://localhost:4321
```

## Deploy

This is its own Vercel project — set **Root Directory** to `sites/demo-gallery`
(see [`docs/deploy-to-vercel.md`](../../docs/deploy-to-vercel.md)), then add a
custom domain like `demos.yourdomain.com`.
