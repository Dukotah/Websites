/**
 * osm.mjs — KEY-FREE, fail-soft enrichment from open map/knowledge sources.
 *
 * The business's OWN website (scrape-site.mjs) is the strongest "that's me"
 * source, but plenty of small businesses have a thin or photo-less site. This
 * module fills the gap from PUBLIC, no-key sources — each fetched only at
 * generate-time, with a short timeout, a proper User-Agent, results cached on
 * disk, and attribution captured so we can credit/license anything we ship:
 *
 *   • Nominatim   — geocode "name + address" → {lat, lng} (OpenStreetMap).
 *   • Overpass    — query the POI at that point for verified hours / phone /
 *                   address / category AND harvest image tags (image=,
 *                   wikimedia_commons=, panoramax=) that point at REAL photos
 *                   of the place.
 *   • Wikidata    — P18 (image) for NOTABLE businesses → a real Commons photo
 *                   + its license (via the Commons imageinfo API).
 *   • Panoramax   — key-free street-level imagery; best-effort nearest photo by
 *                   lat/lng (US coverage is sparse — expected to miss often).
 *
 * EVERY network call here is wrapped so a failure (offline, rate-limit, odd
 * payload) returns empty/neutral rather than throwing — the caller (images.mjs)
 * treats this as a soft, optional tier and falls through to Wikimedia stock /
 * the built-in library exactly as before.
 *
 * Nothing here decodes or processes pixels — it only RESOLVES facts and photo
 * URLs (with attribution). images.mjs downloads the chosen URL and routes it
 * through photo-art's processSlot like every other tier.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Polite, identifiable UA — Nominatim/Overpass usage policies REQUIRE a real
// User-Agent with contact info; a generic one risks an immediate block.
const UA =
  'websites-outreach/1.0 (+https://github.com/dukotah/websites; key-free demo-site factory)';

// Hard ceiling on any single request. Generate-time only — never block a batch
// on a slow open endpoint; fail soft to the next tier instead.
const TIMEOUT_MS = 8000;

// Public, no-key endpoints. Nominatim + Overpass + Panoramax all run usage
// policies that tolerate low-volume, properly-identified, cached access.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// Panoramax federated API (key-free read). The "search nearby" endpoint returns
// a STAC FeatureCollection of street-level pictures around a point.
const PANORAMAX = 'https://api.panoramax.xyz/api/search';

// On-disk cache so a re-run of the factory doesn't re-hit the open endpoints
// (their usage policies expect caching) — sits next to data/research, the repo's
// established cache home (scripts/lib/ → repo root → data/cache/osm).
const CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'data', 'cache', 'osm',
);

// --- tiny fetch + cache helpers --------------------------------------------

/**
 * Fetch a URL as text with the shared timeout + UA. Returns null on any
 * non-ok/error/timeout so every caller can fail soft.
 */
async function getText(url, { accept = 'application/json' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + JSON.parse with the shared timeout. Null on any failure. */
async function getJson(url) {
  const text = await getText(url, { accept: 'application/json' });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * POST a body (used by Overpass, which takes the query as form data). Same
 * timeout/UA/fail-soft contract as getJson.
 */
async function postJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Deterministic cache key for any (kind, inputs) tuple. Hashing keeps the
// filename filesystem-safe regardless of business name / address punctuation.
function cacheKey(kind, parts) {
  const h = createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16);
  return `${kind}-${h}.json`;
}

/** Read a cached result, or null if absent/unreadable. */
async function readCache(file) {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

/** Write a result to cache (best-effort; a write failure never breaks a run). */
async function writeCache(file, value) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, file), JSON.stringify(value));
  } catch {
    /* cache is an optimization — ignore write errors */
  }
}

/**
 * Run `producer()` once per cache key and persist the result, so repeat runs of
 * the factory don't re-hit the open endpoints. A cached `null`/empty is honored
 * too (we don't re-query a known miss). Fails soft to the producer if the cache
 * can't be read.
 */
