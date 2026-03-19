const db = require('../config/db');

const NotificationLog = {
  create: async ({ customerId, type, channel, status = 'pending', errorMessage = null }) => {
    const result = await db.query(
      `INSERT INTO notification_logs (customer_id, type, channel, status, error_message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [customerId, type, channel, status, errorMessage]
    );
    return result.rows[0];
  },

  updateStatus: async (id, status, errorMessage = null) => {
    const result = await db.query(
      `UPDATE notification_logs
       SET status = $1,
           error_message = $2,
           sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END
       WHERE id = $4
       RETURNING *`,
      [status, errorMessage, status, id]
    );
    return result.rows[0];
  },

  /**
   * Get logs for a customer with optional pagination
   */
  findByCustomer: async (customerId, limit = 20, offset = 0) => {
    const result = await db.query(
      `SELECT * FROM notification_logs
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );
    return result.rows;
  },

  findById: async (id) => {
    const result = await db.query('SELECT * FROM notification_logs WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  /**
   * Count total logs for a customer (for pagination)
   */
  countByCustomer: async (customerId) => {
    const result = await db.query(
      'SELECT COUNT(*) FROM notification_logs WHERE customer_id = $1',
      [customerId]
    );
    return parseInt(result.rows[0].count);
  },
};

module.exports = NotificationLog;
