const pool = require('./database');
const bcrypt = require('bcryptjs');

const initDatabase = async () => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        mobile_number VARCHAR(20) DEFAULT '',
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'RELATIONSHIP_MANAGER',
        is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        must_reset_password BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE`);

    // Create roles master table (normalized roles)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default roles
    await pool.query(`
      INSERT INTO roles (name, description)
      VALUES 
        ('SUPER_ADMIN', 'Super admin (can do anything)'),
        ('ADMIN', 'Admin user'),
        ('TEAM_LEAD', 'Team Lead'),
        ('RELATIONSHIP_MANAGER', 'Relationship Manager')
      ON CONFLICT (name) DO NOTHING
    `);

    // Link users to roles via foreign key
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id)
    `);

    // Backfill role_id for existing users based on role name
    await pool.query(`
      UPDATE users u
      SET role_id = r.id
      FROM roles r
      WHERE u.role = r.name
        AND (u.role_id IS NULL OR u.role_id <> r.id)
    `);

    // Create customers table (clients: RM-owned, for budget analysis)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50),
        email VARCHAR(255),
        description TEXT,
        contact_details TEXT,
        assigned_rm_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Active',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_details TEXT`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_rm_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active'`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS visible_to_rm BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) DEFAULT 'INR'`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency_symbol VARCHAR(10) DEFAULT '₹'`);

    // User preference: last selected customer (per user, from database)
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_selected_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL
    `);

    // TL-RM allocation (Admin allocates RMs to TLs)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rm_tl_assignments (
        id SERIAL PRIMARY KEY,
        tl_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(rm_id)
      )
    `);

    // Relationship between users and customers (e.g. RM assigned to customer)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_customers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        assigned_role VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, customer_id)
      )
    `);

    // Create category_groups table (Non Essential, Essential, Assets, Liabilities)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS category_groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(80) NOT NULL UNIQUE,
        display_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      INSERT INTO category_groups (name, display_order)
      VALUES
        ('Non Essential', 1),
        ('Essential', 2),
        ('Assets', 3),
        ('Liabilities', 4),
        ('Others', 5)
      ON CONFLICT (name) DO NOTHING
    `);

    // Create categories table (user_id NULL = global/common categories for all users)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        keywords TEXT[],
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES category_groups(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES category_groups(id) ON DELETE SET NULL
    `);
    await pool.query(`
      ALTER TABLE categories ALTER COLUMN user_id DROP NOT NULL
    `);
    await pool.query(`
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS category_tag VARCHAR(30)
    `);

    // Create transactions table (must exist before clearing categories / updating transaction refs)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        date DATE NOT NULL,
        description TEXT NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        type VARCHAR(20) NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        category_name VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        file_name VARCHAR(255),
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Clear existing categories and seed common (global) categories - one set for all users (after transactions exists)
    await pool.query(`
      UPDATE transactions SET category_id = NULL, category_name = NULL WHERE category_id IS NOT NULL
    `);
    await pool.query('DELETE FROM categories');

    const groupRows = await pool.query(
      'SELECT id, name FROM category_groups ORDER BY display_order'
    );
    const groupIdByName = groupRows.rows.reduce((acc, g) => {
      acc[g.name] = g.id;
      return acc;
    }, {});

    const standardCategoriesByGroup = [
      {
        group: 'Non Essential',
        names: [
          'Dining / Food Delivery',
          'Entertainment / OTT',
          'Shopping',
          'Travel',
          'Subscriptions',
        ],
      },
      {
        group: 'Essential',
        names: [
          'Rent / Home EMI',
          'Groceries',
          'Utilities (EB, Water, Internet)',
          'Transport / Fuel',
          'Insurance Premiums',
          'School / Education',
        ],
      },
      {
        group: 'Assets',
        names: [
          'Bank Balance',
          'Fixed Deposits',
          'Mutual Funds',
          'Shares',
          'Gold',
          'Other Assets',
        ],
      },
      {
        group: 'Liabilities',
        names: [
          'Home Loan',
          'Personal Loan',
          'Credit Card',
          'Vehicle Loan',
          'Other Liabilities',
        ],
      },
      { group: 'Others', names: ['Uncategorized'] },
    ];

    for (const { group, names } of standardCategoriesByGroup) {
      const groupId = groupIdByName[group] || null;
      for (const name of names) {
        await pool.query(
          `INSERT INTO categories (name, keywords, user_id, group_id)
           VALUES ($1, '{}', NULL, $2)`,
          [name, groupId]
        );
      }
    }
    console.log('Categories cleared and reseeded as common (global) with groups from spec.');

    // Create uploads table (optional link to budget case)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS uploads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        budget_case_id INTEGER,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        status VARCHAR(20) DEFAULT 'processing',
        column_mapping JSONB,
        submitted_for_approval BOOLEAN DEFAULT FALSE,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        -- Period of this upload (eg. statement month/year)
        period_month INTEGER,
        period_year INTEGER,
        -- User-declared income and goal for this upload
        declared_income DECIMAL(15, 2),
        goal_amount DECIMAL(15, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS budget_case_id INTEGER`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS key_observation TEXT`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS rejection_comment TEXT`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    // Period + income/goal columns (idempotent on existing DBs)
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS period_month INTEGER`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS period_year INTEGER`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS declared_income DECIMAL(15, 2)`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS goal_amount DECIMAL(15, 2)`);
    // RM observation (written by Relationship Manager; separate from final TL/Admin key observation)
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS rm_observation TEXT`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS rm_observation_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS rm_observation_at TIMESTAMP`);
    // Track who last updated the final key observation and when
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS key_observation_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS key_observation_at TIMESTAMP`);

    // Upload approval audit (rejections and approvals logged for RM visibility)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upload_approval_audit (
        id SERIAL PRIMARY KEY,
        upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        action VARCHAR(20) NOT NULL,
        by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Track category changes made during approval (so RM can see what was changed)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transaction_category_changes (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        old_category_id INTEGER,
        old_category_name VARCHAR(100),
        new_category_id INTEGER,
        new_category_name VARCHAR(100),
        changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Budget cases: strict status flow (Initiated -> Received -> Started -> Approval -> Verified -> Ready for Customer Discussion -> Completed)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budget_cases (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        current_status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
        period_month INTEGER,
        period_year INTEGER,
        submitted_at TIMESTAMP,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rejection_comment TEXT,
        rejected_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Budget case audit trail (immutable log)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budget_case_audit (
        id SERIAL PRIMARY KEY,
        budget_case_id INTEGER NOT NULL REFERENCES budget_cases(id) ON DELETE CASCADE,
        from_status VARCHAR(50),
        to_status VARCHAR(50) NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await pool.query(`
        ALTER TABLE uploads ADD CONSTRAINT fk_uploads_budget_case
        FOREIGN KEY (budget_case_id) REFERENCES budget_cases(id) ON DELETE SET NULL
      `);
    } catch (e) {
      if (!e.message || !e.message.includes('already exists')) throw e;
    }

    // Gemini usage tracking (approximate token/usage units per day, aggregated per user per day)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gemini_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
        estimated_tokens_used BIGINT NOT NULL DEFAULT 0,
        model VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, usage_date)
      )
    `);
    // Ensure unique (user_id, usage_date) for ON CONFLICT on existing DBs created before this constraint
    try {
      await pool.query(`
        ALTER TABLE gemini_usage ADD CONSTRAINT gemini_usage_user_date_unique UNIQUE (user_id, usage_date)
      `);
    } catch (e) {
      if (!e.message?.includes('already exists')) throw e;
    }

    // Gemini usage detailed log: who used, for what feature, how many times (one row per use)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gemini_usage_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        feature VARCHAR(100) NOT NULL,
        model VARCHAR(100),
        estimated_tokens_used BIGINT NOT NULL DEFAULT 0,
        details TEXT
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_gemini_usage_log_user_used_at ON gemini_usage_log (user_id, used_at)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_gemini_usage_log_feature ON gemini_usage_log (feature)
    `);
    await pool.query(`ALTER TABLE gemini_usage_log ADD COLUMN IF NOT EXISTS prompt_tokens BIGINT`);
    await pool.query(`ALTER TABLE gemini_usage_log ADD COLUMN IF NOT EXISTS output_tokens BIGINT`);

    await pool.query(`ALTER TABLE gemini_usage ADD COLUMN IF NOT EXISTS prompt_tokens_used BIGINT NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE gemini_usage ADD COLUMN IF NOT EXISTS output_tokens_used BIGINT NOT NULL DEFAULT 0`);

    // Categorization jobs queue (background AI categorization status)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorization_jobs (
        id SERIAL PRIMARY KEY,
        upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL, -- queued | processing | completed | failed
        total_transactions INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_categorization_jobs_user ON categorization_jobs (user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_categorization_jobs_upload ON categorization_jobs (upload_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_categorization_jobs_status ON categorization_jobs (status)
    `);

    // Simple user log (e.g. logins)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default super admin (admin@gmail.com / 123456) if not exists
    const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@gmail.com';
    const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || '123456';
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [defaultAdminEmail]);
    if (existing.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10);
      const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1 LIMIT 1', ['SUPER_ADMIN']);
      const roleId = roleResult.rows[0]?.id || null;
      await pool.query(
        `INSERT INTO users (username, name, email, mobile_number, password, role, is_super_admin, role_id, enabled, must_reset_password)
         VALUES ($1, $2, $3, $4, $5, 'SUPER_ADMIN', TRUE, $6, TRUE, FALSE)`,
        [defaultAdminEmail, 'Super Admin', defaultAdminEmail, '', hashedPassword, roleId]
      );
      console.log('Default super admin created:', defaultAdminEmail);
    }

    // Verify: list tables in current database
    const tablesResult = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('Database tables initialized successfully');
    console.log('Database:', process.env.DB_NAME || '(check .env DB_NAME)');
    console.log('Tables in public schema:', tablesResult.rows.length);
    tablesResult.rows.forEach((r) => console.log('  -', r.table_name));

  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

module.exports = initDatabase;



