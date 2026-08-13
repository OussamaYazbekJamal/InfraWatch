-- Migration 011: normalize_geo_text() + unaccent extension
--
-- Context: fixes the jurisdiction-matching bug found in Session 4, where
-- reports.district (from Nominatim reverse-geocoding) and organizations.jurisdiction
-- (staff-entered) failed to match due to script (Arabic vs Latin), granularity
-- (village vs county-level fallback), and accent (Zahlé vs Zahle) mismatches.
--
-- This function is used by:
--   - GET /reports/manage query (routes/index.js)
--   - requireReportJurisdiction middleware (routes/index.js)
-- Both call sites MUST guard with `normalize_geo_text(...) <> ''` on both sides
-- of the comparison, to avoid the empty-string wildcard bug (ILIKE '%%' matches
-- every row) for any pre-fix reports whose district was Arabic-only and
-- normalizes to an empty string.
--
-- Companion code-side fix (already applied, not part of this migration):
--   reportsController.js `resolveDistrict()` — added 'accept-language': 'en' to
--   the Nominatim request, and added address.village || address.town to the
--   front of the existing county/municipality/city fallback chain.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION normalize_geo_text(input text) RETURNS text AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(unaccent(input)), '\y(district|qada|governorate|province|caza)\y', '', 'g'),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;