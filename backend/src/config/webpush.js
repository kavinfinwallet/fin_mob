const webpush = require('web-push');

const initWebPush = () => {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('✅ Web Push (VAPID) initialized');
};

module.exports = { webpush, initWebPush };
