/**
 * DB-driven keyword categorizer (Stage 0).
 *
 * Keywords are stored in the `categories.keywords` (text[]) column and managed
 * via the Categories UI. This module loads them from DB at runtime with a
 * short in-memory cache so every categorization job sees fresh keywords without
 * a per-transaction DB round-trip.
 *
 * Matching strategy (in order):
 *   1. All keywords across all categories are merged into a single flat list and
 *      sorted by keyword length DESCENDING — longer / more-specific keywords are
 *      always tested before shorter ones. This prevents "amazon" (6 chars) from
 *      beating "amazon prime" (11 chars) just because Shopping loaded before
 *      Subscriptions.
 *
 *   2. Each keyword is tested against TWO forms of the description:
 *       a. Original lowercase             → catches VPA/concatenated names
 *                                            ("apollopharmacyoffline" contains "apollopharmacy")
 *       b. Delimiter-normalised lowercase → replaces  - / \ _ . @ # :  with spaces,
 *                                            so "-SPA" at end becomes " spa" and
 *                                            the keyword "spa" matches correctly.
 *
 *   3. First keyword that matches (in the sorted flat list) wins.
 */

const pool = require('../config/database');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _flatRules = null;      // [{keyword, category_id, category_name}] sorted longest-first
let _cacheLoadedAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace common bank-description delimiters with a single space and
 * collapse runs of whitespace.
 * Converts "IBKPOS.EP089846@ICICI-116601882187-SPA"
 *       →  "ibkpos ep089846 icici 116601882187 spa"
 */
function normalizeDelimiters(str) {
  return str
    .replace(/[-/\\_\.@#:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Cache loader
// ---------------------------------------------------------------------------

/**
 * Load all categories that have keywords from the DB, flatten into a
 * single keyword list sorted by keyword length descending.
 * Cached for CACHE_TTL_MS.
 */
async function loadRules() {
  const now = Date.now();
  if (_flatRules && now - _cacheLoadedAt < CACHE_TTL_MS) {
    return _flatRules;
  }

  const result = await pool.query(
    `SELECT id, name, keywords
     FROM categories
     WHERE user_id IS NULL
       AND keywords IS NOT NULL
       AND array_length(keywords, 1) > 0
     ORDER BY id`
  );

  const flat = [];
  for (const row of result.rows) {
    if (!Array.isArray(row.keywords)) continue;
    for (const kw of row.keywords) {
      const cleaned = (kw || '').toLowerCase().trim();
      if (!cleaned) continue;
      flat.push({
        keyword: cleaned,
        category_id: row.id,
        category_name: row.name,
      });
    }
  }

  // Longer keywords first → more specific match wins over generic one
  flat.sort((a, b) => b.keyword.length - a.keyword.length);

  _flatRules = flat;
  _cacheLoadedAt = now;
  return _flatRules;
}

/** Force the next call to loadRules() to re-query the DB. */
function refreshRulesCache() {
  _flatRules = null;
  _cacheLoadedAt = 0;
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

/**
 * Match a raw description against a preloaded flat keyword list (synchronous).
 * Call loadRules() once per batch and pass the result here for efficiency.
 *
 * @param {string} description - Raw bank statement narration
 * @param {Array<{ keyword, category_id, category_name }>} flatRules
 * @returns {{ category_name: string, category_id: number } | null}
 */
function matchDescriptionWithRules(description, flatRules) {
  if (!description || !flatRules || flatRules.length === 0) return null;

  const lower = description.toLowerCase();
  const normalized = normalizeDelimiters(lower); // delimiters → spaces

  for (const rule of flatRules) {
    if (lower.includes(rule.keyword) || normalized.includes(rule.keyword)) {
      return { category_name: rule.category_name, category_id: rule.category_id };
    }
  }
  return null;
}

/**
 * Convenience wrapper — loads rules from DB then matches.
 * Use matchDescriptionWithRules() directly when processing many transactions.
 *
 * @param {string} description
 * @returns {Promise<{ category_name: string, category_id: number } | null>}
 */
async function matchByKeyword(description) {
  const rules = await loadRules();
  return matchDescriptionWithRules(description, rules);
}

module.exports = {
  loadRules,
  matchDescriptionWithRules,
  matchByKeyword,
  refreshRulesCache,
};
