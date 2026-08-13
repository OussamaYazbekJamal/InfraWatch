-- ============================================================
--  Migration 001 — Organization auth & roles
--  Additive only. Safe to run on existing data.
--  Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── ORGANIZATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(150)  NOT NULL,
  type          VARCHAR(20)   NOT NULL,
  jurisdiction  VARCHAR(150)  NOT NULL,
  contact_name  VARCHAR(100)  NOT NULL,
  contact_email VARCHAR(150)  NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_type_check
    CHECK (type IN ('municipality', 'government', 'ngo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_status_check
    CHECK (status IN ('pending', 'approved', 'revoked'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── USERS — extend for org roles ─────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- is_active lets org_lead "revoke" org_staff (and orgs get revoked)
-- without deleting the account or orphaning its report history.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Existing rows use 'user' — rename to the new citizen role.
-- 'admin' rows are untouched.
UPDATE users SET role = 'citizen' WHERE role = 'user';
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'citizen';

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('citizen', 'admin', 'org_lead', 'org_staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_organization ON users (organization_id);

-- ── PASSWORD RESET TOKENS ────────────────────────────────────
-- Table only for now — the email-sending flow (forgot/reset password)
-- is a separate follow-up feature once we pick an email provider.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id);