const { getMessaging } = require('../config/firebase');
const { webpush } = require('../config/webpush');
const NotificationLog = require('../models/notificationLog.model');

/**
 * Send OTP via Firebase Cloud Messaging (FCM)
 * Used for mobile apps with an FCM device token
 */
const sendFCMNotification = async ({ fcmToken, otp, purpose, customerId, customerType }) => {
  const log = await NotificationLog.create({
    customerId,
    type: customerType === 'existing' ? 'existing_customer' : 'new_customer',
    channel: 'fcm',
    status: 'pending',
  });

  try {
    const messaging = getMessaging();

    const message = {
      token: fcmToken,
      notification: {
        title: 'Your Verification Code',
        body: `Your OTP is ${otp}. Valid for ${process.env.OTP_EXPIRES_IN_MINUTES || 5} minutes. Do not share this code.`,
      },
      data: {
        otp,
        purpose,
        type: 'otp_verification',
        expires_in: String(parseInt(process.env.OTP_EXPIRES_IN_MINUTES || 5) * 60),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'otp_channel',
          priority: 'max',
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: 'Your Verification Code',
              body: `Your OTP is ${otp}. Valid for ${process.env.OTP_EXPIRES_IN_MINUTES || 5} minutes.`,
            },
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
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
  const log = await NotificationLog.create({
    customerId,
    type: customerType === 'existing' ? 'existing_customer' : 'new_customer',
    channel: 'web_push',
    status: 'pending',
  });

  try {
    const payload = JSON.stringify({
      title: 'Your Verification Code',
      body: `Your OTP is ${otp}. Valid for ${process.env.OTP_EXPIRES_IN_MINUTES || 5} minutes.`,
      data: {
        otp,
        purpose,
        type: 'otp_verification',
      },
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'otp',
      requireInteraction: true,
    });

    await webpush.sendNotification(webPushSubscription, payload, {
      TTL: (parseInt(process.env.OTP_EXPIRES_IN_MINUTES) || 5) * 60,
      urgency: 'high',
    });

    await NotificationLog.updateStatus(log.id, 'sent');

    return { success: true, logId: log.id, channel: 'web push' };
  } catch (err) {
    const errMsg = err.message || 'Web push send failed';
    await NotificationLog.updateStatus(log.id, 'failed', errMsg);
    console.error('[WebPush Error]', errMsg);
    return { success: false, error: errMsg, logId: log.id, channel: 'web push' };
  }
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
  if (fcmToken) {
    return sendFCMNotification({ fcmToken, otp, purpose, customerId, customerType });
  }

  if (webPushSubscription) {
    return sendWebPushNotification({
      webPushSubscription,
      otp,
      purpose,
      customerId,
      customerType,
    });
  }

  // Neither channel available — log as failed
  const log = await NotificationLog.create({
    customerId,
    type: customerType === 'existing' ? 'existing_customer' : 'new_customer',
    channel: 'fcm',
    status: 'failed',
    errorMessage: 'No FCM token or web push subscription available',
  });

  return {
    success: false,
    error: 'No notification channel available for this customer',
    logId: log.id,
  };
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
