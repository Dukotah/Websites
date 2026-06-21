// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import robots from 'astro-robots';

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
  integrations: [
    // Demo prospect pages (/p/<slug>) are unclaimed outreach demos rendered with
    // robots noindex — keep them OUT of the sitemap so they can't be indexed or
    // outrank the prospect's real site. Only non-/p/ routes are listed.
    sitemap({ filter: (page) => !page.includes('/p/') }),
    // robots.txt: disallow crawling the demo pages; the sitemap reference is
    // added automatically when the sitemap integration is present.
    robots({
      policy: [{ userAgent: '*', disallow: ['/p/'] }],
    }),
  ],
});