async function cached(kind, parts, producer) {
  const file = cacheKey(kind, parts);
  const hit = await readCache(file);
  if (hit !== null) return hit;
  const value = await producer();
  // Persist even an empty/neutral result (a known miss) so we don't re-query it.
  await writeCache(file, value ?? null);
  return value;
}

// --- 1) Nominatim geocode ---------------------------------------------------

/**
 * Geocode "name + address" (or just address, or name + town) to a coordinate.
 * KEY-FREE OpenStreetMap search. Returns { lat, lng, displayName, osmType,
 * osmId } or null. Cached by the exact query string.
 *
 * @param {{name?:string, address?:string, city?:string, state?:string}} place
 * @returns {Promise<{lat:number,lng:number,displayName:string,osmType:string,osmId:number}|null>}
 */
export async function geocode(place = {}) {
  const q = [place.name, place.address, place.city, place.state]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(', ');
  if (!q) return null;

  return cached('geocode', [q], async () => {
    const url = `${NOMINATIM}?${new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '0',
    })}`;
    const data = await getJson(url);
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit || hit.lat == null || hit.lon == null) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      displayName: String(hit.display_name || ''),
      osmType: String(hit.osm_type || ''), // node | way | relation
      osmId: Number(hit.osm_id) || 0,
    };
  });
}

// --- 2) Overpass POI enrichment + image-tag harvest -------------------------

// OSM "raw" image tags we trust to point at a REAL photo OF THE PLACE.
//   image=            — a direct URL to a photo of the feature.
//   wikimedia_commons — "File:Foo.jpg" or "Category:Bar" on Commons.
//   panoramax=        — a Panoramax picture/sequence id (street-level photo).
// (mapillary= exists too but its image API needs a token → NOT key-free, skip.)
const IMAGE_TAGS = ['image', 'wikimedia_commons', 'panoramax'];

/**
 * Build an Overpass QL query for nodes/ways/relations near (lat,lng) whose name
 * loosely matches the business — small radius so we hit the actual POI, not a
 * neighbour. We pull the full tag set so the caller can read hours/phone/etc.
 */
