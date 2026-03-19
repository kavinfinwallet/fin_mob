const pool = require('../config/database');
const { loadRules, matchDescriptionWithRules } = require('./keywordCategorizer');

// Common bank/statement prefixes to strip for matching (order matters for longer first)
const PREFIX_PATTERNS = [
  /^upi\s*\/?\s*/i,
  /^neft\s*\/?\s*/i,
  /^imps\s*\/?\s*/i,
  /^rtgs\s*\/?\s*/i,
  /^ft\s*\/?\s*/i,
  /^ref\s*\/?\s*/i,
  /^payout\s*\/?\s*/i,
  /^transfer\s*\/?\s*/i,
  /^ach\s*\/?\s*/i,
  /^mobile\s*\/?\s*/i,
  /^net\s+banking\s*\/?\s*/i,
  /^branch\s*\/?\s*/i,
  /^pos\s*\/?\s*/i,
  /^atm\s*\/?\s*/i,
  /^chq\s*\/?\s*/i,
  /^cheque\s*\/?\s*/i,
  /^dd\s*\/?\s*/i,
  /^ecs\s*\/?\s*/i,
  /^mandate\s*\/?\s*/i,
];

/**
 * Normalize a bank statement description for matching.
 * - Lowercase, collapse whitespace, remove common prefixes (UPI/, NEFT/, etc.)
 * @param {string} description
 * @returns {string}
 */
function normalizeDescription(description) {
  if (description == null || typeof description !== 'string') return '';
  let s = description.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const re of PREFIX_PATTERNS) {
    s = s.replace(re, '');
  }
  return s.trim();
}

/**
 * Extract significant tokens (words, skip pure numbers) for overlap matching.
 * @param {string} normalizedDesc
 * @returns {string[]}
 */
