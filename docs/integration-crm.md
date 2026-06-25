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
npm run generate -- data/<leads>.csv   # writes prospect JSON + outreach-links.json
GALLERY_BASE_URL=https://demos.copperbaytech.com npm run make-thumbnail   # publishes public/thumbnails/<slug>.png
CRM_ADMIN_TOKEN=… GALLERY_BASE_URL=https://demos.copperbaytech.com npm run push-to-crm   # (--all to include needs-review)
```

- **Thumbnails are committed** under `sites/demo-gallery/public/thumbnails/` so they
  deploy with the gallery and are hosted at `/thumbnails/<slug>.png` (used by BOTH the
  email and the CRM panel). `data/thumbnails/` stays gitignored (working copies).
- `claimByDate` comes from each prospect's `outreach.claimByDate` block; unset → no
  expiry shown anywhere (honest, no fake countdown).

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
