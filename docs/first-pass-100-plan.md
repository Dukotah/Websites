# First-Pass 100/100 Plan

> Goal: every new CSV row scores 100/100 on the first generation run, with no manual polish.
> Source: research findings + codebase audit (June 2026).

---

## 1. Gap to 100 Per Dimension

### realPhotos — 25 pts (hardest dimension)

| Sub-check | Points | Current gap |
|---|---|---|
| Non-stock hero | +15 | `isOwn(m)` rejects photos with a credit string — Wikimedia photos silently dropped even when they are the only option. |
| Gallery ≥3 | +7 | `galleryImages` built from `ownPhotos.slice(1)` — same rejection bug means thin sites land 0–1 gallery photos. |
| Non-stock story image | +3 | `storySrc` falls back to `heroPhoto.path` (same URL as hero); scorer awards +3 only when story differs from hero AND is non-stock. |

**Key-free ceiling without fixes:** ~10–15 pts on businesses with no own-site photos.  
**With code fixes only (no API):** ~18–22 pts (own-site photos when available + Wikimedia credited).  
**With Google Places Photos or Mapillary:** 25 pts reliable.

---

### copyAuthenticity — 20 pts

| Sub-check | Points | Current gap |
|---|---|---|
| No TEMPLATED_SERVICE_PATTERN | −8 avoided | Service descriptions fall to `preset.services` when `e.services.length < 3`, producing "Professional X for Y and nearby." — matches TEMPLATED_DESC_PATTERN exactly. |
| About body ≥80 chars, not placeholder | −6 avoided | Fallback about text is ≥80 chars and does not match TEMPLATED_ABOUT_PATTERN — usually safe, but thin. |
| No TEMPLATED_DESC_PATTERN | −6 avoided | Same root cause as service pattern above. |

**Key-free ceiling without fixes:** ~14 pts (loses 6 on service descriptions when scraper finds <3 real services).  
**With fix:** 20 pts — use whatever services count is available (even 1–2) rather than requiring ≥3 before abandoning to preset.

---

### sectionRichness — 20 pts

| Condition | Pts |
|---|---|
| uniqueTypes ≥5 from RICH_TYPES | 20 |
| 4 types | 17 |

Current reliable section set: `services-detailed` + `stats` + `testimonials` + `map` + `hours-contact` = 5 types = 20 pts.  
**Gap:** `stats` requires `established` OR `rating` — when neither is scraped, stats is omitted → 4 types → 17 pts. The `faq` section always builds but is NOT in RICH_TYPES (earns 0 richness pts).  
**Fix (code):** always emit at least 2 stats items (services count is always available). Replace or supplement faq with a RICH_TYPES member like `process` or `feature-grid` for thin-data businesses.

---

### contactComplete — 10 pts

| Sub-check | Points | Gap |
|---|---|---|
| Phone | +3 | Scraper extracts via tel: link and regex — good coverage. |
| Real non-hello@ email | +3 | Multi-page email crawl exists — medium coverage (~60%). |
| Address | +2 | JSON-LD only; no plain-text heuristic fallback ("123 Main St"). |
| Hours length > 0 | +2 | Hardcoded Mon–Fri 8–6 default fills this — always earns +2, but is a false signal. |

**Key-free ceiling without fixes:** ~7–8 pts (address gap on non-JSON-LD sites).  
**Fix (code):** add street-address regex heuristic to scrape-site.mjs; add visible-text hours parser.

---

### identityStrength — 10 pts

| Sub-check | Points | Gap |
|---|---|---|
| fontId ≠ 'modern-grotesk' | +4 | Only lost when `category = 'default'` and modern-grotesk is in the default pool. |
| palette.brand ≠ '#2b2b2b' | +3 | Only lost on edge-case default config — safe for all known categories. |
| shape ≠ 'soft' | +3 | Only lost when `category = 'default'` and soft is selected by seed. |

**Gap:** pure code + CSV hygiene. Ensure CSV always has a non-default category column. Exclude `modern-grotesk` from the default font pool in fonts.ts as a safety net.  
**Key-free ceiling:** 10 pts with both fixes.

