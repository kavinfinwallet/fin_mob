require('dotenv').config();
console.log('--- Env Check ---');
const pk = process.env.FIREBASE_PRIVATE_KEY;
console.log('Original PK length:', pk ? pk.length : 0);
console.log('Starts with quote?', pk?.startsWith('"'));
console.log('Ends with quote?', pk?.endsWith('"'));

if (pk) {
    const formatted = pk.replace(/"/g, '').replace(/\\n/g, '\n');
    console.log('Formatted PK length:', formatted.length);
    console.log('First 50 chars of formatted:', formatted.substring(0, 50));
    console.log('Last 50 chars of formatted:', formatted.substring(formatted.length - 50));
}

const { getMessaging } = require('../src/config/firebase');
try {
    const messaging = getMessaging();
    console.log('Messaging initialized:', !!messaging);
} catch (err) {
    console.error('Firebase Init Error:', err);
}
