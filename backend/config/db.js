const { Pool } = require('pg');
require('dotenv').config();

// Supabase requires SSL in all environments
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => console.log('✅ Supabase PostgreSQL connected'));
pool.on('error',   (err) => console.error('❌ PostgreSQL error:', err));

module.exports = pool;
