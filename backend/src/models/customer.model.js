const db = require('../config/db');

const Customer = {
  findByPhone: async (phoneNumber) => {
    const result = await db.query(
      'SELECT * FROM customers WHERE phone_number = $1 LIMIT 1',
      [phoneNumber]
    );
    return result.rows[0] || null;
  },

  findById: async (id) => {
    const result = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  create: async ({ phoneNumber }) => {
    const result = await db.query(
      `INSERT INTO customers (phone_number, is_active, is_verified)
       VALUES ($1, true, true)
       RETURNING *`,
      [phoneNumber]
    );
    return result.rows[0];
  },

  updateLastLogin: async (id) => {
    const result = await db.query(
      'UPDATE customers SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  },


  deactivate: async (id) => {
    await db.query(
      'UPDATE customers SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
  },

  getProfile: async (id) => {
    const result = await db.query(
      `SELECT id, phone_number, is_active, is_verified, created_at, updated_at, last_login_at
       FROM customers WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },
};

module.exports = Customer;
