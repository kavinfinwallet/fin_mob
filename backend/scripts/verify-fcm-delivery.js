require('dotenv').config();
const { initFirebase, getMessaging } = require('../src/config/firebase');

const fcmToken = process.argv[2];

if (!fcmToken) {
    console.error('Usage: node verify-fcm-delivery.js <FCM_TOKEN>');
    process.exit(1);
}

const testOtp = '123456';

const run = async () => {
    try {
        initFirebase();
        const messaging = getMessaging();

        const message = {
            token: fcmToken,
            notification: {
                title: 'Test OTP Notification',
                body: `Your test OTP is ${testOtp}.`,
            },
            data: {
                otp: testOtp,
                purpose: 'test',
                type: 'otp_verification',
                phone_number: '9876543210',
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'otp_channel',
                    priority: 'max',
                },
            },
        };

        const response = await messaging.send(message);
        console.log('✅ Successfully sent test FCM message:', response);
        console.log('OTP sent:', testOtp);
    } catch (error) {
        console.error('❌ Error sending FCM message:', error);
    }
};

run();
