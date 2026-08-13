const pool = require('../config/db');
const axios = require('axios');
const supabase = require('../config/supabase');
// URL of the FastAPI ML service (infrawatch-ml). Override via env var when
// deployed - defaults to local dev.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_TIMEOUT_MS = 5000; // don't let a slow/down ML service block report submission for long

// Maps the classifier's binary urgency output to your existing severity
// scale. Adjust this mapping if you want a finer-grained scale later
// (e.g. splitting "not_urgent" into low/medium based on confidence).
const URGENCY_TO_SEVERITY = {
  urgent: 'high',
  not_urgent: 'low',
};

// Haversine distance in km between two lat/lon points - used to sanity-check
// the user's map pin against any location mentioned in the report text.
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calls /classify-text on the ML service. Returns null on any failure
// (timeout, service down, bad response) instead of throwing - report
// creation should never hard-fail just because ML enrichment is unavailable.
async function classifyUrgency(text) {
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/classify-text`,
      { text },
      { timeout: ML_TIMEOUT_MS }
    );
    return data; // { urgency, confidence, language_detected, model_used, processed_at }
  } catch (err) {
    console.error('[ML] /classify-text call failed:', err.message);
    return null;
  }
}

// Calls /extract-location on the ML service. Same fail-soft behavior as above.
async function extractLocation(text) {
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/extract-location`,
      { text },
      { timeout: ML_TIMEOUT_MS }
    );
    return data; // { matches, gazetteer_matches, ner_only_matches, processed_at }
  } catch (err) {
    console.error('[ML] /extract-location call failed:', err.message);
    return null;
  }
}

// Reverse-geocodes a lat/lng into the Lebanese district ("qada") it falls in,
// using Nominatim (OpenStreetMap) - free, no API key, same approach already
// used for Overpass/Open-Meteo elsewhere in this project.
// Fail-soft: same philosophy as classifyUrgency/extractLocation - if the
// lookup is slow or down, the report still saves, just with district = null.
const NOMINATIM_TIMEOUT_MS = 5000;
async function resolveDistrict(lat, lon) {
  try {
    // zoom: 16 (was 10) — a higher zoom level asks Nominatim to resolve at
    // village/neighborhood granularity rather than city/district level.
    // At zoom 10, smaller places (e.g. Qab Elias) often came back with
    // their village-level field empty, silently falling through to the
    // much broader county/district name instead — not a text-matching
    // bug like the ones fixed elsewhere, just insufficient precision in
    // the request itself. This affects both report submission and the
    // org-application jurisdiction detection, since both call this same
    // function.
    const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { format: 'json', lat, lon, zoom: 16, addressdetails: 1 ,'accept-language': 'en'},
      headers: { 'User-Agent': 'InfraWatch/1.0 (infrastructure reporting app - Lebanon)' },
      timeout: NOMINATIM_TIMEOUT_MS,
    });
    // Lebanon's districts ("aqdiya") are usually tagged as `county` in OSM's
    // address breakdown. Beirut Governorate has no district/qada layer
    // beneath it (unlike Mount Lebanon, Bekaa, etc.), so points inside Beirut
    // proper return no `county` - confirmed via a real API check, Beirut
    // instead returns a `municipality` field (e.g. "Moussaitbeh"), which is
    // the right level of granularity here. `city` is kept only as a last
    // resort since it can return a smaller neighborhood name (e.g. "Mar Elias")
    // rather than a true district/municipality.
    const address = data?.address || {};
    return address.village || address.town || address.county || address.municipality || address.state_district || address.city_district || address.city || null;
  } catch (err) {
    console.error('[Nominatim] reverse geocode failed:', err.message);
    return null;
  }
}

