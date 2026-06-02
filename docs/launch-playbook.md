# Launch playbook (one site, start to live)

A tight loop for shipping a client site fast. Repeat per business.

## 1. Scaffold (30 sec)

```bash
npm run new-site -- <folder-slug> "Business Name"
cd sites/<folder-slug>
npm install
npm run dev
```

## 2. Fill in `src/config.ts` (the only file you usually touch)

- `name`, `tagline`, `area`, `established`
- `contact` (phone / email / address) and `social` (leave `''` to hide)
- `hero` heading + CTA, and `highlights`
- `about.heading` + `about.body` (array of paragraphs), optional `about.signature`
- `services` (title + description each) and `servicesHeading`
- `hours` + optional `hoursNote`
- `theme.brand` (accent) and `theme.brandDark` (headings + dark sections)

## 3. Photos

Pick one:

- **Client's own photos** → drop in `public/images/`, set `images.hero` /
  `images.story` to those paths.
- **Freely-licensed** → edit `photos.json` (Commons files and/or categories),
  then from the repo root: `npm run fetch-photos -- <folder-slug>`. Point the
  `images` paths at the downloads. Attribution lands in
  `public/images/CREDITS.md`.

Leave the defaults and the page still looks finished (SVG placeholders).

## 4. Final checks

```bash
npm run build      # must finish clean
npm run preview    # read top-to-bottom, desktop + mobile
```

- Tap-to-call works, every link resolves, map points to the right place.
- Set the real domain in `astro.config.mjs` (`site:`).

## 5. Ship + deploy

```bash
# from repo root
git add sites/<folder-slug>
git commit -m "Add <Business Name> site"
git push
```

- Add the site to the table in the root `README.md` (copy a row, change the
  `root-directory=` and `project-name=` in the Deploy button URL).
- Click the **Deploy** button (or import in Vercel and set **Root Directory** to
  `sites/<folder-slug>`). Full details: [`deploy-to-vercel.md`](deploy-to-vercel.md).

That's it — repeat for the next one.
