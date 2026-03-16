const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/db');

const up = async () => {
  try {
    console.log('🚀 Starting database initialization...\n');

    // ── Enable UUID ─────────────────────────────────────────
    await query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('✅ UUID extension enabled');

    // ── 1. NEW CUSTOMERS ────────────────────────────────────
    // Stores new phone numbers during signup flow
    await query(`
      CREATE TABLE IF NOT EXISTS new_customers (
        id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        phone_number VARCHAR(20) NOT NULL UNIQUE,
        status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'verified', 'expired')),
        created_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
        expired_at   TIMESTAMP   NOT NULL
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_new_customers_phone_number
        ON new_customers (phone_number)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_new_customers_status
        ON new_customers (status)
    `);
    console.log('✅ Table created: new_customers');

    // ── 2. CUSTOMERS ────────────────────────────────────────
    // Stores verified active customers (login table)
    await query(`
      CREATE TABLE IF NOT EXISTS customers (
        id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        phone_number   VARCHAR(20) NOT NULL UNIQUE,
        fcm_token      TEXT,
        is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
        is_verified    BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
        last_login_at  TIMESTAMP
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_customers_phone_number
        ON customers (phone_number)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_customers_is_active
        ON customers (is_active)
    `);
    console.log('✅ Table created: customers');

    // ── 3. OTP VERIFICATIONS ────────────────────────────────
    // Tracks OTP requests, attempts and expiry
    await query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id   UUID        NOT NULL,
        phone_number  VARCHAR(20) NOT NULL,
        otp_code      TEXT        NOT NULL,
        purpose       VARCHAR(20) NOT NULL
                        CHECK (purpose IN ('login', 'signup')),
        is_used       BOOLEAN     NOT NULL DEFAULT FALSE,
        attempt_count INTEGER     NOT NULL DEFAULT 0,
        max_attempts  INTEGER     NOT NULL DEFAULT 3,
        created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMP   NOT NULL,
        verified_at   TIMESTAMP
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_otp_phone_number_purpose
        ON otp_verifications (phone_number, purpose)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_otp_is_used
        ON otp_verifications (is_used)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_otp_expires_at
        ON otp_verifications (expires_at)
    `);
    console.log('✅ Table created: otp_verifications');

    // ── 4. NOTIFICATION LOGS ────────────────────────────────
    // Tracks all FCM and web push notifications sent
    await query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id   UUID        NOT NULL,
        type          VARCHAR(30) NOT NULL
                        CHECK (type IN ('new_customer', 'existing_customer')),
        channel       VARCHAR(20) NOT NULL
                        CHECK (channel IN ('fcm', 'web_push')),
        status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed')),
        error_message TEXT,
        created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
        sent_at       TIMESTAMP
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_notification_logs_customer_id
        ON notification_logs (customer_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_notification_logs_status
        ON notification_logs (status)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
        ON notification_logs (created_at DESC)
    `);
    console.log('✅ Table created: notification_logs');

    // ── 5. RELATIONSHIP MANAGERS ────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS relationship_managers (
        id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(100) NOT NULL,
        fcm_token   TEXT,
        is_active   BOOLEAN      DEFAULT TRUE,
        created_at  TIMESTAMP    DEFAULT NOW()
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_rm_is_active 
        ON relationship_managers (is_active)
    `);
    console.log('✅ Table created: relationship_managers');

    // ── AUTO UPDATE updated_at trigger ──────────────────────
    await query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers
    `);
    await query(`
      CREATE TRIGGER trg_customers_updated_at
        BEFORE UPDATE ON customers
        FOR EACH ROW EXECUTE FUNCTION update_updated_at()
    `);
    console.log('✅ Trigger created: trg_customers_updated_at');

    // ── Summary ──────────────────────────────────────────────
    console.log('\n✅ Database initialized successfully!\n');
    console.log('Tables created:');
    console.log('  - new_customers');
    console.log('  - customers');
    console.log('  - otp_verifications');
    console.log('  - notification_logs');
    console.log('  - relationship_managers');
    console.log('\nColumn naming: snake_case ✅\n');

    process.exit(0);

  } catch (err) {
    console.error('\n❌ Database initialization failed:', err.message);
    process.exit(1);
  }
};

module.exports = { up };

if (require.main === module) {
  up();
}