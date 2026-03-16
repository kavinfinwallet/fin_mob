const NewCustomer = require('../models/newCustomer.model');
const Customer = require('../models/customer.model');
const OTPVerification = require('../models/otpVerification.model');
const { generateOTP, hashOTP, verifyOTP, getOTPExpiry } = require('../utils/otp');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { sendOTPNotification } = require('../services/notification.service');
const { successResponse, errorResponse } = require('../utils/response');

// ─────────────────────────────────────────────
// POST /api/send-otp
// Body: { phoneNumber, fcmToken?, webPushSubscription? }
// ─────────────────────────────────────────────
const sendOTP = async (req, res) => {
  try {
    const { phoneNumber, fcmToken, webPushSubscription } = req.body;

    if (!phoneNumber) {
      return errorResponse(res, 'Phone number is required', 400);
    }

    // Determine if existing or new customer
    const existingCustomer = await Customer.findByPhone(phoneNumber);
    let customerId;
    let purpose;
    let customerType;

    if (existingCustomer) {
      // Existing customer — login flow
      if (!existingCustomer.is_active) {
        return errorResponse(res, 'Account is deactivated. Please contact support.', 403);
      }
      customerId = existingCustomer.id;
      purpose = 'login';
      customerType = 'existing';

      // Update FCM token if provided and changed
      if (fcmToken && fcmToken !== existingCustomer.fcm_token) {
        await Customer.updateFcmToken(existingCustomer.id, fcmToken);
      }
    } else {
      // New customer — signup flow
      // Find or create a new_customer entry
      let newCust = await NewCustomer.findByPhone(phoneNumber);

      if (!newCust) {
        newCust = await NewCustomer.create(phoneNumber);
      } else if (newCust.status === 'expired') {
        // Re-create if expired
        await NewCustomer.updateStatus(newCust.id, 'pending');
        newCust = await NewCustomer.findByPhone(phoneNumber);
      }

      customerId = newCust.id;
      purpose = 'signup';
      customerType = 'new customer';
    }

    // Invalidate any previous unused OTPs for this phone+purpose
    await OTPVerification.invalidatePrevious(phoneNumber, purpose);

    // Generate fresh OTP
    const otp = generateOTP();
    const hashedOTP = await hashOTP(otp);
    const expiresAt = getOTPExpiry();

    // Persist OTP record
    await OTPVerification.create({
      customerId,
      phoneNumber,
      hashedOTP,
      purpose,
      expiresAt,
    });

    // Determine FCM token / web push subscription to use
    const tokenToUse = fcmToken || (existingCustomer?.fcm_token ?? null);
    const webPushToUse = webPushSubscription || null;

    // Send push notification
    const notifResult = await sendOTPNotification({
      fcmToken: tokenToUse,
      webPushSubscription: webPushToUse,
      otp,
      purpose,
      customerId,
      customerType,
    });

    if (!notifResult.success) {
      // Notification failed — still created OTP but warn caller
      return errorResponse(
        res,
        'Failed to deliver OTP notification. Please ensure push notifications are enabled.',
        503,
        { channel: notifResult.channel, detail: notifResult.error }
      );
    }

    return successResponse(
      res,
      {
        purpose,
        customerType,
        expiresIn: parseInt(process.env.OTP_EXPIRES_IN_MINUTES || 5) * 60,
        channel: notifResult.channel,
      },
      'OTP sent successfully via push notification'
    );
  } catch (err) {
    console.error('[sendOTP]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// POST /api/verify-otp
// Body: { phoneNumber, otp }
// ─────────────────────────────────────────────
const verifyOTPHandler = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return errorResponse(res, 'Phone number and OTP are required', 400);
    }

    // Find a valid OTP (checks expiry and is_used)
    const existingCustomer = await Customer.findByPhone(phoneNumber);
    const purpose = existingCustomer ? 'login' : 'signup';

    const otpRecord = await OTPVerification.findValid(phoneNumber, purpose);

    if (!otpRecord) {
      return errorResponse(res, 'OTP has expired or does not exist. Please request a new one.', 400);
    }

    // Check max attempt limit
    if (otpRecord.attempt_count >= otpRecord.max_attempts) {
      await OTPVerification.markUsed(otpRecord.id); // block it
      return errorResponse(res, 'Maximum OTP attempts exceeded. Please request a new OTP.', 429);
    }

    // Increment attempt before checking (prevent race condition abuse)
    await OTPVerification.incrementAttempt(otpRecord.id);

    // Verify the OTP
    const isValid = await verifyOTP(otp, otpRecord.otp_code);

    if (!isValid) {
      const remaining = otpRecord.max_attempts - (otpRecord.attempt_count + 1);
      return errorResponse(
        res,
        `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : 'No more attempts.'}`,
        401
      );
    }

    // Mark OTP as used
    await OTPVerification.markUsed(otpRecord.id);

    let customer;
    let isNewCustomer = false;

    if (existingCustomer) {
      // Existing: update last login
      customer = await Customer.updateLastLogin(existingCustomer.id);
    } else {
      // New: create customer account
      const newCustRecord = await NewCustomer.findByPhone(phoneNumber);
      customer = await Customer.create({
        phoneNumber,
        fcmToken: null, // FCM token can be updated after login
      });
      // Mark new_customer as verified
      if (newCustRecord) {
        await NewCustomer.updateStatus(newCustRecord.id, 'verified');
      }
      isNewCustomer = true;
    }

    // Generate JWT token pair
    const tokens = generateTokenPair(customer.id, customer.phone_number);

    return successResponse(
      res,
      {
        isNewCustomer,
        customer: {
          id: customer.id,
          phoneNumber: customer.phone_number,
          isVerified: customer.is_verified,
          createdAt: customer.created_at,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      isNewCustomer ? 'Account created successfully' : 'Login successful'
    );
  } catch (err) {
    console.error('[verifyOTP]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// POST /api/refresh-token
// Body: { refreshToken }
// ─────────────────────────────────────────────
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return errorResponse(res, 'Refresh token is required', 400);
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return errorResponse(res, 'Invalid or expired refresh token', 401);
    }

    // Verify customer still exists and is active
    const customer = await Customer.findById(decoded.sub);
    if (!customer || !customer.is_active) {
      return errorResponse(res, 'Customer not found or account deactivated', 401);
    }

    const tokens = generateTokenPair(customer.id, customer.phone_number);

    return successResponse(res, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, 'Token refreshed');
  } catch (err) {
    console.error('[refreshToken]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// POST /api/logout
// Requires: Authorization header (access token)
// ─────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    // req.customer is set by authMiddleware
    if (req.customer) {
      const customerId = req.customer.sub;
      // Optionally: clear FCM token on logout
      await Customer.updateFcmToken(customerId, null);
    }

    return successResponse(res, {}, 'Logged out successfully');
  } catch (err) {
    console.error('[logout]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/customer-login
// Body: { firebase_id_token, fcm_token, phone }
// ─────────────────────────────────────────────
const customerLogin = async (req, res) => {
  try {
    const { fcm_token, phone } = req.body;

    // 1. Update customer FCM token if provided
    if (phone && fcm_token) {
      const customer = await Customer.findByPhone(phone);
      if (customer) {
        await Customer.updateFcmToken(customer.id, fcm_token);
      }
    }

    // 2. Notify all RMs
    const { sendNotificationToAllRMs, sendGeneralFCMNotification } = require('../services/notification.service');
    const RelationshipManager = require('../models/relationshipManager.model');
    
    const rms = await RelationshipManager.findAllActive();
    const notificationPromises = rms.map(rm => {
      if (rm.fcm_token) {
        return sendGeneralFCMNotification({
          fcmToken: rm.fcm_token,
          title: 'Customer Login Alert',
          body: `Customer with phone ${phone} has just logged in.`,
          data: {
            type: 'customer_login',
            phone: phone || 'Unknown'
          },
          customerId: rm.id
        });
      }
      return Promise.resolve(null);
    });

    await Promise.all(notificationPromises);

    return successResponse(res, {}, 'Login notification processed');
  } catch (err) {
    console.error('[customerLogin]', err);
    return errorResponse(res, 'Internal server error', 500);
  }
};

module.exports = { sendOTP, verifyOTPHandler, refreshToken, logout, customerLogin };
