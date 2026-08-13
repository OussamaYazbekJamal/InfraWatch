const bcrypt = require('bcryptjs');
const pool   = require('../config/db');
const { generateTempPassword } = require('../utils/tempPassword');
const { resolveDistrict } = require('./reportsController');
const { transporter } = require('../utils/mailer');

// POST /api/organizations  (public — application form)
//
// jurisdiction is no longer free-typed — it's resolved server-side from a
// pinned map location, using the exact same resolveDistrict() function
// that resolves a citizen report's district. Both sides of every future
// jurisdiction match now come from the identical code path, which
// eliminates by construction the whole class of text-mismatch bugs found
// and fixed throughout this project (script mismatch, accent mismatch,
// Al/El transliteration) — those all stemmed from comparing two
// independently hand-typed strings, which can no longer happen here.
const applyOrganization = async (req, res) => {
  const { name, type, latitude, longitude, jurisdiction_detail, contact_name, contact_email, contact_phone } = req.body;
  if (!name || !type || latitude === undefined || longitude === undefined || !contact_name || !contact_email || !contact_phone)
    return res.status(400).json({ error: 'All fields required, including a pinned jurisdiction location' });
  if (!['municipality', 'government', 'ngo'].includes(type))
    return res.status(400).json({ error: 'Invalid organization type' });

  const phoneDigits = contact_phone.replace(/[\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(phoneDigits))
    return res.status(400).json({ error: 'Invalid contact phone number' });

  const jurisdiction = await resolveDistrict(latitude, longitude);
  if (!jurisdiction) {
    // Fail closed here, not fail-soft — unlike a citizen report (where a
    // missing district just means one report doesn't route to a
    // jurisdiction view, non-critical), a missing jurisdiction here would
    // mean this ENTIRE organization can never match any report, silently.
    // Better to ask the applicant to try a different/more central point
    // than to approve an org that can never receive anything.
    return res.status(400).json({ error: 'Could not determine a jurisdiction for that location — please try pinning a more central point.' });
  }

  // Catch a duplicate contact email/phone at APPLICATION time, not later
  // at approval time. Previously this only surfaced as a confusing 409
  // when an admin clicked Approve (since that's when the org_lead user
  // account actually gets created) — by then it's unclear to the admin
  // why approval failed. Checking both `organizations` (in case the same
  // contact applies twice before either gets approved) and `users` (in
  // case the email/phone already belongs to a real account) up front
  // means the applicant gets a clear, immediate answer instead.
  try {
    const dupeCheck = await pool.query(
      `SELECT 1 FROM organizations WHERE contact_email = $1 AND status != 'revoked'
       UNION
       SELECT 1 FROM users WHERE email = $1
       UNION
       SELECT 1 FROM organizations WHERE contact_phone = $2 AND status != 'revoked'
       UNION
       SELECT 1 FROM users WHERE phone = $2`,
      [contact_email, phoneDigits]
    );
    if (dupeCheck.rows.length) {
      return res.status(409).json({ error: 'This contact email or phone number is already associated with an existing organization or account.' });
    }
  } catch (e) {
    console.error('[applyOrganization] duplicate check failed:', e.message);
    // Fall through — don't block a legitimate application just because
    // this extra check itself failed; the approval-time check still
    // exists as a backstop either way.
  }

  try {
    const result = await pool.query(
      `INSERT INTO organizations (name, type, jurisdiction, jurisdiction_detail, latitude, longitude, contact_name, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, type, jurisdiction, jurisdiction_detail || null, latitude, longitude, contact_name, contact_email, contact_phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/organizations/jurisdictions — public. Lists approved orgs'
// jurisdiction strings, for the Report form's region dropdown. This gives
// citizens a deterministic way to select their jurisdiction directly,
// guaranteeing an exact string match — bypassing GPS/geocoding entirely
// for this specific purpose, which has real fuzzy-matching edge cases
// (script, accent, transliteration mismatches) already found and fixed
// elsewhere, but which can't be made 100% reliable given it depends on a
// third-party free geocoding service. This dropdown exists specifically
// so jurisdiction routing can be guaranteed correct for demo/testing
// purposes, regardless of any remaining geocoding edge cases.
const listApprovedJurisdictions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, jurisdiction FROM organizations WHERE status = 'approved' ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/organizations  (admin — optional ?status=pending filter)
const listOrganizations = async (req, res) => {
  const { status } = req.query;
  try {
    const result = status
      ? await pool.query('SELECT * FROM organizations WHERE status = $1 ORDER BY created_at DESC', [status])
      : await pool.query('SELECT * FROM organizations ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/organizations/:id/approve  (admin)
// Creates the first org_lead account for this org with a one-time temp password.
const approveOrganization = async (req, res) => {
  const { id } = req.params;
  const { lead_name, lead_email } = req.body;

  try {
    const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
    const org = orgResult.rows[0];
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.status !== 'pending')
      return res.status(400).json({ error: `Organization is already ${org.status}` });

    const name  = lead_name  || org.contact_name;
    const email = lead_email || org.contact_email;

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'A user with this email already exists' });

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    const userResult = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, organization_id, must_change_password)
       VALUES ($1, $2, $3, 'org_lead', $4, true)
       RETURNING id, name, email, role, organization_id`,
      [name, email, hash, org.id]
    );

    await pool.query(`UPDATE organizations SET status = 'approved' WHERE id = $1`, [org.id]);

    // Email the temp password directly to the org_lead's own inbox — not
    // just shown once to the admin who has to manually relay it. Fail-soft:
    // if the email fails to send, the account is still created successfully
    // (the admin can still see and manually share the temp password from
    // the response below), it just means the automatic delivery didn't work
    // this one time.
    try {
      await transporter.sendMail({
        from: `"InfraWatch" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your InfraWatch Organization Lead account',
        text: `Your organization, ${org.name}, has been approved on InfraWatch.\n\nYou can now log in as its Organization Lead:\n\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou'll be asked to set a new password the first time you log in. This temporary password will not be shown again after this email, so keep it until you've logged in.`,
      });
    } catch (mailErr) {
      console.error('[approveOrganization] failed to email org_lead:', mailErr.message);
    }

    res.json({
      organization: { ...org, status: 'approved' },
      org_lead: userResult.rows[0],
      temp_password: tempPassword, // shown once — not retrievable after this response
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/organizations/:id/revoke  (admin)
const revokeOrganization = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE organizations SET status = 'revoked' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Organization not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/organizations/:id/restore  (admin)
// Revoking an org only blocks its staff/lead from logging in — it never
// deletes or modifies any of the org's data (fuel stations, offices,
// reports, etc). Restoring is safe for exactly that reason: everything the
// org had before revocation is still there, untouched, and immediately
// accessible again the moment status flips back to 'approved'.
const restoreOrganization = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE organizations SET status = 'approved' WHERE id = $1 AND status = 'revoked' RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Organization not found, or is not currently revoked' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { applyOrganization, listOrganizations, approveOrganization, revokeOrganization, restoreOrganization, listApprovedJurisdictions };