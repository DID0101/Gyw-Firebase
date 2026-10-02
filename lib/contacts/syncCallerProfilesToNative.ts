import { NativeModules, Platform } from 'react-native';

export type CallerProfileNative = {
  name: string;
  avatar?: string;
  phone?: string;
};

type IncomingCallBridge = {
  setCallerProfileMapJson?: (json: string) => Promise<void>;
};

/**
 * Mirror UID → display metadata for killed-state incoming call UI (Android).
 */
export function syncCallerProfilesToNative(
  profiles: Record<string, CallerProfileNative>,
): void {
  if (Platform.OS !== 'android') return;
  const bridge = NativeModules.IncomingCallBridge as IncomingCallBridge | undefined;
  if (!bridge?.setCallerProfileMapJson) return;
  try {
    void bridge.setCallerProfileMapJson(JSON.stringify(profiles));
  } catch (e) {
    if (__DEV__) console.warn('[syncCallerProfilesToNative] failed', e);
  }
}

export function syncCallerProfileToNative(
  uid: string,
  profile: CallerProfileNative,
): void {
  if (!uid.trim() || !profile.name.trim()) return;
  syncCallerProfilesToNative({ [uid]: profile });
}
