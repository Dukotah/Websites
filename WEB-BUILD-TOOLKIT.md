# Pro Website-Build Toolkit (Astro + Claude Code)

Vetted June 2026. Tools chosen to raise quality/correctness/speed when an AI agent builds client sites. Skeptic flags inline. Prefer official/first-party; verify star counts/maintenance before adopting.

## Top 8 to adopt now
1. **Playwright MCP** (`@playwright/mcp`, Microsoft, ~34k★) — agent gets eyes+hands: screenshot, click, fill forms, read a11y-tree snapshot. Add to `.mcp.json`, point at `localhost:4321`, verify after every change. Biggest single quality lever. (Pre-1.0, expect schema churn.)
2. **`Stop` hook → `astro build` + QA** in `settings.json` — hard pass/fail gate so the agent can't finish on a broken build/regressed score. Anthropic's headline best practice.
3. **Pagefind** via `astro-pagefind` (v2, ~533★) — static full-text search, zero backend; drop-in `<Search/>`, indexes `dist/` at build.
4. **Unlighthouse** (whole-site Lighthouse crawl) + **Lighthouse CI** (`@lhci/cli`, budget gate). Run after `astro build && astro preview`.
5. **`astro:assets` `<Image>` everywhere** (core, Sharp; replaces deprecated `@astrojs/image`) — WebP/AVIF, responsive srcset, `priority` for LCP. Put "always use `<Image>`" in CLAUDE.md.
6. **astro-og-canvas** (delucis) — branded per-page OG social cards at build, no runtime fn.
7. **lychee** (broken links, Rust, ~3.7k★) + **@axe-core/cli** / **pa11y-ci** (a11y; pa11y IS actively maintained) in the post-build pipeline.
8. **`frontend-qa` subagent + `astro-conventions` skill** (official Claude Code features) — isolate QA noise; keep verbose conventions out of every session.

Minimal `.mcp.json`: Playwright MCP + a Lighthouse MCP. Add Chrome DevTools MCP for perf/console debugging; Figma MCP only with a real Figma file.

## By category (best picks)
- **MCP see/test:** Playwright MCP (essential) · Chrome DevTools MCP (~43k★, diagnosis/perf traces) · Figma Dev Mode MCP (only from a real design, beta) · Lighthouse MCP (danielsogl, convenience) · a11y MCP (ronantakizawa).
- **UI/CSS:** Tailwind v4 via `@tailwindcss/vite` (NOT deprecated `@astrojs/tailwind`) · **Starwind UI** (657★, "shadcn for Astro", native) · shadcn/ui (React islands; compose in one .tsx) · daisyUI (pure CSS, no islands) · Accessible Astro Components · Astro Icon / @lucide/astro (verify icon names — AI hallucinates them).
- **Animation:** **Motion** (was Framer Motion; `motion/react`) · **GSAP** (100% FREE since Apr 2025, all plugins) · Astro View Transitions (built-in; re-init 3rd-party JS on `astro:page-load`).
- **Themes:** AstroWind (~5.7k★, on Astro v6/Tailwind v4) · Astroship (lighter) · AstroPaper (blog).
- **Tokens:** Style Dictionary (v4, DTCG) — only when a design system/Figma exists.
- **Visual regression:** Playwright `toHaveScreenshot` (best default; baselines OS/browser-sensitive — generate in CI container) · Argos CI (human review UI).
- **Perf/a11y/links/html:** Unlighthouse + Lighthouse CI · @axe-core/cli + pa11y-ci · lychee (or linkinator for Node) · html-validate (offline) / vnu (true W3C, needs Java).
- **SEO/CWV/schema:** astro-seo (jonasmerlin, ~1.3k★) · @astrojs/sitemap · web-vitals (RUM) · schema-dts + astro-seo-schema (typed JSON-LD).
- **Analytics (open/portable):** Umami (MIT, self-host) or Plausible CE (AGPL); Vercel/Cloudflare = convenient but proprietary. Fathom is closed-source despite privacy marketing.
- **Images/assets:** **Pexels API** (best — free key, may self-host into `src/assets/`) · Pixabay (cache 24h) · Unsplash (highest quality but hotlink/attribution terms fight build-time optimization — use Unsplash MCP `drumnation/unsplash-smart-mcp-server` if you must). AI-gen: gpt-image-1 / FLUX.2 → save bytes to `src/assets/`. Placeholders: Lorem Picsum, placehold.co, @faker-js/faker.
- **Claude Code:** subagents (`.claude/agents/*.md`) · skills (`.claude/skills/*/SKILL.md`, slash commands now = skills) · hooks (deterministic gates) · `.mcp.json` (git-shareable) · lean CLAUDE.md (<200 lines, path-scoped rules). Docs now at code.claude.com/docs. Best-practices page is the key read. Community: anthropics/skills (start here), hesreallyhim/awesome-claude-code, VoltAgent/awesome-claude-code-subagents (but most "frontend" agents assume React — adapt for Astro).

## Avoid (abandoned / hype / wrong-stack)
`@astrojs/tailwind` (→ Vite plugin) · `@astrojs/image` (→ astro:assets) · `astro-robots-txt` (stale → astro-robots) · `@astrolib/seo` (→ astro-seo) · Lost Pixel (archived Apr 2026) · BackstopJS (stale 2023) · broken-link-checker/blc (abandoned) · AOS (stalled) · Tailark (React-only) · Deque Axe MCP (paid, 6★) · via.placeholder.com (dead) · Fathom (closed-source).

## Recommended factory stack
AstroWind/Astroship (Astro v6 + Tailwind v4) → Starwind/daisyUI native, shadcn/Motion/GSAP when richer → `<Image>` everywhere, Pexels/AI-gen into src/assets → astro-seo + sitemap + schema-dts + astro-og-canvas + web-vitals → astro-pagefind if search → Umami/Vercel analytics → `.mcp.json` (Playwright + Lighthouse) → `Stop` hook QA pipeline (html-validate → lychee → axe/pa11y → unlighthouse/lhci → Playwright screenshots) + frontend-qa subagent + plan mode.
