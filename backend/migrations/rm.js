const { query } = require('../src/config/db');

const up = async () => {
  console.log('Running migration: 002_add_relationship_managers.js');

  await query(`
    CREATE TABLE IF NOT EXISTS relationship_managers (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(100) NOT NULL,
        fcm_token   TEXT,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_rm_is_active ON relationship_managers (is_active)');
};

module.exports = { up };
