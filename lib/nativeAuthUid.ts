import { Platform } from 'react-native';

/**
 * Synchronous read of native Firebase Auth UID (no React).
 * Used by FCM background handler and incoming-call routing.
 */
export function getNativeAuthUidSync(): string | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getApp } = require('@react-native-firebase/app');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAuth } = require('@react-native-firebase/auth');
    return getAuth(getApp()).currentUser?.uid ?? null;
  } catch {
    return null;
  }
}
