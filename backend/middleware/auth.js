const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Verifies JWT token on protected routes
const protect = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });

  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;   // { id, email, role, organization_id, must_change_password }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Restricts route to admin role only (kept for existing routes)
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
};

// General-purpose role gate: requireRole('org_lead'), requireRole('admin','org_lead'), etc.
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role))
    return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};

// Blocks all protected actions until a forced password change is done.
// Apply AFTER `protect`. Never apply to the change-password route itself.
const blockIfMustChangePassword = (req, res, next) => {
  if (req.user?.must_change_password)
    return res.status(403).json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' });
  next();
};

// Restricts write access to a specific row to: admins (unconditionally,
// for platform-level anomaly resolution), or org_staff whose
// organization_id matches the row's organization_id.
//
// Org Lead is deliberately NOT included here — per the use-case diagram,
// Lead's role is limited to creating/revoking Org Staff accounts and
// reviewing the Activity Log, not managing entity data directly. This was
// previously implemented as Lead-can-do-everything-Staff-can (a common,
// defensible real-world pattern), but the actual documented design scopes
// Lead more narrowly, so this middleware — and the corresponding frontend
// route guard on /staff/fuel-stations — now match that.
//
// A row with organization_id = NULL is "unclaimed" (legacy/admin-seeded
// baseline data) - any org_staff may act on it, which the calling route
// can treat as "claiming" it. A row already claimed by a DIFFERENT
// organization is off-limits to everyone except admin.
//
// Apply AFTER `protect`. Table name is a fixed string chosen by the
// developer at the route-definition call site (e.g. requireOrgScopedAccess
// ('fuel_stations')), never derived from request input, so it's safe to
// interpolate into the query. Attaches the fetched row to req.targetRow so
// the route handler doesn't need to re-query it.
const requireOrgScopedAccess = (table, idParam = 'id') => async (req, res, next) => {
  if (req.user?.role === 'admin') return next();

  if (req.user?.role !== 'org_staff')
    return res.status(403).json({ error: 'Org Staff access required' });

  try {
    const result = await pool.query(
      `SELECT id, organization_id FROM ${table} WHERE id = $1`,
      [req.params[idParam]]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    const row = result.rows[0];
    if (row.organization_id && row.organization_id !== req.user.organization_id)
      return res.status(403).json({ error: 'This item belongs to a different organization' });

    req.targetRow = row;
    next();
  } catch (err) {
    console.error('[requireOrgScopedAccess]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { protect, adminOnly, requireRole, blockIfMustChangePassword, requireOrgScopedAccess };