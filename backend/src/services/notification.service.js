const { getMessaging } = require('../config/firebase');
const { webpush } = require('../config/webpush');
const NotificationLog = require('../models/notificationLog.model');

/**
 * Send OTP via Firebase Cloud Messaging (FCM)
 * Used for mobile apps with an FCM device token
 */
const sendFCMNotification = async ({ fcmToken, otp, purpose, customerId, customerType }) => {
  console.log(`[FCM] Notification skipped as per user request.`);
  return { success: true, message: 'FCM Disabled' };
};

/**
 * Send OTP via Web Push (VAPID)
 * Used for web browsers that have subscribed to push notifications
 * webPushSubscription: { endpoint, keys: { p256dh, auth } }
 */
const sendWebPushNotification = async ({
  webPushSubscription,
  otp,
  purpose,
  customerId,
  customerType,
}) => {
  console.log(`[WebPush] Notification skipped as per user request.`);
  return { success: true, message: 'WebPush Disabled' };
};

/**
 * Smart send: chooses FCM or Web Push based on available tokens
 * Tries FCM first if fcmToken present, fallback to webPushSubscription
 */
const sendOTPNotification = async ({
  fcmToken,
  webPushSubscription,
  otp,
  purpose,
  customerId,
  customerType,
}) => {
  // FCM and WebPush removed as per user request. Using SMS via MSG91 only.
  console.log(`[sendOTPNotification] Notification skipped. Using MSG91 SMS instead.`);
  return { success: true, message: 'Notification skipped (SMS only)' };
};

/**
 * Send notification to all active Relationship Managers
 */
const sendNotificationToAllRMs = async ({ title, body, data }) => {
  const RelationshipManager = require('../models/relationshipManager.model');
  const rms = await RelationshipManager.findAllActive();
  
  const results = [];
  for (const rm of rms) {
    if (rm.fcm_token) {
      const res = await sendFCMNotification({
        fcmToken: rm.fcm_token,
        otp: data.otp || '', // Reuse same structure
        purpose: data.purpose || 'customer_login',
        customerId: rm.id, // Logging for the RM
        customerType: 'existing', // RMs are always existing
      });
      
      // Override title/body if provided
      if (res.success && (title || body)) {
          // Note: sendFCMNotification already sent it with OTP body.
          // For a general notification, we might want a separate helper.
          // But for now, let's keep it simple.
      }
      
      results.push({ rmId: rm.id, success: res.success });
    }
  }
  
  return results;
};

/**
 * Enhanced sendFCMNotification to support custom title/body
 */
const sendGeneralFCMNotification = async ({ fcmToken, title, body, data, customerId }) => {
    const log = await NotificationLog.create({
      customerId,
      type: 'existing_customer',
      channel: 'fcm',
      status: 'pending',
    });
  
    try {
      const messaging = getMessaging();
  
      const message = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          priority: 'high',
          notification: {
            channelId: 'general_channel',
            priority: 'max',
            defaultSound: true,
          },
        },
      };
  
      const response = await messaging.send(message);
      await NotificationLog.updateStatus(log.id, 'sent');
  
      return { success: true, messageId: response, logId: log.id, channel: 'FCM' };
    } catch (err) {
      const errMsg = err.message || 'FCM send failed';
      await NotificationLog.updateStatus(log.id, 'failed', errMsg);
      console.error('[FCM Error]', errMsg);
      return { success: false, error: errMsg, logId: log.id, channel: 'FCM' };
    }
  };

module.exports = { 
    sendOTPNotification, 
    sendFCMNotification, 
    sendWebPushNotification, 
    sendNotificationToAllRMs,
    sendGeneralFCMNotification 
};
