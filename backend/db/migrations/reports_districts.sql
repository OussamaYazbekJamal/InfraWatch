-- 006_reports_district.sql
-- Adds a district column to reports, populated automatically at creation time
-- via reverse-geocoding the report's existing lat/lng (see reportsController.js).
-- Additive only: one nullable column, nothing else changes.

BEGIN;

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS district VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_reports_district ON reports(district);

COMMIT;

-- Rollback notes (manual, if ever needed):
-- ALTER TABLE reports DROP COLUMN IF EXISTS district;