const db = require('../config/db');

const OTPVerification = {
  /**
   * Create a new OTP record
   */
  create: async ({ customerId, phoneNumber, hashedOTP, purpose, expiresAt }) => {
    const result = await db.query(
      `INSERT INTO otp_verifications
         (customer_id, phone_number, otp_code, purpose, is_used, attempt_count, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, false, 0, $5, $6)
       RETURNING *`,
      [
        customerId,
        phoneNumber,
        hashedOTP,
        purpose,
        parseInt(process.env.OTP_MAX_ATTEMPTS) || 3,
        expiresAt,
      ]
    );
    return result.rows[0];
  },

  /**
   * Find a valid (unexpired, unused) OTP for a phone + purpose
   */
  findValid: async (phoneNumber, purpose) => {
    const result = await db.query(
      `SELECT * FROM otp_verifications
       WHERE phone_number = $1
         AND purpose = $2
         AND is_used = false
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phoneNumber, purpose]
    );
    return result.rows[0] || null;
  },

  /**
   * Increment attempt count
   */
  incrementAttempt: async (id) => {
    const result = await db.query(
      'UPDATE otp_verifications SET attempt_count = attempt_count + 1 WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  },

  /**
   * Mark OTP as used (verified)
   */
  markUsed: async (id) => {
    const result = await db.query(
      `UPDATE otp_verifications
       SET is_used = true, verified_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  },

  /**
   * Invalidate all previous OTPs for a phone+purpose (before issuing new one)
   */
  invalidatePrevious: async (phoneNumber, purpose) => {
    await db.query(
      `UPDATE otp_verifications
       SET is_used = true
       WHERE phone_number = $1 AND purpose = $2 AND is_used = false`,
      [phoneNumber, purpose]
    );
  },
};

module.exports = OTPVerification;
