# Premium site authoring spec (agent contract)

How an agent turns one business's research into a multi-page **premium** demo
(`data/premium/<slug>.json`, schema = `sites/demo-gallery/src/premium/lib/premium-types.ts`).
This replaces the deterministic generator: the agent makes the per-site design
judgment (brand, content, section composition, photo placement) that a rules
engine can't. Quality bar = the hand-built AVISP site (`projects/avisp`).

## Inputs
- `data/research/<slug>.json` — verified facts (`confirmed:true`): tagline, hero
  copy, highlights, about body, services, hours, testimonials, rating, social,
  `_lead` (name/phone/email/address/category/city/state).
- The business's real photos already on disk at
  `sites/demo-gallery/src/assets/prospects/<slug>/` (reference as
  `/images/<slug>/<file>`). **Only reference files that exist.** Hero = best
  landscape/team shot; gallery = the rest. Never invent a photo path.

## Brand (the agent picks — this is real judgment)
Set `brand.color` (hex) + `brand.fontId`. The color seeds the whole palette
(palette.ts); the font sets the type personality.
- **color**: choose a real, fitting brand color — match the business's existing
  brand if known, else a category-appropriate, confident hue (not muddy, not
  default blue). Dental/medical = calm teal/blue/green; BBQ/restaurant = warm
  ember/oxblood/charcoal-warm; trades = strong utilitarian blue/red/orange;
  spa/salon = soft rose/sage/plum; winery = wine red/deep gold.
- **fontId** (one of): `editorial-serif`, `modern-grotesk`, `warm-humanist`,
  `rugged-slab`, `classic-trad`, `clean-sans`, `organic-serif`, `bold-display`,
  `boutique-contrast`, `handcrafted`. Pick for the vibe (e.g. rugged-slab/
  bold-display for BBQ/trades; editorial-serif/classic-trad for dental/law;
  boutique-contrast/organic-serif for spa/winery).

## Pages (3–5; adapt to the business)
Default plan — adjust per business (a restaurant leans menu/photos; a contractor
leans services/proof):
- **home** (slug `home`): `hero` → `stats` (tone `ink`) → `story` → `services`
  (grid, 3–6) → `gallery` or `testimonials` → `cta`.
- **services** (or **menu**): `hero` (variant `editorial`) → `services` (layout
  `rows`, the full list, richer descriptions) → `faq` → `cta`.
- **about**: `hero` (editorial) → `story` (fuller) → `stats` → `gallery` → `cta`.
- **contact**: a single `contact` section (`showMap:true`, `showHours:true`).

## Section rules
- **hero**: `variant` = `split` (home, when a strong landscape/team photo exists),
  `fullbleed` (when a wide hero photo carries it), or `editorial` (interior pages
  / no photo). Headline from REAL specifics (no "Done Right" clichés). 2–4 `badges`
  = real trust facts (years, rating, credentials). CTAs link to `/s/<slug>/contact`
  and `/s/<slug>/services` (and `tel:` the real phone).
- **stats**: only REAL numbers (founding year, rating★ + count, # services, years
  in business). 3–4 items. Don't fabricate.
- **story**: real about copy (paragraphs), `highlights` = real differentiators
  (credentials/licenses/awards) as a checklist, beside a real photo.
- **services**: real services with real one-sentence descriptions. `grid` for a
  scannable home preview, `rows` for the deep services/menu page.
- **testimonials**: ONLY real, verifiable quotes (from research). Omit the section
  if none. Include `rating` when real.
- **gallery**: only the business's real photos. 4–8.
- **faq**: answers from real facts (location, hours, service area, accepting new
  customers). 3–5.
- **cta** / **contact**: real phone/email/address; CTA hrefs internal or tel:.

## Hard rules
- Real facts only. Never fabricate ratings, reviews, years, services, or photos.
  Omit a section rather than pad it.
- Every `images`/section photo `src` must be a file that exists on disk.
- Internal links use `/s/<slug>/<page>`; phone uses `tel:+1…`.
- Set top-level `images.hero` to the home hero photo (drives OG/share + JSON-LD).
- `status`: `ready` only if the site has real photos + verified facts + no gaps;
  else `needs-review` with `flags`.
- Write VALID JSON to `data/premium/<slug>.json`. Match the SOCO Dental reference
  (`data/premium/leslie-jue-dds.json`) for shape + quality.
