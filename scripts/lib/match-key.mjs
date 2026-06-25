// Canonical business-name normalizer — must stay byte-identical to
// scraper-app/contract/normalize.js and Duke's src/lib/crm/matchKey.ts.
//
// TWO distinct keys, do NOT conflate them:
//   * norm()     — LOOSE suppression/dedup key. Strips distinguishing words
//                  (realty/group/team/...). Use ONLY for suppression/dedup;
//                  two different firms can collide, so NEVER join on it.
//   * matchKey() — TIGHT join key. Strips ONLY legal-entity forms
//                  (llc/inc/corp/co/ltd/llp/...) and keeps every distinguishing
//                  word. This is the demo<->lead JOIN key emitted in the
//                  manifest (alongside the stable `id`, which is preferred).
//
// ADDITIVE: emitted next to existing fields, never a replacement for the CRM's
// current name-matching. Do not edit either algorithm without updating the
// other two repo copies.
export function norm(name) {
  let n = (name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  n = n.replace(/\b(llc|inc|incorporated|co|company|group|team|realty|realtors|real estate|properties|brokerage|the)\b/g, " ");
  return n.replace(/\s+/g, "");
}
export function matchKey(name) {
  let n = (name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  n = n.replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|llp)\b/g, " ");
  return n.replace(/\s+/g, "");
}
