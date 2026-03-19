// lib/services/auth_service.dart
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AuthService {

  // ── Backend URL ────────────────────────
 static const String physicalDeviceUrl = 'http://10.140.113.222:16000/api';

  static String get baseUrl {
    if (kIsWeb) return 'http://localhost:16000/api';
    if (Platform.isAndroid) return physicalDeviceUrl;
    return 'http://localhost:16000/api';
  }

  // ── SEND OTP (SERVER) ─────────────────
  Future<Map<String, dynamic>> sendOtp(String phone) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/send-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'phoneNumber': phone}),
      );

      return jsonDecode(response.body);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
Future<void> signOut() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.remove('accessToken');
  await prefs.remove('refreshToken');
}
  // ── VERIFY OTP (SERVER) ───────────────
  Future<Map<String, dynamic>> verifyOtp(
      String phone, String otp) async {
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

      if (data['success'] == true) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('accessToken', data['data']['accessToken']);
        await prefs.setString('refreshToken', data['data']['refreshToken']);
      }

      return data;
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
}