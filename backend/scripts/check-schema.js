const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function checkSchema() {
  const finalResult = {};
  try {
    const tables = ['customers', 'otp_verifications', 'new_customers', 'relationship_managers'];
    for (const table of tables) {
      const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [table]);
      if (res.rows.length === 0) {
        finalResult[table] = 'DOES NOT EXIST';
      } else {
        finalResult[table] = res.rows;
      }
    }
    console.log(JSON.stringify(finalResult, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkSchema();
