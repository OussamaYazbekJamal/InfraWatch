-- Migration 012: normalize_geo_text() — strip leading Al/El article
--
-- Context: found via the Map's Region filter chips not including El Manara.
-- Root cause: reports.district stored "Al Manara" (from Nominatim) while
-- organizations.jurisdiction stores "El Manara(Hammara), Bekaa" (staff-
-- entered) — same place, same Arabic definite article (ال), just
-- transliterated differently ("Al" vs "El"). normalize_geo_text() already
-- strips accents and generic admin words (district/qada/etc.), but had no
-- notion that "Al X" and "El X" can refer to the same place, so the
-- substring match silently failed for this pair (and would for any other
-- place name with the same Al/El convention difference).
--
-- Fix: strip a leading "al " or "el " (as a whole word, so it only ever
-- removes the article, never part of a longer word) before the existing
-- normalization steps. Both sides of any comparison go through this same
-- function, so this is safe and symmetric — it doesn't advantage one side.
--
-- This REPLACES the function body from migration 011 — same function name,
-- so no other code (resolveDistrict, /reports/manage, requireReportJurisdiction,
-- getMapPoints) needs to change; they all call normalize_geo_text() and
-- automatically get the improved matching.

CREATE OR REPLACE FUNCTION normalize_geo_text(input text) RETURNS text AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(unaccent(input)), '\y(district|qada|governorate|province|caza)\y', '', 'g'),
          '^(al|el)\s+', ''
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;