function tokenize(normalizedDesc) {
  if (!normalizedDesc) return [];
  return normalizedDesc
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

/**
 * Jaccard-like token overlap: count of common tokens / max token count.
 * Returns value in [0, 1]. Prefer when most tokens of the existing description
 * appear in the new one (so "AMAZON PAY" matches "UPI/AMAZON PAY INDIA").
 * @param {string[]} tokensNew
 * * @param {string[]} tokensExisting
 */
function tokenOverlapScore(tokensNew, tokensExisting) {
  if (!tokensExisting.length) return 0;
  const setNew = new Set(tokensNew);
  const match = tokensExisting.filter((t) => setNew.has(t)).length;
  return match / Math.max(tokensExisting.length, tokensNew.length);
}

/**
 * Fetch distinct (normalized description -> category_id, category_name) for the user
 * from transactions that already have a category (any upload, any status).
 * @param {number} userId
 * @returns {Promise<Array<{ normalized: string, category_name: string, category_id: number | null }>>}
 */
async function getExistingDescriptionCategories(userId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (LOWER(TRIM(description)))
         description,
         category_id,
         category_name
     FROM transactions
     WHERE user_id = $1
       AND description IS NOT NULL
       AND TRIM(description) <> ''
       AND category_name IS NOT NULL
       AND TRIM(COALESCE(category_name, '')) <> ''
       AND LOWER(TRIM(COALESCE(category_name, ''))) <> 'uncategorized'
     ORDER BY LOWER(TRIM(description)), id DESC`,
    [userId]
  );

  return result.rows.map((r) => ({
    normalized: normalizeDescription(r.description),
    category_name: (r.category_name || '').trim(),
    category_id: r.category_id,
  })).filter((r) => r.normalized.length > 0);
}

/**
 * Find best matching category for a new description from existing DB entries.
 * 1) Exact match on normalized description.
 * 2) Best token-overlap match (require at least 2 overlapping tokens or high overlap).
 * @param {string} newDescription - Raw bank statement description
 * @param {Array<{ normalized: string, category_name: string, category_id: number | null }>} existingList - From getExistingDescriptionCategories
 * @returns {{ category_name: string, category_id: number | null } | null}
 */
function matchDescriptionToCategory(newDescription, existingList) {
  if (!existingList || existingList.length === 0) return null;
  const normalized = normalizeDescription(newDescription);
  if (!normalized) return null;

  // 1) Exact match
  const exact = existingList.find((e) => e.normalized === normalized);
  if (exact) {
    return { category_name: exact.category_name, category_id: exact.category_id };
  }

  // 2) Token overlap: pick existing entry with best overlap
  const tokensNew = tokenize(normalized);
  if (tokensNew.length === 0) return null;

  let best = null;
  let bestScore = 0;
  const MIN_OVERLAP_TOKENS = 1; // allow single token (e.g. "SWIGGY" matches "UPI/SWIGGY")
  const MIN_SCORE = 0.35;

  for (const e of existingList) {
    const tokensExisting = tokenize(e.normalized);
    if (tokensExisting.length === 0) continue;
    const overlapCount = tokensExisting.filter((t) => tokensNew.includes(t)).length;
    if (overlapCount < MIN_OVERLAP_TOKENS) continue;
    const score = tokenOverlapScore(tokensNew, tokensExisting);
    if (score >= MIN_SCORE && score > bestScore) {
      bestScore = score;
      best = e;
    }
  }

  if (best) {
    return { category_name: best.category_name, category_id: best.category_id };
  }
  return null;
}

/**
 * For a list of transactions, assign categories from existing DB descriptions where possible.
 * Credits are not categorized (return Uncategorized). Debits are matched via description.
 * @param {Array<{ description: string, type?: string, [key: string]: any }>} transactions
 * @param {number} userId
 * @returns {Promise<{ categorized: Array<{ ...txn, category_name: string, category_id: number | null }>, needGemini: Array<{ ...txn, category_name?: string, category_id?: number | null }>, needGeminiIndices: number[] }>}
 *   - categorized: same length as transactions; each has category_name/category_id (or Uncategorized for credits / no match).
 *   - needGemini: only debit transactions that had no DB match (to send to Gemini).
 *   - needGeminiIndices: indices in original array for each needGemini item (so we can merge Gemini results back).
 */
async function assignCategoriesFromExisting(transactions, userId) {
  // Preload both sources once — keyword rules from DB and user's past categorizations
  const [keywordRules, existingList] = await Promise.all([
    loadRules(),
    getExistingDescriptionCategories(userId),
  ]);

  const categorized = [];
  const needGemini = [];
  const needGeminiIndices = [];

  // Treat as credit: skip categorization (leave Uncategorized). Be liberal so we don't send credits to Gemini.
  const CREDIT_TYPES = ['credit', 'cr', 'deposit', 'incoming', 'refund', 'interest'];

  for (let i = 0; i < transactions.length; i++) {
    const txn = transactions[i];
    const type = (txn.type || '').toString().trim().toLowerCase();
    const isCredit = CREDIT_TYPES.some((t) => type === t || type.includes(t));

    if (isCredit) {
      categorized.push({ ...txn, category_name: 'Uncategorized', category_id: null });
      continue;
    }

    // Stage 0: keyword match against DB-stored keywords (fast, synchronous after preload)
    const kwMatch = matchDescriptionWithRules(txn.description || '', keywordRules);
    if (kwMatch) {
      categorized.push({ ...txn, category_name: kwMatch.category_name, category_id: kwMatch.category_id });
      continue;
    }

    // Stage 1: fuzzy match against user's previously categorized descriptions
    const match = matchDescriptionToCategory(txn.description || '', existingList);
    if (match) {
      categorized.push({ ...txn, category_name: match.category_name, category_id: match.category_id });
    } else {
      categorized.push(null); // placeholder: will be filled by Gemini
      needGemini.push(txn);
      needGeminiIndices.push(i);
    }
  }

  return { categorized, needGemini, needGeminiIndices };
}

module.exports = {
  normalizeDescription,
  getExistingDescriptionCategories,
  matchDescriptionToCategory,
  assignCategoriesFromExisting,
};
