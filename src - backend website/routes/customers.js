const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Create customer — Admin or Super Admin only (TL and RM cannot create)
router.post('/', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Super Admin can create customers' });
    }

    const { name, code, email, description, contact_details, status, assigned_rm_id, currency_code, currency_symbol } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Customer name is required' });
    }

    const rmId = assigned_rm_id || null;
    const currCode = currency_code || 'INR';
    const currSymbol = currency_symbol != null && currency_symbol !== '' ? currency_symbol : '₹';

    const result = await pool.query(
      `INSERT INTO customers (name, code, email, description, contact_details, assigned_rm_id, status, created_by, currency_code, currency_symbol)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, code, email, description, contact_details, assigned_rm_id, status, currency_code, currency_symbol, created_at`,
      [name, code || null, email || null, description || null, contact_details || null, rmId, status || 'Active', req.user.id, currCode, currSymbol]
    );

    const row = result.rows[0];
    if (row.assigned_rm_id) {
      await pool.query(
        'INSERT INTO user_customers (user_id, customer_id, assigned_role) VALUES ($1, $2, $3) ON CONFLICT (user_id, customer_id) DO NOTHING',
        [row.assigned_rm_id, row.id, 'RM']
      );
    }

    res.status(201).json({ customer: row });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ message: 'Error creating customer' });
  }
});

