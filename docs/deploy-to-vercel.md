# Deploying a site to Vercel

Each site in this repo becomes its **own Vercel project**, all connected to this
same GitHub repository. The magic setting is **Root Directory** — it tells
Vercel which folder to build, so one repo can power many independent live sites.

## One-time: connect the repo

1. Sign up / log in at [vercel.com](https://vercel.com) (free Hobby plan is fine).
2. Install the Vercel GitHub app and give it access to this repository.

## For each new site

1. In Vercel, click **Add New… → Project**.
2. Pick this GitHub repo (`dukotah/websites`).
3. **Set the Root Directory** to the site's folder, e.g. `sites/joes-plumbing`.
   This is the most important step — without it, Vercel tries to build the whole
   repo and fails.
4. Framework Preset should auto-detect as **Astro**. Leave the build settings at
   their defaults:
   - Build command: `astro build` (auto)
   - Output directory: `dist` (auto)
5. Click **Deploy**. In ~1 minute you get a live URL like
   `joes-plumbing.vercel.app`.

Repeat for every site — they each get their own project, URL, and settings, but
all live in this one repo.

## Automatic deploys

Once connected, every `git push` to the repo triggers Vercel to rebuild **only
the projects whose files changed**. Pull requests get their own preview URLs so
you can show a client a draft before it's public.

## Custom domains (theirbusiness.com)

When a client is ready to use their real domain:

1. Open the site's Vercel project → **Settings → Domains**.
2. Add their domain (e.g. `joesplumbing.com`).
3. Vercel shows the DNS records to set. Either:
   - Point the domain's nameservers / records at Vercel at the client's current
     registrar, **or**
   - Buy/transfer the domain through Vercel for the simplest setup.
4. HTTPS is provisioned automatically and free.

Remember to also update `site:` in that project's `astro.config.mjs` to the real
domain and push, so SEO tags and any sitemap use the correct URL.

## Cost

The free **Hobby** plan covers personal/small projects and is plenty for
brochure-style local business sites. If you start doing this commercially at
volume, review Vercel's plans — but you can launch many sites for free to start.
