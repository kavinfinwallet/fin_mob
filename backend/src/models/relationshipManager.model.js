const db = require('../config/db');

const RelationshipManager = {
  findAllActive: async () => {
    const result = await db.query(
      'SELECT id, name, fcm_token FROM relationship_managers WHERE is_active = true'
    );
    return result.rows;
  },

  findById: async (id) => {
    const result = await db.query('SELECT * FROM relationship_managers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  updateFcmToken: async (id, fcmToken) => {
    const result = await db.query(
      'UPDATE relationship_managers SET fcm_token = $1 WHERE id = $2 RETURNING *',
      [fcmToken, id]
    );
    return result.rows[0];
  }
};

module.exports = RelationshipManager;
