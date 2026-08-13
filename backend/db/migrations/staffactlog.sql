-- Migration 013: staff_activity_log
--
-- Supports the Org Lead's "what has my staff been working on" view.
-- One row per successful create/edit/claim/delete action taken by an
-- org_staff or org_lead user on any of the 5 org-owned entity types
-- (fuel_stations, government_offices, transport_routes, outage_data,
-- health_facilities). Admin actions are never logged here — admin's
-- platform-level anomaly resolution isn't part of any single org's own
-- activity history (see logStaffActivity() in routes/index.js).
--
-- entity_id is stored as text rather than uuid because government_offices
-- uses an integer PK while every other entity uses uuid — text avoids
-- needing a separate log table (or a nullable dual-column scheme) per
-- entity type just to accommodate that one inconsistency.

CREATE TABLE IF NOT EXISTS staff_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  action          VARCHAR NOT NULL,   -- 'create' | 'edit' | 'claim' | 'delete'
  entity_type     VARCHAR NOT NULL,   -- 'fuel_stations' | 'government_offices' | 'transport_routes' | 'outage_data' | 'health_facilities'
  entity_id       VARCHAR NOT NULL,
  entity_label    VARCHAR,            -- human-readable name/summary, e.g. a station name
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_org_created
  ON staff_activity_log (organization_id, created_at DESC);