const Customer = require('../models/customer.model');
const NotificationLog = require('../models/notificationLog.model');
const { successResponse, errorResponse } = require('../utils/response');

// ─────────────────────────────────────────────
// GET /api/customer/profile
// ─────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const customerId = req.customer.sub;
    const profile = await Customer.getProfile(customerId);

    if (!profile) {
      return errorResponse(res, 'Customer not found', 404);
    }

    return successResponse(res, { customer: profile }, 'Profile fetched');
  } catch (err) {
    console.error('[getProfile]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// PUT /api/customer/fcm-token
// Body: { fcmToken }
// ─────────────────────────────────────────────
const updateFcmToken = async (req, res) => {
  try {
    const customerId = req.customer.sub;
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return errorResponse(res, 'fcmToken is required', 400);
    }

    const updated = await Customer.updateFcmToken(customerId, fcmToken);

    return successResponse(res, { fcmToken: updated.fcm_token }, 'FCM token updated');
  } catch (err) {
    console.error('[updateFcmToken]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// GET /api/notification/logs
// Query: ?page=1&limit=20
// ─────────────────────────────────────────────
const getNotificationLogs = async (req, res) => {
  try {
    const customerId = req.customer.sub;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      NotificationLog.findByCustomer(customerId, limit, offset),
      NotificationLog.countByCustomer(customerId),
    ]);

    return successResponse(
      res,
      {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      'Notification logs fetched'
    );
  } catch (err) {
    console.error('[getNotificationLogs]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// GET /api/notification/logs/:id
// ─────────────────────────────────────────────
const getNotificationLogById = async (req, res) => {
  try {
    const customerId = req.customer.sub;
    const { id } = req.params;

    const log = await NotificationLog.findById(id);

    if (!log) {
      return errorResponse(res, 'Notification log not found', 404);
    }

    // Ensure customer can only view their own logs
    if (log.customer_id !== customerId) {
      return errorResponse(res, 'Forbidden', 403);
    }

    return successResponse(res, { log }, 'Notification log fetched');
  } catch (err) {
    console.error('[getNotificationLogById]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

module.exports = { getProfile, updateFcmToken, getNotificationLogs, getNotificationLogById };
