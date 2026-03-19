// lib/screens/login_screen.dart
import 'package:flutter/material.dart';
import 'package:pinput/pinput.dart';
import '../services/auth_service.dart';
import 'dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  int _step = 1;
  bool _loading = false;
  bool _otpError = false;
  int _resendSecs = 30;

  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  final _authService = AuthService();

  // ── SEND OTP ─────────────────────────
  Future<void> _sendOtp() async {
    final phone = _phoneCtrl.text.trim();

    if (phone.length != 10) {
      _show('Enter valid number');
      return;
    }

    setState(() => _loading = true);

    final res = await _authService.sendOtp(phone);

    setState(() => _loading = false);

    if (res['success'] == true) {
      setState(() {
        _step = 2;
        _resendSecs = 30;
      });
      _startTimer();
      _show('OTP sent successfully');
    } else {
      _show(res['message']);
    }
  }

  // ── VERIFY OTP ───────────────────────
  Future<void> _verifyOtp() async {
    final phone = _phoneCtrl.text.trim();
    final otp = _otpCtrl.text.trim();

    if (otp.length != 6) {
      setState(() => _otpError = true);
      return;
    }

    setState(() {
      _loading = true;
      _otpError = false;
    });

    final res = await _authService.verifyOtp(phone, otp);

    setState(() => _loading = false);

    if (res['success'] == true) {
      _goToDashboard();
    } else {
      setState(() => _otpError = true);
      _show(res['message']);
    }
  }

  void _goToDashboard() {
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => const DashboardScreen()),
    );
  }

  void _startTimer() {
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return false;
      setState(() => _resendSecs--);
      return _resendSecs > 0;
    });
  }

  void _show(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _step == 1 ? _phoneUI() : _otpUI(),
    );
  }

  Widget _phoneUI() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        TextField(controller: _phoneCtrl),
        ElevatedButton(
          onPressed: _loading ? null : _sendOtp,
          child: const Text('Send OTP'),
        ),
      ],
    );
  }

  Widget _otpUI() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Pinput(length: 6, controller: _otpCtrl),
        ElevatedButton(
          onPressed: _loading ? null : _verifyOtp,
          child: const Text('Verify'),
        ),
      ],
    );
  }
}