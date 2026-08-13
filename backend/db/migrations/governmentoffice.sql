-- 005_government_offices.sql
-- Adds government offices, mirroring fuel_stations (003/004) — corrected version.
-- Additive only: new table + new nullable FK column on reports. Nothing existing changes.

BEGIN;

-- 1. Core offices table — same shape as fuel_stations, minus price columns
CREATE TABLE IF NOT EXISTS government_offices (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    office_type     VARCHAR(100) NOT NULL, -- e.g. 'municipality', 'police_station', 'court', 'ministry_branch'
    area            VARCHAR(255),           -- matches fuel_stations.area, used in card display
    landmark_note   TEXT,                   -- matches fuel_stations.landmark_note
    latitude        DOUBLE PRECISION,       -- nullable: only needed if/when offices join MapView.js later
    longitude       DOUBLE PRECISION,
    status          VARCHAR(50) DEFAULT 'open', -- e.g. 'open', 'closed', 'limited' — optional, mirrors fuel status
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. FK on reports, mirroring reports.fuel_station_id from 004_fuel_station_link.sql
--    This is what actually links a citizen report to an office (picked in the Report form),
--    NOT a column on confirmations — confirmations already work per-report via /reports/:id/confirm.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS government_office_id INTEGER REFERENCES government_offices(id);

-- 3. Helpful indexes for filtering
CREATE INDEX IF NOT EXISTS idx_government_offices_type ON government_offices(office_type);
CREATE INDEX IF NOT EXISTS idx_reports_government_office_id ON reports(government_office_id);

COMMIT;

-- Rollback notes (manual, if ever needed):
-- ALTER TABLE reports DROP COLUMN IF EXISTS government_office_id;
-- DROP TABLE IF EXISTS government_offices;