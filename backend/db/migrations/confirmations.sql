-- ============================================================
--  Migration 002 — Confirmations (voting on existing reports)
--  Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS confirmations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  phone_number  VARCHAR(30) NOT NULL,
  confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_confirmations_report ON confirmations (report_id);