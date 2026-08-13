const bcrypt = require('bcryptjs');
const pool   = require('../config/db');
const { generateTempPassword } = require('../utils/tempPassword');
const { transporter } = require('../utils/mailer');

// POST /api/staff  (org_lead only — creates org_staff in their own org)
const createOrgStaff = async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!req.user.organization_id)
    return res.status(400).json({ error: 'No organization associated with this account' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'A user with this email already exists' });

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, organization_id, must_change_password)
       VALUES ($1, $2, $3, 'org_staff', $4, true)
       RETURNING id, name, email, role, organization_id`,
      [name, email, hash, req.user.organization_id]
    );

    // Email the temp password directly to the new staff member's own
    // inbox — not just shown once to the org_lead who has to manually
    // relay it. Fail-soft: if the email fails, the account is still
    // created successfully (the org_lead can still see and manually
    // share the temp password from the response below).
    try {
      const orgResult = await pool.query('SELECT name FROM organizations WHERE id = $1', [req.user.organization_id]);
      const orgName = orgResult.rows[0]?.name || 'your organization';
      await transporter.sendMail({
        from: `"InfraWatch" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your InfraWatch Staff account',
        text: `You've been added as staff for ${orgName} on InfraWatch.\n\nYou can now log in:\n\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou'll be asked to set a new password the first time you log in. This temporary password will not be shown again after this email, so keep it until you've logged in.`,
      });
    } catch (mailErr) {
      console.error('[createOrgStaff] failed to email staff member:', mailErr.message);
    }

    res.status(201).json({ staff: result.rows[0], temp_password: tempPassword });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/staff  (org_lead only — list their own org's staff)
const listOrgStaff = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, is_active, created_at FROM users
       WHERE organization_id = $1 AND role = 'org_staff' ORDER BY created_at DESC`,
      [req.user.organization_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/staff/:id/revoke  (org_lead only — own org, org_staff only)
const revokeOrgStaff = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = false
       WHERE id = $1 AND organization_id = $2 AND role = 'org_staff'
       RETURNING id, name, email, is_active`,
      [req.params.id, req.user.organization_id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Staff member not found in your organization' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/staff/:id/restore  (org_lead only — own org, org_staff only)
// Revoking only blocks login (is_active = false) — it never deletes or
// modifies anything the staff member created (fuel stations, offices,
// activity log entries, etc). Restoring is safe for exactly that reason,
// same as restoring an organization: everything is still there, untouched.
const restoreOrgStaff = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = true
       WHERE id = $1 AND organization_id = $2 AND role = 'org_staff'
       RETURNING id, name, email, is_active`,
      [req.params.id, req.user.organization_id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Staff member not found in your organization' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { createOrgStaff, listOrgStaff, revokeOrgStaff, restoreOrgStaff };