// List customers - role-based visibility. ?activeOnly=true returns only Active (for dropdowns).
router.get('/', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;
    const activeOnly = req.query.activeOnly === 'true';

    let result;
    if (isAdmin) {
      result = await pool.query(
        `SELECT c.id, c.name, c.code, c.email, c.description, c.contact_details, c.assigned_rm_id, c.status, c.visible_to_rm, c.currency_code, c.currency_symbol, c.created_at,
                u.name AS rm_name, u.email AS rm_email
         FROM customers c
         LEFT JOIN users u ON u.id = c.assigned_rm_id
         ${activeOnly ? 'WHERE c.status = $1' : ''}
         ORDER BY c.name`,
        activeOnly ? ['Active'] : []
      );
    } else if (role === 'TEAM_LEAD') {
      result = await pool.query(
        `SELECT DISTINCT c.id, c.name, c.code, c.email, c.description, c.contact_details, c.assigned_rm_id, c.status, c.visible_to_rm, c.currency_code, c.currency_symbol, c.created_at,
                u.name AS rm_name, u.email AS rm_email
         FROM customers c
         LEFT JOIN users u ON u.id = c.assigned_rm_id
         INNER JOIN rm_tl_assignments a ON a.rm_id = c.assigned_rm_id AND a.tl_id = $1
         ${activeOnly ? 'WHERE c.status = $2' : ''}
         ORDER BY c.name`,
        activeOnly ? [req.user.id, 'Active'] : [req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT c.id, c.name, c.code, c.email, c.description, c.contact_details, c.assigned_rm_id, c.status, c.currency_code, c.currency_symbol, c.created_at
         FROM customers c
         WHERE c.assigned_rm_id = $1
         AND (c.visible_to_rm IS NULL OR c.visible_to_rm = true)
         ${activeOnly ? 'AND c.status = $2' : ''}
         ORDER BY c.name`,
        activeOnly ? [req.user.id, 'Active'] : [req.user.id]
      );
    }

    const customerList = result.rows;
    const prefResult = await pool.query(
      'SELECT last_selected_customer_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const selectedCustomerId = prefResult.rows[0]?.last_selected_customer_id ?? null;
    const validSelectedId = selectedCustomerId && customerList.some(c => c.id === selectedCustomerId)
      ? selectedCustomerId
      : null;
    if (validSelectedId !== selectedCustomerId && selectedCustomerId != null) {
      await pool.query('UPDATE users SET last_selected_customer_id = NULL WHERE id = $1', [req.user.id]);
    }

    res.json({ customers: customerList, selectedCustomerId: validSelectedId });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ message: 'Error fetching customers' });
  }
});

// Update current user's selected customer (persisted per user in DB)
router.patch('/selected', authenticate, async (req, res) => {
  try {
    const { customerId } = req.body;
    const userId = req.user.id;
    if (customerId !== null && customerId !== undefined && customerId !== '') {
      const id = typeof customerId === 'number' ? customerId : parseInt(customerId, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid customer id' });
      }
      const role = req.user.role;
      const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;
      let canSelect;
      if (isAdmin) {
        const r = await pool.query('SELECT id, status FROM customers WHERE id = $1', [id]);
        canSelect = r.rows.length > 0 && (r.rows[0].status || 'Active') === 'Active';
      } else if (role === 'TEAM_LEAD') {
        const r = await pool.query(
          `SELECT c.id, c.status FROM customers c INNER JOIN rm_tl_assignments a ON a.rm_id = c.assigned_rm_id AND a.tl_id = $1 WHERE c.id = $2`,
          [userId, id]
        );
        canSelect = r.rows.length > 0 && (r.rows[0].status || 'Active') === 'Active';
      } else {
        const r = await pool.query('SELECT id, status FROM customers WHERE id = $1 AND assigned_rm_id = $2', [id, userId]);
        canSelect = r.rows.length > 0 && (r.rows[0].status || 'Active') === 'Active';
      }
      if (!canSelect) {
        return res.status(403).json({ message: 'Customer not in your list or customer is inactive' });
      }
      await pool.query('UPDATE users SET last_selected_customer_id = $1 WHERE id = $2', [id, userId]);
      return res.json({ selectedCustomerId: id });
    }
    await pool.query('UPDATE users SET last_selected_customer_id = NULL WHERE id = $1', [userId]);
    res.json({ selectedCustomerId: null });
  } catch (error) {
    console.error('Update selected customer error:', error);
    res.status(500).json({ message: 'Error updating selected customer' });
  }
});

// List RMs that can be assigned to customers (Admin: all RMs; TL: only RMs allocated to that TL)
router.get('/assignable-rms', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;

    let result;
    if (isAdmin) {
      result = await pool.query(
        `SELECT id, name, email FROM users WHERE role = 'RELATIONSHIP_MANAGER' AND enabled = TRUE ORDER BY name`
      );
    } else if (role === 'TEAM_LEAD') {
      result = await pool.query(
        `SELECT u.id, u.name, u.email
         FROM users u
         INNER JOIN rm_tl_assignments a ON a.rm_id = u.id AND a.tl_id = $1
         WHERE u.role = 'RELATIONSHIP_MANAGER' AND u.enabled = TRUE
         ORDER BY u.name`,
        [req.user.id]
      );
    } else {
      return res.json({ rms: [] });
    }

    res.json({ rms: result.rows });
  } catch (error) {
    console.error('Get assignable RMs error:', error);
    res.status(500).json({ message: 'Error fetching RMs' });
  }
});

// Update customer (owner RM or Admin/TL); Admin/TL can change assigned_rm_id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, email, description, contact_details, status, assigned_rm_id, visible_to_rm, currency_code, currency_symbol } = req.body;

    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;
    const isTL = role === 'TEAM_LEAD';

    const check = await pool.query(
      'SELECT id, assigned_rm_id FROM customers WHERE id = $1',
      [id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    const cust = check.rows[0];
    if (!isAdmin && !isTL && cust.assigned_rm_id !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this customer' });
    }

    if (isTL) {
      const tlCheck = await pool.query(
        'SELECT 1 FROM rm_tl_assignments WHERE tl_id = $1 AND rm_id = $2',
        [req.user.id, cust.assigned_rm_id]
      );
      if (tlCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Not authorized to update this customer' });
      }
    }

    // Team Lead can only update visible_to_rm (show/hide from RM); customer is not disabled, only visibility to RM changes
    const updates = [];
    const values = [];
    let v = 1;
    if (isTL) {
      if (visible_to_rm === undefined) {
        return res.status(400).json({ message: 'Team Lead can only set visibility to RM (visible_to_rm)' });
      }
      updates.push(`visible_to_rm = $${v++}`);
      values.push(Boolean(visible_to_rm));
    } else {
      if (name !== undefined) { updates.push(`name = $${v++}`); values.push(name); }
      if (code !== undefined) { updates.push(`code = $${v++}`); values.push(code); }
      if (email !== undefined) { updates.push(`email = $${v++}`); values.push(email); }
      if (description !== undefined) { updates.push(`description = $${v++}`); values.push(description); }
      if (contact_details !== undefined) { updates.push(`contact_details = $${v++}`); values.push(contact_details); }
      if (status !== undefined) { updates.push(`status = $${v++}`); values.push(status); }
      if (isAdmin && assigned_rm_id !== undefined) {
        updates.push(`assigned_rm_id = $${v++}`);
        values.push(assigned_rm_id === '' || assigned_rm_id === null ? null : assigned_rm_id);
      }
      if (currency_code !== undefined) { updates.push(`currency_code = $${v++}`); values.push(currency_code || 'INR'); }
      if (currency_symbol !== undefined) { updates.push(`currency_symbol = $${v++}`); values.push(currency_symbol != null && currency_symbol !== '' ? currency_symbol : '₹'); }
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${v} RETURNING id, name, code, email, description, contact_details, assigned_rm_id, status, visible_to_rm, currency_code, currency_symbol, created_at`,
      values
    );

    const updated = result.rows[0];
    if (isAdmin && assigned_rm_id !== undefined) {
      if (cust.assigned_rm_id) {
        await pool.query('DELETE FROM user_customers WHERE user_id = $1 AND customer_id = $2', [cust.assigned_rm_id, id]);
      }
      if (updated.assigned_rm_id) {
        await pool.query(
          'INSERT INTO user_customers (user_id, customer_id, assigned_role) VALUES ($1, $2, $3) ON CONFLICT (user_id, customer_id) DO NOTHING',
          [updated.assigned_rm_id, id, 'RM']
        );
      }
    }

    res.json({ customer: updated });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ message: 'Error updating customer' });
  }
});

module.exports = router;
