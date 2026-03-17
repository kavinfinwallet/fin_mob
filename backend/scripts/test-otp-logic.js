require('dotenv').config();
const { pool } = require('../src/config/db');
const { initFirebase } = require('../src/config/firebase');
const { initWebPush } = require('../src/config/webpush');
const Customer = require('../src/models/customer.model');
const NewCustomer = require('../src/models/newCustomer.model');
const OTPVerification = require('../src/models/otpVerification.model');
const { generateOTP, hashOTP, getOTPExpiry } = require('../src/utils/otp');
const { sendOTPNotification } = require('../src/services/notification.service');

const test = async () => {
    try {
        console.log('Testing sendOTP logic...');
        const phoneNumber = '9876543210';
        
        // Init services
        initFirebase();
        initWebPush();
        
        // Find customer
        const existingCustomer = await Customer.findByPhone(phoneNumber);
        let customerId;
        let purpose;
        let customerType;

        if (existingCustomer) {
            customerId = existingCustomer.id;
            purpose = 'login';
            customerType = 'existing';
        } else {
            let newCust = await NewCustomer.findByPhone(phoneNumber);
            if (!newCust) {
                newCust = await NewCustomer.create(phoneNumber);
            }
            customerId = newCust.id;
            purpose = 'signup';
            customerType = 'new customer';
        }

        console.log('Customer found/created:', { customerId, purpose, customerType });

        // Invalidate previous
        await OTPVerification.invalidatePrevious(phoneNumber, purpose);
        console.log('Invalidated previous OTPs');

        // Generate OTP
        const otp = generateOTP();
        const hashedOTP = await hashOTP(otp);
        const expiresAt = getOTPExpiry();
        console.log('Generated OTP:', otp);

        // Create OTP
        await OTPVerification.create({
            customerId,
            phoneNumber,
            hashedOTP,
            purpose,
            expiresAt,
        });
        console.log('Created OTP record');

        // Send Notification
        const notifResult = await sendOTPNotification({
            fcmToken: null,
            webPushSubscription: null,
            otp,
            purpose,
            customerId,
            customerType,
        });
        console.log('Notification result:', notifResult);

    } catch (err) {
        console.error('ERROR DETECTED:', err);
    } finally {
        await pool.end();
    }
};

test();
