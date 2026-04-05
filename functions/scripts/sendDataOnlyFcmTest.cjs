/**
 * Pure data-only FCM (no `notification` block) — use to verify setBackgroundMessageHandler on Android.
 *
 * Prerequisites:
 *   cd functions && npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccount.json  (or firebase login application default)
 *
 * Usage:
 *   node scripts/sendDataOnlyFcmTest.cjs "<DEVICE_FCM_TOKEN>"
 *
 * Token: log from app after messaging().getToken() or from Firestore users/.../fcmTokens.
 */
const admin = require('firebase-admin');

const token = process.argv[2];
if (!token || token.length < 20) {
  console.error('Usage: node scripts/sendDataOnlyFcmTest.cjs "<FCM_REGISTRATION_TOKEN>"');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const traceId = `script-${Date.now()}`;
const message = {
  token,
  data: {
    type: 'incoming_call',
    callId: 'test123',
    callerId: 'debug_sender',
    callerName: 'Debug caller',
    callType: 'audio',
    hasVideo: 'false',
    title: 'Incoming audio call',
    body: 'Debug caller',
    traceId,
  },
  android: {
    priority: 'high',
    ttl: 30000,
    directBootOk: true,
    contentAvailable: true,
  },
  apns: {
    headers: { 'apns-priority': '10' },
    payload: { aps: { contentAvailable: true, sound: 'default' } },
  },
};

admin
  .messaging()
  .send(message)
  .then((id) => {
    console.log('OK sent message id:', id);
    console.log('traceId (match in app 📦 MESSAGE SOURCE TRACE):', traceId);
    console.log('Payload: data-only (no notification). Watch adb for 📩 RAW FCM BACKGROUND + delivery class data-only');
  })
  .catch((e) => {
    console.error('Send failed:', e?.message || e);
    process.exit(1);
  });