function overpassQuery(lat, lng, name, radius = 80) {
  // Escape quotes/backslashes in the name for the regex literal.
  const safe = String(name || '').replace(/["\\]/g, '\\$&').trim();
  // First word ≥3 chars is a decent loose match (e.g. "Smitty's Towing" → Smitty).
  const token = safe.split(/\s+/).find((w) => w.replace(/[^A-Za-z0-9]/g, '').length >= 3) || safe;
  const nameFilter = token ? `["name"~"${token.replace(/["\\]/g, '\\$&')}",i]` : '';
  // around: a metres-radius circle at lat,lng. Query all three element kinds.
  return (
    '[out:json][timeout:25];' +
    '(' +
    `node(around:${radius},${lat},${lng})${nameFilter};` +
    `way(around:${radius},${lat},${lng})${nameFilter};` +
    `relation(around:${radius},${lat},${lng})${nameFilter};` +
    ');' +
    'out tags center 5;'
  );
}

// Map common OSM `amenity`/`shop`/`cuisine` values toward the factory's category
// vocabulary — best-effort; an unknown value is just returned lower-cased.
function osmCategory(tags = {}) {
  const a = (tags.amenity || '').toLowerCase();
  const s = (tags.shop || '').toLowerCase();
  const c = (tags.craft || '').toLowerCase();
  if (a === 'cafe' || a === 'coffee_shop') return 'cafe';
  if (a === 'restaurant' || a === 'fast_food') return 'restaurant';
  if (a === 'bar' || a === 'pub') return 'restaurant';
  if (s === 'hairdresser') return 'salon';
  if (s === 'beauty') return 'spa';
  if (c === 'plumber' || s === 'plumber') return 'plumbing';
  if (c === 'electrician') return 'electrician';
  if (s === 'car_repair') return 'auto-repair';
  if (s === 'winery' || tags.craft === 'winery') return 'winery';
  return a || s || c || '';
}

// OSM `opening_hours` is a compact spec ("Mo-Fr 09:00-17:00; Sa 10:00-14:00").
// Turn it into the factory's [{day, hours}] shape with light, deterministic
// formatting (we don't fully parse the OSM grammar — just split clauses).
const OSM_DAY = {
  Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun',
};

function parseOpeningHours(spec) {
  if (!spec || typeof spec !== 'string') return [];
  const out = [];
  for (const clause of spec.split(';')) {
    const c = clause.trim();
    if (!c) continue;
    // "Mo-Fr 09:00-17:00" → day part + time part.
    const m = c.match(/^([A-Za-z,\- ]+?)\s+([\d:]+\s*-\s*[\d:]+|off|closed|24\/7)/i);
    if (!m) continue;
    const dayPart = m[1].trim();
    const timePart = m[2].trim();
    // Translate Mo/Tu… abbreviations to the site's Mon/Tue… form (range or list).
    const day = dayPart
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => OSM_DAY[d] || d)
      .replace(/\s*-\s*/g, ' – ')
      .replace(/\s*,\s*/g, ', ');
    const hours = /off|closed/i.test(timePart)
      ? 'Closed'
      : timePart === '24/7'
        ? 'Open 24 hours'
        : timePart.replace(/\s*-\s*/, ' – ');
    out.push({ day, hours });
  }
  return out.slice(0, 7);
}

/**
 * Query Overpass for the POI near a coordinate and return verified facts plus
 * any image-pointing tags. Returns:
 *   { hours:[], phone, address, category, tags:{} , imageRefs:[{kind,value}] }
 * or null when nothing matched. `imageRefs` is RAW — resolveImageRef() turns
 * each into a downloadable {url, credit, license, source} (or drops it).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} name
 * @param {{radius?:number}} [opts]
 */
export async function overpassPoi(lat, lng, name, { radius = 80 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return cached('overpass', [lat.toFixed(5), lng.toFixed(5), name], async () => {
    const data = await postJson(OVERPASS, `data=${encodeURIComponent(overpassQuery(lat, lng, name, radius))}`);
    const els = Array.isArray(data?.elements) ? data.elements : [];
    if (!els.length) return null;
    // Prefer the element with the most useful tags (name + contact/hours/image).
    const score = (el) => {
      const t = el.tags || {};
      return (
        (t.name ? 2 : 0) +
        (t.opening_hours ? 1 : 0) +
        (t.phone || t['contact:phone'] ? 1 : 0) +
        IMAGE_TAGS.reduce((n, k) => n + (t[k] ? 2 : 0), 0)
      );
    };
    els.sort((a, b) => score(b) - score(a));
    const tags = els[0].tags || {};

    // Assemble a one-line address from the OSM addr:* tags when present.
    const addrParts = [
      [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      tags['addr:city'],
      tags['addr:state'],
      tags['addr:postcode'],
    ].filter(Boolean);

    const imageRefs = [];
    for (const k of IMAGE_TAGS) {
      if (tags[k]) imageRefs.push({ kind: k, value: String(tags[k]) });
    }

    return {
      hours: parseOpeningHours(tags.opening_hours),
      phone: tags.phone || tags['contact:phone'] || '',
      website: tags.website || tags['contact:website'] || '',
      address: addrParts.join(', '),
      category: osmCategory(tags),
      wikidata: tags.wikidata || '', // a QID here lets us jump straight to P18
      imageRefs,
      tags,
    };
  });
}

// --- 3) Wikidata P18 → Commons photo + license ------------------------------

/**
 * Resolve a Wikidata QID's P18 (image) claim to a Commons "File:…" name.
 * Returns the bare filename ("Foo.jpg") or '' if the entity has no P18.
 */
async function wikidataP18(qid) {
  if (!/^Q\d+$/.test(qid || '')) return '';
  const data = await getJson(`${WIKIDATA_ENTITY}/${qid}.json`);
  const claims = data?.entities?.[qid]?.claims?.P18;
  const fileName = claims?.[0]?.mainsnak?.datavalue?.value;
  return typeof fileName === 'string' ? fileName : '';
}

/**
 * Resolve a Commons "File:…" name (or bare "Foo.jpg") to a real, downloadable
 * image URL + attribution via the Commons imageinfo API. Returns
 * { url, credit, license, source } or null.
 *
 * @param {string} fileName  "File:Foo.jpg" | "Foo.jpg"
 * @param {number} [width]   preferred thumbnail width (we never upscale later)
 */
export async function commonsFile(fileName, width = 1600) {
  if (!fileName) return null;
  const title = fileName.startsWith('File:') ? fileName : `File:${fileName}`;
  return cached('commons', [title, String(width)], async () => {
    const url = `${COMMONS_API}?${new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime',
      iiurlwidth: String(width),
      format: 'json',
      origin: '*',
    })}`;
    const data = await getJson(url);
    const pages = data?.query?.pages;
    const page = pages && Object.values(pages)[0];
    const info = page?.imageinfo?.[0];
    if (!info) return null;
    // Only ship raster photos (a Commons SVG/PDF isn't a usable hero).
    if (!/image\/(jpe?g|png|webp)/i.test(info.mime || '')) return null;
    const meta = info.extmetadata || {};
    const strip = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return {
      url: info.thumburl || info.url,
      credit: strip(meta.Artist?.value) || 'Wikimedia Commons',
      license: strip(meta.LicenseShortName?.value) || 'See source',
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    };
  });
}

/**
 * For a NOTABLE business with a Wikidata QID, fetch its P18 photo + license.
 * Returns { url, credit, license, source } or null (no QID / no image).
 *
 * @param {string} qid  e.g. "Q12345"
 */
export async function wikidataPhoto(qid) {
  if (!/^Q\d+$/.test(qid || '')) return null;
  const fileName = await cached('wikidata-p18', [qid], () => wikidataP18(qid));
  if (!fileName) return null;
  return commonsFile(fileName);
}

// --- 4) Panoramax nearest street-level image (best-effort) ------------------

/**
 * Find the nearest Panoramax (key-free, CC-BY-SA street-level) picture to a
 * coordinate. US coverage is sparse, so this is expected to MISS often — it
 * fails soft to null. Returns { url, credit, license, source } when a picture
 * is found within `radius` metres.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{radius?:number}} [opts]  radius in metres (default 60)
 */
export async function panoramaxNearest(lat, lng, { radius = 60 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return cached('panoramax', [lat.toFixed(5), lng.toFixed(5), String(radius)], async () => {
    // STAC search: a tiny bbox around the point (≈ radius metres). 1° lat ≈ 111km.
    const dLat = radius / 111000;
    const dLng = radius / (111000 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',');
    const url = `${PANORAMAX}?${new URLSearchParams({ bbox, limit: '1' })}`;
    const data = await getJson(url);
    const feat = data?.features?.[0];
    if (!feat) return null;
    // STAC asset URLs live under assets.{sd|hd|thumb}.href; prefer a sized one.
    const assets = feat.assets || {};
    const href =
      assets.sd?.href || assets.hd?.href || assets.thumb?.href || assets.image?.href || '';
    if (!href || !/^https?:/i.test(href)) return null;
    const props = feat.properties || {};
    return {
      url: href,
      // Panoramax pictures are CC-BY-SA; capture the contributor when present.
      credit: props['geovisio:producer'] || props.provider || 'Panoramax contributors',
      license: props.license || 'CC-BY-SA',
      source: feat.links?.find?.((l) => l.rel === 'self')?.href || PANORAMAX,
    };
  });
}

// --- ref resolver + top-level orchestrator ----------------------------------

/**
 * Turn one RAW Overpass image ref ({kind, value}) into a downloadable photo
 * descriptor { url, credit, license, source } — or null when it can't be
 * resolved key-free. Fails soft per ref.
 */
export async function resolveImageRef(ref) {
  if (!ref || !ref.value) return null;
  try {
    if (ref.kind === 'image') {
      // A direct URL — only trust http(s) raster-ish links (skip page links).
      if (!/^https?:\/\//i.test(ref.value)) return null;
      return {
        url: ref.value,
        credit: 'OpenStreetMap contributor',
        license: 'See source',
        source: ref.value,
      };
    }
    if (ref.kind === 'wikimedia_commons') {
      // "File:Foo.jpg" → real URL; a "Category:…" can't resolve to one file → skip.
      if (/^category:/i.test(ref.value)) return null;
      return await commonsFile(ref.value);
    }
    if (ref.kind === 'panoramax') {
      // A bare Panoramax picture id → its STAC item; best-effort.
      const data = await getJson(
        `https://api.panoramax.xyz/api/collections/items/${encodeURIComponent(ref.value)}`,
      );
      const assets = data?.assets || {};
      const href = assets.sd?.href || assets.hd?.href || assets.thumb?.href || '';
      if (!href) return null;
      return {
        url: href,
        credit: 'Panoramax contributors',
        license: 'CC-BY-SA',
        source: `https://api.panoramax.xyz/api/collections/items/${encodeURIComponent(ref.value)}`,
      };
    }
  } catch {
    /* fail soft */
  }
  return null;
}

/**
 * TOP-LEVEL key-free OSM/Wikidata enrichment for one business. Geocodes, then
 * enriches from Overpass, then gathers candidate REAL photos of the place from
 * (in source-strength order):
 *   1. Wikidata P18 (notable businesses) — a curated, licensed photo.
 *   2. Overpass image tags (image= / wikimedia_commons= / panoramax=).
 *   3. Panoramax nearest street-level (sparse in the US; best-effort).
 *
 * Returns a fail-soft object — NEVER throws:
 *   {
 *     facts: { hours:[], phone, address, category, website } | {},
 *     photos: [ { url, credit, license, source } ],   // de-duped by url
 *     coord:  { lat, lng } | null,
 *     attribution: [ "credit (license)" ]             // human-readable summary
 *   }
 *
 * @param {{name?:string, address?:string, city?:string, state?:string,
 *          category?:string, wikidata?:string}} place
 * @param {{maxPhotos?:number}} [opts]
 */
export async function enrichFromOSM(place = {}, { maxPhotos = 4 } = {}) {
  const empty = { facts: {}, photos: [], coord: null, attribution: [] };
  try {
    const coord = await geocode(place);
    if (!coord) return empty;

    const poi = await overpassPoi(coord.lat, coord.lng, place.name || '');
    const facts = poi
      ? {
          hours: poi.hours || [],
          phone: poi.phone || '',
          address: poi.address || '',
          category: poi.category || '',
          website: poi.website || '',
        }
      : {};

    const photos = [];
    const seenUrl = new Set();
    const push = (p) => {
      if (!p || !p.url || seenUrl.has(p.url)) return;
      seenUrl.add(p.url);
      photos.push(p);
    };

    // 1) Wikidata P18 — prefer an explicit QID on the caller, else the one OSM
    //    carried on the POI (tags.wikidata). Notable businesses only.
    const qid = place.wikidata || poi?.wikidata || '';
    if (qid) push(await wikidataPhoto(qid));

    // 2) Overpass image refs → resolved photos (most precise: tagged ON the POI).
    for (const ref of poi?.imageRefs || []) {
      if (photos.length >= maxPhotos) break;
      push(await resolveImageRef(ref));
    }

    // 3) Panoramax nearest — last, lowest hit rate; only if we still need photos.
    if (photos.length < maxPhotos) {
      push(await panoramaxNearest(coord.lat, coord.lng));
    }

    const trimmed = photos.slice(0, maxPhotos);
    return {
      facts,
      photos: trimmed,
      coord: { lat: coord.lat, lng: coord.lng },
      // Human-readable attribution lines for anything we might ship.
      attribution: trimmed.map((p) => `${p.credit} (${p.license})`),
    };
  } catch {
    return empty; // top-level fail-soft: never break the photo cascade
  }
}