// POST /api/reports/:id/confirm
// Requires the `protect` middleware (logged-in only) — a citizen confirms an
// existing report instead of filing a duplicate. Identity comes from the
// verified session (req.user.id), not a typed phone number, closing the same
// impersonation/spoofing gap fixed on CONFIRMATION in the ERD. One
// confirmation per user per report, enforced by a DB unique constraint on
// (report_id, user_id) — see migration 007_confirmations_user_id.sql.
// The original reporter cannot confirm their own report — confirmation is
// meant to be independent corroboration from someone else, not a rubber
// stamp from the person who already vouched for it by filing it.
const confirmReport = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Login required to confirm a report' });

  try {
    const reportCheck = await pool.query('SELECT id, user_id FROM reports WHERE id = $1', [req.params.id]);
    if (!reportCheck.rows.length) return res.status(404).json({ error: 'Report not found' });

    if (reportCheck.rows[0].user_id === userId) {
      return res.status(403).json({ error: "You can't confirm your own report" });
    }

    await pool.query(
      'INSERT INTO confirmations (report_id, user_id) VALUES ($1, $2)',
      [req.params.id, userId]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS confirmation_count FROM confirmations WHERE report_id = $1',
      [req.params.id]
    );

    res.status(201).json({ confirmation_count: countResult.rows[0].confirmation_count });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already confirmed this report' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/reports
// Supports ?category=roads&severity=high&status=pending
const getReports = async (req, res) => {
  const { category, severity, status } = req.query;
  let query  = `
    SELECT r.*, fs.name AS fuel_station_name, fs.brand AS fuel_station_brand,
           go.name AS government_office_name, go.office_type AS government_office_type,
           COALESCE(c.confirmation_count, 0) AS confirmation_count
    FROM reports r
    LEFT JOIN fuel_stations fs ON fs.id = r.fuel_station_id
    LEFT JOIN government_offices go ON go.id = r.government_office_id
    LEFT JOIN (
      SELECT report_id, COUNT(*)::int AS confirmation_count
      FROM confirmations
      GROUP BY report_id
    ) c ON c.report_id = r.id
    WHERE 1=1`;
  const vals = [];
  let   i    = 1;

  if (category) { query += ` AND r.category = $${i++}`;  vals.push(category); }
  if (severity) { query += ` AND r.severity = $${i++}`;  vals.push(severity); }
  if (status)   { query += ` AND r.status   = $${i++}`;  vals.push(status);   }

  query += ' ORDER BY r.created_at DESC';

  try {
    const result = await pool.query(query, vals);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/reports/map
// Returns only fields needed for map pins (lightweight)
const getMapPoints = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.category, r.problem_type, r.location_name,
             r.latitude, r.longitude, r.severity, r.status, r.created_at, r.district,
             COALESCE(c.confirmation_count, 0) AS confirmation_count,
             fs.name AS fuel_station_name, fs.brand AS fuel_station_brand,
             go.name AS government_office_name, go.office_type AS government_office_type,
             matched_org.jurisdiction AS matched_jurisdiction
      FROM reports r
      LEFT JOIN (
        SELECT report_id, COUNT(*)::int AS confirmation_count
        FROM confirmations
        GROUP BY report_id
      ) c ON c.report_id = r.id
      LEFT JOIN fuel_stations fs ON fs.id = r.fuel_station_id
      LEFT JOIN government_offices go ON go.id = r.government_office_id
      LEFT JOIN LATERAL (
        SELECT org.jurisdiction
        FROM organizations org
        WHERE r.district IS NOT NULL
          AND normalize_geo_text(r.district) <> ''
          AND normalize_geo_text(org.jurisdiction) <> ''
          AND (
            normalize_geo_text(org.jurisdiction) ILIKE '%' || normalize_geo_text(r.district) || '%'
            OR normalize_geo_text(r.district) ILIKE '%' || normalize_geo_text(org.jurisdiction) || '%'
          )
        LIMIT 1
      ) matched_org ON true
      WHERE r.status != 'resolved'
      ORDER BY r.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/reports/:id
const getReport = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, COALESCE(c.confirmation_count, 0) AS confirmation_count,
             fs.name AS fuel_station_name, fs.brand AS fuel_station_brand,
             go.name AS government_office_name, go.office_type AS government_office_type
      FROM reports r
      LEFT JOIN (
        SELECT report_id, COUNT(*)::int AS confirmation_count
        FROM confirmations
        GROUP BY report_id
      ) c ON c.report_id = r.id
      LEFT JOIN fuel_stations fs ON fs.id = r.fuel_station_id
      LEFT JOIN government_offices go ON go.id = r.government_office_id
      WHERE r.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/reports
// Requires the `protect` middleware (logged-in only) — identity (name/phone)
// now flows from the verified USER account via req.user, never re-typed per
// report. Matches the ERD: REPORT no longer carries its own name/phone.
const createReport = async (req, res) => {
  const {
    category, problem_type, description,
    location_name, latitude, longitude, severity, region,
    fuel_station_id, government_office_id,
  } = req.body;
  if (!req.user?.id) return res.status(401).json({ error: 'Login required to submit a report' });
  // Validate BEFORE uploading to Supabase Storage - uploading first and
  // validating after wastes a storage write (and leaves an orphaned file
  // with no matching report) whenever required fields are missing.
  if (!category || !problem_type || !description || !location_name || !latitude || !longitude)
    return res.status(400).json({ error: 'Missing required fields' });

  const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
  if (!severity || !VALID_SEVERITIES.includes(severity))
    return res.status(400).json({ error: 'A valid severity is required' });

  // The "which region is this in" dropdown is required — it lets the
  // citizen directly select their jurisdiction, guaranteeing an exact
  // string match against an approved org's jurisdiction, bypassing
  // GPS reverse-geocoding entirely for this purpose. Geocoding (below,
  // via resolveDistrict) has real fuzzy-matching edge cases that have
  // been found and fixed repeatedly, but can never be made 100%
  // guaranteed given it depends on a free third-party service — this
  // dropdown exists specifically to make jurisdiction routing reliable
  // regardless of any remaining geocoding edge case. Re-validated against
  // the live approved-orgs list (not just trusted from the request body)
  // so a stale/tampered value can't silently misroute a report.
  if (!region) return res.status(400).json({ error: 'Please select which region this report is in' });
  let validatedRegion = null;
  try {
    const orgCheck = await pool.query(
      `SELECT jurisdiction FROM organizations WHERE status = 'approved' AND jurisdiction = $1`,
      [region]
    );
    if (!orgCheck.rows.length) return res.status(400).json({ error: 'Selected region is not recognized — please refresh and try again' });
    validatedRegion = orgCheck.rows[0].jurisdiction;
  } catch (err) {
    console.error('[createReport] region validation failed:', err.message);
    return res.status(500).json({ error: 'Server error validating region' });
  }

  // The JWT payload only carries { id, email, role, organization_id,
  // must_change_password } - name/phone are NOT in the token, so they must
  // be looked up from the users table rather than read off req.user.
  let reporterName = null;
  let reporterPhone = null;
  try {
    const userRow = await pool.query('SELECT name, phone FROM users WHERE id = $1', [req.user.id]);
    if (userRow.rows.length) {
      reporterName = userRow.rows[0].name;
      reporterPhone = userRow.rows[0].phone;
    }
  } catch (err) {
    console.error('[createReport] failed to look up reporter name/phone:', err.message);
    // fail-soft: report still saves, just without name/phone populated
  }

  let image_url = null;
  if (req.file) {
    const ext = req.file.originalname.split('.').pop();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('report-images')
      .upload(filename, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) {
      console.error('[Supabase Storage] upload failed:', uploadError.message);
      // fail-soft: same philosophy as the ML calls - don't block report creation
      // over an image upload failure, just save the report without a photo.
    } else {
      const { data } = supabase.storage.from('report-images').getPublicUrl(filename);
      image_url = data.publicUrl;
    }
  }

  // --- ML enrichment (fail-soft: report still saves if the ML service is down) ---
  // Note: reverse-geocoding is deliberately NOT called here anymore.
  // Jurisdiction routing is now fully handled by the citizen's region
  // dropdown selection (validated above) — reintroducing geocoding here,
  // even just as an informational cross-check, would mean depending on
  // the same free third-party service whose unreliability motivated this
  // fix in the first place, for zero functional gain.
  const [urgencyResult, locationResult] = await Promise.all([
    classifyUrgency(description),
    extractLocation(description),
  ]);

  // The citizen's explicit region selection (validated above against the
  // live approved-orgs list) is what's actually saved and used for
  // jurisdiction routing — guaranteed reliable.
  const district = validatedRegion;

  // AI's urgency classification is metadata only (nlp_confidence, ml_label)
  // — it powers the "AI severity estimate" suggestion shown on the Report
  // form, which the citizen can accept or ignore. The citizen's own final
  // severity selection (validated above) is always what's actually saved;
  // previously this was reversed — the AI's guess silently overrode
  // whatever the citizen picked, regardless of their choice.
  let nlp_confidence = null;
  let ml_label = null;

  if (urgencyResult) {
    nlp_confidence = urgencyResult.confidence;
    ml_label = urgencyResult.urgency;
  }

  // Cross-check extracted location (if any) against the user's map pin.
  // This doesn't block submission - it's a soft signal surfaced back to the
  // client so the frontend can show a "double check your pin?" warning.
  //
  // Ambiguous matches (same name exists at multiple, genuinely distinct
  // places - e.g. "Hamra" in both Beirut and elsewhere) are deliberately
  // NOT used for the mismatch check: silently picking one of several
  // equally-plausible locations and treating it as ground truth would be
  // worse than not checking at all, since a coincidentally-wrong guess
  // could either falsely confirm a wrong pin or falsely flag a correct one.
  let location_mismatch = null;
  let location_ambiguous = null;
  if (locationResult && locationResult.matches.length > 0) {
    const ambiguousMatch = locationResult.matches.find((m) => m.ambiguous);
    if (ambiguousMatch) {
      location_ambiguous = {
        mentioned_place: ambiguousMatch.matched_name,
        candidates: [
          { lat: ambiguousMatch.lat, lon: ambiguousMatch.lon, place_type: ambiguousMatch.place_type },
          ...ambiguousMatch.alternative_candidates,
        ],
      };
      console.warn(
        `[ML] Ambiguous location "${ambiguousMatch.matched_name}" on new report - ` +
        `${location_ambiguous.candidates.length} possible places, skipping mismatch auto-check`
      );
    }

    const bestUnambiguousMatch = locationResult.matches.find((m) => m.lat != null && m.lon != null && !m.ambiguous);
    if (bestUnambiguousMatch) {
      const distance = distanceKm(
        parseFloat(latitude), parseFloat(longitude),
        bestUnambiguousMatch.lat, bestUnambiguousMatch.lon
      );
      const MISMATCH_THRESHOLD_KM = 15; // tune based on how precise you want this
      if (distance > MISMATCH_THRESHOLD_KM) {
        location_mismatch = {
          mentioned_place: bestUnambiguousMatch.matched_name,
          mentioned_coords: { lat: bestUnambiguousMatch.lat, lon: bestUnambiguousMatch.lon },
          pin_coords: { lat: parseFloat(latitude), lon: parseFloat(longitude) },
          distance_km: Math.round(distance * 10) / 10,
        };
        console.warn(
          `[ML] Location mismatch on new report: pin is ${location_mismatch.distance_km}km ` +
          `from mentioned place "${bestUnambiguousMatch.matched_name}"`
        );
      }
    }
  }

  // Captured for storage (and later, clustering) regardless of whether it
  // triggered a mismatch warning above — even a place mention that matched
  // the pin fine is still useful as a clustering signal. Prefers the
  // unambiguous match; falls back to the ambiguous one's name if that's
  // all the description gave us.
  //
  // Deliberately excludes broad administrative areas (city/town/village/
  // etc.) — if a citizen just wrote "there's a problem in Zahle", every
  // report from that city would "mention the same place", which carries
  // no real distinguishing information at all (of course two reports in
  // Zahle both mention Zahle). Only landmark-level mentions (a specific
  // church, station, street corner) are meaningful enough to use as a
  // clustering signal. The exact place_type taxonomy comes from the ML
  // service, so this filter is intentionally broad/defensive rather than
  // an exhaustive allowlist.
  const BROAD_PLACE_TYPES = ['city', 'town', 'village', 'county', 'state', 'country', 'region', 'suburb', 'municipality', 'administrative', 'province', 'district'];
  const isLandmarkLevel = (match) => !BROAD_PLACE_TYPES.includes((match?.place_type || '').toLowerCase());

  const extractedPlace =
    (locationResult?.matches.find((m) => m.lat != null && m.lon != null && !m.ambiguous && isLandmarkLevel(m))?.matched_name) ||
    (locationResult?.matches.find((m) => m.ambiguous && isLandmarkLevel(m))?.matched_name) ||
    null;

  try {
    const result = await pool.query(`
      INSERT INTO reports
        (user_id, category, problem_type, description,
         location_name, latitude, longitude,
         severity, nlp_confidence, ml_label, image_url,
         name, phone, fuel_station_id, government_office_id, district, extracted_place)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *
    `, [
      req.user.id,
      category, problem_type, description,
      location_name, latitude, longitude,
      severity, nlp_confidence, ml_label,
      image_url,
      reporterName, reporterPhone,
      fuel_station_id || null,
      government_office_id || null,
      district || null,
      extractedPlace,
    ]);

    // Notify Org Staff of whichever org this report's district matches —
    // same normalize_geo_text matching logic used everywhere else (Staff's
    // own Reports view, the Map's region filter, PDF export). Fail-soft and
    // non-blocking: notification failures never affect report submission,
    // which has already succeeded by this point. Only org_staff is
    // notified, not org_lead, since Lead no longer manages reports per the
    // use-case diagram — there'd be nothing for them to act on here.
    if (district) {
      try {
        const staffResult = await pool.query(
          `SELECT u.id AS user_id
             FROM users u
             JOIN organizations o ON o.id = u.organization_id
            WHERE u.role = 'org_staff'
              AND normalize_geo_text($1) <> ''
              AND normalize_geo_text(o.jurisdiction) <> ''
              AND (
                normalize_geo_text(o.jurisdiction) ILIKE '%' || normalize_geo_text($1) || '%'
                OR normalize_geo_text($1) ILIKE '%' || normalize_geo_text(o.jurisdiction) || '%'
              )`,
          [district]
        );
        const report = result.rows[0];
        const message = `New ${report.category} report: ${report.problem_type} at ${report.location_name}`;
        for (const row of staffResult.rows) {
          await pool.query(
            'INSERT INTO notifications (user_id, type, message, read) VALUES ($1, $2, $3, false)',
            [row.user_id, 'new_report', message]
          );
        }
      } catch (notifyErr) {
        console.error('[createReport] failed to notify org_staff:', notifyErr.message);
      }
    }

    // Duplicate-report clustering — the CLUSTER entity from the original
    // ERD, implemented as the simple heuristic that was always the plan:
    // same category + within 300m (real distance, using each report's
    // exact lat/lng) + within 48 hours + not already resolved. Fail-soft
    // and non-blocking, same as the notification logic above — a
    // clustering failure never affects report submission itself.
    try {
      const report = result.rows[0];
      // Three ways two reports can be considered the same real issue,
      // checked together (any one match is enough):
      //   1. Same fuel_station_id / government_office_id — exact, reliable
      //      regardless of how differently two citizens happened to pin
      //      near the same building.
      //   2. Same extracted_place (from NLP text extraction) — an extra
      //      signal for categories with no exact entity ID to reference
      //      (Roads, Electricity, Transportation), catching cases where
      //      two citizens both mentioned the same landmark but pinned a
      //      bit differently. Never overrides the actual stored pin —
      //      purely an additional matching signal.
      //   3. Within 300m real distance (haversine, exact lat/lng) —
      //      the fallback for everything else.
      const nearbyResult = await pool.query(
        `SELECT id, cluster_id FROM reports
          WHERE id != $1
            AND category = $2
            AND problem_type = $3
            AND status != 'resolved'
            AND created_at >= NOW() - INTERVAL '48 hours'
            AND (
              (fuel_station_id IS NOT NULL AND fuel_station_id = $4)
              OR (government_office_id IS NOT NULL AND government_office_id = $5)
              OR (
                -- Same mentioned place name is NOT enough on its own — a
                -- common name (e.g. "St. George's Church") can genuinely
                -- exist in multiple, unrelated towns. Requiring it to ALSO
                -- be within a broader 5km radius rules out that false
                -- match, while still being far more forgiving than the
                -- strict 300m fallback below, to account for imprecise
                -- pinning around a real shared landmark.
                extracted_place IS NOT NULL AND $6::text IS NOT NULL AND lower(extracted_place) = lower($6::text)
                AND (
                  6371 * acos(
                    LEAST(1, GREATEST(-1,
                      cos(radians($7)) * cos(radians(latitude)) * cos(radians(longitude) - radians($8)) +
                      sin(radians($7)) * sin(radians(latitude))
                    ))
                  )
                ) <= 5
              )
              OR (
                6371 * acos(
                  LEAST(1, GREATEST(-1,
                    cos(radians($7)) * cos(radians(latitude)) * cos(radians(longitude) - radians($8)) +
                    sin(radians($7)) * sin(radians(latitude))
                  ))
                )
              ) <= 0.3
            )
          ORDER BY created_at ASC
          LIMIT 1`,
        [report.id, report.category, report.problem_type,
         report.fuel_station_id, report.government_office_id, report.extracted_place,
         report.latitude, report.longitude]
      );

      if (nearbyResult.rows.length) {
        const match = nearbyResult.rows[0];
        let clusterId = match.cluster_id;

        if (clusterId) {
          // The matched report already belongs to a cluster — join it,
          // and bump the cluster's report_count.
          await pool.query('UPDATE clusters SET report_count = report_count + 1 WHERE id = $1', [clusterId]);
        } else {
          // Neither report is clustered yet — form a brand-new cluster
          // containing both.
          const newCluster = await pool.query(
            'INSERT INTO clusters (category, type, report_count) VALUES ($1, $2, 2) RETURNING id',
            [report.category, report.problem_type]
          );
          clusterId = newCluster.rows[0].id;
          await pool.query('UPDATE reports SET cluster_id = $1 WHERE id = $2', [clusterId, match.id]);
        }

        await pool.query('UPDATE reports SET cluster_id = $1 WHERE id = $2', [clusterId, report.id]);
        report.cluster_id = clusterId; // reflected in the response below
      }
    } catch (clusterErr) {
      console.error('[createReport] clustering check failed:', clusterErr.message);
    }

    // Include the mismatch/ambiguity warnings (if any) in the response
    // without storing them in the DB - purely informational for the
    // frontend to display.
    const responseBody = { ...result.rows[0] };
    if (location_mismatch) {
      responseBody.location_mismatch = location_mismatch;
    }
    if (location_ambiguous) {
      responseBody.location_ambiguous = location_ambiguous;
    }

    res.status(201).json(responseBody);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/reports/:id/location
// Lets the reporting user (or admin) correct a report's pin after a
// location_mismatch warning was shown - e.g. "you mentioned Tripoli but
// pinned Beirut, update to Tripoli?"
const updateLocation = async (req, res) => {
  const { latitude, longitude, location_name } = req.body;

  if (latitude == null || longitude == null)
    return res.status(400).json({ error: 'latitude and longitude are required' });

  try {
    const result = await pool.query(`
      UPDATE reports
      SET latitude = $1, longitude = $2,
          location_name = COALESCE($3, location_name),
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [latitude, longitude, location_name || null, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/reports/:id/status
// Shared by Admin (platform-wide anomaly resolution) and Org Staff/Lead
// (day-to-day jurisdiction handling) via the same route, gated by
// requireReportJurisdiction in routes/index.js.
//
// Notification behavior is intentionally role-dependent: Org Staff/Lead
// status changes notify the reporter + everyone who confirmed the report
// (their own citizens, in their own jurisdiction) — but only when there's
// real news to share (reviewed/resolved), not on 'pending', which is the
// default/no-progress state. Admin's platform-level anomaly resolution
// does NOT trigger citizen notifications — that's a deliberate choice, not
// an oversight: Admin's role here is platform cleanup (including reports
// that fall outside any org's jurisdiction), not day-to-day citizen-facing
// communication, which belongs to the org that owns that jurisdiction.
const updateStatus = async (req, res) => {
  const { status, note } = req.body;
  const allowed    = ['pending', 'reviewed', 'resolved'];
  if (!allowed.includes(status))
    return res.status(400).json({ error: 'Invalid status value' });

  try {
    const result = await pool.query(
      'UPDATE reports SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Report not found' });

    const isStaff = req.user?.role === 'org_staff';
    const isNotifiableStatus = status === 'reviewed' || status === 'resolved';

    if (isStaff && isNotifiableStatus) {
      const report = result.rows[0];
      const reportLabel = `${report.location_name || report.district || 'your report'} (${report.category} — ${report.problem_type})`;
      const message = (note && note.trim())
        ? `Regarding ${reportLabel}: ${note.trim()}`
        : `Your report at ${reportLabel} was updated to: ${status}`;

      // Recipients: the original reporter + everyone who confirmed this
      // report — deduplicated in case the reporter also somehow appears
      // twice, and confirmations already exclude self-confirmation by design.
      const recipientsResult = await pool.query(
        `SELECT DISTINCT user_id FROM (
           SELECT $1::uuid AS user_id
           UNION
           SELECT user_id FROM confirmations WHERE report_id = $2
         ) recipients
         WHERE user_id IS NOT NULL`,
        [report.user_id, req.params.id]
      );

      for (const row of recipientsResult.rows) {
        try {
          await pool.query(
            'INSERT INTO notifications (user_id, type, message, read) VALUES ($1, $2, $3, false)',
            [row.user_id, 'report_update', message]
          );
        } catch (notifyErr) {
          // Fail-soft: same philosophy as the rest of this file — a
          // notification failure shouldn't undo or block the status
          // update itself, which has already been committed above.
          console.error('[updateStatus] failed to insert notification for user', row.user_id, notifyErr.message);
        }
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/reports/:id  (admin only)
const deleteReport = async (req, res) => {
  try {
    await pool.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    res.json({ message: 'Report deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getReports, getMapPoints, getReport, createReport, updateLocation, updateStatus, deleteReport, confirmReport, resolveDistrict };