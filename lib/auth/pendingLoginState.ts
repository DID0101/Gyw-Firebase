import AsyncStorage from '@react-native-async-storage/async-storage';

import { logAuthReliability } from '@/lib/reliability/reliabilityLog';

const KEY = 'pendingLogin:v1';

/** OTP sessions expire quickly — do not restore stale sign-in mid-flow. */
export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

export type PendingLoginState = {
  phone: string;
  verificationId: string;
  savedAt: string;
  /** Server-side Identity Toolkit fallback (when native Play Integrity fails). */
  mode?: 'native' | 'server';
  sessionInfo?: string;
};

function isPendingLoginFresh(state: PendingLoginState): boolean {
  const savedAtMs = Date.parse(state.savedAt);
  if (!Number.isFinite(savedAtMs)) return false;
  return Date.now() - savedAtMs <= PENDING_LOGIN_TTL_MS;
}

export async function savePendingLogin(state: PendingLoginState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
    logAuthReliability('LOGIN_STATE_SAVED', {});
  } catch {
    /* non-fatal */
  }
}

export async function loadPendingLogin(): Promise<PendingLoginState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingLoginState;
  } catch {
    return null;
  }
}

/** Returns saved OTP flow only if still within TTL; clears expired entries. */
export async function loadPendingLoginIfFresh(): Promise<PendingLoginState | null> {
  const saved = await loadPendingLogin();
  if (!saved?.verificationId || !saved.phone) return null;
  if (saved.mode === 'server' && !saved.sessionInfo) return null;
  if (!isPendingLoginFresh(saved)) {
    await clearPendingLogin();
    logAuthReliability('LOGIN_STATE_EXPIRED', {});
    return null;
  }
  return saved;
}

export async function clearPendingLogin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
