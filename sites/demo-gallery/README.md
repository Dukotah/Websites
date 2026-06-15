# Demo gallery

One Astro app that renders **many** premium, multi-page prospect demo sites —
one per JSON file in `src/data/premium/`, served at `/s/<slug>`. Built for cold
outreach: generate a batch, deploy once, and every prospect gets their own link.

- `src/data/premium/*.json` — one prospect per file (shape =
  `src/premium/lib/premium-types.ts`; validate with `npm run premium-validate`).
- `src/pages/s/[slug]/index.astro` + `[page].astro` — render a prospect's
  multi-page site by slug.
- `src/pages/index.astro` — your private dashboard listing every demo (`noindex`).
- `src/premium/components/`, `src/premium/layouts/` — the premium section
  components + layout shell, prop-driven so they render any prospect's config.

Don't hand-edit the JSON files — generate them from the repo root:

```bash
npm run generate -- data/prospects.csv
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
