# New site checklist

A repeatable process for taking a local business from "no/bad website" to live.

## 1. Set up the project

```bash
# From the repo root. Name the folder after the business (lowercase, dashes).
cp -r sites/_template sites/joes-plumbing
cd sites/joes-plumbing
npm install
npm run dev        # preview at http://localhost:4321
```

## 2. Gather the business details

Before writing anything, collect:

- [ ] Business name
- [ ] Phone, email, physical address
- [ ] Town / area they serve (important for showing up in local Google searches)
- [ ] List of services or products
- [ ] Opening hours
- [ ] A short story / "about us" blurb
- [ ] Logo and any photos (drop logo into `public/`)
- [ ] Brand colors (or pick something that fits their vibe)
- [ ] Social / Google Business Profile links

## 3. Fill in `src/config.ts`

This one file holds nearly all the content. Update:

- [ ] `name`, `tagline`, `area`
- [ ] `seoDescription` (mention the town — helps local search)
- [ ] `contact` (phone / email / address)
- [ ] `social` links (leave `''` to hide one)
- [ ] `hero` heading + call-to-action
- [ ] `about` story
- [ ] `services` cards
- [ ] `hours`
- [ ] `theme.brand` / `theme.brandDark` colors

## 4. Polish

- [ ] Replace `public/favicon.svg` with the client's logo/initial
- [ ] Add real photos if you have them
- [ ] Read the page top to bottom on desktop and mobile (browser dev tools)
- [ ] Check every link and the phone "tap to call" works
- [ ] Set the real domain in `astro.config.mjs` (`site:`)

## 5. Verify the build

```bash
npm run build      # must finish with no errors
npm run preview    # final check of the production build
```

## 6. Ship it

```bash
# From the repo root
git add sites/joes-plumbing
git commit -m "Add Joe's Plumbing site"
git push
```

Then follow [`deploy-to-vercel.md`](deploy-to-vercel.md) to put it live.

## Naming convention

Use lowercase folder names with dashes, matching the business:
`joes-plumbing`, `maple-grove-dental`, `riverside-bakery`. Keep it consistent —
it becomes part of the Vercel project setup.
