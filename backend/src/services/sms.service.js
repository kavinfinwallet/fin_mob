// services/sms.service.js

const https = require('https');

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID;

/**
 * Send OTP via MSG91 (Server-generated OTP)
 * @param {string} phoneNumber - 10 digit or with country code
 * @param {string} otp - Generated OTP from server
 * @returns {Promise<object>}
 */
const sendOTP = (phoneNumber, otp) => {
  return new Promise((resolve, reject) => {
    try {
      // Ensure phone is in 91XXXXXXXXXX format
      let formattedPhone = phoneNumber;
      if (phoneNumber.length === 10) {
        formattedPhone = `91${phoneNumber}`;
      }

      console.log(`[MSG91] Sending OTP ${otp} to ${formattedPhone}`);

      const payload = JSON.stringify({
        template_id: MSG91_TEMPLATE_ID,
        mobile: formattedPhone,
        authkey: MSG91_AUTH_KEY,
        otp: otp // 🔥 Inject your server-generated OTP
      });

      const options = {
        hostname: 'control.msg91.com',
        port: 443,
        path: '/api/v5/otp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'authkey': MSG91_AUTH_KEY
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('[MSG91] OTP sent successfully:', parsed);
              resolve({
                success: true,
                data: parsed
              });
            } else {
              console.error('[MSG91] Send Error:', parsed);
              reject({
                success: false,
                error: parsed.message || 'Failed to send OTP',
                statusCode: res.statusCode,
                raw: parsed
              });
            }
          } catch (err) {
            reject({
              success: false,
              error: 'Invalid JSON response from MSG91',
              raw: data
            });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[MSG91] Request Error:', err.message);
        reject({
          success: false,
          error: err.message
        });
      });

      req.write(payload);
      req.end();

    } catch (err) {
      reject({
        success: false,
        error: err.message
      });
    }
  });
};

/**
 * (OPTIONAL) Resend OTP using MSG91 retry API
 * @param {string} phoneNumber
 * @returns {Promise<object>}
 */
const resendOTP = (phoneNumber) => {
  return new Promise((resolve, reject) => {
    try {
      let formattedPhone = phoneNumber;
      if (phoneNumber.length === 10) {
        formattedPhone = `91${phoneNumber}`;
      }

      const options = {
        hostname: 'control.msg91.com',
        port: 443,
        path: `/api/v5/otp/retry?retrytype=text&mobile=${formattedPhone}`,
        method: 'POST',
        headers: {
          'authkey': MSG91_AUTH_KEY
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => data += chunk);

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, data: parsed });
            } else {
              reject({
                success: false,
                error: parsed.message || 'Resend OTP failed',
                statusCode: res.statusCode
              });
            }
          } catch {
            reject({ success: false, error: 'Invalid response from MSG91' });
          }
        });
      });

      req.on('error', reject);
      req.end();

    } catch (err) {
      reject({ success: false, error: err.message });
    }
  });
};

module.exports = {
  sendOTP,
  resendOTP
};