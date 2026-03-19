const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Get all category groups (for tabs / grouping)
router.get('/groups', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, display_order FROM category_groups ORDER BY display_order, id'
    );
    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Get category groups error:', error);
    res.status(500).json({ message: 'Error fetching category groups' });
  }
});

// Get all categories (common/global: same list for all users)
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.keywords, c.user_id, c.group_id, c.category_tag,
              cg.name AS group_name
       FROM categories c
       LEFT JOIN category_groups cg ON c.group_id = cg.id
       WHERE c.user_id IS NULL
       ORDER BY cg.display_order NULLS LAST, c.name`
    );
    const categories = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      keywords: row.keywords,
      user_id: row.user_id,
      group_id: row.group_id,
      group_name: row.group_name || 'Others',
      category_tag: row.category_tag || null,
    }));
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

// Helper: only allow non-Relationship-Manager roles to modify global categories/groups
const assertCanManageCategories = (user) => {
  if (!user) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  if (user.role === 'RELATIONSHIP_MANAGER') {
    const err = new Error('Relationship Managers cannot modify global categories');
    err.statusCode = 403;
    throw err;
  }
};

// Create category group
router.post('/groups', authenticate, async (req, res) => {
  try {
    assertCanManageCategories(req.user);
    const { name, display_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Group name is required' });
    }

    try {
      const result = await pool.query(
        'INSERT INTO category_groups (name, display_order) VALUES ($1, COALESCE($2, 0)) RETURNING id, name, display_order',
        [name.trim(), Number.isFinite(display_order) ? display_order : null]
      );
      return res.status(201).json({ group: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        // unique_violation on name
        return res.status(409).json({ message: 'Group name must be unique' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Create category group error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || 'Error creating category group' });
  }
});

// Update category group
router.put('/groups/:id', authenticate, async (req, res) => {
  try {
    assertCanManageCategories(req.user);
    const { id } = req.params;
    const { name, display_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Group name is required' });
    }

    try {
      const result = await pool.query(
        `UPDATE category_groups
         SET name = $1,
             display_order = COALESCE($2, display_order)
         WHERE id = $3
         RETURNING id, name, display_order`,
        [name.trim(), Number.isFinite(display_order) ? display_order : null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Category group not found' });
      }

      return res.json({ group: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ message: 'Group name must be unique' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Update category group error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || 'Error updating category group' });
  }
});

// Delete category group
router.delete('/groups/:id', authenticate, async (req, res) => {
  try {
    assertCanManageCategories(req.user);
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM category_groups WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category group not found' });
    }

    // categories referencing this group will automatically have group_id set to NULL (ON DELETE SET NULL)
    return res.json({ message: 'Category group deleted successfully' });
  } catch (error) {
    console.error('Delete category group error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || 'Error deleting category group' });
  }
});

// Allowed category tags (Investment, EMI)
const ALLOWED_CATEGORY_TAGS = ['investment', 'emi'];

// Create category (common/global: user_id NULL so same for all users)
router.post('/', authenticate, async (req, res) => {
  try {
    assertCanManageCategories(req.user);
    const { name, keywords, group_id, category_tag } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const tag = category_tag && ALLOWED_CATEGORY_TAGS.includes(String(category_tag).toLowerCase())
      ? String(category_tag).toLowerCase()
      : null;

    const result = await pool.query(
      'INSERT INTO categories (name, keywords, user_id, group_id, category_tag) VALUES ($1, $2, NULL, $3, $4) RETURNING *',
      [name, keywords || [], group_id || null, tag]
    );

    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ message: 'Error creating category' });
  }
});

// Update category (allow update of global categories: user_id IS NULL)
router.put('/:id', authenticate, async (req, res) => {
  try {
    assertCanManageCategories(req.user);
    const { id } = req.params;
    const { name, keywords, group_id, category_tag } = req.body;

    const tag = category_tag && ALLOWED_CATEGORY_TAGS.includes(String(category_tag).toLowerCase())
      ? String(category_tag).toLowerCase()
      : null;

    const result = await pool.query(
      'UPDATE categories SET name = $1, keywords = $2, group_id = COALESCE($3, group_id), category_tag = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND user_id IS NULL RETURNING *',
      [name, keywords || [], group_id !== undefined ? group_id : null, tag, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ category: result.rows[0] });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ message: 'Error updating category' });
  }
});

// Delete category (allow delete of global categories: user_id IS NULL)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    assertCanManageCategories(req.user);
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND user_id IS NULL RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Error deleting category' });
  }
});

module.exports = router;



