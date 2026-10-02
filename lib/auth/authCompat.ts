/**
 * Strangler compatibility layer — screens migrate here before calling AuthManager directly.
 * Old lib/phoneAuth.ts remains for internal delegation until Phase 6+.
 */
import {
  clearPendingLogin,
  loadPendingLoginIfFresh,
  savePendingLogin,
  type PendingLoginState,
} from '@/lib/auth/pendingLoginState';
import { authManager } from '@/lib/auth/AuthManager';
import {
  clearPhoneLoginSession,
  getPhoneLoginSession,
} from '@/lib/auth/phoneLoginSession';
import {
  friendlyAuthError,
  getPhoneOtpSessionForPersistence,
  restorePhoneLoginSession,
  type SendPhoneOtpOptions,
} from '@/lib/phoneAuth';

export {
  friendlyAuthError,
  getPhoneOtpSessionForPersistence,
  restorePhoneLoginSession,
};

export type OtpVerifyResult = { uid: string; phoneNumber: string | null };

/** Send OTP via AuthManager (updates FSM + locks). */
export async function compatSendOTP(
  phoneNumber: string,
  options?: SendPhoneOtpOptions,
): Promise<string> {
  const verificationId = await authManager.requestOTP(phoneNumber, options);
  if (verificationId == null) {
    throw Object.assign(new Error('OTP request already in progress'), { code: 'auth/duplicate-request' });
  }
  return verificationId;
}

/** Verify OTP via AuthManager. */
export async function compatVerifyOTP(
  verificationId: string,
  code: string,
): Promise<OtpVerifyResult> {
  const result = await authManager.verifyOTP(verificationId, code);
  if (result == null) {
    throw Object.assign(new Error('Verification already in progress'), { code: 'auth/duplicate-request' });
  }
  return result;
}

export async function compatSavePendingLogin(state: PendingLoginState): Promise<void> {
  const meta = authManager.getOtpPersistenceMeta();
  const verificationId = state.verificationId;
  await savePendingLogin({
    ...state,
    mode:
      meta?.mode ??
      state.mode ??
      (verificationId.startsWith('server:')
        ? 'server'
        : verificationId.startsWith('dev:')
          ? 'dev'
          : 'native'),
    sessionInfo: meta?.sessionInfo ?? state.sessionInfo,
  });
}

export {
  loadPendingLoginIfFresh,
  clearPendingLogin,
  getPhoneLoginSession,
  clearPhoneLoginSession,
};

export async function compatSignOut(): Promise<void> {
  return authManager.signOut();
}

/** Re-export legacy names used by tests / gradual migration. */
export const sendPhoneOTP = compatSendOTP;
export const confirmPhoneOTP = compatVerifyOTP;
