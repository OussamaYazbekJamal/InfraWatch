const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../config/db');
const { transporter } = require('../utils/mailer');

const OTP_EXPIRY_MINUTES = 10;
const RESET_CODE_EXPIRY_MINUTES = 15;

// Shared password complexity rule, applied consistently everywhere a
// password is set or changed (register, changePassword, resetPassword) —
// these three endpoints previously had three different, inconsistent
// minimums (none, 8, and 6 characters) with no complexity requirement at
// all, meaning simple passwords were accepted depending only on which
// screen was used. One rule, one message, applied everywhere now.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';

function isPasswordComplex(password) {
  return typeof password === 'string' && PASSWORD_RULE.test(password);
}

// Generates a 6-digit numeric code, hashes it, stores it in the existing
// password_reset_tokens table (migration 001) with a short expiry, and
// emails it to the given user. Reuses the token_hash column generically —
// it's just a hashed short-lived code, same shape as the phone OTP table.
async function issuePasswordResetCode(user) {
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + RESET_CODE_EXPIRY_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, codeHash, expiresAt]
  );

  await transporter.sendMail({
    from: `"InfraWatch" <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: 'Your InfraWatch password reset code',
    text: `Your password reset code is ${code}. It expires in ${RESET_CODE_EXPIRY_MINUTES} minutes. If you didn't request this, you can safely ignore this email.`,
  });
}

const signToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id || null,
      must_change_password: !!user.must_change_password,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

// Generates a 6-digit numeric OTP, hashes it, and stores it against the
// given user with a short expiry — same pattern as password_reset_tokens.
// Demo/no-SMS-provider mode: the plaintext code is returned to the caller
// (and logged server-side) instead of being sent via a real SMS carrier.
// Swapping in a real provider later only means replacing the console.log
// line below with an actual send call — nothing else in this flow changes.
async function issuePhoneOtp(userId) {
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO phone_verification_tokens (user_id, code_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, codeHash, expiresAt]
  );

  console.log(`[OTP] Verification code for user ${userId}: ${code} (expires in ${OTP_EXPIRY_MINUTES}m)`);
  return code;
}

// POST /api/auth/register  (citizen self-registration only — role is never client-supplied)
const register = async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone)
    return res.status(400).json({ error: 'All fields required' });
  if (!isPasswordComplex(password))
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, 'citizen', $4)
       RETURNING id, name, email, role, organization_id, must_change_password, phone, phone_verified`,
      [name, email, hash, phone]
    );
    const user = result.rows[0];

    // Demo/no-SMS-provider mode — dev_otp_code is only present so the
    // frontend can display it during testing; drop it from the response
    // once a real SMS provider is wired into issuePhoneOtp.
    const devOtpCode = await issuePhoneOtp(user.id);

    res.status(201).json({ token: signToken(user), user, dev_otp_code: devOtpCode });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'users_phone_unique') {
      return res.status(409).json({ error: 'This phone number is already registered to another account' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await pool.query(
      `SELECT u.*, o.status AS org_status
         FROM users u
         LEFT JOIN organizations o ON o.id = u.organization_id
        WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.is_active)
      return res.status(403).json({ error: 'This account has been deactivated' });

    if (user.organization_id && user.org_status === 'revoked')
      return res.status(403).json({ error: 'This organization has been revoked' });

    res.json({
      token: signToken(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
        must_change_password: user.must_change_password,
        phone: user.phone,
        phone_verified: user.phone_verified,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/change-password  (protected — used for forced first-login change too)
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Current and new password required' });
  if (!isPasswordComplex(newPassword))
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash)))
      return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
      [hash, user.id]
    );

    const updated = { ...user, password_hash: hash, must_change_password: false };
    // Reissue token — the old one has must_change_password: true baked in.
    res.json({ token: signToken(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/verify-phone  (protected — checks the code against the
// most recent unused, unexpired token for the logged-in user)
const verifyPhone = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Verification code required' });

  try {
    const tokenRow = await pool.query(
      `SELECT * FROM phone_verification_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!tokenRow.rows.length)
      return res.status(400).json({ error: 'No active verification code — request a new one' });

    const match = await bcrypt.compare(code, tokenRow.rows[0].code_hash);
    if (!match) return res.status(400).json({ error: 'Incorrect verification code' });

    await pool.query('UPDATE phone_verification_tokens SET used_at = NOW() WHERE id = $1', [tokenRow.rows[0].id]);
    await pool.query('UPDATE users SET phone_verified = true WHERE id = $1', [req.user.id]);

    res.json({ phone_verified: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/resend-otp  (protected — issues a fresh code; the previous
// unused code is simply superseded, since verifyPhone always checks the
// most recently issued one)
const resendOtp = async (req, res) => {
  try {
    const devOtpCode = await issuePhoneOtp(req.user.id);
    res.json({ message: 'A new verification code has been issued', dev_otp_code: devOtpCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/forgot-password  (public — no login required, that's the point)
// Always responds with the same message regardless of whether the email is
// registered, so this endpoint can't be used to check which emails have
// accounts.
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const result = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (result.rows.length) {
      await issuePasswordResetCode(result.rows[0]);
    }
    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    console.error('[forgotPassword]', err.message);
    // Still respond success-shaped even on an internal error — same reasoning
    // as above, don't let error timing leak whether the email exists.
    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  }
};

// POST /api/auth/reset-password  (public)
const resetPassword = async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword)
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  if (!isPasswordComplex(newPassword))
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!userResult.rows.length)
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    const userId = userResult.rows[0].id;

    const tokenRow = await pool.query(
      `SELECT * FROM password_reset_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (!tokenRow.rows.length)
      return res.status(400).json({ error: 'Invalid or expired reset code' });

    const match = await bcrypt.compare(code, tokenRow.rows[0].token_hash);
    if (!match) return res.status(400).json({ error: 'Invalid or expired reset code' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [tokenRow.rows[0].id]);

    res.json({ message: 'Password has been reset. You can now sign in.' });
  } catch (err) {
    console.error('[resetPassword]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { register, login, changePassword, verifyPhone, resendOtp, forgotPassword, resetPassword };