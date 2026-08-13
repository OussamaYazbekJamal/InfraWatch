const PDFDocument = require('pdfkit');
const axios = require('axios');
const pool = require('../config/db');

// ── Stats gathering — modular, one function per section ──────────────────
// Kept as separate small functions (not one giant query) specifically so
// that adding a new PDF section later (as the project grows) means adding
// one more function here and one more call in generatePdf(), not
// restructuring this file.

async function getOrgReportStats(organizationId) {
  const r = await pool.query(
    `SELECT r.category, r.severity, r.status, COALESCE(c.confirmation_count, 0) AS confirmation_count
       FROM reports r
       JOIN organizations o ON o.id = $1
       LEFT JOIN (
         SELECT report_id, COUNT(*)::int AS confirmation_count
         FROM confirmations GROUP BY report_id
       ) c ON c.report_id = r.id
      WHERE r.district IS NOT NULL
        AND normalize_geo_text(r.district) <> ''
        AND normalize_geo_text(o.jurisdiction) <> ''
        AND (
          normalize_geo_text(o.jurisdiction) ILIKE '%' || normalize_geo_text(r.district) || '%'
          OR normalize_geo_text(r.district) ILIKE '%' || normalize_geo_text(o.jurisdiction) || '%'
        )`,
    [organizationId]
  );

  const rows = r.rows;
  const countBy = (key) => rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});

  return {
    total: rows.length,
    byCategory: countBy('category'),
    bySeverity: countBy('severity'),
    byStatus: countBy('status'),
    totalConfirmations: rows.reduce((sum, row) => sum + row.confirmation_count, 0),
  };
}

// One entry per entity type — add a new object here to extend PDF coverage
// to a future entity type without touching anything else in this file.
const ENTITY_SECTIONS = [
  { key: 'fuel_stations',      label: 'Fuel Stations' },
  { key: 'government_offices', label: 'Government Offices' },
  { key: 'transport_routes',   label: 'Transport Routes' },
  { key: 'outage_data',        label: 'Outage Records' },
  { key: 'health_facilities',  label: 'Health Facilities' },
];

async function getOrgEntityStats(organizationId) {
  const results = {};
  for (const { key, label } of ENTITY_SECTIONS) {
    try {
      const r = await pool.query(
        `SELECT status, COUNT(*)::int AS count FROM ${key} WHERE organization_id = $1 GROUP BY status`,
        [organizationId]
      );
      const total = r.rows.reduce((sum, row) => sum + row.count, 0);
      results[key] = { label, total, byStatus: Object.fromEntries(r.rows.map(row => [row.status || 'unspecified', row.count])) };
    } catch (e) {
      // Some entities (e.g. outage_data) may have no 'status' column —
      // fall back to a plain count so one entity's shape difference
      // doesn't break the whole report.
      const r = await pool.query(`SELECT COUNT(*)::int AS count FROM ${key} WHERE organization_id = $1`, [organizationId]);
      results[key] = { label, total: r.rows[0].count, byStatus: {} };
    }
  }
  return results;
}

// ── Summary text — fail-soft AI, same philosophy as the rest of the app ──

function buildTemplateSummary(orgName, reportStats, entityStats) {
  const topCategory = Object.entries(reportStats.byCategory).sort((a, b) => b[1] - a[1])[0];
  const resolvedCount = reportStats.byStatus.resolved || 0;
  const pendingCount = reportStats.byStatus.pending || 0;

  let text = `This report summarizes ${orgName}'s infrastructure data and citizen reports as of ${new Date().toLocaleDateString()}. `;
  if (reportStats.total > 0) {
    text += `A total of ${reportStats.total} report${reportStats.total === 1 ? '' : 's'} ${reportStats.total === 1 ? 'has' : 'have'} been submitted in this jurisdiction`;
    if (topCategory) text += `, with "${topCategory[0]}" being the most common category (${topCategory[1]} report${topCategory[1] === 1 ? '' : 's'})`;
    text += `. ${resolvedCount} report${resolvedCount === 1 ? '' : 's'} ${resolvedCount === 1 ? 'has' : 'have'} been resolved, while ${pendingCount} remain${pendingCount === 1 ? 's' : ''} pending. `;
    text += `Citizens have confirmed reports a combined ${reportStats.totalConfirmations} time${reportStats.totalConfirmations === 1 ? '' : 's'}, reflecting community engagement with the platform.`;
  } else {
    text += `No citizen reports have been submitted in this jurisdiction yet.`;
  }
  return text;
}

// Attempts a real AI-written summary via Google Gemini's free tier. Fails
// soft: any missing key, timeout, or API error simply falls back to the
// deterministic template above — the PDF always generates successfully
// either way, matching this project's existing fail-soft AI philosophy
// (see: report submission still succeeding when /classify-image fails).
async function generateAiSummary(orgName, reportStats, entityStats) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Write a short, professional 3-4 sentence executive summary for a municipal infrastructure report, based on this data. Be factual and concise, no headers or bullet points, plain prose only.

