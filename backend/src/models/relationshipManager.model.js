const db = require('../config/db');

const RelationshipManager = {
  findAllActive: async () => {
    const result = await db.query(
      'SELECT id, name FROM relationship_managers WHERE is_active = true'
    );
    return result.rows;
  },

  findById: async (id) => {
    const result = await db.query('SELECT * FROM relationship_managers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

};

module.exports = RelationshipManager;
