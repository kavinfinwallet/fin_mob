// lib/main.dart
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:firebase_auth/firebase_auth.dart';
import 'screens/landing_screen.dart';
import 'screens/dashboard_screen.dart';

// FCM background handler
@pragma('vm:entry-point')
Future<void> _fcmBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform);
  print('FCM background: ${message.notification?.title}');
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  FirebaseMessaging.onBackgroundMessage(_fcmBackgroundHandler);

  if (kIsWeb) {
    try {
      // Web specific initialization
      // Note: Use a real VAPID key from Firebase Console > Project Settings > Cloud Messaging > Web configuration
      String? token = await FirebaseMessaging.instance.getToken(
        vapidKey: null, // Let it use default or user can provide
      );
      print('FCM Token (Web): $token');
    } catch (e) {
      print('Error getting FCM token: $e');
    }
  } else {
    await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
  }

  runApp(const FinWalletApp());
}

class FinWalletApp extends StatefulWidget {
  const FinWalletApp({super.key});

  @override
  State<FinWalletApp> createState() => _FinWalletAppState();
}

class _FinWalletAppState extends State<FinWalletApp> {
  @override
  void initState() {
    super.initState();
    _setupInteractedMessages();
  }

  void _setupInteractedMessages() {
    // Listen for foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      print('Foreground message received: ${message.notification?.title}');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Notification: ${message.notification?.title ?? "New Message"}'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    });

    // Handle background message clicks
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      print('Message clicked! ${message.data}');
    });
  }

  @override
  Widget build(BuildContext context) {
    // Check if user is already logged in for session persistence
    final bool isLoggedIn = FirebaseAuth.instance.currentUser != null;

    return MaterialApp(
      title: 'FinWallet',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF1A73E8),
      ),
      home: isLoggedIn ? const DashboardScreen() : const LandingScreen(),
    );
  }
}
