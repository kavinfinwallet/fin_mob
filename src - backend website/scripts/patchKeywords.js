/**
 * One-time patch: fix bad seed keywords and add missing VPA-style entries.
 * Run: node scripts/patchKeywords.js
 */
const pool = require('../config/database');

async function patch() {
  // --- Spa: remove leading-delimiter tricks, add plain 'spa' ---
  await pool.query(
    `UPDATE categories
     SET keywords = ARRAY_REMOVE(ARRAY_REMOVE(keywords, ' spa'), '/spa'),
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id IS NULL AND LOWER(name) = 'spa'`
  );
  await pool.query(
    `UPDATE categories
     SET keywords = ARRAY_APPEND(keywords, 'spa'),
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id IS NULL AND LOWER(name) = 'spa'
       AND NOT ('spa' = ANY(keywords))`
  );
  console.log('[+] Spa keywords fixed');

  // --- Medical: add VPA no-space variants ---
  const medKws = ['apollopharmacy', 'apollohospital', 'apollodiagnostics', 'medpluspharmacy'];
  for (const kw of medKws) {
    await pool.query(
      `UPDATE categories
       SET keywords = ARRAY_APPEND(keywords, $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id IS NULL AND LOWER(name) = 'medical'
         AND NOT ($1 = ANY(keywords))`,
      [kw]
    );
  }
  console.log('[+] Medical VPA keywords added');

  // --- Shares: add Jupiter investment app VPA ---
  const shareKws = ['jupiterfppi', 'jupiter investment'];
  for (const kw of shareKws) {
    await pool.query(
      `UPDATE categories
       SET keywords = ARRAY_APPEND(keywords, $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id IS NULL AND LOWER(name) = 'shares'
         AND NOT ($1 = ANY(keywords))`,
      [kw]
    );
  }
  console.log('[+] Shares Jupiter keywords added');

  // --- Travel: add common airline VPA handles ---
  const travelKws = ['airindiaupi', 'indigopayment', 'spicejettravels', 'vistaratravels'];
  for (const kw of travelKws) {
    await pool.query(
      `UPDATE categories
       SET keywords = ARRAY_APPEND(keywords, $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id IS NULL AND LOWER(name) = 'travel'
         AND NOT ($1 = ANY(keywords))`,
      [kw]
    );
  }
  console.log('[+] Travel airline VPA keywords added');

  console.log('\nPatch complete.');
  await pool.end();
}

patch().catch((err) => {
  console.error('Patch failed:', err.message);
  process.exit(1);
});
