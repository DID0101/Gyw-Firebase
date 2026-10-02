/**
 * Persists phone-auth signup state across app kill / network loss.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { logAuthReliability } from '@/lib/reliability/reliabilityLog';

const KEY = 'pendingSignup:v1';

export const PENDING_SIGNUP_TTL_MS = __DEV__ ? 30 * 60 * 1000 : 10 * 60 * 1000;

function isPendingSignupFresh(savedAt: string | undefined): boolean {
  const savedAtMs = Date.parse(savedAt ?? '');
  if (!Number.isFinite(savedAtMs)) return false;
  return Date.now() - savedAtMs <= PENDING_SIGNUP_TTL_MS;
}

export type PendingProfile = {
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
};

export type PendingSignupState = {
  step: 'form' | 'otp';
  phone: string;
  verificationId: string | null;
  pendingProfile: PendingProfile | null;
  savedAt: string;
  mode?: 'native' | 'server' | 'dev';
  sessionInfo?: string;
};

export async function savePendingSignup(state: PendingSignupState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
    logAuthReliability('SIGNUP_STATE_SAVED', { step: state.step, hasVid: !!state.verificationId });
  } catch {
    /* non-fatal */
  }
}

export async function loadPendingSignup(): Promise<PendingSignupState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignupState;
    if (!parsed || typeof parsed !== 'object') return null;
    logAuthReliability('SIGNUP_STATE_LOADED', { step: parsed.step, hasVid: !!parsed.verificationId });
    return parsed;
  } catch {
    return null;
  }
}

/** Restores signup OTP step only if fresh; otherwise clears stale state. */
export async function loadPendingSignupIfFresh(): Promise<PendingSignupState | null> {
  const saved = await loadPendingSignup();
  if (!saved) return null;
  if (saved.step === 'otp' && saved.verificationId) {
    if (!isPendingSignupFresh(saved.savedAt)) {
      await clearPendingSignup();
      logAuthReliability('SIGNUP_STATE_EXPIRED', {});
      return null;
    }
    if (saved.mode === 'server' && !saved.sessionInfo) return null;
  }
  return saved;
}

export async function clearPendingSignup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
    logAuthReliability('SIGNUP_STATE_CLEARED', {});
  } catch {
    /* non-fatal */
  }
}
