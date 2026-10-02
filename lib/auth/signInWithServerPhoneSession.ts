import { Platform } from 'react-native';

import { auth } from '@/lib/firebase';
import { getRnAuth } from '@/lib/rnFirebase';

/**
 * Server OTP returns Identity Toolkit sessionInfo — use it directly as the native
 * verificationId. Avoids verifyPhoneLoginOtp + createCustomToken (INTERNAL on CF).
 */
export async function signInWithServerPhoneSession(
  sessionInfo: string,
  code: string,
): Promise<{ uid: string; phoneNumber: string | null }> {
  const verificationCode = String(code).trim();
  if (verificationCode.length !== 6) {
    throw Object.assign(new Error('6-digit code required'), { code: 'auth/invalid-verification-code' });
  }

  if (Platform.OS === 'web') {
    const { PhoneAuthProvider, signInWithCredential } = await import('firebase/auth');
    const credential = PhoneAuthProvider.credential(sessionInfo, verificationCode);
    const { user } = await signInWithCredential(auth, credential);
    return { uid: user.uid, phoneNumber: user.phoneNumber };
  }

  const authInstance = getRnAuth();
  if (!authInstance) {
    throw new Error('Native Firebase Auth is not initialized');
  }

  const { PhoneAuthProvider, signInWithCredential } = require('@react-native-firebase/auth');
  const credential = PhoneAuthProvider.credential(sessionInfo, verificationCode);
  const { user } = await signInWithCredential(authInstance, credential);
  if (!user?.uid) {
    throw Object.assign(new Error('Phone sign-in did not return a user'), { code: 'auth/internal-error' });
  }
  return { uid: user.uid, phoneNumber: user.phoneNumber ?? null };
}
