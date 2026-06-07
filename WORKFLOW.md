# WORKFLOW.md — cold lead → demo site → CRM → sent email

This is the end-to-end outreach pipeline. It spans **three repos** that hand off
to each other; the join key across all of them is the **business name**
(normalized — case/punctuation are ignored). No shared IDs.

## The three moving parts

| Repo | Role | Output |
|---|---|---|
| **sonoma-lead-scraper** | Sources the cold-lead universe | `lead-tracker/data/export/ALL_COUNTIES_dedup.csv` |
| **Websites** (this repo) | The site factory | Bespoke demo sites at `/p/<slug>` + `data/outreach-links.json` |
| **Duke** | The CRM reps work in | `copperbaytech.com/crm` — queue, outreach, pipeline, earnings |

## The one-command path (recommended)

```bash
npm run pipeline -- --csv data/leads.csv            # generate → build → audit → deploy → CRM links
npm run pipeline -- --csv data/leads.csv --dry-run  # preview everything, change nothing outward
npm run pipeline -- --csv data/leads.csv --send     # also fire cold outreach (gated, see Stage 5)
```

`scripts/run-pipeline.mjs` chains the steps below and **fails closed** — if the
build breaks or the audit finds a critical issue, it stops before anything ships.
Each step can be skipped (`--skip-generate`, `--no-build`, `--no-audit`,
`--no-deploy`, `--no-crm`). The stages, run manually, are:

## Stage 1 — Source cold leads (`sonoma-lead-scraper`)

The scraper builds the raw lead list (`name, category, city, phone, email,
website, …`) and commits `ALL_COUNTIES_dedup.csv`. The Duke CRM reads this file
directly over raw GitHub (`src/app/api/crm/leads/route.ts` → `CSV_URL`), so
updating the CSV updates the CRM's lead pool. The push webhook
(`/api/crm/webhook`) clears the lead cache when that CSV changes — fresh data,
no redeploy. **Every business in that CSV is a cold lead in the rep's queue.**

## Stage 2 — Generate the demo sites (`Websites`)

```bash
npm run generate-prospects -- data/leads.csv
```

For each row with a `website`, the factory scrapes the business's real facts +
photos, writes bespoke copy, varies layout/fonts (anti-cookie-cutter divergence
so siblings don't look templated), and flags thin sites `needs-review`. It writes
one JSON per prospect to `sites/demo-gallery/src/data/prospects/` and a
`data/outreach-links.json` manifest (`name, email, link, status`).

QA gates before sending: `npm run shots` (visual), `node scripts/audit.mjs`
(mechanical, exits non-zero on criticals). Fix every `needs-review`.

## Stage 3 — Deploy the gallery (`Websites`)

```bash
git add sites/demo-gallery/src/data/prospects sites/demo-gallery/src/assets/prospects
git commit -m "Add outreach prospects: <batch>"
git push     # → main; Vercel rebuilds the gallery → links go live (~1 min)
```

One Astro app hosts every demo at `/p/<slug>`.

## Stage 4 — Plug links into the CRM (`Websites` → `Duke`)

```bash
export CRM_BASE_URL=https://copperbaytech.com
export CRM_ADMIN_TOKEN=<same secret set on Duke's Vercel env>
npm run push-to-crm          # --dry-run to preview first
```

`scripts/push-to-crm.mjs` reads the manifest and POSTs each `{name, link}` to
Duke's token-gated `POST /api/crm/admin/preview-url`. Duke stores it in Redis
keyed by normalized name (`setLeadPreview`); the leads API enriches every lead
with `previewUrl`. Idempotent — safe to re-run. Unmatched names are reported as
`skipped` (fix the name or add the lead, then re-run).

## Stage 5 — Work the cold leads + send outreach (`Duke` CRM)

A rep logs into `copperbaytech.com/crm`. Tabs: **Queue · Follow-ups · Pipeline ·
Leads · Email · Scripts · Earnings**. Lifecycle:

1. **Call queue** — cold leads sorted; a lead with a demo shows a violet **"Demo"
   badge** so reps lead with "I already built you a site."
2. **Claim & call** — rep claims, uses call timer + scripts, logs the outcome →
   status `new → contacted → follow_up → won / not_interested`.
3. **The demo is the hook** — opening the lead shows **"Preview site we built"**
   (+ copy button) → the live `/p/<slug>` page.
4. **Email outreach** — single (`EmailComposer`) or **BulkOutreach**, sent via
   Resend with **suppression-list** filtering and a **daily warm-up cap** that
   ramps as the sending domain ages (protects deliverability on cold sends).
5. **Pipeline** — drag `new → contacted → interested → won/lost`.
6. **Convert** — a won deal becomes a **submission** (pending/accepted/rejected)
   with a commission value feeding **Earnings**; graduate the prospect to a paid
   standalone site via `npm run new-site`.

## The closed loop

```
sonoma-lead-scraper ──CSV──▶ Duke CRM (cold leads in the queue)
        │                          ▲
        └──CSV──▶ Websites factory  │ push-to-crm (name → demo link)
                   generate ──▶ deploy gallery ──┘
                                          │
   Rep works the cold lead in CRM ◀───────┘  ("Demo" badge + preview link)
        └──▶ won ──▶ standalone paid site (new-site)
```

## Automatic vs. you-own

- **Automatic:** site generation, photo scraping, gallery deploy on push, CRM
  reading the lead CSV, link-to-lead matching, the Demo badge/preview link,
  outreach suppression + warm-up cap.
- **You own (one-time / per-batch):** Vercel projects + domains; setting
  `CRM_ADMIN_TOKEN` (Duke env) and matching it on the push; running the pipeline
  per batch; Resend domain verification (`OUTREACH_DOMAIN_VERIFIED_DATE`) for
  email.

## The one gotcha that silently breaks the loop

The CRM lead name and the prospect `name` must match (case/punctuation are
normalized away, real spelling differences are not). Always
`npm run push-to-crm -- --dry-run` first and check for `skipped` names.
