// Canonical business-name match key — must stay byte-identical to
// scraper-app/contract/normalize.js and Duke's future shared copy.
//
// The intent is ONE match function across all three repos so a normalized name
// computed here agrees with the CRM's join key. This is ADDITIVE: it is emitted
// alongside the existing fields, never a replacement for the CRM's current
// name-matching. Do not edit the algorithm here without updating the other copies.
export function norm(name) {
  let n = (name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  n = n.replace(/\b(llc|inc|incorporated|co|company|group|team|realty|realtors|real estate|properties|brokerage|the)\b/g, " ");
  return n.replace(/\s+/g, "");
}
export const matchKey = norm;
