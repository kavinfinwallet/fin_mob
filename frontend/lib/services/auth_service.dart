// lib/services/auth_service.dart
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  User? get currentUser => _auth.currentUser;

  // ── Sign out ──────────────────────────────────────────
  Future<void> signOut() async {
    await _auth.signOut();
  }

  // ── Send OTP via Firebase ─────────────────────────────
  Future<void> sendOtp({
    required String phone,
    required Function(String verificationId, int? resendToken) onCodeSent,
    required Function(String error) onError,
    required Function() onAutoVerified,
    int? forceResendingToken,
  }) async {
    await _auth.verifyPhoneNumber(
      phoneNumber: '+91$phone',
      timeout: const Duration(seconds: 60),
      forceResendingToken: forceResendingToken,
      verificationCompleted: (PhoneAuthCredential credential) async {
        await _auth.signInWithCredential(credential);
        onAutoVerified();
      },
      verificationFailed: (FirebaseAuthException e) {
        String msg = e.message ?? 'Verification failed';
        if (e.code == 'invalid-phone-number') msg = 'Invalid phone number format';
        if (e.code == 'too-many-requests') msg = 'Too many attempts. Try later.';
        onError(msg);
      },
      codeSent: (String verificationId, int? resendToken) {
        onCodeSent(verificationId, resendToken);
      },
      codeAutoRetrievalTimeout: (_) {},
    );
  }

  // ── Verify 6-digit OTP (Firebase) ─────────────────────
  Future<bool> verifyOtp({
    required String verificationId,
    required String smsCode,
  }) async {
    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationId,
        smsCode: smsCode,
      );
      await _auth.signInWithCredential(credential);
      return true;
    } catch (e) {
      print('OTP Verify Error: $e');
      return false;
    }
  }

  // ── Custom Backend OTP ────────────────────────────────
  // IMPORTANT: Replace with your actual production backend URL
  static const String baseUrl = 'http://192.168.1.15:15000/api';

  Future<Map<String, dynamic>> sendBackendOtp(String phone) async {
    try {
      final fcmToken = await FirebaseMessaging.instance.getToken();
      
      final response = await http.post(
        Uri.parse('$baseUrl/send-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phoneNumber': phone,
          'fcmToken': fcmToken,
        }),
      );

      return jsonDecode(response.body);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> verifyBackendOtp(String phone, String otp) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/verify-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phoneNumber': phone,
          'otp': otp,
        }),
      );

      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        // Save tokens
        final prefs = await SharedPreferences.getInstance();
        if (data['data']['accessToken'] != null) {
          await prefs.setString('accessToken', data['data']['accessToken']);
        }
        if (data['data']['refreshToken'] != null) {
          await prefs.setString('refreshToken', data['data']['refreshToken']);
        }
      }
      return data;
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ── Notify RM after customer login ───────────────────

  Future<void> notifyRMAfterLogin() async {
    try {
      final user = _auth.currentUser;
      if (user == null) return;

      // Get FCM token - might be null on some devices/simulators
      final fcmToken = await FirebaseMessaging.instance.getToken();
      final idToken  = await user.getIdToken();
      
      if (baseUrl.contains('your-backend.com')) {
        print('INFO: RM notification skipped (placeholder URL). Update baseUrl in auth_service.dart');
        return;
      }

      final response = await http.post(
        Uri.parse('$baseUrl/auth/customer-login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'firebase_id_token': idToken,
          'fcm_token':         fcmToken ?? '',
          'phone':             user.phoneNumber ?? '',
        }),
      );

      if (response.statusCode != 200) {
        print('RM notification failed: ${response.statusCode}');
      }
    } catch (e) {
      // Do not block login if notification fails
      print('RM notify error: $e');
    }
  }
}
