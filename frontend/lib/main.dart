// lib/main.dart
import 'package:flutter/material.dart';
import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';
import 'package:flutter/foundation.dart' show kIsWeb, defaultTargetPlatform, TargetPlatform;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'screens/landing_screen.dart';
import 'screens/dashboard_screen.dart';

// Global key for ScaffoldMessenger
final GlobalKey<ScaffoldMessengerState> messengerKey = GlobalKey<ScaffoldMessengerState>();

// OTP Notification Manager
class OtpManager {
  static final OtpManager _instance = OtpManager._internal();
  factory OtpManager() => _instance;
  OtpManager._internal();

  final _otpStreamController = StreamController<String>.broadcast();
  Stream<String> get otpStream => _otpStreamController.stream;

  void notifyOtp(String otp) {
    _otpStreamController.add(otp);
  }

  void showOtpDialog(BuildContext context, String otp) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => _OtpDialog(otp: otp),
    );
  }
}

class _OtpDialog extends StatelessWidget {
  final String otp;
  const _OtpDialog({required this.otp});

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFF1B263B),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFF415A77), width: 1),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Row(
              children: [
                Icon(Icons.security_rounded, color: Color(0xFF1A73E8), size: 24),
                SizedBox(width: 12),
                Text(
                  'OTP Received',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.05),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white10),
              ),
              child: Text(
                otp,
                style: const TextStyle(
                  color: Color(0xFF1A73E8),
                  fontSize: 32,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 6,
                ),
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Color(0xFF415A77)),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Close',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final otpManager = OtpManager();

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
      // Use the VAPID key from your Firebase Console
      String? token = await FirebaseMessaging.instance.getToken(
        vapidKey: 'BFq5dU7RDVUlnGKj7FaiTyuRgTyuwo5bggjmHOrRlD2jWonsVpseWctD00KbKcHSipiw3pAt4ZK6QV6_UYeYsLw',
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

    // Create notification channel for Android
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'otp_channel', // id
      'OTP Notifications', // title
      description: 'This channel is used for OTP verification codes.', // description
      importance: Importance.max,
    );

    final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
        FlutterLocalNotificationsPlugin();

    if (defaultTargetPlatform == TargetPlatform.android) {
      await flutterLocalNotificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    }

    // Initialize the plugin
    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const InitializationSettings initializationSettings =
        InitializationSettings(android: initializationSettingsAndroid);
    await flutterLocalNotificationsPlugin.initialize(initializationSettings);

    // Set foreground notification options
    await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );
    
    // Get and print FCM token
    String? token = await FirebaseMessaging.instance.getToken();
    print('FCM Token: $token');
  }

  runApp(const WealthOSApp());
}

class WealthOSApp extends StatefulWidget {
  const WealthOSApp({super.key});

  @override
  State<WealthOSApp> createState() => _WealthOSAppState();
}

class _WealthOSAppState extends State<WealthOSApp> {
  @override
  void initState() {
    super.initState();
    _setupInteractedMessages();
    _checkInitialMessage();
  }

  Future<void> _checkInitialMessage() async {
    RemoteMessage? initialMessage =
        await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      _handleMessage(initialMessage);
    }
  }

  void _handleMessage(RemoteMessage message) {
    print('Message clicked! ${message.data}');
    // Extract OTP and notify if app was terminated
    String? otp = message.data['otp'];
    if (otp != null) {
      otpManager.notifyOtp(otp);
    }
  }

  void _setupInteractedMessages() {
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      print('Foreground message received: ${message.notification?.title}');
      
      // Extract OTP from data or body
      String? otp = message.data['otp'];
      if (otp == null && message.notification?.body != null) {
        // Fallback: try to extract 6 digits from body
        final regExp = RegExp(r'\d{6}');
        final match = regExp.firstMatch(message.notification!.body!);
        if (match != null) {
          otp = match.group(0);
        }
      }

      if (otp != null) {
        otpManager.notifyOtp(otp);
        // Show premium dialog
        final context = messengerKey.currentContext;
        if (context != null) {
          otpManager.showOtpDialog(context, otp);
        }
      }
    });

    // Handle background message clicks
    FirebaseMessaging.onMessageOpenedApp.listen(_handleMessage);
  }

  @override
  Widget build(BuildContext context) {
    // Check if user is already logged in for session persistence
    final bool isLoggedIn = FirebaseAuth.instance.currentUser != null;

    return MaterialApp(
      title: 'WealthOS',
      scaffoldMessengerKey: messengerKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF1A73E8),
      ),
      home: isLoggedIn ? const DashboardScreen() : const LandingScreen(),
    );
  }
}