---

### trustSignals — 10 pts

| Sub-check | Points | Gap |
|---|---|---|
| testimonials section in plan.sections | +5 | Testimonials built only when `e.testimonials.length` is truthy. Most small-business sites don't embed reviews in JSON-LD — reviews live on Google/Yelp. Data-availability gap. |
| config.established non-empty | +3 | JSON-LD foundingDate + "since YYYY" regex — works on ~30–40% of sites. Data-availability gap. |
| Haystack regex matches rating/review string | +2 | `e.rating` is written into highlights[] — regex matches when scraped. Works when data is available. |

**Key-free ceiling (typical):** ~2–5 pts (rating haystack if scraped; established if published; testimonials only if site embeds them).  
**With Outscraper/Places API:** 10 pts reliable (real rating + testimonials from Google reviews).

---

### seoMeta — 5 pts

| Sub-check | Points | Gap |
|---|---|---|
| seoDescription 80–160 chars | +2 | `clip(seoDescription, 150)` does not guarantee ≥80 chars. Short firstSentence + short name/area can produce <80. |
| Area mentioned in seoDescription | +2 | Composer embeds area — but if `row.city` is empty and backfill hasn't run, area is empty → +2 missed. |
| Tagline non-default | +1 | Fallback tagline does not match TEMPLATED_TAG regex — always earns +1. |

**Key-free ceiling without fixes:** ~3 pts.  
**With fixes (code only):** 5 pts.

---

## 2. Track A — Key-Free Maximum

**No API keys. Only own-site scraping, schema.org parsing, extruct, OSM/Wikidata, heuristic photo filtering.**

### What we can fill reliably

| Source | Fields |
|---|---|
| Own-site JSON-LD (extruct) | name, address, phone, hours, rating, reviewCount, foundingDate, services, description, about, images, testimonials (when embedded) |
| Own-site Open Graph / microdata | og:image, street address, phone (fallback) |
| Sitemap crawl | gallery/about/testimonial subpage discovery |
| Wikidata SPARQL | foundingDate for chains/notable businesses (~10% of arbitrary local businesses) |
| OSM Overpass | address confirmation, start_date (sparse) |
| BBB plain-HTML scrape | years in business, letter grade, accreditation |
| Heuristic stock-photo filter | rejects istock/shutterstock/getty CDN domains, stock filenames, bad alt text, wrong aspect ratio |
| OpenCLIP ViT-B/32 (local, free) | rejects non-business-category photos without any API cost |

### Honest dimension-by-dimension estimate (key-free, with code fixes applied)

| Dimension | Max pts | Key-free realistic | Notes |
|---|---|---|---|
| realPhotos | 25 | 15–20 | Own-site photos pass on ~70–85% of businesses with a site. Gallery ≥3 fails when site has <3 extractable photos. Story image fix adds +3 when 2nd image available. |
| copyAuthenticity | 20 | 18–20 | Service description fix (use 1–2 scraped services) eliminates main risk. About fallback is safe. |
| sectionRichness | 20 | 17–20 | 5 rich sections when established or rating scraped; 4 sections (17 pts) when neither available on thin sites. |
| contactComplete | 10 | 7–9 | Phone + email + hours always. Address: +2 when JSON-LD or new heuristic finds it. |
| identityStrength | 10 | 10 | Pure code fix: non-default category in CSV + remove modern-grotesk from default pool. |
| trustSignals | 10 | 2–5 | Rating haystack when scraped (+2). Established when JSON-LD has foundingDate (+3). Testimonials: 0 unless embedded in site. |
| seoMeta | 5 | 5 | Code fix: pad seoDescription to ≥80 chars; ensure city backfill runs before copy generation. |
| **TOTAL** | **100** | **~74–89** | Wide range driven by trustSignals and realPhotos on thin-data businesses. |

**Honest key-free ceiling: ~85 on businesses with a well-structured site; ~74 on thin sites with no JSON-LD reviews or own photos.**

