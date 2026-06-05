// @ts-check
import { defineConfig } from 'astro/config';

// The deployed domain. Social-share previews (og:image/twitter) and canonical
// URLs need an ABSOLUTE base, so set SITE_URL to the demos domain on Vercel
// (e.g. https://demos.copperbaytech.com). Falls back to the Vercel-provided URL,
// then a placeholder for local builds.
const site =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://example.com');

// https://astro.build/config
export default defineConfig({
  site,
});
