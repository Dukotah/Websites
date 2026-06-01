# Driftwood Cowgirl Boutique

Landing page for Driftwood Cowgirl Boutique — a beachy, boho-western shop in
Bodega, CA, and the home base for Horse N Around Trail Rides.

```bash
cd sites/driftwood-cowgirl-boutique
npm install
npm run dev      # http://localhost:4321
```

## Before going live — details to confirm with the owner

These are marked `VERIFY` in `src/config.ts`:

- **Email** — `hello@driftwoodcowgirl.com` is a placeholder.
- **Phone** — currently the shared location / trail-ride sign-in line
  `(707) 875-3333`. Confirm this is the number they want on the boutique page.
- **Hours** — mirrored from Horse N Around Trail Rides; confirm the boutique's
  actual hours.
- **Domain** — `astro.config.mjs` assumes `driftwoodcowgirl.com`; update if
  different.

## Make it shine

The page currently uses color + emoji icons. It will look far better with real
photos — drop the shop's photos into `public/` and add an image to the hero.
Their Instagram (@driftwoodcowgirlboutique) is a good source once you have rights
to use the images.

All content lives in `src/config.ts`.
