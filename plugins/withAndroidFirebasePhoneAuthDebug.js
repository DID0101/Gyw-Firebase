/**
 * @deprecated Use ./withAndroidFirebasePhoneAuthStable.js (app.json).
 * This shim no longer injects forceRecaptchaFlowForTesting — that caused recurring
 * auth/missing-client-identifier on real phone numbers.
 */
module.exports = require('./withAndroidFirebasePhoneAuthStable');
