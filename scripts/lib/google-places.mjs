/**
 * google-places.mjs — enrich a prospect from Google and pull real photos.
 *
 * Uses the Google Places API (New, v1). Given a business name + location from
 * the CSV, it finds the place, returns useful details (address, phone, real
 * opening hours, whether they already have a website), and downloads storefront
 * photos. Everything here is best-effort: any failure returns null/empty so the
 * generator falls back to placeholders instead of crashing.
 *
 * Requires GOOGLE_MAPS_API_KEY (with "Places API (New)" enabled).
 * Docs: https://developers.google.com/maps/documentation/places/web-service
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Only the fields we use — keeps the request cheap and the response small.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.editorialSummary',
  'places.photos',
].join(',');

/**
 * Find the best-matching place for a CSV row. Returns the raw place object or
 * null. The query uses whatever the row has — name plus any location hint.
 */
export async function lookupPlace(row, apiKey) {
  const locationHint = [row.address, row.city, row.state].filter(Boolean).join(' ');
  const textQuery = [row.name, row.category, locationHint].filter(Boolean).join(' ').trim();
  if (!textQuery) return null;

  const res = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, maxResultCount: 1, languageCode: 'en' }),
  });

  if (!res.ok) {
    throw new Error(`Places searchText HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data.places?.[0] ?? null;
}

/**
 * Normalize a raw place into the fields the generator merges in. Pure — no I/O.
 */
export function placeToEnrichment(place) {
  if (!place) return null;
  return {
    placeId: place.id ?? '',
    displayName: place.displayName?.text ?? '',
    formattedAddress: place.formattedAddress ?? '',
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? '',
    websiteUri: place.websiteUri ?? '',
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? 0,
    primaryType: place.primaryTypeDisplayName?.text ?? '',
    editorialSummary: place.editorialSummary?.text ?? '',
    hours: weekdayDescriptionsToHours(place.regularOpeningHours?.weekdayDescriptions),
    photos: place.photos ?? [],
  };
}

/**
 * Google returns hours as ["Monday: 8:00 AM – 6:00 PM", ...]. Turn that into
 * the config's [{ day, hours }] shape. Returns null if none available.
 */
export function weekdayDescriptionsToHours(descriptions) {
  if (!Array.isArray(descriptions) || descriptions.length === 0) return null;
  return descriptions.map((line) => {
    const idx = line.indexOf(': ');
    if (idx === -1) return { day: line, hours: '' };
    return { day: line.slice(0, idx).slice(0, 3), hours: line.slice(idx + 2) };
  });
}

/**
 * Download up to `max` photos for a place into <destDir>/<slug>/, returning
 * [{ path, alt, credit }] with public-relative paths the site can use. Skips
 * silently on any per-photo failure.
 */
export async function downloadPhotos(place, apiKey, { destDir, slug, max = 2 }) {
  const photos = (place?.photos ?? []).slice(0, max);
  if (photos.length === 0) return [];

  const outDir = join(destDir, slug);
  await mkdir(outDir, { recursive: true });

  const saved = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      // photo.name looks like "places/ABC/photos/XYZ"; the /media endpoint
      // returns the actual image bytes (following a redirect).
      const url =
        `https://places.googleapis.com/v1/${photo.name}/media` +
        `?maxWidthPx=1600&maxHeightPx=1200&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const ext = (res.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
      const fileName = `${i === 0 ? 'hero' : i === 1 ? 'story' : `photo-${i}`}.${ext}`;
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(join(outDir, fileName), buf);

      const credit = photo.authorAttributions?.[0]?.displayName ?? '';
      saved.push({ path: `/images/${slug}/${fileName}`, alt: '', credit });
    } catch (err) {
      // best-effort: one bad photo shouldn't sink the rest
      console.warn(`    · photo ${i + 1} skipped (${err.message})`);
    }
  }
  return saved;
}
