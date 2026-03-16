importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBgQO5QAU_M0I0PO4OXBC_cjCx2E6MHw3w",
  authDomain: "otp-login-0.firebaseapp.com",
  projectId: "otp-login-0",
  storageBucket: "otp-login-0.firebasestorage.app",
  messagingSenderId: "383429725561",
  appId: "1:383429725561:web:b5fdbc6230503e82dc73a8",
  measurementId: "G-9NPXFSRGEE"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
