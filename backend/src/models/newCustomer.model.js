const db = require('../config/db');

const NewCustomer = {
  /**
   * Find a new_customer by phone number
   */
  findByPhone: async (phoneNumber) => {
    const result = await db.query(
      'SELECT * FROM new_customers WHERE phone_number = $1 LIMIT 1',
      [phoneNumber]
    );
    return result.rows[0] || null;
  },

  /**
   * Find by ID
   */
  findById: async (id) => {
    const result = await db.query('SELECT * FROM new_customers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  /**
   * Create a new pending entry
   */
  create: async (phoneNumber) => {
    const expiresHours = parseInt(process.env.NEW_CUSTOMER_EXPIRES_IN_HOURS) || 24;
    const result = await db.query(
      `INSERT INTO new_customers (phone_number, status, expired_at)
       VALUES ($1, 'pending', NOW() + INTERVAL '${expiresHours} hours')
       RETURNING *`,
      [phoneNumber]
    );
    return result.rows[0];
  },

  /**
   * Update status
   */
  updateStatus: async (id, status) => {
    const result = await db.query(
      'UPDATE new_customers SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0];
  },

  /**
   * Expire all expired pending entries
   */
  expireOldEntries: async () => {
    await db.query(
      `UPDATE new_customers SET status = 'expired'
       WHERE status = 'pending' AND expired_at < NOW()`
    );
  },
};

module.exports = NewCustomer;
