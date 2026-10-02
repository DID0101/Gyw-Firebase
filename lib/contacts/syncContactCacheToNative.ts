import { NativeModules, Platform } from 'react-native';

import type { PhoneNameMap } from '@/lib/contacts/contactPhoneIndex';

type IncomingCallBridge = {
  setContactNameMap?: (map: Record<string, string>) => void;
  setContactNameMapJson?: (json: string) => void;
};

/**
 * Mirror local contact index to Android native layer for FCM / killed-state UI.
 * Never uploads data — on-device SharedPreferences only.
 */
export function syncContactCacheToNative(phoneToName: PhoneNameMap): void {
  if (Platform.OS === 'web') return;
  const bridge = NativeModules.IncomingCallBridge as IncomingCallBridge | undefined;
  if (!bridge) return;

  try {
    if (typeof bridge.setContactNameMapJson === 'function') {
      bridge.setContactNameMapJson(JSON.stringify(phoneToName));
      return;
    }
    bridge.setContactNameMap?.(phoneToName);
  } catch (e) {
    if (__DEV__) console.warn('[syncContactCacheToNative] failed', e);
  }
}
