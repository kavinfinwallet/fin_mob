// lib/screens/login_screen.dart
// Phone number input → 6-digit OTP verify via Firebase
// After OTP success → notifies RM via backend push notification

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pinput/pinput.dart';
import '../services/auth_service.dart';
import 'dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  // ── State ──────────────────────────────────────────────
  int    _step           = 1;     // 1 = phone entry, 2 = OTP entry
  bool   _loading        = false;
  bool   _otpError       = false;
  int    _resendSecs     = 30;
  int?   _resendToken;
  // No longer need _verificationId for custom backend OTP

  final _phoneCtrl   = TextEditingController();
  final _otpCtrl     = TextEditingController();
  final _authService = AuthService();

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }

  // ── SEND OTP (Backend) ───────────────────────────────
  Future<void> _sendOtp({bool isResend = false}) async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length != 10) {
      _showSnack('Enter a valid 10-digit number');
      return;
    }

    setState(() => _loading = true);

    final response = await _authService.sendBackendOtp(phone);

    setState(() => _loading = false);

    if (response['success'] == true) {
      setState(() {
        _step       = 2;
        _resendSecs = 30;
      });
      _startResendTimer();
      if (isResend) _showSnack('OTP Resent Successfully');
    } else {
      _showSnack(response['message'] ?? 'Failed to send OTP');
    }
  }

  // ── VERIFY 6-DIGIT OTP (Backend) ──────────────────────
  Future<void> _verifyOtp() async {
    final code = _otpCtrl.text.trim();
    final phone = _phoneCtrl.text.trim();

    // Must be 6 digits
    if (code.length != 6) {
      setState(() => _otpError = true);
      return;
    }

    setState(() {
      _loading  = true;
      _otpError = false;
    });

    final response = await _authService.verifyBackendOtp(phone, code);

    if (response['success'] == true) {
      // ── NOTIFY RM ──────────────────────────────────
      // Customer logged in successfully
      // This calls backend → backend finds RM → sends FCM push to RM website
      await _authService.notifyRMAfterLogin();
      // ───────────────────────────────────────────────

      _goToDashboard();
    } else {
      setState(() {
        _loading  = false;
        _otpError = true;
      });
      _showSnack(response['message'] ?? 'Incorrect OTP. Please try again.');
    }
  }

  void _goToDashboard() {
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const DashboardScreen()),
      (route) => false,
    );
  }

  // ── Resend countdown ──────────────────────────────────
  void _startResendTimer() {
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return false;
      setState(() => _resendSecs--);
      return _resendSecs > 0;
    });
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: const Color(0xFF1A73E8),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10)),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1B2A),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 24),

              // Back button
              GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  width: 42, height: 42,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.arrow_back_ios_new,
                      color: Colors.white70, size: 16),
                ),
              ),

              const SizedBox(height: 40),

              // Step dots
              Row(children: [
                _StepDot(active: _step == 1, done: _step > 1),
                const SizedBox(width: 8),
                Container(
                  width: 40, height: 2,
                  color: _step > 1
                      ? const Color(0xFF1A73E8)
                      : Colors.white24,
                ),
                const SizedBox(width: 8),
                _StepDot(active: _step == 2, done: false),
              ]),

              const SizedBox(height: 36),

              // Animate between phone and OTP step
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _step == 1
                    ? _buildPhoneStep()
                    : _buildOtpStep(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ════════════════════════════════════════════════════
  // STEP 1 — Phone Number Input
  // ════════════════════════════════════════════════════
  Widget _buildPhoneStep() {
    return Column(
      key: const ValueKey('phone'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [

        const Text(
          'Enter your\nmobile number',
          style: TextStyle(
            fontSize: 34,
            fontWeight: FontWeight.w800,
            color: Colors.white,
            height: 1.2,
          ),
        ),

        const SizedBox(height: 12),

        Text(
          "We'll send a 6-digit OTP to verify",
          style: TextStyle(
            fontSize: 15,
            color: Colors.white.withOpacity(0.5),
          ),
        ),

        const SizedBox(height: 44),

        // Phone input with +91 prefix
        Container(
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.07),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white24),
          ),
          child: Row(children: [

            // Country code
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 20),
              decoration: const BoxDecoration(
                border: Border(
                    right: BorderSide(color: Colors.white24)),
              ),
              child: Row(children: [
                const Text('🇮🇳',
                    style: TextStyle(fontSize: 18)),
                const SizedBox(width: 6),
                const Text('+91',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700)),
              ]),
            ),

            // Phone number
            Expanded(
              child: TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly
                ],
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2,
                ),
                decoration: InputDecoration(
                  counterText: '',
                  hintText: '98765 43210',
                  hintStyle: TextStyle(
                    color: Colors.white.withOpacity(0.25),
                    fontSize: 18,
                    letterSpacing: 1,
                    fontWeight: FontWeight.w400,
                  ),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 20),
                ),
                onSubmitted: (_) => _sendOtp(),
              ),
            ),
          ]),
        ),

        const SizedBox(height: 16),

        // Security note
        Row(children: [
          Icon(Icons.lock_outline,
              size: 13,
              color: Colors.white.withOpacity(0.35)),
          const SizedBox(width: 6),
          Expanded(
            child: Text('Your number is encrypted and secure',
                style: TextStyle(
                    fontSize: 12,
                    color: Colors.white.withOpacity(0.35))),
          ),
        ]),

        const SizedBox(height: 40),

        // Send OTP button
        SizedBox(
          width: double.infinity,
          height: 58,
          child: ElevatedButton(
            onPressed: _loading ? null : _sendOtp,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF1A73E8),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
              elevation: 0,
            ),
            child: _loading
                ? const SizedBox(
                    width: 24, height: 24,
                    child: CircularProgressIndicator(
                        color: Colors.white, strokeWidth: 2.5))
                : const Text('Send OTP',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700)),
          ),
        ),

        const SizedBox(height: 28),

        Center(
          child: Text.rich(TextSpan(children: [
            TextSpan(
              text: 'By continuing you agree to our ',
              style: TextStyle(
                  fontSize: 12,
                  color: Colors.white.withOpacity(0.4)),
            ),
            const TextSpan(
              text: 'Terms & Privacy Policy',
              style: TextStyle(
                  fontSize: 12,
                  color: Color(0xFF1A73E8),
                  fontWeight: FontWeight.w500),
            ),
          ])),
        ),
      ],
    );
  }

  // ════════════════════════════════════════════════════
  // STEP 2 — 6-digit OTP Verification
  // ════════════════════════════════════════════════════
  Widget _buildOtpStep() {
    // Pinput box themes
    final defaultTheme = PinTheme(
      width: 52,
      height: 60,
      textStyle: const TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w700,
        color: Colors.white,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white24, width: 1.5),
      ),
    );

    final focusedTheme = defaultTheme.copyDecorationWith(
      border: const Border.fromBorderSide(
          BorderSide(color: Color(0xFF1A73E8), width: 2)),
      color: const Color(0xFF1A73E8).withOpacity(0.12),
    );

    final submittedTheme = defaultTheme.copyDecorationWith(
      border: const Border.fromBorderSide(
          BorderSide(color: Color(0xFF34A853), width: 2)),
      color: const Color(0xFF34A853).withOpacity(0.1),
    );

    final errorTheme = defaultTheme.copyDecorationWith(
      border: const Border.fromBorderSide(
          BorderSide(color: Color(0xFFEA4335), width: 2)),
      color: const Color(0xFFEA4335).withOpacity(0.1),
    );

    return Column(
      key: const ValueKey('otp'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [

        const Text(
          'Verify your\nnumber',
          style: TextStyle(
            fontSize: 34,
            fontWeight: FontWeight.w800,
            color: Colors.white,
            height: 1.2,
          ),
        ),

        const SizedBox(height: 12),

        // Show phone number with change option
        Row(children: [
          Expanded(
            child: Text(
              'OTP sent to +91 ${_phoneCtrl.text}  ',
              style: TextStyle(
                  fontSize: 14,
                  color: Colors.white.withOpacity(0.5)),
            ),
          ),
          GestureDetector(
            onTap: () => setState(() {
              _step = 1;
              _otpCtrl.clear();
              _otpError = false;
            }),
            child: const Text('Change',
                style: TextStyle(
                    fontSize: 14,
                    color: Color(0xFF1A73E8),
                    fontWeight: FontWeight.w600)),
          ),
        ]),

        const SizedBox(height: 44),

        // ── 6-digit Pinput boxes ─────────────────────
        Center(
          child: Pinput(
            controller: _otpCtrl,
            length: 6,                    // 6-digit OTP
            keyboardType: TextInputType.number,
            autofocus: true,
            defaultPinTheme:   defaultTheme,
            focusedPinTheme:   focusedTheme,
            submittedPinTheme: submittedTheme,
            errorPinTheme:     errorTheme,
            forceErrorState:   _otpError,
            onCompleted: (_) => _verifyOtp(),
            hapticFeedbackType: HapticFeedbackType.lightImpact,
          ),
        ),

        const SizedBox(height: 12),

        // Error message
        if (_otpError)
          Center(
            child: Text(
              'Incorrect OTP. Please try again.',
              style: TextStyle(
                  fontSize: 13,
                  color: Colors.red.shade400),
            ),
          ),

        const SizedBox(height: 40),

        // Verify button
        SizedBox(
          width: double.infinity,
          height: 58,
          child: ElevatedButton(
            onPressed: _loading ? null : _verifyOtp,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF1A73E8),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
              elevation: 0,
            ),
            child: _loading
                ? const SizedBox(
                    width: 24, height: 24,
                    child: CircularProgressIndicator(
                        color: Colors.white, strokeWidth: 2.5))
                : const Text('Verify & Continue',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700)),
          ),
        ),

        const SizedBox(height: 24),

        // Resend OTP row
        Center(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text("Didn't receive it?  ",
                  style: TextStyle(
                      fontSize: 14,
                      color: Colors.white.withOpacity(0.45))),
              _resendSecs > 0
                  ? Text(
                      'Resend in 0:${_resendSecs.toString().padLeft(2, '0')}',
                      style: TextStyle(
                          fontSize: 14,
                          color: Colors.white.withOpacity(0.3)),
                    )
                  : GestureDetector(
                      onTap: _loading ? null : () => _sendOtp(isResend: true),
                      child: Text('Resend OTP',
                          style: TextStyle(
                              fontSize: 14,
                              color: _loading ? Colors.white24 : const Color(0xFF1A73E8),
                              fontWeight: FontWeight.w600)),
                    ),
            ],
          ),
        ),

        const SizedBox(height: 24),

        // FCM notification info card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF34A853).withOpacity(0.1),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
                color: const Color(0xFF34A853).withOpacity(0.3)),
          ),
          child: Row(children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                color: const Color(0xFF34A853).withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                  Icons.notifications_active_rounded,
                  color: Color(0xFF34A853),
                  size: 18),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('RM will be notified',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF34A853))),
                  SizedBox(height: 3),
                  Text(
                    'Your Relationship Manager will receive a push notification when you log in.',
                    style: TextStyle(
                        fontSize: 11,
                        color: Colors.white54,
                        height: 1.5),
                  ),
                ],
              ),
            ),
          ]),
        ),
      ],
    );
  }
}

// ── Step dot indicator ────────────────────────────────────────
class _StepDot extends StatelessWidget {
  final bool active;
  final bool done;
  const _StepDot({required this.active, required this.done});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: active ? 24 : 10,
      height: 10,
      decoration: BoxDecoration(
        color: active || done
            ? const Color(0xFF1A73E8)
            : Colors.white24,
        borderRadius: BorderRadius.circular(5),
      ),
    );
  }
}
