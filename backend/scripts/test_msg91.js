require('dotenv').config();
const https = require('https');

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID;

console.log('MSG91_AUTH_KEY:', MSG91_AUTH_KEY ? 'Present' : 'Missing');
console.log('MSG91_TEMPLATE_ID:', MSG91_TEMPLATE_ID ? 'Present' : 'Missing');

const sendOTP = (phoneNumber, otp) => {
  return new Promise((resolve, reject) => {
    let formattedPhone = phoneNumber;
    if (phoneNumber.length === 10) {
      formattedPhone = `91${phoneNumber}`;
    }

    console.log(`[MSG91 TEST] Sending OTP ${otp} to ${formattedPhone}`);

    const payload = JSON.stringify({
      template_id: MSG91_TEMPLATE_ID,
      mobile: formattedPhone,
      authkey: MSG91_AUTH_KEY,
      otp: otp
    });

    const options = {
      hostname: 'control.msg91.com',
      port: 443,
      path: '/api/v5/otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'authkey': MSG91_AUTH_KEY // Adding this as it's often required in headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      console.log('Status Code:', res.statusCode);
      
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Response:', data);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Request Error:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

// Use a placeholder number or let the user know I'm testing
const testPhone = '8608226955'; // I'll use a dummy one or one from logs if I see one
const testOTP = '123456';

sendOTP(testPhone, testOTP)
  .then(res => console.log('Test Done'))
  .catch(err => console.error('Test Failed'));
