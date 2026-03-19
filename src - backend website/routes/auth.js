const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Register - disabled by default (no public registration; admin imports users)
router.post('/register', async (req, res) => {
  if (process.env.ALLOW_REGISTRATION !== 'true') {
    return res.status(403).json({ message: 'Registration is disabled. Contact your administrator.' });
  }
  try {
    const { username, name, email, mobile_number, password } = req.body;

    if (!username || !name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const userCheck = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultRole = 'RELATIONSHIP_MANAGER';
    const result = await pool.query(
      `INSERT INTO users (username, name, email, mobile_number, password, role, is_super_admin, role_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               (SELECT id FROM roles WHERE name = $8 LIMIT 1))
       RETURNING id, username, name, email, mobile_number, role, is_super_admin, enabled, must_reset_password`,
      [username, name, email, mobile_number || '', hashedPassword, defaultRole, false, defaultRole]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        mobile_number: user.mobile_number,
        role: user.role,
        is_super_admin: user.is_super_admin,
        must_reset_password: user.must_reset_password
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login - email or username, check enabled
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const loginId = email || username;

    if (!loginId || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const result = await pool.query(
      `SELECT id, username, name, email, mobile_number, password, role, is_super_admin, enabled, must_reset_password
       FROM users WHERE email = $1 OR username = $1`,
      [loginId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (user.enabled === false) {
      return res.status(403).json({ message: 'Account is disabled. Contact your administrator.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    try {
      await pool.query(
        `INSERT INTO user_logs (user_id, action, details)
         VALUES ($1, $2, $3)`,
        [user.id, 'login', 'User logged in']
      );
    } catch (logError) {
      console.warn('Failed to record user log:', logError.message);
    }

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        mobile_number: user.mobile_number,
        role: user.role,
        is_super_admin: user.is_super_admin,
        must_reset_password: user.must_reset_password
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      'SELECT id, username, name, email, mobile_number, role, is_super_admin, enabled, must_reset_password FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Change password (e.g. first-time reset from Settings)
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const result = await pool.query(
      'SELECT id, password FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1, must_reset_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashed, req.user.id]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper: require Admin or Super Admin for admin-only routes
const requireAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      'SELECT id, username, name, email, role, is_super_admin, enabled FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Admin: import/create user (e.g. by email; default password = email, must reset on first login)
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, name, email, mobile_number, password, role, is_super_admin } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }

    const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'RELATIONSHIP_MANAGER'];
    const finalRole = allowedRoles.includes(role) ? role : 'RELATIONSHIP_MANAGER';
    const uname = username || email;

    const userCheck = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [uname, email]
    );

    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }

    const defaultPassword = password || email;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    const mustResetPassword = !password;

    const result = await pool.query(
      `INSERT INTO users (username, name, email, mobile_number, password, role, is_super_admin, role_id, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               (SELECT id FROM roles WHERE name = $8 LIMIT 1), $9)
       RETURNING id, username, name, email, mobile_number, role, is_super_admin, enabled, must_reset_password, created_at`,
      [
        uname,
        name,
        email,
        mobile_number || '',
        hashedPassword,
        finalRole,
        Boolean(is_super_admin) && finalRole === 'SUPER_ADMIN',
        finalRole,
        mustResetPassword
      ]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Create user (admin) error:', error);
    res.status(500).json({ message: 'Server error while creating user' });
  }
});

// Admin: update user (enable/disable, role, etc.)
router.patch('/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const { enabled, role, name, mobile_number } = req.body;
    const roleTrimmed = typeof role === 'string' ? role.trim() : (role || '');

    // If role is being changed, check that user has no assignments (must remove links first)
    if (roleTrimmed) {
      const allowed = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'RELATIONSHIP_MANAGER'];
      const newRoleNorm = roleTrimmed.toUpperCase();
      if (allowed.includes(newRoleNorm) || allowed.some((r) => r.toUpperCase() === newRoleNorm)) {
        const currentUser = await pool.query(
          `SELECT u.id, u.role AS role_col, r.name AS role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.id = $1`,
          [userId]
        );
        if (currentUser.rows.length === 0) {
          return res.status(404).json({ message: 'User not found' });
        }
        const row = currentUser.rows[0];
        const currentRoleRaw = (row.role_name || row.role_col || '').toString().trim();
        const currentRoleNorm = currentRoleRaw.toUpperCase();
        const roleActuallyChanging = currentRoleNorm !== newRoleNorm;
        if (roleActuallyChanging) {
          if (currentRoleNorm === 'RELATIONSHIP_MANAGER') {
            const [custCount, assignCount] = await Promise.all([
              pool.query('SELECT COUNT(*) AS n FROM customers WHERE assigned_rm_id = $1', [userId]),
              pool.query('SELECT COUNT(*) AS n FROM rm_tl_assignments WHERE rm_id = $1', [userId])
            ]);
            const customersAsRm = parseInt(custCount.rows[0].n, 10) || 0;
            const inRmTlAssignments = parseInt(assignCount.rows[0].n, 10) || 0;
            if (customersAsRm > 0 || inRmTlAssignments > 0) {
              const parts = [];
              if (customersAsRm > 0) parts.push(`${customersAsRm} customer(s) assigned to this RM`);
              if (inRmTlAssignments > 0) parts.push('this RM is assigned to a Team Lead');
              return res.status(400).json({
                message: `Cannot change role: user is still linked. Remove the following first: ${parts.join('; ')}. Reassign or remove in Assignments page and RM's Details.`
              });
            }
          }
          if (currentRoleNorm === 'TEAM_LEAD') {
            const tlAssigns = await pool.query('SELECT COUNT(*) AS n FROM rm_tl_assignments WHERE tl_id = $1', [userId]);
            const count = parseInt(tlAssigns.rows[0].n, 10) || 0;
            if (count > 0) {
              return res.status(400).json({
                message: `Cannot change role: this Team Lead has ${count} RM(s) assigned. Remove all RM–TL assignments for this user first (Assignments page).`
              });
            }
          }
        }
      }
    }

    const updates = [];
    const values = [];
    let v = 1;

    if (typeof enabled === 'boolean') {
      updates.push(`enabled = $${v++}`);
      values.push(enabled);
    }
    if (roleTrimmed) {
      const allowed = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'RELATIONSHIP_MANAGER'];
      const roleToSet = allowed.find((r) => r.toUpperCase() === roleTrimmed.toUpperCase());
      if (roleToSet) {
        updates.push(`role = $${v++}`);
        values.push(roleToSet);
        updates.push(`role_id = (SELECT id FROM roles WHERE name = $${v++} LIMIT 1)`);
        values.push(roleToSet);
      }
    }
    if (name) {
      updates.push(`name = $${v++}`);
      values.push(name);
    }
    if (mobile_number !== undefined) {
      updates.push(`mobile_number = $${v++}`);
      values.push(mobile_number);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${v} RETURNING id, username, name, email, role, enabled, must_reset_password`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: list users with pagination and filters
// Query: page (default 1), limit (default 10), search, role, enabled (true|false|all)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim().replace(/%/g, '\\%');
    const roleFilter = (req.query.role || '').trim();
    const enabledFilter = req.query.enabled; // 'true' | 'false' | undefined (all)

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(
        `(u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex})`
      );
      params.push(`%${search}%`);
      paramIndex += 1;
    }
    if (roleFilter && ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'RELATIONSHIP_MANAGER'].includes(roleFilter)) {
      conditions.push(`u.role = $${paramIndex}`);
      params.push(roleFilter);
      paramIndex += 1;
    }
    if (enabledFilter === 'true' || enabledFilter === 'false') {
      conditions.push(`u.enabled = $${paramIndex}`);
      params.push(enabledFilter === 'true');
      paramIndex += 1;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, username, name, email, mobile_number, role, is_super_admin, enabled, must_reset_password, created_at
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error('List users (admin) error:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Admin: allocate RMs to TL (assign RM to a TL)
router.post('/rm-tl-assignments', requireAdmin, async (req, res) => {
  try {
    const { tl_id, rm_id } = req.body;
    if (!tl_id || !rm_id) {
      return res.status(400).json({ message: 'tl_id and rm_id are required' });
    }

    const tl = await pool.query('SELECT id, role FROM users WHERE id = $1 AND enabled = TRUE', [tl_id]);
    const rm = await pool.query('SELECT id, role FROM users WHERE id = $1 AND enabled = TRUE', [rm_id]);
    if (tl.rows.length === 0 || tl.rows[0].role !== 'TEAM_LEAD') {
      return res.status(400).json({ message: 'Invalid or disabled Team Lead' });
    }
    if (rm.rows.length === 0 || rm.rows[0].role !== 'RELATIONSHIP_MANAGER') {
      return res.status(400).json({ message: 'Invalid or disabled Relationship Manager' });
    }

    await pool.query(
      `INSERT INTO rm_tl_assignments (tl_id, rm_id) VALUES ($1, $2)
       ON CONFLICT (rm_id) DO UPDATE SET tl_id = $1`,
      [tl_id, rm_id]
    );

    res.status(201).json({ message: 'RM allocated to TL successfully' });
  } catch (error) {
    console.error('RM-TL assignment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: remove RM from TL
router.delete('/rm-tl-assignments/:rmId', requireAdmin, async (req, res) => {
  try {
    const { rmId } = req.params;
    const r = await pool.query('DELETE FROM rm_tl_assignments WHERE rm_id = $1 RETURNING id', [rmId]);
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    res.json({ message: 'Assignment removed' });
  } catch (error) {
    console.error('Remove assignment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: list RM-TL assignments
router.get('/rm-tl-assignments', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.tl_id, a.rm_id, a.created_at,
              u_tl.name AS tl_name, u_tl.email AS tl_email,
              u_rm.name AS rm_name, u_rm.email AS rm_email
       FROM rm_tl_assignments a
       JOIN users u_tl ON u_tl.id = a.tl_id
       JOIN users u_rm ON u_rm.id = a.rm_id
       ORDER BY u_tl.name, u_rm.name`
    );
    res.json({ assignments: result.rows });
  } catch (error) {
    console.error('List assignments error:', error);
    res.status(500).json({ message: 'Error fetching assignments' });
  }
});

// Admin: list available roles
router.get('/roles', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, created_at
       FROM roles
       ORDER BY id`
    );

    res.json({ roles: result.rows });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ message: 'Error fetching roles' });
  }
});

// Admin: user logs
router.get('/user-logs', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ul.id, ul.user_id, u.username, u.name, ul.action, ul.details, ul.created_at
       FROM user_logs ul
       LEFT JOIN users u ON u.id = ul.user_id
       ORDER BY ul.created_at DESC
       LIMIT 500`
    );

    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Get user logs error:', error);
    res.status(500).json({ message: 'Error fetching user logs' });
  }
});

module.exports = router;



