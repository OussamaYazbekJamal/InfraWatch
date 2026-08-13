import { useState, useCallback } from 'react';
import { previewJurisdiction } from '../services/api';

// Shared "Show near me" logic — requests the citizen's browser location,
// then resolves it to a district name using the SAME /geocode/preview
// endpoint (and underlying resolveDistrict() function) already built for
// the Apply as Organization form. Reused here rather than duplicated,
// since it's the same underlying problem: turn coordinates into a
// district name a citizen or org can be matched against.
//
// Also exposes the raw coordinates, since name-based matching only works
// when the citizen happens to be inside one of the seeded demo regions —
// most real locations won't have a name match at all yet, given there
// are only 3 seeded regions. Pages use the raw coords as a distance-based
// fallback ("no exact area match, but here are the nearest results") when
// the name match comes back empty.
export function useNearMe() {
  const [myDistrict, setMyDistrict] = useState(null);
  const [myCoords, setMyCoords] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by your browser.');
      return;
    }
    setDetecting(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyCoords(coords);
        try {
          const { data } = await previewJurisdiction(coords.lat, coords.lng);
          if (data.district) {
            setMyDistrict(data.district);
          } else {
            setError("Couldn't determine your district. Try again, or browse all results below.");
          }
        } catch {
          setError('Something went wrong detecting your location.');
        } finally {
          setDetecting(false);
        }
      },
      () => {
        setError('Could not access your location. Check your browser permissions.');
        setDetecting(false);
      },
      { timeout: 8000 }
    );
  }, []);

  const clear = useCallback(() => { setMyDistrict(null); setMyCoords(null); setError(''); }, []);

  return { myDistrict, myCoords, detecting, error, requestLocation, clear };
}

// Standard haversine formula — straight-line distance in km between two
// points. Used for the "no exact area-name match, show nearest instead"
// fallback across category pages.
export function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns the N closest items to myCoords, sorted nearest-first, each with
// a `_distanceKm` field attached. Used as the fallback when an area-name
// match comes back empty — most real locations won't have a name match
// yet, given there are currently only 3 seeded demo regions, so this lets
// the page still show something useful ("nearest results") instead of a
// blank "no results" for anyone testing from outside those regions.
export function nearestItems(items, myCoords, latKey = 'latitude', lngKey = 'longitude', limit = 6) {
  if (!myCoords) return [];
  return items
    .filter(item => item[latKey] && item[lngKey])
    .map(item => ({ ...item, _distanceKm: distanceKm(myCoords.lat, myCoords.lng, item[latKey], item[lngKey]) }))
    .sort((a, b) => a._distanceKm - b._distanceKm)
    .slice(0, limit);
}

// Mirrors the backend's normalize_geo_text() Postgres function closely
// enough for client-side fuzzy area/district matching — lowercase, strip
// a leading Al/El article, strip generic admin words, collapse whitespace.
// Deliberately skips the accent-stripping step the SQL version does via
// the `unaccent` Postgres extension (no equivalent built into plain JS
// without an extra library) — matching is still reasonably forgiving,
// just not accent-proof on the client side specifically.
export function normalizeAreaText(input) {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/\b(district|qada|governorate|province|caza)\b/g, '')
    .replace(/^(al|el)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// True if either string contains the other, once both are normalized —
// same "substring either direction" logic the backend uses for jurisdiction
// matching, just running in the browser against already-loaded data instead
// of a fresh database query.
export function areaMatches(a, b) {
  const na = normalizeAreaText(a);
  const nb = normalizeAreaText(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}