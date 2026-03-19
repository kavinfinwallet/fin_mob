const express = require('express');
const router = express.Router();

const {
  sendOTPHandler,
  verifyOTPHandler,
} = require('../controllers/auth.controller');

const {
  getProfile,
  getNotificationLogs,
  getNotificationLogById,
} = require('../controllers/customer.controller');

const authMiddleware = require('../middleware/auth.middleware');
const { sendOTPLimiter, verifyOTPLimiter } = require('../middleware/rateLimit.middleware');



router.post('/send-otp', sendOTPLimiter, sendOTPHandler);
router.post('/verify-otp', verifyOTPLimiter, verifyOTPHandler);


// Customer
router.get('/customer/profile', authMiddleware, getProfile);

// Logs
router.get('/notification/logs', authMiddleware, getNotificationLogs);
router.get('/notification/logs/:id', authMiddleware, getNotificationLogById);

module.exports = router;