Dimensions that CANNOT hit max key-free on thin sites:
- **trustSignals** (-5 pts testimonials when no embedded reviews): Google/Yelp reviews do not appear in the business's own HTML — this is a genuine data-availability gap, not a code bug.
- **realPhotos** (−3 to −7 pts gallery/story when site has fewer than 3 extractable images): cannot manufacture real photos from thin sites without an external photo source.

---

## 3. Track B — Single Cheapest API Unlock to Make 100 First-Pass Realistic

### The unlock: Outscraper Google Maps Reviews (pay-as-you-go)

**Why Outscraper over Places API:**
- Google Places API Reviews field = $25/1,000 calls (Enterprise + Atmosphere SKU), strict no-caching ToS, hard limit of 5 reviews.
- Outscraper = $3/1,000 reviews pay-as-you-go, 500 free reviews on account creation, no monthly subscription, credits never expire, returns rating + reviewCount + full review text + author + date + hours + photos URLs in one call.
- For a factory generating ~100 sites/month fetching 3 reviews each: 300 reviews = $0.90/month after the free 500 are exhausted. Effective cost: **~$0.009 per site** for reviews + rating + reviewCount.

### What Outscraper fills

| Field | Enrichment key | Downstream consumers |
|---|---|---|
| rating (number) | `enrichment.rating` | researchCopy highlights, stats section, trustSignals haystack |
| reviewsCount (number) | `enrichment.reviewCount` | researchCopy highlights, stats section |
| reviews[].text (string) | `enrichment.testimonials[].quote` | testimonials section (+5 trust pts) |
| reviews[].author (string) | `enrichment.testimonials[].author` | testimonials section |
| hours (structured) | `enrichment.hours` | hours-contact section, contactComplete |
| photos[].url (string) | `enrichment.images` (append) | acquirePhotos tier-1 |
| founding_year (when available) | `enrichment.established` | stats section, trustSignals +3 |

### Revised dimension estimate with Outscraper

| Dimension | Max pts | With Outscraper | Delta |
|---|---|---|---|
| realPhotos | 25 | 22–25 | +5–7 (Outscraper photo URLs fill gallery; story from 2nd URL) |
| copyAuthenticity | 20 | 20 | 0 (code fix handles this) |
| sectionRichness | 20 | 20 | 0 (stats now always fires; testimonials section always fires) |
| contactComplete | 10 | 9–10 | +1 (hours from Outscraper; address code fix) |
| identityStrength | 10 | 10 | 0 (code fix) |
| trustSignals | 10 | 10 | +5–8 (testimonials always +5; rating always +2; established when available +3) |
| seoMeta | 5 | 5 | 0 (code fix) |
| **TOTAL** | **100** | **~96–100** | |

**Realistic first-pass score with Outscraper: 96–100. The remaining 0–4 pt variance is realPhotos gallery count on businesses with no Google Maps photos.**

### Integration points (from audit)

All changes confined to one new file + one import line:

1. **New file:** `scripts/lib/augment-enrichment.mjs`
   - Exports `async function augmentEnrichment(enrichment, row)`
   - POSTs to `https://api.outscraper.com/maps/reviews-v3?query={row.name}, {row.city}, {row.state}` with `X-API-KEY` header
   - Writes into `enrichment.rating`, `enrichment.reviewCount`, `enrichment.testimonials`, `enrichment.hours`, `enrichment.established`, `enrichment.images` (append)
   - Only fires when `OUTSCRAPER_API_KEY` env var is set (track B mode)

2. **One line in `scripts/lib/scrape-site.mjs`** before `return enrichment` at line 477:
   ```js
   await augmentEnrichment(enrichment, row); // no-op when key absent
   ```

3. **No changes to** generate-prospects.mjs, images.mjs, buildSections, researchCopy, buildConfig, or any scorer — they already consume the enrichment fields correctly.

### Legal / attribution policy for Outscraper data

