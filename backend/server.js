require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const routes  = require('./routes/index');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'InfraWatch API running' }));

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
