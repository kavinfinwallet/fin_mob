require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const run = async () => {
  const client = await pool.connect();
  try {
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.js') && f !== 'run.js' && f !== 'seed_rm.js')
      .sort();

    for (const file of files) {
      console.log(`⏳ Running migration: ${file} ...`);
      const migration = require(path.join(__dirname, file));
      if (typeof migration.up === 'function') {
        await migration.up();
        console.log(`✅ Migration ${file} complete.`);
      } else {
        console.warn(`⚠️ Migration ${file} does not export an 'up' function.`);
      }
    }
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