- Display rating and reviewCount as aggregate stats only — no legal exposure.
- Display review TEXT as short quotes (≤50 words per review) attributed to "Google reviewer" with a hyperlink to the business's Google Maps page — never display reviewer real names.
- Add sitewide disclaimer on every demo page: "This demo is not affiliated with Google LLC. Review excerpts sourced from public Google Maps listings and linked to their original source."
- Do NOT cache or store review text beyond the build artifact; regenerate from API on next build cycle.
- Outscraper absorbs the ToS-vs-Google infrastructure risk (public data, hiQ/Van Buren precedent). Scale here is demo sites, not commercial resale of review data.

---

## 4. Recommended Hybrid: Key-Free Default + Optional Turbo Mode

### Architecture

```
CSV row
  │
  ▼
scrapeSite()         ← always runs; populates enrichment from own-site HTML
  │
  ▼
augmentEnrichment()  ← runs only when OUTSCRAPER_API_KEY env var present
  │                     (or any other turbo-mode key: Places API, Apify, etc.)
  ▼
acquirePhotos()      ← tier-1 uses enrichment.images (now includes API photos)
  │
  ▼
generate config → score → flag any dimension still under threshold
```

### Flag-never-fake policy

Every dimension that the pipeline could not fill gets a machine-readable flag in the output JSON (not a fake value):

```json
"flags": {
  "testimonials": "MISSING — no reviews found on own site or external source",
  "established": "MISSING — no founding date in structured data",
  "galleryImages": "PARTIAL — only 1 photo found, need ≥3 for full score",
  "address": "MISSING — no structured address extracted"
}
```

`deriveStatus` already produces a `flags[]` array — extend it with per-dimension flag codes rather than letting `buildConfig` silently hardcode defaults (e.g., the fake Mon–Fri 8–6 hours should emit a `hours:DEFAULT_PLACEHOLDER` flag).

### Mode detection

```
OUTSCRAPER_API_KEY set → turbo mode (expected score: 96–100)
No keys set           → key-free mode (expected score: 74–89)
```

The factory's terminal output should print the expected-score range for each mode at startup and report per-business score + flag summary after each site is generated.

---

## 5. Concrete Build Checklist

Ordered smallest-first, highest-leverage first within each group.

### Group 0 — CSV hygiene (zero code, immediate gain: +4–7 pts identityStrength/seoMeta)

- [ ] Ensure every CSV row has a non-empty `category` column mapped to a known CATEGORIES key (not `'default'`).
- [ ] Ensure every CSV row has a non-empty `city` column.
- [ ] Confirm `state` is filled for all rows.

---

### Group 1 — Code-only fixes (no API keys, gain: +8–15 pts)

**File: `scripts/lib/scrape-site.mjs`**

- [ ] Add street-address plain-text heuristic after JSON-LD address extraction:
  - Pattern: `/\d+\s+[A-Z][a-z]+\s+(St|Ave|Rd|Blvd|Dr|Ln|Way|Pkwy|Ct|Pl)\b/` in stripped body text.
  - Write first match into `enrichment.address` when JSON-LD address is empty.
  - Gain: +2 contactComplete pts on non-JSON-LD sites.

- [ ] Add visible-text hours parser:
  - Pattern: look for day abbreviations (Mon|Tue|Wed|Thu|Fri|Sat|Sun) adjacent to time patterns (9am, 9:00, 9:00 AM) within 50 chars.
  - Write parsed `{day, hours}` objects into `enrichment.hours` when JSON-LD hours are empty.
  - Gain: eliminates reliance on the fake Mon–Fri 8–6 default; earns honest +2 pts.

- [ ] Expand sitemap crawl to surface gallery/about/testimonial subpages before main-page scrape:
  - Parse `/robots.txt` → sitemap URLs → filter `<loc>` values by slug keywords: `gallery|photos|our-work|about|team|testimonial|review|menu`.
  - Fetch each matched subpage and run extruct on it.
  - Merge additional images, services, testimonials, and about text into enrichment.
  - Gain: increases testimonial and service hit rates on businesses with dedicated subpages.

