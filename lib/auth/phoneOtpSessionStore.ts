/**
 * Durable server OTP session — survives Metro reload (in-memory session is wiped).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'phoneOtpServerSession:v1';
const TTL_MS = 10 * 60 * 1000;

export type StoredServerOtpSession = {
  sessionInfo: string;
  phone: string;
  verificationId: string;
  savedAt: string;
};

export async function persistServerOtpSession(
  sessionInfo: string,
  phone: string,
  verificationId: string,
): Promise<void> {
  const state: StoredServerOtpSession = {
    sessionInfo,
    phone,
    verificationId,
    savedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

export async function loadServerOtpSession(
  verificationId?: string | null,
): Promise<StoredServerOtpSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as StoredServerOtpSession;
    if (!state?.sessionInfo || !state.phone) return null;
    const savedAtMs = Date.parse(state.savedAt);
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > TTL_MS) {
      await clearServerOtpSession();
      return null;
    }
    if (verificationId && state.verificationId !== verificationId) {
      // Allow any server:* id when phone flow is active (truncated id is stable per sessionInfo prefix).
      if (!verificationId.startsWith('server:')) return null;
      if (!state.verificationId.startsWith('server:')) return null;
      if (!state.sessionInfo.startsWith(verificationId.slice('server:'.length))) {
        return null;
      }
    }
    return state;
  } catch {
    return null;
  }
}

export async function clearServerOtpSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
