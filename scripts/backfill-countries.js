/**
 * One-time backfill: resolves country for all existing jobs that have a location
 * but no country set yet. Uses local location_country cache first, then Nominatim.
 * Run from project root:
 *   node scripts/backfill-countries.js
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/jobs.db');
const db = new DatabaseSync(DB_PATH);

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'JobHunterApp/1.0 (self-hosted job search tool)';

const HARDCODED = {
  'emea': 'EMEA',
  'dach': 'DACH',
  'european union': 'European Union',
  'european economic area': 'European Economic Area',
  'greater alicante area': 'Spain',
  'greater barcelona metropolitan area': 'Spain',
  'greater bilbao metropolitan area': 'Spain',
  'greater madrid metropolitan area': 'Spain',
  'greater málaga metropolitan area': 'Spain',
  'greater orense area': 'Spain',
  'greater santander metropolitan area': 'Spain',
  'greater san sebastian area': 'Spain',
  'greater cádiz metropolitan area': 'Spain',
  'greater munich metropolitan area': 'Germany',
  'greater hamburg area': 'Germany',
  'greater dusseldorf area': 'Germany',
  'frankfurt rhine-main metropolitan area': 'Germany',
  'berlin metropolitan area': 'Germany',
  'greater paris metropolitan region': 'France',
  'greater marseille metropolitan area': 'France',
  'greater chicago area': 'United States',
  'greater houston': 'United States',
  'greater philadelphia': 'United States',
  'dallas-fort worth metroplex': 'United States',
  'greater hyderabad area': 'India',
  'greater johor bahru': 'Malaysia',
  'greater kempten area': 'Germany',
  'amsterdam area': 'Netherlands',
  'the randstad, netherlands': 'Netherlands',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function nominatimLookup(location) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&addressdetails=1&limit=1`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data[0]?.address?.country ?? null;
}

async function main() {
  // Ensure location_country table exists (created by app on first run)
  db.exec(`CREATE TABLE IF NOT EXISTS location_country (
    location   TEXT PRIMARY KEY,
    country    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`);

  // Ensure country column exists
  const cols = db.prepare('PRAGMA table_info(jobs)').all();
  if (!cols.some(c => c.name === 'country')) {
    db.exec('ALTER TABLE jobs ADD COLUMN country TEXT');
    console.log('Added country column to jobs.');
  }

  // Seed hardcoded entries
  const now = new Date().toISOString();
  for (const [loc, country] of Object.entries(HARDCODED)) {
    db.prepare(`INSERT OR IGNORE INTO location_country (location, country, created_at) VALUES (?, ?, ?)`)
      .run(loc[0].toUpperCase() + loc.slice(1), country, now);
  }

  // Get distinct locations that still need a country
  const rows = db.prepare(
    `SELECT DISTINCT location FROM jobs
     WHERE location IS NOT NULL AND location != ''
       AND (country IS NULL OR country = '')
     ORDER BY location ASC`,
  ).all();

  if (rows.length === 0) {
    console.log('All locations already resolved. Nothing to do.');
    return;
  }

  console.log(`Resolving country for ${rows.length} distinct location(s).\n`);

  const upsertCache = db.prepare(
    `INSERT OR REPLACE INTO location_country (location, country, created_at) VALUES (?, ?, ?)`,
  );
  const updateJobs = db.prepare(
    `UPDATE jobs SET country = ? WHERE location = ? AND (country IS NULL OR country = '')`,
  );

  let ok = 0, failed = 0, cached = 0;

  for (let i = 0; i < rows.length; i++) {
    const { location } = rows[i];

    // Check hardcoded
    const hardcoded = HARDCODED[location.toLowerCase().trim()];
    if (hardcoded) {
      updateJobs.run(hardcoded, location);
      process.stdout.write(`[hardcoded] ${location} → ${hardcoded}\n`);
      ok++;
      continue;
    }

    // Check DB cache
    const cached_row = db.prepare(`SELECT country FROM location_country WHERE location = ?`).get(location);
    if (cached_row && cached_row.country) {
      updateJobs.run(cached_row.country, location);
      process.stdout.write(`[cache] ${location} → ${cached_row.country}\n`);
      cached++;
      ok++;
      continue;
    }

    // Nominatim
    process.stdout.write(`[nominatim] ${location} → `);
    let country = null;
    try {
      country = await nominatimLookup(location);
      process.stdout.write(`${country ?? '(not found)'}\n`);
      upsertCache.run(location, country ?? '', new Date().toISOString());
      if (country) {
        updateJobs.run(country, location);
        ok++;
      } else {
        failed++;
      }
    } catch (err) {
      process.stdout.write(`ERROR: ${err.message}\n`);
      failed++;
    }

    if (i < rows.length - 1) await sleep(1100);
  }

  console.log(`\nDone. ${ok} resolved (${cached} from cache), ${failed} unresolved.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
