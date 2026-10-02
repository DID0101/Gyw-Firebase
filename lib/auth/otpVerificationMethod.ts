import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/** Native mobile uses Play Integrity only — no reCAPTCHA. */
export type OtpVerificationMethod = 'native';

export type SendPhoneOtpOptions = {
  /** Ignored on Android/iOS — always Play Integrity. */
  method?: OtpVerificationMethod;
};

const STORAGE_KEY = 'gyw_otp_verification_method';
const DEFAULT_METHOD: OtpVerificationMethod = 'native';

/** Play Integrity is the only native path; picker removed. */
export function isOtpMethodPickerAvailable(): boolean {
  return false;
}

export async function getStoredOtpVerificationMethod(): Promise<OtpVerificationMethod> {
  return DEFAULT_METHOD;
}

export async function setStoredOtpVerificationMethod(_method: OtpVerificationMethod): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, DEFAULT_METHOD);
  } catch {
    /* non-fatal */
  }
}

export function getOtpMethodLabel(_method: OtpVerificationMethod = 'native'): string {
  return 'Play Integrity (no reCAPTCHA)';
}

export function getOtpMethodDescription(_method: OtpVerificationMethod = 'native'): string {
  return 'Silent Google Play Integrity check, then SMS. No reCAPTCHA.';
}

export function getAvailableOtpMethods(_phoneNumber?: string): OtpVerificationMethod[] {
  return ['native'];
}

export async function resolveOtpVerificationMethod(
  _phoneNumber: string,
  _override?: OtpVerificationMethod,
): Promise<OtpVerificationMethod> {
  if (Platform.OS === 'web') return DEFAULT_METHOD;
  return DEFAULT_METHOD;
}

/** One-time cleanup if an older dev build stored a reCAPTCHA method. */
export async function ensurePlayIntegrityOtpMode(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw && raw !== 'native') {
      await AsyncStorage.setItem(STORAGE_KEY, DEFAULT_METHOD);
    }
  } catch {
    /* non-fatal */
  }
}
