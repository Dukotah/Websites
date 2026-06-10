# websites ↔ Copper Bay Tech CRM integration (the "demo package")

How the demo factory feeds the duke CRM (`copperbaytech.com`). One mechanism —
the existing **push** path, enriched — not a parallel pull system.

## The loop

```
sonoma-lead-scraper ──CSV──▶ duke CRM (leads)
                                   │  rep picks a lead, you build its demo
                                   ▼
   websites: generate-prospects ─▶ make-thumbnail ─▶ push-to-crm ──┐
                                                                    │ POST /api/crm/admin/preview-url
                                                                    ▼
                              duke CRM lead panel: demo link + status + category
                              + "offer expires" + thumbnail (matched by business name)
```

Join key: the **normalized business name** (`previewKey` on the CRM side) — stable
across CSV re-exports, the only field both sides share.

## The demo package (wire shape)

`push-to-crm.mjs` POSTs `{ entries: [ … ] }`, each entry:

```jsonc
{
  "name": "Smitty's Towing",          // REQUIRED — join key
  "link": "https://demos.copperbaytech.com/p/smittys-towing", // REQUIRED, absolutized
  "slug": "smittys-towing",
  "status": "ready",                  // 'ready' | 'needs-review' (CRM normalizes → needs_review)
  "flags": ["…"],
  "category": "towing",
  "area": "Healdsburg, CA",
  "claimByDate": "2026-07-01",        // '' when unset
  "thumbnailUrl": "https://demos.copperbaytech.com/thumbnails/smittys-towing.png"
}
```

Backward compatible: old `{name, link}` posts still work (all new fields optional).
The CRM stores this per-name in the `lead_previews` Redis hash and **tolerates legacy
bare-URL string values**. In the lead panel a rep now sees the demo link, a status
pill (**amber "Needs Review" gates the Send button**), category, "Offer expires …",
and a **thumbnail preview** — the *same* PNG used in the cold email.

## Run order (one session)

```bash
npm run generate-prospects -- data/<leads>.csv   # writes prospect JSON + outreach-links.json
GALLERY_BASE_URL=https://demos.copperbaytech.com npm run make-thumbnail   # publishes public/thumbnails/<slug>.png
CRM_ADMIN_TOKEN=… GALLERY_BASE_URL=https://demos.copperbaytech.com npm run push-to-crm   # (--all to include needs-review)
```

- **Thumbnails are committed** under `sites/demo-gallery/public/thumbnails/` so they
  deploy with the gallery and are hosted at `/thumbnails/<slug>.png` (used by BOTH the
  email and the CRM panel). `data/thumbnails/` stays gitignored (working copies).
- `claimByDate` comes from each prospect's `outreach.claimByDate` block; unset → no
  expiry shown anywhere (honest, no fake countdown).

## On-demand generation (the "Generate Website" button)

Instead of running CSV batches, the CRM can generate a single lead's demo from a
button on its profile. The button fires a **GitHub `repository_dispatch`**, which
runs `.github/workflows/generate-demo.yml` on a network-enabled runner (so the
scraper + deep photo crawl actually pull the business's real facts and photos),
commits the new prospect to `main` (Vercel deploys on push), and runs
`push-to-crm` to attach the live link back to the lead.

**The button = one API call** from the CRM backend (token kept server-side):

```bash
curl -X POST https://api.github.com/repos/Dukotah/Websites/dispatches \
  -H "Authorization: Bearer $GH_DISPATCH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{
        "event_type": "generate-demo",
        "client_payload": {
          "name": "Smitty's Towing",
          "website": "https://smittystowing.com",
          "category": "towing",
          "city": "Healdsburg", "state": "CA",
          "phone": "(707) 555-0142", "email": "", "address": ""
        }
      }'
```

`client_payload` is exactly a CSV row as JSON (`name` required; everything else
optional — `website` is the biggest quality lever). `GH_DISPATCH_TOKEN` is a
fine-grained PAT with **Contents: read/write** on this repo.

**The link is deterministic**, so the template can use it immediately (before the
build even finishes) — the slug is `name` lowercased with non-alphanumerics
collapsed to hyphens (matching `slugify` in `generate-prospects.mjs`):

```
slug = name.toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
link = `${GALLERY_BASE_URL}/p/${slug}`     // e.g. https://demos.copperbaytech.com/p/smittys-towing
```

So the CRM can drop `link` into the outreach template the moment the button is
clicked; the `push-to-crm` step then confirms it and sets the **status pill**
(`ready` vs `needs-review`) once the runner finishes (~1–2 min). A
`needs-review` result still gates the Send button, exactly as the batch path does.

**Repo setup (owner, one-time):** add Actions **secrets** `CRM_BASE_URL` +
`CRM_ADMIN_TOKEN` and an Actions **variable** `GALLERY_BASE_URL`. The workflow
also runs manually from the Actions tab (`workflow_dispatch`) for testing.

## Env (owner to-dos)

- `CRM_ADMIN_TOKEN` — must equal the value in the duke app (the push is token-gated).
- `GALLERY_BASE_URL` — `https://demos.copperbaytech.com` (absolutizes links + thumbnails).

## Not built (deliberate)

Reverse sync (a converted lead flipping `outreach.published` back in websites) is a
low-priority follow-up — converts usually graduate to a standalone site, so the demo
page's published state rarely matters. Add a `sync-published-from-crm` script only if
cheap-tier clients start living on the gallery long-term.

> Duke side (route + `db.ts` storage + lead panel + email template) is implemented and
> committed in the duke repo (`feat(crm): demo-package metadata on lead previews`).
