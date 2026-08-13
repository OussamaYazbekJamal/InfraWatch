-- 008_organization_scoping.sql
-- Org-ownership pivot: nullable organization_id on existing shared-data
-- tables (NULL = unclaimed/legacy/admin-seeded baseline, still shown to
-- citizens; claimed rows are staff-managed going forward), plus the new
-- health_facilities entity (staff-entered only — no legacy/unclaimed case).
-- Additive only.

BEGIN;

-- Existing tables — nullable FK, uuid regardless of the local table's own PK type
ALTER TABLE fuel_stations      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE government_offices ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE transport_routes   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outage_data        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_fuel_stations_org      ON fuel_stations (organization_id);
CREATE INDEX IF NOT EXISTS idx_government_offices_org ON government_offices (organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_routes_org   ON transport_routes (organization_id);
CREATE INDEX IF NOT EXISTS idx_outage_data_org        ON outage_data (organization_id);

-- New entity — staff-entered only, organization_id NOT NULL (no legacy case)
CREATE TABLE IF NOT EXISTS health_facilities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name            VARCHAR(255) NOT NULL,
  facility_type   VARCHAR(100) NOT NULL, -- e.g. 'clinic', 'hospital', 'pharmacy', 'dispensary'
  area            VARCHAR(255),
  landmark_note   TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  status          VARCHAR(50) DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_facilities_org  ON health_facilities (organization_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_type ON health_facilities (facility_type);

COMMIT;

-- Rollback notes (manual, if ever needed):
-- ALTER TABLE fuel_stations      DROP COLUMN IF EXISTS organization_id;
-- ALTER TABLE government_offices DROP COLUMN IF EXISTS organization_id;
-- ALTER TABLE transport_routes   DROP COLUMN IF EXISTS organization_id;
-- ALTER TABLE outage_data        DROP COLUMN IF EXISTS organization_id;
-- DROP TABLE IF EXISTS health_facilities;