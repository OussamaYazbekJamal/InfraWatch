-- 009_phone_verification.sql
-- Phone verification OTPs at registration — same pattern as
-- password_reset_tokens (hashed code, expiry, used_at). Additive only.
-- Demo/no-SMS-provider mode: the plaintext code is returned in the API
-- response and logged server-side instead of being sent via a real SMS
-- carrier. Swapping in a real provider later only touches authController.js
-- (issuePhoneOtp), not this table.

BEGIN;

CREATE TABLE IF NOT EXISTS phone_verification_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_verification_user ON phone_verification_tokens (user_id);

COMMIT;

-- Rollback notes (manual, if ever needed):
-- DROP TABLE IF EXISTS phone_verification_tokens;