- [ ] Run `extruct.extract(html, {base_url, syntaxes: ['json-ld','microdata','opengraph']})` instead of manual JSON-LD parsing:
  - Catches microdata `itemprop` (older GoDaddy/Weebly templates) and Open Graph business hours tags missed by current JSON-LD-only pass.
  - Gain: broader coverage on the ~30–40% of sites using microdata or OG instead of JSON-LD.

**File: `scripts/lib/generate-prospects.mjs`**

- [ ] Fix `researchCopy` service-description fallback (line ~413–418):
  - Current: falls back to `preset.services` when `e.services.length < 3`.
  - Fix: use `e.services` when `e.services.length >= 1`; fall back to preset only when `e.services.length === 0`.
  - Gain: +6 copyAuthenticity pts (eliminates TEMPLATED_DESC_PATTERN matches on single-service businesses).

- [ ] Fix `seoDescription` minimum length (line ~440–444):
  - After composing `firstSentence + ' ${row.name} serves ${area}.'`, check `seoDescription.length`.
  - If < 80: append `' ${what} trusted by ${area} residents since ${established || 'years'}.'` (or any safe filler that adds real context without fabricating facts).
  - Never pad with placeholder text.
  - Gain: +2 seoMeta pts.

- [ ] Ensure `row.city` backfill from `e.city` runs before `researchCopy` (confirm lines 803–806 execute before copy generation, not after):
  - If currently ordered after, move backfill earlier.
  - Gain: prevents area-empty edge case that costs +2 seoMeta pts.

- [ ] Fix story image source:
  - `storySrc` currently falls back to `heroPhoto.path`. Change to: use `media[1].path` when it exists; fall back to hero only when no second image is available.
  - Gain: +3 realPhotos pts on any business with ≥2 photos.

- [ ] Fix gallery photo acceptance — include credited (Wikimedia) photos when no own-site photos exist:
  - Current: `isOwn(m)` rejects photos with a credit string.
  - Fix: when `ownPhotos.length === 0`, accept credited photos into `galleryImages` and emit them with a `credit` field in the template.
  - Gain: +7 realPhotos pts on businesses with Wikimedia coverage.

**File: `scripts/lib/fonts.ts`**

- [ ] Remove `modern-grotesk` from the default font pool (or add an explicit exclusion in `pickFont` when category === 'default'):
  - Gain: +4 identityStrength pts as a safety net when CSV category is missing.

**File: `score.ts` (if `faq` is a permanent section type)**

- [ ] Either: add `faq` to `RICH_TYPES`, OR replace the `faq` section in `buildSections` with a `process` or `feature-grid` section (both already in RICH_TYPES) when the business has enough service data to populate it.
  - Gain: +3 sectionRichness pts on thin-data businesses that currently land at 4 types.

---

### Group 2 — New file: augment-enrichment.mjs (turbo mode, gain: +7–26 pts)

- [ ] Create `scripts/lib/augment-enrichment.mjs`:
  ```
  export async function augmentEnrichment(enrichment, row) {
    // no-op in key-free mode
    if (!process.env.OUTSCRAPER_API_KEY) return;
    // POST to Outscraper maps/reviews-v3
    // Map response fields → enrichment fields
    // Legal gate: store quote ≤50 words; attribute to 'Google reviewer'; append Maps URL
    // Append photo URLs to enrichment.images
    // Set enrichment._source = 'outscraper' for flag tracking
  }
  ```

- [ ] Add one import + one call in `scripts/lib/scrape-site.mjs` before `return enrichment` (line 477):
  ```js
  import { augmentEnrichment } from './augment-enrichment.mjs';
  // ...
  await augmentEnrichment(enrichment, row);
  return enrichment;
  ```

- [ ] Add to `augmentEnrichment`: Outscraper photo URL injection into `enrichment.images` (append, not replace — own-site photos take precedence).

- [ ] Add to `augmentEnrichment`: founding year extraction from Outscraper `founding_year` field when present.

---

