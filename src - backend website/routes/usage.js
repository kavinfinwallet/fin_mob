const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Get Gemini token usage and remaining (simple estimate)
router.get('/gemini', authenticate, async (req, res) => {
  try {
    const dailyLimit = parseInt(process.env.GEMINI_DAILY_LIMIT_TOKENS || '100000', 10);

    const result = await pool.query(
      `SELECT COALESCE(SUM(estimated_tokens_used), 0) AS used,
              COALESCE(SUM(prompt_tokens_used), 0) AS used_input,
              COALESCE(SUM(output_tokens_used), 0) AS used_output
       FROM gemini_usage
       WHERE usage_date = CURRENT_DATE`
    );

    const used = parseInt(result.rows[0].used || 0, 10);
    const usedInput = parseInt(result.rows[0].used_input || 0, 10);
    const usedOutput = parseInt(result.rows[0].used_output || 0, 10);
    const remaining = Math.max(dailyLimit - used, 0);

    res.json({
      dailyLimit,
      used,
      usedInput,
      usedOutput,
      remaining
    });
  } catch (error) {
    console.error('Get Gemini usage error:', error);
    res.status(500).json({ message: 'Error fetching Gemini usage' });
  }
});

// Get detailed Gemini usage: who used, for what feature, how many times (and tokens)
// Query params: date=YYYY-MM-DD (default today), days=7 (for last N days), allUsers=1 (admin only)
router.get('/gemini/detail', authenticate, async (req, res) => {
  try {
    const date = req.query.date || null;
    const days = parseInt(req.query.days || '1', 10);
    const allUsers = req.query.allUsers === '1' || req.query.allUsers === 'true';
    const isAdmin = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN' || req.user?.is_super_admin;

    const dailyLimit = parseInt(process.env.GEMINI_DAILY_LIMIT_TOKENS || '100000', 10);

    let dateCondition = 'l.used_at::date = CURRENT_DATE';
    const queryParams = [];
    if (date) {
      dateCondition = 'l.used_at::date = $1';
      queryParams.push(date);
    } else if (days > 1) {
      dateCondition = 'l.used_at::date >= CURRENT_DATE - $1::int';
      queryParams.push(days);
    }

    const userFilter = allUsers && isAdmin ? '' : 'AND l.user_id = $' + (queryParams.length + 1);
    if (!allUsers || !isAdmin) {
      queryParams.push(req.user.id);
    }

    const detailResult = await pool.query(
      `SELECT l.user_id, u.username, u.name, u.email, l.feature, l.model,
              COUNT(*) AS call_count,
              SUM(l.estimated_tokens_used) AS total_tokens,
              SUM(COALESCE(l.prompt_tokens, 0)) AS input_tokens,
              SUM(COALESCE(l.output_tokens, 0)) AS output_tokens
       FROM gemini_usage_log l
       JOIN users u ON u.id = l.user_id
       WHERE ${dateCondition} ${userFilter}
       GROUP BY l.user_id, u.username, u.name, u.email, l.feature, l.model
       ORDER BY l.user_id, l.feature`,
      queryParams
    );

    const usedTodayResult = await pool.query(
      `SELECT COALESCE(SUM(estimated_tokens_used), 0) AS used,
              COALESCE(SUM(prompt_tokens_used), 0) AS used_input,
              COALESCE(SUM(output_tokens_used), 0) AS used_output
       FROM gemini_usage
       WHERE usage_date = CURRENT_DATE`
    );
    const usedToday = parseInt(usedTodayResult.rows[0].used || 0, 10);
    const usedTodayInput = parseInt(usedTodayResult.rows[0].used_input || 0, 10);
    const usedTodayOutput = parseInt(usedTodayResult.rows[0].used_output || 0, 10);

    const byUser = [];
    const userMap = new Map();
    for (const row of detailResult.rows) {
      let u = userMap.get(row.user_id);
      if (!u) {
        u = {
          userId: row.user_id,
          username: row.username,
          name: row.name,
          email: row.email,
          totalCalls: 0,
          totalTokens: 0,
          byFeature: []
        };
        userMap.set(row.user_id, u);
        byUser.push(u);
      }
      u.totalCalls += parseInt(row.call_count, 10);
      u.totalTokens += parseInt(row.total_tokens, 10) || 0;
      u.byFeature.push({
        feature: row.feature,
        model: row.model,
        callCount: parseInt(row.call_count, 10),
        totalTokens: parseInt(row.total_tokens, 10) || 0,
        inputTokens: parseInt(row.input_tokens, 10) || 0,
        outputTokens: parseInt(row.output_tokens, 10) || 0
      });
    }

    const recentLogResult = await pool.query(
      `SELECT l.id, l.user_id, u.username, u.email, l.feature, l.model, l.estimated_tokens_used, l.prompt_tokens, l.output_tokens, l.details, l.used_at
       FROM gemini_usage_log l
       JOIN users u ON u.id = l.user_id
       WHERE ${dateCondition} ${userFilter}
       ORDER BY l.used_at DESC
       LIMIT 100`,
      queryParams
    );
    const recentLog = recentLogResult.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      email: r.email,
      feature: r.feature,
      model: r.model,
      estimatedTokensUsed: parseInt(r.estimated_tokens_used, 10),
      inputTokens: r.prompt_tokens != null ? parseInt(r.prompt_tokens, 10) : null,
      outputTokens: r.output_tokens != null ? parseInt(r.output_tokens, 10) : null,
      details: r.details,
      usedAt: r.used_at
    }));

    res.json({
      dailyLimit,
      usedToday,
      usedTodayInput,
      usedTodayOutput,
      remainingToday: Math.max(dailyLimit - usedToday, 0),
      byUser,
      recentLog
    });
  } catch (error) {
    console.error('Get Gemini usage detail error:', error);
    res.status(500).json({ message: 'Error fetching Gemini usage detail' });
  }
});

module.exports = router;

