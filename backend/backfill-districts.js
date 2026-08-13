// backfill-districts.js
// One-time script: fills in `district` for every existing report that
// doesn't have one yet, using the same resolveDistrict() logic as new
// reports use at creation time.
//
// Run manually from the backend folder:  node backfill-districts.js
// Safe to re-run - it only touches rows where district IS NULL, so
// anything already filled in (or already skipped due to a bad lookup)
// won't be touched again unless you clear it first.
//
// Nominatim's usage policy allows at most 1 request/second - this script
// waits 1.1s between calls to stay comfortably under that, so it will take
// roughly (number of reports) seconds to finish. Fine for a one-time job,
// just don't expect it to be instant if you have hundreds of reports.

const pool = require('./config/db'); // adjust path if this file lives elsewhere
const { resolveDistrict } = require('./controllers/reportsController'); // adjust path to match your project

const DELAY_MS = 1100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const { rows } = await pool.query(
    'SELECT id, latitude, longitude FROM reports WHERE district IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL'
  );

  console.log(`Found ${rows.length} reports missing a district. Starting backfill...`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const district = await resolveDistrict(row.latitude, row.longitude);

    if (district) {
      await pool.query('UPDATE reports SET district = $1 WHERE id = $2', [district, row.id]);
      updated++;
      console.log(`[${row.id}] -> ${district}`);
    } else {
      skipped++;
      console.log(`[${row.id}] -> no district found, left as null (can re-run later)`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`Done. Updated: ${updated}, skipped: ${skipped}, total processed: ${rows.length}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});