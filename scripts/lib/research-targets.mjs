/**
 * research-targets.mjs — build a precise WEB-RESEARCH BRIEF for one lead.
 *
 * The factory is key-free today: the deep external-source research (Yelp / Google /
 * Facebook / BBB / local news) is done by the in-session AGENT (or a keyed pass),
 * not by a deterministic scraper. This module's job is to make that research step
 * DEEP and TARGETED instead of vague: given a lead, it produces ready-to-open
 * query URLs for each source, and given a research file it reports exactly which
 * confirmable facts are still missing. Together they tell the agent precisely
 * what to look up and where — so a flagship lead can be web-verified and promoted
 * to confirmed:true instead of shipping on a thin scrape.
 *
 * Pure + dependency-free + side-effect-free (safe to import anywhere, incl. tests).
 * It NEVER fabricates facts — it only emits places to look.
 */

const enc = (s) => encodeURIComponent(String(s || '').trim());

/** Compact "Name City, ST" search phrase from a lead-ish object. */
export function leadQuery(lead = {}) {
  return [lead.name, [lead.city, lead.state].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ready-to-open research URLs for a lead, one per high-signal source. These are
 * SEARCH/landing URLs (not fabricated profile links) — the agent opens them,
 * confirms the real facts, and writes them back into the research file.
 *
 * Returns: [{ source, why, url }]
 */
export function buildResearchTargets(lead = {}) {
  const q = leadQuery(lead);
  if (!q) return [];
  const name = lead.name || '';
  const place = [lead.city, lead.state].filter(Boolean).join(' ');
  const targets = [
    { source: 'google', why: 'rating, hours, "About"/owner snippets, top reviews', url: `https://www.google.com/search?q=${enc(q)}` },
    { source: 'google-maps', why: 'verified address, hours, photos, review count', url: `https://www.google.com/maps/search/${enc(q)}` },
    { source: 'yelp', why: 'services, price tier, real review quotes + author first names', url: `https://www.yelp.com/search?find_desc=${enc(name)}&find_loc=${enc(place)}` },
    { source: 'facebook', why: 'owner story, founding year, posts, real photos', url: `https://www.facebook.com/search/top?q=${enc(q)}` },
    { source: 'bbb', why: 'founding year, accreditation, principal/owner name', url: `https://www.bbb.org/search?find_text=${enc(name)}&find_loc=${enc(place)}` },
    { source: 'news', why: 'awards, milestones, local-press quotes worth citing', url: `https://news.google.com/search?q=${enc(q)}` },
  ];
  if (lead.website) {
    targets.unshift({ source: 'own-site', why: 'About / Services / Reviews pages the scrape may have missed', url: lead.website });
  }
  return targets;
}

/**
 * What is still missing from a research file that an agent could confirm on the
 * web — drives a focused enrichment pass and the promote-to-confirmed decision.
 *
 * Returns: string[] of gap descriptions (empty ⇒ the file is research-complete).
 */
export function researchGaps(research = {}) {
  const gaps = [];
  const established = research.established || research._lead?.established;
  if (!established) gaps.push('founding year (check About / BBB / Facebook)');
  const services = research.services || [];
  if (services.length < 3) gaps.push(`only ${services.length} service(s) — confirm the real service list`);
  const reviews = research.testimonials || [];
  if (reviews.length < 2) gaps.push(`only ${reviews.length} real review(s) — pull 2–3 verbatim from Google/Yelp`);
  const photos = research.realPhotoUrls || [];
  if (!photos.length) gaps.push('no real photos — source clearly-theirs storefront/work/team shots');
  if (!research._lead?.owner && !research.aboutBody?.length) gaps.push('owner/family story (the trust anchor)');
  if (research.aggregatorHost) gaps.push(`website is an aggregator (${research.aggregatorHost}) — find the real own-site`);
  return gaps;
}

/**
 * Human-readable brief: targets + gaps for one research file. Used by
 * verify-research --targets and flagship-build's research hook so the agent sees
 * exactly what to look up and where, then can promote the file to confirmed:true.
 */
export function formatBrief(research = {}, lead = research._lead || {}) {
  const targets = buildResearchTargets({ ...lead, website: research.website || lead.website });
  const gaps = researchGaps(research);
  const lines = [];
  lines.push(`  RESEARCH BRIEF — ${lead.name || research.slug || '(unknown)'}`);
  if (gaps.length) {
    lines.push('    Gaps to confirm on the web:');
    for (const g of gaps) lines.push(`      • ${g}`);
  } else {
    lines.push('    No open gaps — file looks research-complete; verify then set confirmed:true.');
  }
  if (targets.length) {
    lines.push('    Where to look:');
    for (const t of targets) lines.push(`      • ${t.source.padEnd(11)} ${t.url}   (${t.why})`);
  }
  return lines.join('\n');
}
