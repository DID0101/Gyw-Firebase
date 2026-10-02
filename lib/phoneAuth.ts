import { Platform } from 'react-native';

import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { assertOnlineForOperation } from '@/lib/reliability/NetworkManager';

import { auth } from './firebase';
import { getRnAuth, hasRnFirebase } from './rnFirebase';
import {
  clearPhoneLoginSession,
  getPhoneLoginSession,
} from '@/lib/auth/phoneLoginSession';
import {
  confirmDevPhoneBypass,
} from '@/lib/auth/sendPhoneOtpDevBypass';
import { sendPhoneOtpNative } from '@/lib/auth/sendPhoneOtpNative';
import {
  resolveOtpVerificationMethod,
  type SendPhoneOtpOptions,
} from '@/lib/auth/otpVerificationMethod';
import { signInWithServerPhoneSession } from '@/lib/auth/signInWithServerPhoneSession';
import {
  ensurePhoneLoginSession,
  restorePhoneLoginSession,
} from '@/lib/auth/phoneLoginSessionRestore';
import { clearServerOtpSession } from '@/lib/auth/phoneOtpSessionStore';

let _webRecaptcha: import('firebase/auth').RecaptchaVerifier | null = null;

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

/** Firebase backend error 39 = QuotaExceeded (per-number / per-IP OTP rate limit). */
export function isOtpQuotaExceeded(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? '');
  return /error code:\s*39/i.test(msg);
}

async function sendPhoneOtpWeb(phoneNumber: string): Promise<string> {
  const { RecaptchaVerifier, signInWithPhoneNumber } = await import('firebase/auth');
  if (!_webRecaptcha) {
    _webRecaptcha = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      'expired-callback': () => {
        _webRecaptcha = null;
      },
    });
  }
  logAuth('AUTH_WEB_INVISIBLE_RECAPTCHA_START');
  prodDebug('AUTH_OTP_WEB_START', { mode: 'invisible_recaptcha' });
  try {
    const result = await signInWithPhoneNumber(auth, phoneNumber, _webRecaptcha);
    logAuth('AUTH_CONFIRMATION_RECEIVED', {
      verificationId: result.verificationId ? 'SET' : 'EMPTY',
      mode: 'web',
    });
    prodDebug('AUTH_OTP_WEB_OK', {});
    return result.verificationId;
  } catch (e) {
    prodDebugError('AUTH_OTP_WEB_FAIL', e, {});
    _webRecaptcha = null;
    throw e;
  }
}

function isMissingClientIdentifier(error: unknown): boolean {
  const e = error as { code?: string; message?: string; userInfo?: { code?: string } };
  const code = e?.code ?? e?.userInfo?.code ?? '';
  const msg = e?.message ?? '';
  return (
    code === 'auth/missing-client-identifier' ||
    code === 'missing-client-identifier' ||
    msg.includes('missing-client-identifier')
  );
}

async function sendPhoneOtpPlayIntegrity(phoneNumber: string): Promise<string> {
  logAuth('AUTH_NATIVE_OTP_START', { platform: Platform.OS });
  prodDebug('AUTH_OTP_NATIVE_PATH', { platform: Platform.OS, mode: 'play_integrity_silent' });
  const verificationId = await sendPhoneOtpNative(phoneNumber);
  logAuth('AUTH_CONFIRMATION_RECEIVED', { verificationId: 'NATIVE', mode: 'native' });
  prodDebug('AUTH_OTP_NATIVE_OK', { platform: Platform.OS });
  return verificationId;
}

export type { SendPhoneOtpOptions } from '@/lib/auth/otpVerificationMethod';
export { getAvailableOtpMethods, isOtpMethodPickerAvailable } from '@/lib/auth/otpVerificationMethod';

// ─── Send OTP ────────────────────────────────────────────────────────────────