Organization: ${orgName}
Total citizen reports: ${reportStats.total}
Reports by category: ${JSON.stringify(reportStats.byCategory)}
Reports by status: ${JSON.stringify(reportStats.byStatus)}
Total confirmations from citizens: ${reportStats.totalConfirmations}
Infrastructure entities managed: ${Object.entries(entityStats).map(([k, v]) => `${v.label}: ${v.total}`).join(', ')}`;

  try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 8000 }
    );
    const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : null;
  } catch (e) {
    console.error('[generateAiSummary] falling back to template:', e.message);
    return null;
  }
}

// ── PDF rendering ──────────────────────────────────────────────────────

function drawBarChart(doc, title, dataObj, x, y, width) {
  doc.fontSize(12).fillColor('#0f172a').text(title, x, y);
  y += 20;
  const entries = Object.entries(dataObj);
  if (entries.length === 0) {
    doc.fontSize(10).fillColor('#94a3b8').text('No data available.', x, y);
    return y + 20;
  }
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const barHeight = 16;
  const gap = 8;
  const maxBarWidth = width - 140;

  entries.forEach(([label, value], i) => {
    const barY = y + i * (barHeight + gap);
    const barWidth = (value / maxVal) * maxBarWidth;
    doc.fontSize(9).fillColor('#334155').text(label, x, barY + 3, { width: 110, ellipsis: true });
    doc.rect(x + 115, barY, barWidth, barHeight).fill('#10b981');
    doc.fontSize(9).fillColor('#0f172a').text(String(value), x + 120 + barWidth, barY + 3);
  });
  return y + entries.length * (barHeight + gap) + 10;
}

async function generatePdf(req, res) {
  try {
    if (!req.user.organization_id) {
      return res.status(403).json({ error: 'Your account is not linked to an organization' });
    }

    const orgResult = await pool.query('SELECT name, jurisdiction FROM organizations WHERE id = $1', [req.user.organization_id]);
    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' });
    const org = orgResult.rows[0];

    const [reportStats, entityStats] = await Promise.all([
      getOrgReportStats(req.user.organization_id),
      getOrgEntityStats(req.user.organization_id),
    ]);

    const aiSummary = await generateAiSummary(org.name, reportStats, entityStats);
    const summaryText = aiSummary || buildTemplateSummary(org.name, reportStats, entityStats);
    const summaryIsAi = Boolean(aiSummary);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="InfraWatch_${org.name.replace(/[^a-z0-9]+/gi, '_')}_Report.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // Header
    doc.fontSize(20).fillColor('#1e40af').text('InfraWatch Regional Report', { align: 'left' });
    doc.fontSize(13).fillColor('#0f172a').text(org.name);
    doc.fontSize(9).fillColor('#64748b').text(`${org.jurisdiction} · Generated ${new Date().toLocaleString()}`);
    doc.moveDown(1.5);

    // Summary
    doc.fontSize(13).fillColor('#0f172a').text(summaryIsAi ? 'Executive Summary ' : 'Executive Summary');
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#334155').text(summaryText, { align: 'left', lineGap: 3 });
    doc.moveDown(1.5);

    // Reports overview
    doc.fontSize(14).fillColor('#0f172a').text('Reports Overview');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#334155').text(`Total reports: ${reportStats.total}   ·   Total citizen confirmations: ${reportStats.totalConfirmations}`);
    doc.moveDown(0.8);

    let cursorY = doc.y;
    cursorY = drawBarChart(doc, 'By Category', reportStats.byCategory, 50, cursorY, 495);
    doc.y = cursorY + 10;
    cursorY = drawBarChart(doc, 'By Status', reportStats.byStatus, 50, doc.y, 495);
    doc.y = cursorY + 20;

    // Infrastructure overview
    if (doc.y > 620) doc.addPage();
    doc.x = 50; // reset cursor to left margin — the bar chart above drew
                // with explicit x/y coordinates, which otherwise leaves
                // doc.x pointing wherever the last bar/label was drawn.
    doc.fontSize(14).fillColor('#0f172a').text('Infrastructure Overview', 50);
    doc.moveDown(0.5);

    Object.values(entityStats).forEach((entity) => {
      if (doc.y > 680) doc.addPage();
      doc.fontSize(11).fillColor('#0f172a').text(`${entity.label}: ${entity.total} total`, 50);
      const statusLine = Object.entries(entity.byStatus).map(([s, c]) => `${s}: ${c}`).join('  ·  ');
      if (statusLine) doc.fontSize(9).fillColor('#64748b').text(statusLine, 50);
      doc.moveDown(0.6);
    });

    doc.end();
  } catch (err) {
    console.error('[generatePdf]', err);
    res.status(500).json({ error: 'Failed to generate PDF report' });
  }
}

module.exports = { generatePdf };

