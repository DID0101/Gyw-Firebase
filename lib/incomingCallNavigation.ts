/**
 * Bridges incoming-call events (FCM, Notifee) to Expo Router.
 * Linking.openURL is unreliable when the app is already foregrounded; use router.replace/push instead.
 */
import * as ExpoLinking from 'expo-linking';
import { Linking, Platform } from 'react-native';

export type IncomingCallNavOptions = {
  /** If true, CallScreen auto-starts media + marks call active (system "Answer" / deep link). */
  autoAccept?: boolean;
};

type NavFn = (callId: string, opts?: IncomingCallNavOptions) => void;

let navigateFn: NavFn | null = null;

let lastNav: { callId: string; at: number } | null = null;

function isDuplicate(callId: string): boolean {
  const now = Date.now();
  if (lastNav && lastNav.callId === callId && now - lastNav.at < 1500) return true;
  lastNav = { callId, at: now };
  return false;
}

export function registerIncomingCallNavigator(fn: NavFn | null): void {
  navigateFn = fn;
}

/** True when Expo Router registered a handler (typically only while the app UI is active). */
export function getIncomingCallNavigator(): NavFn | null {
  return navigateFn;
}

/**
 * Navigate to the call screen. Prefer the registered Expo Router handler when the app is mounted.
 */
export function navigateToIncomingCallScreen(callId: string, opts?: IncomingCallNavOptions): void {
  if (!callId) return;
  if (isDuplicate(callId)) return;

  if (navigateFn) {
    navigateFn(callId, opts);
    return;
  }

  try {
    const autoAccept = opts?.autoAccept === true;
    const url = ExpoLinking.createURL(`/(home)/call/${encodeURIComponent(callId)}`, {
      queryParams: autoAccept ? { accept: '1' } : {},
    });
    void Linking.openURL(url);
  } catch {
    const qs = opts?.autoAccept === true ? '?accept=1' : '';
    if (Platform.OS !== 'web') {
      void Linking.openURL(`gyw://call/${encodeURIComponent(callId)}${qs}`);
    }
  }
}
