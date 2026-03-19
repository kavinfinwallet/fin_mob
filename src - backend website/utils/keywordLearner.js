/**
 * Keyword Learning — Stage 0 self-improvement.
 *
 * After Gemini categorizes a transaction it returns a `keyword` — the key
 * phrase it used to decide the category.  This module:
 *
 *   1. Validates the keyword (non-generic, actually present in the description).
 *   2. Appends it to `categories.keywords` in the DB if it is new.
 *   3. Invalidates the keyword-rule cache so the next batch picks it up immediately.
 *   4. Optionally logs every learning event (new or duplicate) to a JSONL file.
 *
 * Env flags:
 *   KEYWORD_LEARNING_LOG=true        → enable/disable all learning + logging (default: false)
 *   GEMINI_LOG_DIR=./logs            → directory for the keyword-learning.log file
 */

const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { refreshRulesCache } = require('./keywordCategorizer');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LEARNING_ENABLED =
  (process.env.KEYWORD_LEARNING_LOG || 'false').toLowerCase() === 'true';

const LOG_DIR = (process.env.GEMINI_LOG_DIR || './logs').trim();
const LOG_FILE = path.join(LOG_DIR, 'keyword-learning.log');

// ---------------------------------------------------------------------------
// Generic / noise keywords — never worth saving
// ---------------------------------------------------------------------------
const SKIP_KEYWORDS = new Set([
  'payment', 'payments', 'transfer', 'transfers', 'paid', 'pay',
  'upi', 'neft', 'imps', 'rtgs', 'nach', 'ach', 'ecs', 'mandate',
  'debit', 'credit', 'dr', 'cr', 'deposit', 'withdrawal',
  'bank', 'banking', 'account', 'acc',
  'fund', 'funds', 'amount', 'money', 'cash',
  'send', 'sent', 'received', 'receive',
  'transaction', 'txn', 'ref', 'reference',
  'balance', 'charge', 'charges', 'fee', 'fees',
  'service', 'services', 'bill', 'bills',
  'online', 'mobile', 'net', 'digital',
  'india', 'indian', 'pvt', 'ltd', 'llp', 'inc',
  'new', 'old', 'buy', 'purchase',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the keyword should NOT be learned.
 * Rules:
 *  - null / empty
 *  - shorter than 3 chars
 *  - pure number
 *  - in the SKIP list
 *  - only special characters / whitespace
 */
function shouldSkipKeyword(kw) {
  if (!kw || typeof kw !== 'string') return true;
  const clean = kw.trim().toLowerCase();
  if (clean.length < 3) return true;
  if (/^\d+$/.test(clean)) return true;
  if (/^[\W_]+$/.test(clean)) return true; // only punctuation / symbols
  if (SKIP_KEYWORDS.has(clean)) return true;
  return false;
}

/**
 * Append a JSON line to the learning log file.
 * Silently swallows write errors so learning failures never break categorization.
 */
function appendToLog(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.warn('[keyword-learning] log write failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Learn keywords extracted by Gemini and persist them to the DB.
 *
 * @param {Array<{
 *   description: string,
 *   categoryName: string,
 *   categoryId: number|null,
 *   keyword: string|null
 * }>} learnings  — one entry per Gemini-categorized transaction
 *
 * @returns {Promise<number>} number of new keywords added to DB
 */
async function learnKeywords(learnings) {
  if (!LEARNING_ENABLED) return 0;
  if (!learnings || learnings.length === 0) return 0;

  let newCount = 0;

  for (const item of learnings) {
    const { description = '', categoryName = '', categoryId, keyword } = item;

    if (!categoryId || categoryName === 'Uncategorized') continue;
    if (shouldSkipKeyword(keyword)) continue;

    const kw = keyword.trim().toLowerCase();

    // Keyword must actually appear in the description (prevents hallucinations)
    if (!description.toLowerCase().includes(kw)) continue;

    // Append to DB only if not already stored for this category
    const res = await pool.query(
      `UPDATE categories
       SET keywords    = ARRAY_APPEND(keywords, $1),
           updated_at  = CURRENT_TIMESTAMP
       WHERE id        = $2
         AND user_id   IS NULL
         AND NOT ($1   = ANY(COALESCE(keywords, '{}')))
       RETURNING id`,
      [kw, categoryId]
    );

    const isNew = res.rows.length > 0;
    if (isNew) newCount++;

    appendToLog({
      ts: new Date().toISOString(),
      category: categoryName,
      keyword: kw,
      isNew,
      description: description.slice(0, 120),
    });
  }

  if (newCount > 0) {
    console.log(`[keyword-learning] +${newCount} new keyword(s) added → refreshing cache`);
    refreshRulesCache(); // next batch will see the new keywords immediately
  }

  return newCount;
}

module.exports = { learnKeywords, shouldSkipKeyword };