/** TODO: AUTH_REFACTOR_REMOVE — screens must use @/lib/auth/authCompat; AuthManager delegates here. */
export async function sendPhoneOTP(
  phoneNumber: string,
  options?: SendPhoneOtpOptions,
): Promise<string> {
  assertOnlineForOperation('sendPhoneOTP');
  await resolveOtpVerificationMethod(phoneNumber, options?.method);
  logAuth('AUTH_PHONE_START', {
    platform: Platform.OS,
    phone: redactPhone(phoneNumber),
    method: 'native',
  });

  if (Platform.OS === 'web') {
    return sendPhoneOtpWeb(phoneNumber);
  }

  if (!hasRnFirebase) {
    throw new Error(
      'Phone auth requires a native development build.\n\nRun: npx expo run:android',
    );
  }

  try {
    return await sendPhoneOtpPlayIntegrity(phoneNumber);
  } catch (error) {
    if (isMissingClientIdentifier(error)) {
      throw Object.assign(
        new Error(
          'Play Integrity could not verify this app. Add your debug SHA-256 in Firebase Console ' +
            '(Project settings → Android app com.gyw1.chat), enable Play Integrity API in Google Cloud ' +
            '(gyw1-146d7), then rebuild and try again.',
        ),
        { code: 'auth/missing-client-identifier', cause: error },
      );
    }
    throw error;
  }
}

// ─── Confirm OTP ─────────────────────────────────────────────────────────────

/** TODO: AUTH_REFACTOR_REMOVE — screens must use @/lib/auth/authCompat; AuthManager delegates here. */
export async function confirmPhoneOTP(
  verificationId: string,
  code: string,
): Promise<{ uid: string; phoneNumber: string | null }> {
  assertOnlineForOperation('confirmPhoneOTP');

  const session = await ensurePhoneLoginSession(verificationId);
  if (session?.mode === 'dev') {
    try {
      logAuth('AUTH_VERIFY_START', { provider: 'dev/custom-token' });
      const out = await confirmDevPhoneBypass(session.phone, code);
      logAuth('AUTH_VERIFY_SUCCESS', { uid: out.uid.slice(0, 8), mode: 'dev' });
      clearPhoneLoginSession();
      return out;
    } catch (e: unknown) {
      logAuth('AUTH_VERIFY_FAILED', {
        code: (e as { code?: string })?.code,
        message: (e as Error)?.message,
        mode: 'dev',
      });
      throw e;
    }
  }

  if (session?.mode === 'server' && session.sessionInfo) {
    try {
      logAuth('AUTH_VERIFY_START', {
        provider: 'client/phone-credential',
        hasSessionInfo: !!session.sessionInfo,
        phoneSuffix: session.phone.slice(-4),
      });
      const signedIn = await signInWithServerPhoneSession(session.sessionInfo, code);
      logAuth('AUTH_VERIFY_SUCCESS', {
        uid: signedIn.uid.slice(0, 8),
        mode: 'server',
      });
      clearPhoneLoginSession();
      await clearServerOtpSession();
      return signedIn;
    } catch (e: any) {
      logAuth('AUTH_VERIFY_FAILED', {
        code: e?.code,
        message: e?.message,
        nativeErrorCode: e?.nativeErrorCode,
        mode: 'server',
      });
      throw e;
    }
  }

  if (verificationId.startsWith('server:') || verificationId.startsWith('dev:')) {
    throw Object.assign(new Error('Phone verification session expired. Request a new code.'), {
      code: 'auth/session-expired',
    });
  }

  if (Platform.OS === 'web') {
    const { PhoneAuthProvider, signInWithCredential } = await import('firebase/auth');
    const credential = PhoneAuthProvider.credential(verificationId, code);
    try {
      logAuth('AUTH_VERIFY_START', { provider: 'web/firebase-auth' });
      const { user } = await signInWithCredential(auth, credential);
      logAuth('AUTH_VERIFY_SUCCESS', { uid: user?.uid ? 'SET' : 'EMPTY' });
      clearPhoneLoginSession();
      return { uid: user.uid, phoneNumber: user.phoneNumber };
    } catch (e: any) {
      logAuth('AUTH_VERIFY_FAILED', { code: e?.code, message: e?.message, raw: e });
      throw e;
    }
  }

  const { PhoneAuthProvider, signInWithCredential } = require('@react-native-firebase/auth');
  const credential = PhoneAuthProvider.credential(verificationId, code);
  try {
    logAuth('AUTH_VERIFY_START', { provider: 'native/@react-native-firebase/auth' });
    const { user } = await signInWithCredential(getRnAuth(), credential);
    logAuth('AUTH_VERIFY_SUCCESS', { uid: user?.uid ? 'SET' : 'EMPTY' });
    clearPhoneLoginSession();
    return { uid: user.uid, phoneNumber: user.phoneNumber };
  } catch (e: any) {
    logAuth('AUTH_VERIFY_FAILED', {
      code: e?.code,
      message: e?.message,
      nativeErrorCode: e?.nativeErrorCode,
      userInfo: e?.userInfo,
      raw: e,
    });
    throw e;
  }
}

