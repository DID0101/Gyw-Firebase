import type { PendingLoginState } from '@/lib/auth/pendingLoginState';
import { loadPendingLoginIfFresh } from '@/lib/auth/pendingLoginState';
import { loadPendingSignupIfFresh } from '@/lib/auth/pendingSignupState';

import {
  getPhoneLoginSession,
  setPhoneLoginSession,
  type PhoneLoginSession,
} from './phoneLoginSession';
import { loadServerOtpSession } from './phoneOtpSessionStore';

export function restorePhoneLoginSession(state: {
  phone: string;
  verificationId: string;
  mode?: 'native' | 'server' | 'dev';
  sessionInfo?: string;
}): void {
  if (state.mode === 'dev' || state.verificationId.startsWith('dev:')) {
    setPhoneLoginSession({ mode: 'dev', phone: state.phone, devPending: true });
    return;
  }
  if (state.sessionInfo || state.verificationId.startsWith('server:')) {
    if (state.sessionInfo) {
      setPhoneLoginSession({ mode: 'server', sessionInfo: state.sessionInfo, phone: state.phone });
      return;
    }
  }
  setPhoneLoginSession({ mode: 'native', verificationId: state.verificationId, phone: state.phone });
}

/** Rehydrate in-memory OTP session after Metro reload / app restart. */
export async function ensurePhoneLoginSession(verificationId: string): Promise<PhoneLoginSession | null> {
  const current = getPhoneLoginSession();
  if (current?.mode === 'server' && current.sessionInfo) return current;
  if (current?.mode === 'dev') return current;
  if (current?.mode === 'native' && !verificationId.startsWith('server:') && !verificationId.startsWith('dev:')) {
    return current;
  }

  if (verificationId.startsWith('server:')) {
    const stored = await loadServerOtpSession(verificationId);
    if (stored?.sessionInfo) {
      restorePhoneLoginSession({
        phone: stored.phone,
        verificationId: stored.verificationId,
        mode: 'server',
        sessionInfo: stored.sessionInfo,
      });
      return getPhoneLoginSession();
    }
  }

  const login = await loadPendingLoginIfFresh();
  if (login?.verificationId === verificationId || (login?.sessionInfo && verificationId.startsWith('server:'))) {
    restorePhoneLoginSession({
      phone: login.phone,
      verificationId: login.verificationId,
      mode: login.mode ?? (login.sessionInfo ? 'server' : undefined),
      sessionInfo: login.sessionInfo,
    });
    const restored = getPhoneLoginSession();
    if (restored?.mode === 'server' && restored.sessionInfo) return restored;
  }

  const signup = await loadPendingSignupIfFresh();
  if (signup?.verificationId === verificationId && signup.sessionInfo) {
    restorePhoneLoginSession({
      phone: signup.phone,
      verificationId,
      mode: signup.mode ?? 'server',
      sessionInfo: signup.sessionInfo,
    });
    return getPhoneLoginSession();
  }

  return getPhoneLoginSession();
}
