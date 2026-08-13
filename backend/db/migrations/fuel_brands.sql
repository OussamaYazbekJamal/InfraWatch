-- ============================================================
--  Migration 003 — Fuel station brand & landmark filtering
--  Additive only.
-- ============================================================

ALTER TABLE fuel_stations ADD COLUMN IF NOT EXISTS brand VARCHAR(50);
ALTER TABLE fuel_stations ADD COLUMN IF NOT EXISTS landmark_note VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_fuel_stations_brand ON fuel_stations (brand);