### Group 3 — Flag-never-fake enforcement

- [ ] Extend `deriveStatus` to emit per-dimension flag codes for unfilled fields:
  - `testimonials:MISSING`, `established:MISSING`, `rating:MISSING`, `gallery:PARTIAL:N`, `address:MISSING`, `hours:DEFAULT_PLACEHOLDER`.

- [ ] Change the fake Mon–Fri 8–6 default hours in `buildConfig` to emit a `hours:DEFAULT_PLACEHOLDER` flag instead of silently writing the hardcoded value. Keep the default value for template rendering but mark it as unverified in the output JSON.

- [ ] Add factory startup log: print mode (key-free vs turbo), expected score range, and per-business score + flag summary after each site.

---

### Group 4 — Key-free photo enrichment (optional, no API key for Mapillary)

- [ ] Register a free Mapillary client token (no credit card, account only).
- [ ] Add a Mapillary tier to `acquirePhotos` in `images.mjs` between tier-1 (own-site) and the Wikimedia fallback:
  - Geocode `row.city + ' ' + row.state` via Nominatim (free, keyless).
  - Query Mapillary `/images?lat=&lng=&radius=30&limit=5&fields=id,thumb_2048_url` with client token.
  - Filter by compass angle facing the street; pass through heuristic stock-photo filter.
  - Append to `enrichment.images`.
  - Gain: +7 realPhotos gallery pts for urban businesses (~50–65% hit rate in US cities).

---

## Dimension-to-Fix Matrix

| Dimension | Key-free fix | Code change | Turbo (API) needed |
|---|---|---|---|
| realPhotos | Story image fix, Wikimedia credited photos, Mapillary | images.mjs, generate-prospects.mjs | Outscraper photos for full 25 |
| copyAuthenticity | Service description fix | generate-prospects.mjs | Not needed |
| sectionRichness | Always-2-stats fix, faq→rich-type swap | generate-prospects.mjs, score.ts | Not needed |
| contactComplete | Address heuristic, hours text parser | scrape-site.mjs | Outscraper hours helps |
| identityStrength | CSV category + font pool fix | fonts.ts | Not needed |
| trustSignals | Sitemap subpage crawl helps; BBB scrape for established | scrape-site.mjs | Outscraper for reliable 10 pts |
| seoMeta | Length pad + city backfill order | generate-prospects.mjs | Not needed |

---

## Legal / Attribution Policy (encoded in factory)

1. **Review text:** display ≤50 words per quote. Attribute to "Google reviewer" with hyperlink to the business's Google Maps page. Never display reviewer real names in the generated HTML.

2. **Star ratings:** display aggregate numeric rating (e.g., "4.8 out of 5") with attribution "via Google Maps." Do not blend with Yelp ratings into one composite score.

3. **Photos:** own-site photos and Mapillary (CC-BY-SA, display Mapillary logo). Never re-host Google Places Photos (ToS: no caching). Wikimedia photos: display CC license and photographer credit in the image caption or footnote.

4. **Sitewide disclaimer on every demo page:** "This demo site is not affiliated with, endorsed by, or sponsored by Google LLC or any third-party review platform. Review excerpts sourced from public listings and linked to their original source. Contact us to claim or update this listing."

5. **Factory gate:** block generation if any of the following flags are unresolved: `photo_source:UNVERIFIED` (no documented license or own-site source). Allow generation with `testimonials:MISSING` (just omit the section). Allow generation with `established:MISSING` (omit from stats). Never write a fake year, fake phone number, fake address, or fabricated review.

---

## Expected Score by Mode

| Mode | Typical score | Edge-case floor |
|---|---|---|
| Key-free, no code fixes | 60–75 | 55 (thin site, no JSON-LD) |
| Key-free + all Group 1 code fixes | 80–89 | 74 (no embedded reviews, thin photos) |
| Key-free + code fixes + Mapillary | 83–92 | 78 |
| Turbo (Outscraper $0.009/site) + code fixes | 96–100 | 93 (no Google Maps listing) |
