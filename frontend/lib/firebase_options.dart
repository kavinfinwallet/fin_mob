// lib/firebase_options.dart
// Your Firebase project: otp-login-0

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError('Not supported');
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey:            'AIzaSyBgQO5QAU_M0I0PO4OXBC_cjCx2E6MHw3w',
    appId:             '1:383429725561:web:b5fdbc6230503e82dc73a8',
    messagingSenderId: '383429725561',
    projectId:         'otp-login-0',
    authDomain:        'otp-login-0.firebaseapp.com',
    storageBucket:     'otp-login-0.firebasestorage.app',
    measurementId:     'G-9NPXFSRGEE',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey:            'AIzaSyBgQO5QAU_M0I0PO4OXBC_cjCx2E6MHw3w',
    appId:             '1:383429725561:android:b5fdbc6230503e82dc73a8',
    messagingSenderId: '383429725561',
    projectId:         'otp-login-0',
    storageBucket:     'otp-login-0.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey:            'AIzaSyBgQO5QAU_M0I0PO4OXBC_cjCx2E6MHw3w',
    appId:             '1:383429725561:ios:b5fdbc6230503e82dc73a8',
    messagingSenderId: '383429725561',
    projectId:         'otp-login-0',
    storageBucket:     'otp-login-0.firebasestorage.app',
    iosBundleId:       'com.example.finwallet',
  );
}
