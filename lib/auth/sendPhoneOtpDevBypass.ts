/**
 * Dev-only phone bypass when Play Integrity / reCAPTCHA fail on physical devices.
 * Uses email/password sign-in (no custom-token IAM required).
 */
import { Platform } from 'react-native';

import { functions, httpsCallable } from '@/lib/firebase';
import { getRnAuth } from '@/lib/rnFirebase';

import { getDevPhoneCode, isDevPhoneAllowlisted } from './devPhoneAllowlist';
import { setPhoneLoginSession } from './phoneLoginSession';

type DevLoginResponse = {
  uid: string;
  phoneNumber: string | null;
  email: string;
  password: string;
};

function devCallable<TReq, TRes>(name: string) {
  if (Platform.OS === 'web') {
    return httpsCallable<TReq, TRes>(functions, name);
  }
  return (httpsCallable as (f: typeof functions, n: string, o: { timeout: number }) => ReturnType<typeof httpsCallable>)(
    functions,
    name,
    { timeout: 30_000 },
  );
}

export function canUseDevPhoneBypass(phoneNumber: string): boolean {
  return __DEV__ && isDevPhoneAllowlisted(phoneNumber);
}

/** Returns synthetic verificationId — actual auth happens in confirmDevPhoneBypass. */
export async function sendPhoneOtpDevBypass(phoneNumber: string): Promise<string> {
  if (!canUseDevPhoneBypass(phoneNumber)) {
    throw Object.assign(new Error('Phone not in dev allowlist'), { code: 'auth/dev-not-allowlisted' });
  }
  setPhoneLoginSession({ mode: 'dev', phone: phoneNumber, devPending: true });
  return `dev:${phoneNumber.replace(/\D/g, '').slice(-10)}`;
}

export async function confirmDevPhoneBypass(
  phoneNumber: string,
  code: string,
): Promise<{ uid: string; phoneNumber: string | null }> {
  const expected = getDevPhoneCode(phoneNumber);
  if (!expected) {
    throw Object.assign(new Error('Phone not in dev allowlist'), { code: 'auth/dev-not-allowlisted' });
  }

  const fn = devCallable<{ phoneNumber: string; code: string }, DevLoginResponse>('devPhoneLogin');
  const { data } = await fn({ phoneNumber, code });

  const authInstance = getRnAuth();
  if (!authInstance) {
    throw new Error('Native Firebase Auth is not initialized');
  }

  const { signInWithEmailAndPassword } = require('@react-native-firebase/auth');
  await signInWithEmailAndPassword(authInstance, data.email, data.password);
  return { uid: data.uid, phoneNumber: data.phoneNumber };
}
