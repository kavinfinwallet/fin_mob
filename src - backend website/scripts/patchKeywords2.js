/**
 * Patch 2: add plain short-form keywords that were missing.
 * Run: node scripts/patchKeywords2.js
 */
const pool = require('../config/database');

const PATCHES = [
  // Medical: plain 'medical' and 'doctor' catch merchant names like "velavanmedical" and remarks like "DOCTOR"
  { category: 'medical', keywords: ['medical', 'doctor'] },

  // Gifts: plain 'gift' catches remarks like "UPI...116873597985-GIFT"
  { category: 'gifts & donations', keywords: ['gift'] },
];

async function patch() {
  for (const p of PATCHES) {
    for (const kw of p.keywords) {
      const res = await pool.query(
        `UPDATE categories
         SET keywords = ARRAY_APPEND(keywords, $1),
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id IS NULL
           AND LOWER(name) = $2
           AND NOT ($1 = ANY(keywords))
         RETURNING name`,
        [kw, p.category]
      );
      if (res.rows.length > 0) {
        console.log(`[+] Added "${kw}" → "${res.rows[0].name}"`);
      } else {
        console.log(`[=] "${kw}" already exists or category not found for "${p.category}"`);
      }
    }
  }
  console.log('\nPatch 2 complete.');
  await pool.end();
}

patch().catch((err) => {
  console.error('Patch failed:', err.message);
  process.exit(1);
});
