const admin = require('firebase-admin');

let firebaseApp;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  const pk = process.env.FIREBASE_PRIVATE_KEY;
  const pkClean = pk ? pk.replace(/^['"]|['"]$/g, '') : pk;
  
  const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: pkClean ? pkClean.replace(/\\n/g, '\n') : undefined,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('✅ Firebase Admin SDK initialized');
  return firebaseApp;
};

const getMessaging = () => {
  if (!firebaseApp) initFirebase();
  return admin.messaging();
};

module.exports = { initFirebase, getMessaging };
