-- 007_confirmations_user_id.sql
-- Finishes the confirmations.user_id migration (the column itself was already
-- added in the previous session). Additive/relaxing only: nothing existing
-- is dropped, phone_number is kept (nullable) for any pre-existing rows.

BEGIN;

-- Already run previously, kept here so this file is re-runnable standalone:
ALTER TABLE confirmations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- phone_number is being phased out in favor of the verified user_id — relax
-- the NOT NULL so new inserts (which no longer supply phone_number) succeed.
ALTER TABLE confirmations ALTER COLUMN phone_number DROP NOT NULL;

-- New uniqueness rule: one confirmation per logged-in user per report.
-- The old UNIQUE (report_id, phone_number) constraint is left in place
-- untouched — harmless, since phone_number will just be NULL on all new rows
-- and Postgres treats NULLs as distinct for uniqueness purposes.
DO $$ BEGIN
  ALTER TABLE confirmations
    ADD CONSTRAINT confirmations_report_user_unique UNIQUE (report_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_confirmations_user ON confirmations (user_id);

COMMIT;

-- Rollback notes (manual, if ever needed):
-- ALTER TABLE confirmations DROP CONSTRAINT IF EXISTS confirmations_report_user_unique;
-- ALTER TABLE confirmations ALTER COLUMN phone_number SET NOT NULL; -- only if no NULL rows exist yet