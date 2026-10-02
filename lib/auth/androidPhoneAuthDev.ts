/**
 * Android phone auth settings — only disable app verification for test/allowlist numbers.
 * Setting appVerificationDisabledForTesting globally breaks real-number OTP (Play Integrity + reCAPTCHA).
 */
import { Platform } from 'react-native';

import { isDevPhoneAllowlisted } from '@/lib/auth/devPhoneAllowlist';
import { getRnAuth } from '@/lib/rnFirebase';

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/** Firebase Console test numbers (Auth → Phone → test numbers). Optional env override. */
function getFirebaseConsoleTestPhones(): string[] {
  const raw = process.env.EXPO_PUBLIC_FIREBASE_TEST_PHONES ?? '';
  return raw
    .split(',')
    .map((p) => normalizePhone(p.trim()))
    .filter((p) => p.startsWith('+') && p.length >= 8);
}

function isFirebaseConsoleTestPhone(phoneNumber: string): boolean {
  const normalized = normalizePhone(phoneNumber);
  return getFirebaseConsoleTestPhones().includes(normalized);
}

export function isPhoneAuthTestNumber(phoneNumber: string): boolean {
  const normalized = normalizePhone(phoneNumber);
  return isDevPhoneAllowlisted(normalized) || isFirebaseConsoleTestPhone(normalized);
}

/**
 * Configure RN Firebase Auth settings per OTP request.
 * Real numbers: verification ENABLED (Play Integrity → reCAPTCHA fallback).
 * Test numbers: verification disabled (Firebase console test / dev allowlist).
 */
export function configurePhoneAuthForNumber(phoneNumber: string): {
  appVerificationDisabled: boolean;
  isTestNumber: boolean;
} {
  if (Platform.OS !== 'android') {
    return { appVerificationDisabled: false, isTestNumber: false };
  }

  const isTestNumber = isPhoneAuthTestNumber(phoneNumber);
  const auth = getRnAuth();
  if (auth?.settings) {
    auth.settings.appVerificationDisabledForTesting = isTestNumber;
    auth.settings.forceRecaptchaFlowForTesting = false;
  }

  return { appVerificationDisabled: isTestNumber, isTestNumber };
}

/** Ensure real-number path on cold start (__DEV__ only). */
export function ensureRealNumberVerificationEnabled(): void {
  if (!__DEV__ || Platform.OS !== 'android') return;
  try {
    const auth = getRnAuth();
    if (auth?.settings) {
      auth.settings.appVerificationDisabledForTesting = false;
      auth.settings.forceRecaptchaFlowForTesting = false;
    }
  } catch {
    /* non-fatal */
  }
}
