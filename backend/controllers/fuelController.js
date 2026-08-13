const pool = require('../config/db');

// GET /api/fuel  — all stations with live prices
const getStations = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fuel_stations ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/fuel/map  — lightweight map pins only
const getMapPoints = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, area, latitude, longitude, status, diesel_price, gasoline_price FROM fuel_stations'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/fuel/:id  (admin only) — update price or status
const updateStation = async (req, res) => {
  const { status, diesel_price, gasoline_price } = req.body;
  try {
    const result = await pool.query(`
      UPDATE fuel_stations
      SET status         = COALESCE($1, status),
          diesel_price   = COALESCE($2, diesel_price),
          gasoline_price = COALESCE($3, gasoline_price),
          updated_at     = NOW()
      WHERE id = $4
      RETURNING *
    `, [status, diesel_price, gasoline_price, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Station not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getStations, getMapPoints, updateStation };
