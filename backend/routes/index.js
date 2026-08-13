const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { protect, adminOnly, requireRole, requireOrgScopedAccess } = require('../middleware/auth');
const organizations = require('../controllers/organizationsController');
const staff         = require('../controllers/staffController');
// memoryStorage keeps the uploaded file in req.file.buffer instead of
// writing it to local disk - this is what the Supabase Storage upload
// (in reportsController.js) actually needs. It also means files never
// touch the server's local filesystem, which matters on Render since
// that filesystem is ephemeral and wiped on every restart/redeploy -
// local disk storage would silently lose all images on the next deploy.
const upload   = multer({ storage: multer.memoryStorage() });
const axios    = require('axios');


const auth    = require('../controllers/authController');
const reports = require('../controllers/reportsController');
const pdfReport = require('../controllers/pdfReportController');

const pool = require('../config/db');

// Records a staff/lead action for the Org Lead's activity log — "was staff
// active today, what did they work on". Only org_staff/org_lead actions are
// logged, not admin's (admin's platform-level anomaly resolution isn't part
// of any single org's own activity history). Fire-and-forget/fail-soft: a
// logging failure must never block or undo the actual data change that
// already succeeded — same philosophy used for notifications elsewhere.
async function logStaffActivity({ req, action, entityType, entityId, label }) {
  if (!['org_staff', 'org_lead'].includes(req.user?.role)) return;
  if (!req.user.organization_id) return;
  try {
    await pool.query(
      `INSERT INTO staff_activity_log (organization_id, user_id, action, entity_type, entity_id, entity_label)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.organization_id, req.user.id, action, entityType, String(entityId), label || null]
    );
  } catch (e) {
    console.error('[logStaffActivity] failed:', e.message);
  }
}

// Restricts PATCH /reports/:id/status to: admin (unconditionally), or
// org_lead/org_staff whose organization's jurisdiction fuzzy-matches this
// report's district — same matching approach already used for the 5
// civic-data entities' /manage endpoints. Reports have no organization_id
// column at all (they're citizen-submitted, not org-owned), so this checks
// district/jurisdiction text instead of requireOrgScopedAccess's
// organization_id equality check.
const requireReportJurisdiction = async (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  if (req.user?.role !== 'org_staff')
    return res.status(403).json({ error: 'Insufficient permissions' });

  try {
    const result = await pool.query(
      `SELECT r.id
       FROM reports r
       JOIN organizations o ON o.id = $1
       WHERE r.id = $2
         AND r.district IS NOT NULL
         AND o.jurisdiction IS NOT NULL
         AND normalize_geo_text(r.district) <> ''
         AND normalize_geo_text(o.jurisdiction) <> ''
         AND (
           normalize_geo_text(o.jurisdiction) ILIKE '%' || normalize_geo_text(r.district) || '%'
           OR normalize_geo_text(r.district) ILIKE '%' || normalize_geo_text(o.jurisdiction) || '%'
         )`,
      [req.user.organization_id, req.params.id]
    );
    if (!result.rows.length) return res.status(403).json({ error: 'This report is outside your jurisdiction' });
    next();
  } catch (err) {
    console.error('[requireReportJurisdiction]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};
// ── Auth ──────────────────────────────────────────────────────
router.post('/auth/register', auth.register);
router.post('/auth/login',    auth.login);
router.post('/auth/change-password', protect, auth.changePassword);
router.post('/auth/verify-phone', protect, auth.verifyPhone);
router.post('/auth/resend-otp',   protect, auth.resendOtp);
router.post('/auth/forgot-password', auth.forgotPassword);
router.post('/auth/reset-password',  auth.resetPassword);
// ── Reports ───────────────────────────────────────────────────
router.get('/reports',                reports.getReports);
router.get('/reports/map',            reports.getMapPoints);

// GET /api/reports/manage — org_lead/org_staff only. Reports filtered to
// the staff's own jurisdiction (fuzzy district match, same approach as the
// 5 civic-data /manage endpoints) — a citizen report has no organization_id
// to match against, only its auto-computed district text.
router.get('/reports/manage', protect, requireRole('org_staff'), async (req, res) => {
  try {
    const orgResult = await pool.query('SELECT jurisdiction FROM organizations WHERE id = $1', [req.user.organization_id]);
    const jurisdiction = orgResult.rows[0]?.jurisdiction;
    if (!jurisdiction) return res.json([]);

    const r = await pool.query(
  `SELECT r.*, COALESCE(c.confirmation_count, 0) AS confirmation_count,
          cl.report_count AS cluster_report_count, cl.type AS cluster_type
     FROM reports r
     LEFT JOIN (
       SELECT report_id, COUNT(*)::int AS confirmation_count
       FROM confirmations
       GROUP BY report_id
     ) c ON c.report_id = r.id
     LEFT JOIN clusters cl ON cl.id = r.cluster_id
    WHERE r.district IS NOT NULL
      AND normalize_geo_text(r.district) <> ''
      AND normalize_geo_text($1) <> ''
      AND (
        normalize_geo_text($1) ILIKE '%' || normalize_geo_text(r.district) || '%'
        OR normalize_geo_text(r.district) ILIKE '%' || normalize_geo_text($1) || '%'
      )
    ORDER BY r.created_at DESC`,
  [jurisdiction]
);
    
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/reports/lead-view — org_lead only, read-only. Same jurisdiction
// fuzzy-match as /reports/manage (the Org Staff view), but for Org Lead —
// visibility only. Deliberately has no corresponding PATCH route, so
// there is no way to reach report-status changes through this endpoint.
router.get('/reports/lead-view', protect, requireRole('org_lead'), async (req, res) => {
  try {
    const orgResult = await pool.query('SELECT jurisdiction FROM organizations WHERE id = $1', [req.user.organization_id]);
    const jurisdiction = orgResult.rows[0]?.jurisdiction;
    if (!jurisdiction) return res.json([]);

    const r = await pool.query(
  `SELECT r.*, COALESCE(c.confirmation_count, 0) AS confirmation_count,
          cl.report_count AS cluster_report_count, cl.type AS cluster_type
     FROM reports r
     LEFT JOIN (
       SELECT report_id, COUNT(*)::int AS confirmation_count
       FROM confirmations
       GROUP BY report_id
     ) c ON c.report_id = r.id
     LEFT JOIN clusters cl ON cl.id = r.cluster_id
    WHERE r.district IS NOT NULL
      AND normalize_geo_text(r.district) <> ''
      AND normalize_geo_text($1) <> ''
      AND (
        normalize_geo_text($1) ILIKE '%' || normalize_geo_text(r.district) || '%'
        OR normalize_geo_text(r.district) ILIKE '%' || normalize_geo_text($1) || '%'
      )
    ORDER BY r.created_at DESC`,
  [jurisdiction]
);

    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/reports/mine — the logged-in citizen's own submitted reports,
// so they can track status themselves (separate from /reports/manage,
// which is the staff/lead jurisdiction view of OTHER people's reports).
// Registered BEFORE /reports/:id — otherwise Express would match "mine"
// as the :id parameter instead of hitting this route at all.
router.get('/reports/mine', protect, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.*, COALESCE(c.confirmation_count, 0) AS confirmation_count
         FROM reports r
         LEFT JOIN (
           SELECT report_id, COUNT(*)::int AS confirmation_count
           FROM confirmations
           GROUP BY report_id
         ) c ON c.report_id = r.id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.get('/reports/pdf-summary', protect, requireRole('org_staff'), pdfReport.generatePdf);
router.get('/reports/:id',            reports.getReport);
router.post('/reports/:id/confirm', protect, reports.confirmReport);
router.post('/reports', protect, upload.single('image'), reports.createReport);
router.patch('/reports/:id/status',   protect, requireReportJurisdiction, reports.updateStatus);
router.patch('/reports/:id/location', protect, reports.updateLocation);
router.delete('/reports/:id',         protect, adminOnly, reports.deleteReport);

// GET /api/reports/pdf-summary — Org Lead/Staff only, generates a
// downloadable PDF summarizing their own org's reports + entity data.

// ── Notifications ────────────────────────────────────────────
// GET /api/notifications — the logged-in user's own notifications only
// (never another user's — scoped by req.user.id, not a request param).
router.get('/notifications', protect, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/notifications/:id/read — marks one of the logged-in user's own
// notifications as read. The WHERE clause checks both id AND user_id, so a
// user can never mark someone else's notification as read just by guessing
// another notification's id.
router.patch('/notifications/:id/read', protect, async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Organizations ─────────────────────────────────────────────
// GET /api/geocode/preview?lat=..&lng=.. — public. Lets the Apply as
// Organization form show the detected jurisdiction name live as someone
// clicks the map, before they submit — reuses the exact same
// resolveDistrict() function used to resolve a citizen report's district,
// so what's previewed here is guaranteed to match what report matching
// will actually use later.
router.get('/geocode/preview', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  try {
    const district = await reports.resolveDistrict(lat, lng);
    res.json({ district });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/organizations/jurisdictions', organizations.listApprovedJurisdictions);
router.post('/organizations',              organizations.applyOrganization);
router.get('/organizations',   protect, adminOnly, organizations.listOrganizations);
router.post('/organizations/:id/approve', protect, adminOnly, organizations.approveOrganization);
router.post('/organizations/:id/revoke',  protect, adminOnly, organizations.revokeOrganization);
router.post('/organizations/:id/restore', protect, adminOnly, organizations.restoreOrganization);

// ── Org Staff ─────────────────────────────────────────────────
router.post('/staff',              protect, requireRole('org_lead'), staff.createOrgStaff);
router.get('/staff',               protect, requireRole('org_lead'), staff.listOrgStaff);
router.patch('/staff/:id/revoke',  protect, requireRole('org_lead'), staff.revokeOrgStaff);
router.patch('/staff/:id/restore', protect, requireRole('org_lead'), staff.restoreOrgStaff);

// GET /api/staff/activity — Org Lead's view of what their org's staff (and
// themselves) have been doing: who did what, to which entity, and when.
// Org Lead only, matching the "Org Lead needs to give staff accounts and
// see if they were active" scope this feature was built for.
router.get('/staff/activity', protect, requireRole('org_lead'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sal.id, sal.action, sal.entity_type, sal.entity_id, sal.entity_label, sal.created_at,
              u.name AS staff_name, u.email AS staff_email
         FROM staff_activity_log sal
         JOIN users u ON u.id = sal.user_id
        WHERE sal.organization_id = $1
        ORDER BY sal.created_at DESC
        LIMIT 200`,
      [req.user.organization_id]
    );
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Fuel ──────────────────────────────────────────────────────
router.get('/fuel', async (req, res) => {
  const { brand } = req.query;
  try {
    const query = brand
      ? { text: 'SELECT * FROM fuel_stations WHERE brand = $1 ORDER BY name', values: [brand] }
      : { text: 'SELECT * FROM fuel_stations ORDER BY name', values: [] };
    const r = await pool.query(query);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/fuel/brands', async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT brand FROM fuel_stations WHERE brand IS NOT NULL ORDER BY brand');
    res.json(r.rows.map(row => row.brand));
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/fuel/map', async (req, res) => {
  const { brand } = req.query;
  try {
    const query = brand
      ? { text: 'SELECT id,name,area,brand,landmark_note,latitude,longitude,status,diesel_price,gasoline_price FROM fuel_stations WHERE brand = $1', values: [brand] }
      : { text: 'SELECT id,name,area,brand,landmark_note,latitude,longitude,status,diesel_price,gasoline_price FROM fuel_stations', values: [] };
    const r = await pool.query(query);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/fuel/manage — org_lead/org_staff only. Returns rows they can
// manage: their own org's claimed stations, plus any unclaimed
// (organization_id IS NULL) stations available to claim. This is the
// staff-facing management list — NOT the public map/list endpoints above.
router.get('/fuel/manage', protect, requireRole('org_staff'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT fs.*, (fs.organization_id = $1) AS is_own
         FROM fuel_stations fs
         LEFT JOIN organizations o ON o.id = $1
        WHERE fs.organization_id = $1
           OR (fs.organization_id IS NULL AND o.jurisdiction IS NOT NULL AND fs.area IS NOT NULL
               AND (fs.area ILIKE '%' || o.jurisdiction || '%' OR o.jurisdiction ILIKE '%' || fs.area || '%'))
        ORDER BY fs.name`,
      [req.user.organization_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/fuel — org_lead/org_staff only. organization_id always comes
// from the logged-in session, never from the request body — a staff member
// can never create a station under a different organization's name.
router.post('/fuel', protect, requireRole('org_staff'), async (req, res) => {
  if (!req.user.organization_id)
    return res.status(403).json({ error: 'Your account is not linked to an organization' });

  const { name, area, latitude, longitude, status, diesel_price, gasoline_price, brand, landmark_note } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    const r = await pool.query(
      `INSERT INTO fuel_stations
         (name, area, latitude, longitude, status, diesel_price, gasoline_price, brand, landmark_note, organization_id, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,'available'),$6,$7,$8,$9,$10,NOW())
       RETURNING *`,
      [name, area || null, latitude || null, longitude || null, status || null,
       diesel_price || null, gasoline_price || null, brand || null, landmark_note || null,
       req.user.organization_id]
    );
    res.status(201).json(r.rows[0]);
    logStaffActivity({ req, action: 'create', entityType: 'fuel_stations', entityId: r.rows[0].id, label: r.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/fuel/:id', protect, requireOrgScopedAccess('fuel_stations'), async (req, res) => {
  const { name, area, latitude, longitude, status, diesel_price, gasoline_price, brand, landmark_note } = req.body;

  // Claiming: if this row is currently unclaimed and the requester is
  // org_lead/org_staff (not admin), this edit also assigns it to their org.
  // Admin edits never change organization_id — anomaly resolution shouldn't
  // silently reassign ownership.
  const claimingOrgId =
    req.user.role !== 'admin' && req.targetRow.organization_id === null
      ? req.user.organization_id
      : null;

  try {
    const r = await pool.query(
      `UPDATE fuel_stations SET
         name            = COALESCE($1, name),
         area            = COALESCE($2, area),
         latitude        = COALESCE($3, latitude),
         longitude       = COALESCE($4, longitude),
         status          = COALESCE($5, status),
         diesel_price    = COALESCE($6, diesel_price),
         gasoline_price  = COALESCE($7, gasoline_price),
         brand           = COALESCE($8, brand),
         landmark_note   = COALESCE($9, landmark_note),
         organization_id = COALESCE($10, organization_id),
         updated_at      = NOW()
       WHERE id = $11 RETURNING *`,
      [name || null, area || null, latitude || null, longitude || null, status || null,
       diesel_price || null, gasoline_price || null, brand || null, landmark_note || null,
       claimingOrgId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
    logStaffActivity({ req, action: claimingOrgId ? 'claim' : 'edit', entityType: 'fuel_stations', entityId: req.params.id, label: r.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/fuel/:id — same org-scoping rule as PATCH above, but stricter:
// unlike editing, deleting an unclaimed (organization_id IS NULL) baseline
// row is not allowed for non-admins — a station must already belong to your
// org (i.e. be claimed first via PATCH) before it can be deleted.
router.delete('/fuel/:id', protect, requireOrgScopedAccess('fuel_stations'), async (req, res) => {
  if (req.user.role !== 'admin' && req.targetRow.organization_id !== req.user.organization_id) {
    return res.status(403).json({ error: 'Claim this station (edit it) before deleting it' });
  }
  try {
    await pool.query('DELETE FROM fuel_stations WHERE id = $1', [req.params.id]);
    res.json({ message: 'Fuel station deleted' });
    logStaffActivity({ req, action: 'delete', entityType: 'fuel_stations', entityId: req.params.id, label: req.targetRow.name });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});
// ── Offices ─────────────────────────────────────────────────
router.get('/offices', async (req, res) => {
  const { office_type } = req.query;
  try {
    const query = office_type
      ? { text: 'SELECT * FROM government_offices WHERE office_type = $1 ORDER BY name', values: [office_type] }
      : { text: 'SELECT * FROM government_offices ORDER BY name', values: [] };
    const r = await pool.query(query);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/offices/types', async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT office_type FROM government_offices ORDER BY office_type');
    res.json(r.rows.map(row => row.office_type));
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/offices/manage — org_lead/org_staff only, same shape as /fuel/manage.
router.get('/offices/manage', protect, requireRole('org_staff'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT go.*, (go.organization_id = $1) AS is_own
         FROM government_offices go
         LEFT JOIN organizations o ON o.id = $1
        WHERE go.organization_id = $1
           OR (go.organization_id IS NULL AND o.jurisdiction IS NOT NULL AND go.area IS NOT NULL
               AND (go.area ILIKE '%' || o.jurisdiction || '%' OR o.jurisdiction ILIKE '%' || go.area || '%'))
        ORDER BY go.name`,
      [req.user.organization_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/offices', protect, requireRole('org_staff'), async (req, res) => {
  if (!req.user.organization_id)
    return res.status(403).json({ error: 'Your account is not linked to an organization' });

  const { name, office_type, area, landmark_note, latitude, longitude, status } = req.body;
  if (!name || !office_type) return res.status(400).json({ error: 'Name and office type are required' });

  try {
    const r = await pool.query(
      `INSERT INTO government_offices
         (name, office_type, area, landmark_note, latitude, longitude, status, organization_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'open'),$8,NOW())
       RETURNING *`,
      [name, office_type, area || null, landmark_note || null, latitude || null, longitude || null,
       status || null, req.user.organization_id]
    );
    res.status(201).json(r.rows[0]);
    logStaffActivity({ req, action: 'create', entityType: 'government_offices', entityId: r.rows[0].id, label: r.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/offices/:id', protect, requireOrgScopedAccess('government_offices'), async (req, res) => {
  const { name, office_type, area, landmark_note, latitude, longitude, status } = req.body;
  const claimingOrgId =
    req.user.role !== 'admin' && req.targetRow.organization_id === null
      ? req.user.organization_id
      : null;

  try {
    const r = await pool.query(
      `UPDATE government_offices SET
         name            = COALESCE($1, name),
         office_type     = COALESCE($2, office_type),
         area            = COALESCE($3, area),
         landmark_note   = COALESCE($4, landmark_note),
         latitude        = COALESCE($5, latitude),
         longitude       = COALESCE($6, longitude),
         status          = COALESCE($7, status),
         organization_id = COALESCE($8, organization_id),
         updated_at      = NOW()
       WHERE id = $9 RETURNING *`,
      [name || null, office_type || null, area || null, landmark_note || null, latitude || null,
       longitude || null, status || null, claimingOrgId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
    logStaffActivity({ req, action: claimingOrgId ? 'claim' : 'edit', entityType: 'government_offices', entityId: req.params.id, label: r.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/offices/:id', protect, requireOrgScopedAccess('government_offices'), async (req, res) => {
  if (req.user.role !== 'admin' && req.targetRow.organization_id !== req.user.organization_id) {
    return res.status(403).json({ error: 'Claim this office (edit it) before deleting it' });
  }
  try {
    await pool.query('DELETE FROM government_offices WHERE id = $1', [req.params.id]);
    res.json({ message: 'Office deleted' });
    logStaffActivity({ req, action: 'delete', entityType: 'government_offices', entityId: req.params.id, label: req.targetRow.name });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});
// ── Transport ─────────────────────────────────────────────────
router.get('/transport', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM transport_routes ORDER BY route_number');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/transport/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE transport_routes SET status = $1 WHERE id = $2 RETURNING *',
      [req.body.status, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/transport/manage — org_lead/org_staff only, same shape as /fuel/manage.
router.get('/transport/manage', protect, requireRole('org_staff'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT tr.*, (tr.organization_id = $1) AS is_own
         FROM transport_routes tr
         LEFT JOIN organizations o ON o.id = $1
        WHERE tr.organization_id = $1
           OR (tr.organization_id IS NULL AND o.jurisdiction IS NOT NULL
               AND (tr.origin ILIKE '%' || o.jurisdiction || '%' OR tr.destination ILIKE '%' || o.jurisdiction || '%'))
        ORDER BY tr.route_number`,
      [req.user.organization_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/transport', protect, requireRole('org_staff'), async (req, res) => {
  if (!req.user.organization_id)
    return res.status(403).json({ error: 'Your account is not linked to an organization' });

  const { route_number, origin, destination, stops, duration, frequency, price_range, distance_km, status } = req.body;
  if (!route_number || !origin || !destination)
    return res.status(400).json({ error: 'Route number, origin, and destination are required' });

  try {
    const r = await pool.query(
      `INSERT INTO transport_routes
         (route_number, origin, destination, stops, duration, frequency, price_range, distance_km, status, organization_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'active'),$10)
       RETURNING *`,
      [route_number, origin, destination, stops || null, duration || null, frequency || null,
       price_range || null, distance_km || null, status || null, req.user.organization_id]
    );
    res.status(201).json(r.rows[0]);
    logStaffActivity({ req, action: 'create', entityType: 'transport_routes', entityId: r.rows[0].id, label: `#${r.rows[0].route_number}: ${r.rows[0].origin} → ${r.rows[0].destination}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/transport/:id', protect, requireOrgScopedAccess('transport_routes'), async (req, res) => {
  const { route_number, origin, destination, stops, duration, frequency, price_range, distance_km, status } = req.body;
  const claimingOrgId =
    req.user.role !== 'admin' && req.targetRow.organization_id === null
      ? req.user.organization_id
      : null;

  try {
    const r = await pool.query(
      `UPDATE transport_routes SET
         route_number    = COALESCE($1, route_number),
         origin          = COALESCE($2, origin),
         destination     = COALESCE($3, destination),
         stops           = COALESCE($4, stops),
         duration        = COALESCE($5, duration),
         frequency       = COALESCE($6, frequency),
         price_range     = COALESCE($7, price_range),
         distance_km     = COALESCE($8, distance_km),
         status          = COALESCE($9, status),
         organization_id = COALESCE($10, organization_id)
       WHERE id = $11 RETURNING *`,
      [route_number || null, origin || null, destination || null, stops || null, duration || null,
       frequency || null, price_range || null, distance_km || null, status || null,
       claimingOrgId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
    logStaffActivity({ req, action: claimingOrgId ? 'claim' : 'edit', entityType: 'transport_routes', entityId: req.params.id, label: `#${r.rows[0].route_number}: ${r.rows[0].origin} → ${r.rows[0].destination}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/transport/:id', protect, requireOrgScopedAccess('transport_routes'), async (req, res) => {
  if (req.user.role !== 'admin' && req.targetRow.organization_id !== req.user.organization_id) {
    return res.status(403).json({ error: 'Claim this route (edit it) before deleting it' });
  }
  try {
    await pool.query('DELETE FROM transport_routes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Transport route deleted' });
    logStaffActivity({ req, action: 'delete', entityType: 'transport_routes', entityId: req.params.id, label: `#${req.targetRow.route_number}: ${req.targetRow.origin} → ${req.targetRow.destination}` });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Outage data ───────────────────────────────────────────────
router.get('/outage', async (req, res) => {
  const { district = 'Beirut', year = 2025 } = req.query;
  try {
    const r = await pool.query(
      'SELECT * FROM outage_data WHERE district = $1 AND year = $2 ORDER BY month_num',
      [district, year]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/outage/districts', async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT district FROM outage_data ORDER BY district');
    res.json(r.rows.map(r => r.district));
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/outage/manage — org_lead/org_staff only, same shape as /fuel/manage.
router.get('/outage/manage', protect, requireRole('org_staff'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT od.*, (od.organization_id = $1) AS is_own
         FROM outage_data od
         LEFT JOIN organizations o ON o.id = $1
        WHERE od.organization_id = $1
           OR (od.organization_id IS NULL AND o.jurisdiction IS NOT NULL
               AND (od.district ILIKE '%' || o.jurisdiction || '%' OR o.jurisdiction ILIKE '%' || od.district || '%'))
        ORDER BY od.district, od.year DESC, od.month_num`,
      [req.user.organization_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/outage', protect, requireRole('org_staff'), async (req, res) => {
  if (!req.user.organization_id)
    return res.status(403).json({ error: 'Your account is not linked to an organization' });

  const { district, month_name, month_num, year, avg_hours } = req.body;
  if (!district || !month_num || !year)
    return res.status(400).json({ error: 'District, month, and year are required' });

  try {
    const r = await pool.query(
      `INSERT INTO outage_data (district, month_name, month_num, year, avg_hours, organization_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       RETURNING *`,
      [district, month_name || null, month_num, year, avg_hours || null, req.user.organization_id]
    );
    res.status(201).json(r.rows[0]);
    logStaffActivity({ req, action: 'create', entityType: 'outage_data', entityId: r.rows[0].id, label: `${r.rows[0].district} — ${r.rows[0].month_name} ${r.rows[0].year}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/outage/:id', protect, requireOrgScopedAccess('outage_data'), async (req, res) => {
  const { district, month_name, month_num, year, avg_hours } = req.body;
  const claimingOrgId =
    req.user.role !== 'admin' && req.targetRow.organization_id === null
      ? req.user.organization_id
      : null;

  try {
    const r = await pool.query(
      `UPDATE outage_data SET
         district        = COALESCE($1, district),
         month_name      = COALESCE($2, month_name),
         month_num       = COALESCE($3, month_num),
         year            = COALESCE($4, year),
         avg_hours       = COALESCE($5, avg_hours),
         organization_id = COALESCE($6, organization_id),
         updated_at      = NOW()
       WHERE id = $7 RETURNING *`,
      [district || null, month_name || null, month_num || null, year || null, avg_hours || null,
       claimingOrgId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
    logStaffActivity({ req, action: claimingOrgId ? 'claim' : 'edit', entityType: 'outage_data', entityId: req.params.id, label: `${r.rows[0].district} — ${r.rows[0].month_name} ${r.rows[0].year}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/outage/:id', protect, requireOrgScopedAccess('outage_data'), async (req, res) => {
  if (req.user.role !== 'admin' && req.targetRow.organization_id !== req.user.organization_id) {
    return res.status(403).json({ error: 'Claim this record (edit it) before deleting it' });
  }
  try {
    await pool.query('DELETE FROM outage_data WHERE id = $1', [req.params.id]);
    res.json({ message: 'Outage record deleted' });
    logStaffActivity({ req, action: 'delete', entityType: 'outage_data', entityId: req.params.id, label: `${req.targetRow.district} — ${req.targetRow.month_name} ${req.targetRow.year}` });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Health — nearby facilities via Overpass (OSM) — FREE, no API key ──
// Called from frontend with user's lat/lng
// GET /api/health — public, citizen-facing. Staff-entered health facilities
// (health_facilities table), meant as a genuine supplement to the live OSM
// scan below — this was designed into the ERD from the post-pivot redesign
// onward, but never actually had a public endpoint until now, so staff-
// entered data was invisible to citizens despite being fully built on the
// staff side. Joined with organizations so citizens see which municipality
// verified/entered each facility.
router.get('/health', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT hf.*, o.name AS organization_name
         FROM health_facilities hf
         JOIN organizations o ON o.id = hf.organization_id
        ORDER BY hf.name`
    );
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.get('/health/nearby', async (req, res) => {
  const { lat, lng, radius = 5000, type = 'hospital' } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  // Map our type param to OSM amenity tags
  const typeMap = {
    hospital:  'hospital',
    pharmacy:  'pharmacy',
    clinic:    'clinic',
    doctor:    'doctors',
  };
  const amenity = typeMap[type] || 'hospital';

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="${amenity}"](around:${radius},${lat},${lng});
      way["amenity"="${amenity}"](around:${radius},${lat},${lng});
    );
    out center 20;
  `;

  try {
    console.log('Overpass query:', query);

    const resp = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SeniorProjectHealthApp/1.0 (osamajamal90yazbek@gmail.com)'
        },
        timeout: 30000
      }
    );
    const places = resp.data.elements.map(el => ({
      id:      el.id,
      name:    el.tags?.name || el.tags?.['name:en'] || el.tags?.['name:ar'] || `Unnamed ${amenity}`,
      lat:     el.lat || el.center?.lat,
      lng:     el.lon || el.center?.lon,
      phone:   el.tags?.phone || el.tags?.['contact:phone'] || null,
      address: [el.tags?.['addr:street'], el.tags?.['addr:city']].filter(Boolean).join(', ') || null,
      opening: el.tags?.opening_hours || null,
      website: el.tags?.website || null,
      // Relevant mainly for clinics/doctors — OSM tags this as a
      // semicolon-separated list when a facility covers multiple
      // specialties (e.g. "cardiology;dermatology").
      specialty: el.tags?.['healthcare:speciality'] || null,
      type:    amenity,
    })).filter(p => p.lat && p.lng);

    res.json(places);
  } catch (err) {
    console.error('Overpass error:', err.message);
    res.status(503).json({ error: 'Health facility lookup temporarily unavailable' });
  }
});

// ── Health Facilities — staff-entered only (organization_id NOT NULL,
// no unclaimed/legacy case, unlike fuel/offices/transport/outage). This is
// a supplement to the live Overpass scan above, not a replacement — the
// citizen-facing /health/nearby scan stays exactly as-is.
router.get('/health/manage', protect, requireRole('org_staff'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT *, true AS is_own FROM health_facilities WHERE organization_id = $1 ORDER BY name`,
      [req.user.organization_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/health', protect, requireRole('org_staff'), async (req, res) => {
  if (!req.user.organization_id)
    return res.status(403).json({ error: 'Your account is not linked to an organization' });

  const { name, facility_type, area, landmark_note, latitude, longitude, status } = req.body;
  if (!name || !facility_type) return res.status(400).json({ error: 'Name and facility type are required' });

  try {
    const r = await pool.query(
      `INSERT INTO health_facilities
         (name, facility_type, area, landmark_note, latitude, longitude, status, organization_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'open'),$8,NOW())
       RETURNING *`,
      [name, facility_type, area || null, landmark_note || null, latitude || null, longitude || null,
       status || null, req.user.organization_id]
    );
    res.status(201).json(r.rows[0]);
    logStaffActivity({ req, action: 'create', entityType: 'health_facilities', entityId: r.rows[0].id, label: r.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/health/:id', protect, requireOrgScopedAccess('health_facilities'), async (req, res) => {
  const { name, facility_type, area, landmark_note, latitude, longitude, status } = req.body;
  try {
    const r = await pool.query(
      `UPDATE health_facilities SET
         name          = COALESCE($1, name),
         facility_type = COALESCE($2, facility_type),
         area          = COALESCE($3, area),
         landmark_note = COALESCE($4, landmark_note),
         latitude      = COALESCE($5, latitude),
         longitude     = COALESCE($6, longitude),
         status        = COALESCE($7, status),
         updated_at    = NOW()
       WHERE id = $8 RETURNING *`,
      [name || null, facility_type || null, area || null, landmark_note || null, latitude || null,
       longitude || null, status || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
    logStaffActivity({ req, action: 'edit', entityType: 'health_facilities', entityId: req.params.id, label: r.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/health/:id', protect, requireOrgScopedAccess('health_facilities'), async (req, res) => {
  try {
    await pool.query('DELETE FROM health_facilities WHERE id = $1', [req.params.id]);
    res.json({ message: 'Health facility deleted' });
    logStaffActivity({ req, action: 'delete', entityType: 'health_facilities', entityId: req.params.id, label: req.targetRow.name });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── ML / NLP placeholder endpoints ───────────────────────────
router.post('/ml/classify-text', async (req, res) => {
  const ML = process.env.ML_SERVICE_URL;
  if (!ML) return res.json({ severity: null, category: null, confidence: null, message: 'ML service not configured' });
  try {
    // FastAPI expects { text: "..." } - req.body from the frontend is
    // { description: "..." }, so map the field name rather than forwarding
    // req.body directly.
    const { data } = await axios.post(`${ML}/classify-text`, { text: req.body.description });

    // The Python model classifies binary urgency (urgent / not_urgent) plus
    // detected language - it does NOT classify a 4-level severity or a
    // category. The frontend was built expecting { severity, category },
    // which this response never actually contained (data.severity was
    // always undefined), so the "AI suggestion" box silently never
    // appeared - not because the model was wrong, but because the two
    // sides were never speaking the same shape. Translate honestly based
    // on what the model actually predicts, rather than pretending it
    // classifies category (it doesn't) - category is left null on purpose,
    // so the frontend's existing `{nlpHint.category && ...}` check just
    // skips rendering that line instead of showing a fake value.
    res.json({
      severity: data.urgency === 'urgent' ? 'high' : 'low',
      category: null,
      confidence: data.confidence,
      language_detected: data.language_detected,
      urgency: data.urgency,
    });
  } catch { res.json({ severity: null, category: null, confidence: null }); }
});

router.post('/ml/extract-location', async (req, res) => {
  const ML = process.env.ML_SERVICE_URL;
  if (!ML) return res.json({ matches: [], gazetteer_matches: 0, ner_only_matches: 0, message: 'ML service not configured' });
  try {
    const { data } = await axios.post(`${ML}/extract-location`, { text: req.body.description });
    res.json(data);
  } catch { res.json({ matches: [], gazetteer_matches: 0, ner_only_matches: 0 }); }
});

router.post('/ml/classify-image', protect, upload.single('image'), async (req, res) => {
  const ML = process.env.ML_SERVICE_URL;
  if (!ML) return res.json({ label: null, message: 'ML service not configured' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  try {
    // multer is configured with memoryStorage() (see top of this file) —
    // the uploaded file lives in req.file.buffer, NOT on disk, so there is
    // no req.file.path to read from. Appending the buffer directly is the
    // correct way to forward it as multipart form data — but form-data's
    // content-type guessing from just a filename string is unreliable, and
    // FastAPI's classify_image endpoint rejects anything outside
    // image/jpeg, image/png, image/webp with a 400. Passing multer's own
    // detected mimetype explicitly (available from the original browser
    // upload regardless of storage engine) avoids that.
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const { data } = await axios.post(`${ML}/classify-image`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });
    res.json(data);
  } catch (err) {
    console.error('[ML] /classify-image proxy failed:', err.message);
    res.json({ label: null, message: 'Image classification unavailable' });
  }
});

// ── Weather-based flood risk ─────────────────────────────────
// Cross-checks recent rainfall at a location against reported flooding -
// corroborating evidence for a category the image classifier can't detect
// at all (RDD2022 has no flooding examples). Computed live from a free
// weather API, no database changes needed - schema stays untouched while
// DB review with the instructor is still pending.
//
// Uses Open-Meteo's forecast endpoint with past_days=2 to get actual
// observed hourly precipitation for the last 48 hours (not a forecast -
// past_days returns real reanalysis data for those days).
router.get('/weather/flood-risk', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  try {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat,
        longitude: lng,
        hourly: 'precipitation',
        past_days: 2,
        forecast_days: 1,
        timezone: 'auto',
      },
      timeout: 10000,
    });

    const precipValues = data.hourly?.precipitation || [];
    const totalRainfall48h = precipValues.reduce((sum, v) => sum + (v || 0), 0);

    // Thresholds are a simple heuristic, not a calibrated meteorological
    // model - documented as such. Tune based on Lebanon's actual drainage
    // conditions if you have local data to calibrate against.
    let risk_level;
    if (totalRainfall48h >= 50) risk_level = 'high';
    else if (totalRainfall48h >= 20) risk_level = 'moderate';
    else if (totalRainfall48h >= 5) risk_level = 'low';
    else risk_level = 'none';

    res.json({
      rainfall_mm_48h: Math.round(totalRainfall48h * 10) / 10,
      risk_level,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Weather] flood-risk lookup failed:', err.message);
    res.status(503).json({ error: 'Weather lookup temporarily unavailable' });
  }
});

module.exports = router;