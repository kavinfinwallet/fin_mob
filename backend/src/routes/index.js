const express = require('express');
const router = express.Router();

const { sendOTP, verifyOTPHandler, refreshToken, logout, customerLogin } = require('../controllers/auth.controller');
const {
  getProfile,
  updateFcmToken,
  getNotificationLogs,
  getNotificationLogById,
} = require('../controllers/customer.controller');

const authMiddleware = require('../middleware/auth.middleware');
const { sendOTPLimiter, verifyOTPLimiter } = require('../middleware/rateLimit.middleware');

// ── Auth ──────────────────────────────────────
router.post('/auth/customer-login', customerLogin);
router.post('/send-otp', sendOTPLimiter, sendOTP);
router.post('/verify-otp', verifyOTPLimiter, verifyOTPHandler);
router.post('/refresh-token', refreshToken);
router.post('/logout', authMiddleware, logout);

// ── Customer (protected) ──────────────────────
router.get('/customer/profile', authMiddleware, getProfile);
router.put('/customer/fcm-token', authMiddleware, updateFcmToken);

// ── Notification Logs (protected) ─────────────
router.get('/notification/logs', authMiddleware, getNotificationLogs);
router.get('/notification/logs/:id', authMiddleware, getNotificationLogById);

module.exports = router;
