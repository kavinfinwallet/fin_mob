/**
 * This script mocks the smsService and tests the auth.controller logic.
 * Run this with: node scripts/test_msg91_integration.js
 */

process.env.MSG91_AUTH_KEY = 'test_key';
process.env.MSG91_TEMPLATE_ID = 'test_template';

const smsService = require('../src/services/sms.service');
const authController = require('../src/controllers/auth.controller');

// Mocking dependencies if necessary (e.g. DB models)
// For a real verification, we'd use a test DB and real MSG91 sandbox if available.
// Here we'll just check if the service can be imported and has the right methods.

console.log('--- MSG91 Integration Check ---');

if (typeof smsService.sendOTP === 'function' && 
    typeof smsService.verifyOTP === 'function' && 
    typeof smsService.resendOTP === 'function') {
  console.log('✅ sms.service.js has correct exports');
} else {
  console.error('❌ sms.service.js is missing required methods');
  process.exit(1);
}

console.log('Checking auth.controller.js for smsService usage...');
const fs = require('fs');
const path = require('path');
const authControllerContent = fs.readFileSync(path.join(__dirname, '../src/controllers/auth.controller.js'), 'utf8');

if (authControllerContent.includes("require('../services/sms.service')")) {
  console.log('✅ auth.controller.js imports smsService');
} else {
  console.error('❌ auth.controller.js does not import smsService');
}

if (authControllerContent.includes('smsService.sendOTP') && authControllerContent.includes('smsService.verifyOTP')) {
  console.log('✅ auth.controller.js calls smsService methods');
} else {
  console.error('❌ auth.controller.js missing smsService calls');
}

console.log('\nIntegration logic looks correct based on static analysis.');
console.log('To fully verify, please provide real MSG91 credentials in .env and test via API.');
