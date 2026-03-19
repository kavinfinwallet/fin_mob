const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

const STATUS_FLOW = [
  'INITIATED',
  'RECEIVED',
  'STARTED',
  'PENDING_APPROVAL',  // submitted to TL
  'VERIFIED',          // TL approved
  'READY_FOR_CUSTOMER_DISCUSSION',
  'COMPLETED_BUDGET_ANALYSIS'
];

const canTransition = (fromStatus, toStatus) => {
  if (toStatus === 'PENDING_APPROVAL') return fromStatus === 'STARTED';
  if (toStatus === 'VERIFIED') return fromStatus === 'PENDING_APPROVAL';
  if (toStatus === 'REJECTED') return fromStatus === 'PENDING_APPROVAL';
  const idx = STATUS_FLOW.indexOf(fromStatus);
  const nextIdx = STATUS_FLOW.indexOf(toStatus);
  return nextIdx === idx + 1 && nextIdx >= 0;
};

const addAudit = async (budgetCaseId, fromStatus, toStatus, userId, comment) => {
  await pool.query(
    `INSERT INTO budget_case_audit (budget_case_id, from_status, to_status, user_id, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [budgetCaseId, fromStatus, toStatus, userId, comment || null]
  );
};

// List budget cases - RM: own; TL: allocated RMs'; Admin: all
router.get('/', authenticate, async (req, res) => {
  try {
    const { customer_id, status } = req.query;
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;

    let query = `
      SELECT bc.id, bc.customer_id, bc.created_by, bc.current_status, bc.period_month, bc.period_year,
             bc.submitted_at, bc.approved_by, bc.rejection_comment, bc.rejected_at, bc.created_at, bc.updated_at,
             c.name AS customer_name,
             u_rm.name AS rm_name, u_rm.email AS rm_email
      FROM budget_cases bc
      JOIN customers c ON c.id = bc.customer_id
      JOIN users u_rm ON u_rm.id = bc.created_by
    `;
    const params = [];
    let p = 1;

    if (!isAdmin && role === 'TEAM_LEAD') {
      query += ` INNER JOIN rm_tl_assignments a ON a.rm_id = bc.created_by AND a.tl_id = $${p}`;
      params.push(req.user.id);
      p++;
    } else if (!isAdmin && role === 'RELATIONSHIP_MANAGER') {
      query += ` WHERE bc.created_by = $${p}`;
      params.push(req.user.id);
      p++;
    }

    if (customer_id) {
      query += (params.length ? ' AND' : ' WHERE') + ` bc.customer_id = $${p}`;
      params.push(customer_id);
      p++;
    }
    if (status) {
      query += (params.length ? ' AND' : ' WHERE') + ` bc.current_status = $${p}`;
      params.push(status);
      p++;
    }

    query += ' ORDER BY bc.updated_at DESC';

    const result = await pool.query(query, params);
    res.json({ budget_cases: result.rows });
  } catch (error) {
    console.error('List budget cases error:', error);
    res.status(500).json({ message: 'Error fetching budget cases' });
  }
});

// Get one budget case with audit trail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;

    const caseResult = await pool.query(
      `SELECT bc.*, c.name AS customer_name, u_rm.name AS rm_name, u_rm.email AS rm_email
       FROM budget_cases bc
       JOIN customers c ON c.id = bc.customer_id
       JOIN users u_rm ON u_rm.id = bc.created_by
       WHERE bc.id = $1`,
      [id]
    );
    if (caseResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget case not found' });
    }

    const bc = caseResult.rows[0];
    if (!isAdmin && role === 'TEAM_LEAD') {
      const tlCheck = await pool.query('SELECT id FROM rm_tl_assignments WHERE tl_id = $1 AND rm_id = $2', [req.user.id, bc.created_by]);
      if (tlCheck.rows.length === 0) return res.status(403).json({ message: 'Not authorized' });
    } else if (!isAdmin && role === 'RELATIONSHIP_MANAGER' && bc.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const auditResult = await pool.query(
      `SELECT a.id, a.from_status, a.to_status, a.user_id, a.comment, a.created_at, u.name AS user_name
       FROM budget_case_audit a
       JOIN users u ON u.id = a.user_id
       WHERE a.budget_case_id = $1 ORDER BY a.created_at ASC`,
      [id]
    );

    res.json({ budget_case: bc, audit: auditResult.rows });
  } catch (error) {
    console.error('Get budget case error:', error);
    res.status(500).json({ message: 'Error fetching budget case' });
  }
});

// Create budget case (RM only, for own customer)
router.post('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'RELATIONSHIP_MANAGER' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only RM can create budget cases' });
    }

    const { customer_id, period_month, period_year } = req.body;
    if (!customer_id) {
      return res.status(400).json({ message: 'customer_id is required' });
    }

    const cust = await pool.query(
      'SELECT id, assigned_rm_id, status FROM customers WHERE id = $1',
      [customer_id]
    );
    if (cust.rows.length === 0) return res.status(404).json({ message: 'Customer not found' });
    if ((cust.rows[0].status || 'Active') !== 'Active') {
      return res.status(403).json({ message: 'Cannot create budget case for an inactive customer. Please select an active customer.' });
    }
    if (cust.rows[0].assigned_rm_id !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Customer not assigned to you' });
    }

    const result = await pool.query(
      `INSERT INTO budget_cases (customer_id, created_by, current_status, period_month, period_year)
       VALUES ($1, $2, 'INITIATED', $3, $4)
       RETURNING id, customer_id, created_by, current_status, period_month, period_year, created_at`,
      [customer_id, req.user.id, period_month || null, period_year || null]
    );

    const row = result.rows[0];
    await addAudit(row.id, null, 'INITIATED', req.user.id, null);

    res.status(201).json({ budget_case: row });
  } catch (error) {
    console.error('Create budget case error:', error);
    res.status(500).json({ message: 'Error creating budget case' });
  }
});

// Transition status (RM: Initiated->Received->Started->PendingApproval; then Ready->Completed. TL: Approve/Reject)
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { to_status, comment } = req.body;

    if (!to_status) {
      return res.status(400).json({ message: 'to_status is required' });
    }

    const caseResult = await pool.query(
      'SELECT * FROM budget_cases WHERE id = $1',
      [id]
    );
    if (caseResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget case not found' });
    }

    const bc = caseResult.rows[0];
    const fromStatus = bc.current_status;
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || req.user.is_super_admin;

    if (role === 'TEAM_LEAD' && !isAdmin) {
      const tlCheck = await pool.query('SELECT id FROM rm_tl_assignments WHERE tl_id = $1 AND rm_id = $2', [req.user.id, bc.created_by]);
      if (tlCheck.rows.length === 0) return res.status(403).json({ message: 'Not authorized to act on this case' });
    } else if (role === 'RELATIONSHIP_MANAGER' && bc.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (to_status === 'VERIFIED') {
      if (fromStatus !== 'PENDING_APPROVAL') {
        return res.status(400).json({ message: 'Only cases pending approval can be verified' });
      }
      await pool.query(
        `UPDATE budget_cases SET current_status = 'VERIFIED', approved_by = $1, submitted_at = NULL, rejection_comment = NULL, rejected_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [req.user.id, id]
      );
      await addAudit(id, fromStatus, 'VERIFIED', req.user.id, comment);
      const updated = await pool.query('SELECT * FROM budget_cases WHERE id = $1', [id]);
      return res.json({ budget_case: updated.rows[0], message: 'Approved' });
    }

    if (to_status === 'REJECTED') {
      if (fromStatus !== 'PENDING_APPROVAL') {
        return res.status(400).json({ message: 'Only cases pending approval can be rejected' });
      }
      if (!comment || !comment.trim()) {
        return res.status(400).json({ message: 'Rejection comment is required' });
      }
      await pool.query(
        `UPDATE budget_cases SET current_status = 'STARTED', submitted_at = NULL, approved_by = NULL, rejection_comment = $1, rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [comment.trim(), id]
      );
      await addAudit(id, fromStatus, 'REJECTED', req.user.id, comment);
      const updated = await pool.query('SELECT * FROM budget_cases WHERE id = $1', [id]);
      return res.json({ budget_case: updated.rows[0], message: 'Rejected' });
    }

    if (!canTransition(fromStatus, to_status)) {
      return res.status(400).json({
        message: `Invalid status transition from ${fromStatus} to ${to_status}`,
        allowed_next: fromStatus === 'STARTED' ? ['PENDING_APPROVAL'] : STATUS_FLOW[STATUS_FLOW.indexOf(fromStatus) + 1]
      });
    }

    const setSubmitted = to_status === 'PENDING_APPROVAL'
      ? ', submitted_at = CURRENT_TIMESTAMP'
      : '';

    await pool.query(
      `UPDATE budget_cases SET current_status = $1, updated_at = CURRENT_TIMESTAMP ${setSubmitted} WHERE id = $2`,
      [to_status, id]
    );
    await addAudit(id, fromStatus, to_status, req.user.id, comment || null);

    const updated = await pool.query('SELECT * FROM budget_cases WHERE id = $1', [id]);
    res.json({ budget_case: updated.rows[0] });
  } catch (error) {
    console.error('Status transition error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Link upload to budget case (optional)
router.patch('/:id/link-upload', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { upload_id } = req.body;

    const bc = await pool.query('SELECT id, created_by FROM budget_cases WHERE id = $1', [id]);
    if (bc.rows.length === 0) return res.status(404).json({ message: 'Budget case not found' });
    if (bc.rows[0].created_by !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await pool.query(
      'UPDATE uploads SET budget_case_id = $1 WHERE id = $2 AND user_id = $3',
      [id, upload_id, req.user.id]
    );

    res.json({ message: 'Upload linked' });
  } catch (error) {
    console.error('Link upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
