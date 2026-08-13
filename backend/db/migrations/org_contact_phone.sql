-- 013_organizations_contact_phone.sql
-- Adds an optional contact phone number to organization applications, so
-- admin has more to go on when deciding whether to approve one. Nullable —
-- existing organizations (and the application form) don't require it.
-- Additive only.

BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(30);

COMMIT;

-- Rollback notes (manual, if ever needed):
-- ALTER TABLE organizations DROP COLUMN IF EXISTS contact_phone;