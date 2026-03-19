const crypto = require('crypto');
const db = require('../config/db');
const smsService = require('../services/sms.service');
const jwt = require('jsonwebtoken');
const Customer = require('../models/customer.model');
const OTPVerification = require('../models/otpVerification.model');

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// SEND OTP
const sendOTPHandler = async (req, res) => {
  try {
    let { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Normalize: remove all non-digits
    phoneNumber = phoneNumber.replace(/\D/g, '');

    // If it starts with 91 and has 12 digits, take last 10
    if (phoneNumber.startsWith('91') && phoneNumber.length === 12) {
      phoneNumber = phoneNumber.slice(2);
    }

    if (phoneNumber.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number. Please enter a 10-digit number.'
      });
    }

    // 1. Find or Create Customer
    let customer = await Customer.findByPhone(phoneNumber);
    if (!customer) {
      customer = await Customer.create({ phoneNumber });
    }

    // 2. Generate OTP
    const otp = generateOTP();
    const hashedOTP = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');

    const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRES_IN_MINUTES) || 5) * 60 * 1000);

    // 3. Invalidate previous and Save new OTP
    await OTPVerification.invalidatePrevious(phoneNumber, 'login');
    await OTPVerification.create({
      customerId: customer.id,
      phoneNumber,
      hashedOTP,
      purpose: 'login',
      expiresAt
    });

    // 4. Send via MSG91
    await smsService.sendOTP(phoneNumber, otp);

    console.log(`[OTP] ${phoneNumber} → ${otp}`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (error) {
    console.error('Send OTP Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// VERIFY OTP
const verifyOTPHandler = async (req, res) => {
  try {
    let { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone and OTP required'
      });
    }

    // Normalize phone
    phoneNumber = phoneNumber.replace(/\D/g, '');
    if (phoneNumber.startsWith('91') && phoneNumber.length === 12) {
      phoneNumber = phoneNumber.slice(2);
    }

    // 1. Find valid OTP
    const otpRecord = await OTPVerification.findValid(phoneNumber, 'login');

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // 2. Verify Hash
    const hashedInput = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');

    // Column name is otp_code in DB based on models/otpVerification.model.js
    if (hashedInput !== otpRecord.otp_code) { 
      await OTPVerification.incrementAttempt(otpRecord.id);
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // 3. Mark as used
    await OTPVerification.markUsed(otpRecord.id);

    // 4. Get Customer
    const customer = await Customer.findByPhone(phoneNumber);
    if (customer) {
      await Customer.updateLastLogin(customer.id);
    }

    // 5. Generate Tokens
    const accessToken = jwt.sign(
      { userId: customer.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    const refreshToken = jwt.sign(
      { userId: customer.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: customer.id,
          phone_number: customer.phone_number
        }
      }
    });

  } catch (error) {
    console.error('Verify OTP Error:', error);

    return res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  sendOTPHandler,
  verifyOTPHandler
};