/** Expose server session fields for pending-login persistence. */
export function getPhoneOtpSessionForPersistence(): {
  mode: 'native' | 'server' | 'dev';
  sessionInfo?: string;
} | null {
  const session = getPhoneLoginSession();
  if (!session) return null;
  if (session.mode === 'dev') return { mode: 'dev' };
  return { mode: session.mode, sessionInfo: session.mode === 'server' ? session.sessionInfo : undefined };
}

export { restorePhoneLoginSession } from '@/lib/auth/phoneLoginSessionRestore';

// ─── Error messages ───────────────────────────────────────────────────────────

export function friendlyAuthError(error: any): string {
  const code: string = error?.code ?? '';
  const msg: string = error?.message ?? '';

  if (code === 'auth/timeout' || msg.includes('timed out')) {
    return 'Verification is taking too long. Wait a moment and try again.';
  }
  if (code === 'auth/duplicate-request') {
    return 'A verification request is already in progress. Wait for it to finish.';
  }
  if (code === 'auth/invalid-api-key' || msg.includes('invalid-api-key')) {
    return 'Security verification could not start. Reload the app and try again.';
  }
  if (isOtpQuotaExceeded(error)) {
    return (
      'Too many verification attempts for this phone number or device. ' +
      'Wait 1–2 hours, try a different number, or add a Firebase test phone in Console → Authentication → Phone.'
    );
  }
  if (code === 'auth/missing-client-identifier' || msg.includes('missing-client-identifier')) {
    return (
      'Play Integrity could not verify this app. Add your SHA-256 in Firebase Console ' +
      '(Project settings → Android app com.gyw1.chat), enable Play Integrity API in Google Cloud, then rebuild.'
    );
  }
  if (msg.includes('recaptcha_expired') || msg.includes('Verification cancelled')) {
    return 'Verification expired or cancelled. Tap Send OTP again.';
  }
  if (code === 'auth/dev-not-allowlisted') {
    return (
      'Dev bypass: this phone is not allowlisted.\n\n' +
      'Add EXPO_PUBLIC_DEV_PHONE_CODES="+90XXXXXXXXXX:123456" to .env.local and restart Metro, ' +
      'or add the phone in Firestore system/devPhoneAuth.'
    );
  }
  if (code === 'functions/failed-precondition' || code === 'failed-precondition') {
    return msg || 'Phone verification service configuration issue.';
  }
  if (code === 'functions/resource-exhausted' || code === 'resource-exhausted') {
    return msg || 'Too many OTP attempts. Wait 1–2 hours or use a Firebase test phone number.';
  }
  if (code === 'auth/device-not-secure') {
    return 'Phone sign-in needs a device PIN, pattern, or password. Set one in Settings, then try again.';
  }
  if (code === 'auth/too-many-requests' || msg.includes('too-many-requests') || msg.includes('blocked all requests')) {
    return 'Too many sign-in attempts — Firebase temporarily blocked this device. Wait a few hours or use a Firebase test phone number.';
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
  if (code === 'network/offline') {
    return 'No internet connection. Check your network and try again.';
  }
  if (code === 'functions/not-found' || code === 'not-found' || msg.includes('NOT_FOUND')) {
    return 'Phone login service not deployed. Run: firebase deploy --only functions:sendPhoneLoginOtp,functions:verifyPhoneLoginOtp,functions:checkPhoneRegistration';
  }
  if (msg.includes('Username check service not deployed')) {
    return msg;
  }
  if (code === 'auth/account-not-found') {
    return 'No account found for this phone number. Please sign up first.';
  }
  if (code === 'auth/account-already-exists') {
    return 'An account already exists for this phone number. Please sign in.';
  }
  if (code === 'functions/internal' || code === 'auth/internal-error') {
    return msg && msg !== 'INTERNAL' ? msg : 'Verification failed. Request a new code and try again.';
  }
  if (msg.includes('Phone verification failed')) {
    if (msg.includes('INVALID_CODE')) return 'Wrong code. Check it and try again.';
    if (msg.includes('SESSION_EXPIRED') || msg.includes('INVALID_SESSION_INFO')) {
      return 'Code expired. Please request a new one.';
    }
    return msg;
  }
  return msg || 'Something went wrong. Please try again.';
}
