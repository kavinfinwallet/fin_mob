const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Generate a random numeric OTP of given length
 */
const generateOTP = (length = parseInt(process.env.OTP_LENGTH) || 6) => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(crypto.randomInt(min, max + 1));
};

/**
 * Hash OTP using bcrypt
 */
const hashOTP = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
};

/**
 * Verify a plain OTP against a bcrypt hash
 */
const verifyOTP = async (plainOTP, hashedOTP) => {
  return bcrypt.compare(plainOTP, hashedOTP);
};

/**
 * Calculate OTP expiry timestamp
 */
const getOTPExpiry = (minutesFromNow = parseInt(process.env.OTP_EXPIRES_IN_MINUTES) || 5) => {
  return new Date(Date.now() + minutesFromNow * 60 * 1000);
};

module.exports = { generateOTP, hashOTP, verifyOTP, getOTPExpiry };
