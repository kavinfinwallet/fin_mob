const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function checkDB() {
  try {
    const res = await pool.query('SELECT current_database(), current_user');
    console.log('Connected to:', res.rows[0]);
    
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tableNames = tables.rows.map(r => r.table_name);
    console.log('Tables:', tableNames);
    
    for (const tableName of tableNames) {
      const countRes = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
      console.log(`Table ${tableName} has ${countRes.rows[0].count} rows`);
    }
    
    await pool.end();
  } catch (err) {
    console.error('DB Check Failed:', err.message);
    process.exit(1);
  }
}

checkDB();
