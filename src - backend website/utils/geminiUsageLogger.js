const pool = require('../config/database');

/**
 * Log a single Gemini API use to the database (who, for what, how much).
 * Writes to gemini_usage_log (detailed) and updates gemini_usage (daily aggregate).
 *
 * @param {Object} options
 * @param {number} options.userId - User who triggered the use (required)
 * @param {string} options.feature - What it was used for, e.g. 'categorization', 'transformation'
 * @param {number} options.estimatedTokens - Total tokens used for this call
 * @param {number} [options.promptTokens] - Input/prompt tokens (from API when available)
 * @param {number} [options.outputTokens] - Output/candidates tokens (from API when available)
 * @param {string} [options.model] - Model name used (e.g. gemini-1.5-flash)
 * @param {string} [options.details] - Optional JSON or text (e.g. batch_size, transaction_count)
 */
async function logGeminiUsage({ userId, feature, estimatedTokens, promptTokens, outputTokens, model, details }) {
  if (userId == null || feature == null || estimatedTokens == null) {
    console.warn('logGeminiUsage: userId, feature, and estimatedTokens are required');
    return;
  }
  const modelName = model || process.env.GEMINI_MODEL || 'gemini-default';
  const promptVal = promptTokens != null ? promptTokens : null;
  const outputVal = outputTokens != null ? outputTokens : null;
  try {
    await pool.query(
      `INSERT INTO gemini_usage_log (user_id, feature, model, estimated_tokens_used, prompt_tokens, output_tokens, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, feature, modelName, estimatedTokens, promptVal, outputVal, details || null]
    );
  } catch (e) {
    console.warn('Failed to insert gemini_usage_log:', e.message);
  }
  try {
    await pool.query(
      `INSERT INTO gemini_usage (user_id, usage_date, estimated_tokens_used, prompt_tokens_used, output_tokens_used, model)
       VALUES ($1, CURRENT_DATE, $2, COALESCE($3, 0), COALESCE($4, 0), $5)
       ON CONFLICT (user_id, usage_date) DO UPDATE
       SET estimated_tokens_used = gemini_usage.estimated_tokens_used + EXCLUDED.estimated_tokens_used,
           prompt_tokens_used = gemini_usage.prompt_tokens_used + COALESCE(EXCLUDED.prompt_tokens_used, 0),
           output_tokens_used = gemini_usage.output_tokens_used + COALESCE(EXCLUDED.output_tokens_used, 0),
           updated_at = CURRENT_TIMESTAMP`,
      [userId, estimatedTokens, promptVal, outputVal, modelName]
    );
  } catch (e) {
    console.warn('Failed to update gemini_usage:', e.message);
  }
}

module.exports = {
  logGeminiUsage
};
