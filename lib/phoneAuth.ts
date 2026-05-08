import { Platform } from 'react-native';
import { auth } from './firebase';
import { getRnAuth, hasRnFirebase } from './rnFirebase';

let _webRecaptcha: any = null;

function redactPhone(phone: string) {
  const cleaned = String(phone || '');
  if (cleaned.length <= 6) return 'REDACTED';
  return `${cleaned.slice(0, 3)}***${cleaned.slice(-2)}`;
}

function logAuth(tag: string, data?: any) {
  if (!__DEV__) return;
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[AUTH_PHONE] ${tag}${data === undefined ? '' : ' '}${data === undefined ? '' : JSON.stringify(data)}`,
    );
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[AUTH_PHONE] ${tag}`);
  }
}

// ─── Send OTP ────────────────────────────────────────────────────────────────

export async function sendPhoneOTP(phoneNumber: string): Promise<string> {
  logAuth('AUTH_PHONE_START', { platform: Platform.OS, phone: redactPhone(phoneNumber) });
  if (Platform.OS === 'web') {
    const { RecaptchaVerifier, signInWithPhoneNumber } = await import('firebase/auth');
    if (!_webRecaptcha) {
      _webRecaptcha = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        'expired-callback': () => { _webRecaptcha = null; },
      });
    }
    try {
      logAuth('AUTH_PROVIDER_START', { provider: 'web/firebase-auth' });
      const result = await signInWithPhoneNumber(auth, phoneNumber, _webRecaptcha);
      logAuth('AUTH_CONFIRMATION_RECEIVED', { verificationId: result.verificationId ? 'SET' : 'EMPTY' });
      return result.verificationId;
    } catch (e: any) {
      logAuth('AUTH_PROVIDER_ERROR', {
        code: e?.code,
        message: e?.message,
        name: e?.name,
        stack: e?.stack,
        raw: e,
      });
      throw e;
    }
  }

  if (!hasRnFirebase) {
    throw new Error(
      'Phone auth requires a native development build.\n\nRun: npx expo run:android',
    );
  }

  try {
    logAuth('AUTH_PROVIDER_START', { provider: 'native/@react-native-firebase/auth' });
    const { signInWithPhoneNumber } = require('@react-native-firebase/auth');
    const result = await signInWithPhoneNumber(getRnAuth(), phoneNumber);
    logAuth('AUTH_CONFIRMATION_RECEIVED', { verificationId: result?.verificationId ? 'SET' : 'EMPTY' });
    return result.verificationId || '';
  } catch (e: any) {
    logAuth('AUTH_PROVIDER_ERROR', {
      code: e?.code,
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
      nativeErrorCode: e?.nativeErrorCode,
      userInfo: e?.userInfo,
      raw: e,
    });
    throw e;
  }
}

// ─── Confirm OTP ─────────────────────────────────────────────────────────────

export async function confirmPhoneOTP(
  verificationId: string,
  code: string,
): Promise<{ uid: string; phoneNumber: string | null }> {
  if (Platform.OS === 'web') {
    const { PhoneAuthProvider, signInWithCredential } = await import('firebase/auth');
    const credential = PhoneAuthProvider.credential(verificationId, code);
    try {
      logAuth('AUTH_VERIFY_START', { provider: 'web/firebase-auth' });
      const { user } = await signInWithCredential(auth, credential);
      logAuth('AUTH_VERIFY_SUCCESS', { uid: user?.uid ? 'SET' : 'EMPTY' });
      return { uid: user.uid, phoneNumber: user.phoneNumber };
    } catch (e: any) {
      logAuth('AUTH_VERIFY_FAILED', { code: e?.code, message: e?.message, stack: e?.stack, raw: e });
      throw e;
    }
  }

  const { PhoneAuthProvider, signInWithCredential } = require('@react-native-firebase/auth');
  const credential = PhoneAuthProvider.credential(verificationId, code);
  try {
    logAuth('AUTH_VERIFY_START', { provider: 'native/@react-native-firebase/auth' });
    const { user } = await signInWithCredential(getRnAuth(), credential);
    logAuth('AUTH_VERIFY_SUCCESS', { uid: user?.uid ? 'SET' : 'EMPTY' });
    return { uid: user.uid, phoneNumber: user.phoneNumber };
  } catch (e: any) {
    logAuth('AUTH_VERIFY_FAILED', {
      code: e?.code,
      message: e?.message,
      stack: e?.stack,
      nativeErrorCode: e?.nativeErrorCode,
      userInfo: e?.userInfo,
      raw: e,
    });
    throw e;
  }
}

// ─── Error messages ───────────────────────────────────────────────────────────

export function friendlyAuthError(error: any): string {
  const code: string = error?.code ?? '';
  const msg: string = error?.message ?? '';

  if (code === 'auth/missing-client-identifier' || msg.includes('missing-client-identifier')) {
    return (
      'Firebase could not verify this Android app (Play Integrity / reCAPTCHA).\n\n' +
      'Required checks:\n' +
      '• Confirm you are using package com.gyw1.chat (not com.gyw.chat)\n' +
      '• Firebase Console → com.gyw1.chat: add SHA-1 + SHA-256 from android/gradlew :app:signingReport, then download fresh google-services.json\n' +
      '• Google Cloud (gyw1-146d7): enable Play Integrity API + Identity Toolkit API\n' +
      '\nDevice note:\n' +
      'If logcat shows "RecaptchaActivity: Could not generate an encryption key", fix Android Keystore on the phone (set a screen lock PIN/pattern, update Play Services/Chrome/WebView, reboot) or test on another device.\n' +
      '\nThen rebuild: npx expo run:android'
    );
  }
  if (code === 'auth/too-many-requests' || msg.includes('too-many-requests') || msg.includes('blocked all requests')) {
    return 'Too many attempts — Firebase blocked this device. Wait 24–48 hours, try a different number, or use a different network.';
  }
  if (code === 'auth/invalid-phone-number') {
    return 'Invalid phone number. Use international format: +1234567890';
  }
  if (code === 'auth/invalid-verification-code') {
    return 'Wrong code. Check it and try again.';
  }
  if (code === 'auth/code-expired' || code === 'auth/session-expired' || msg.includes('expired')) {
    return 'Code expired. Please request a new one.';
  }
  if (code === 'auth/argument-error') {
    return 'Phone number must include a country code, e.g. +1234567890';
  }
  return msg || 'Something went wrong. Please try again.';
}
