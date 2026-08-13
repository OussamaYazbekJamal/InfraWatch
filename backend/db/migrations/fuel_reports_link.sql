-- ============================================================
--  Migration 004 — Link fuel reports to a specific station
--  Additive only.
-- ============================================================

ALTER TABLE reports ADD COLUMN IF NOT EXISTS fuel_station_id UUID
  REFERENCES fuel_stations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_fuel_station ON reports (fuel_station_id);