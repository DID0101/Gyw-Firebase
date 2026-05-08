/**
 * Run before RN Firebase loads to silence modular deprecation warnings.
 * Import first in app/_layout.tsx.
 */

// ── Android: Telecom PhoneAccount is registered in MainApplication.kt ────────
// CallConnectionService.registerPhoneAccount(this) is called in Application.onCreate()
// so the PhoneAccount is always registered before any FCM push arrives.
// Nothing to do here on Android.

// ── iOS: bridge VoIP token from UserDefaults → AsyncStorage ──────────────────
// GywVoIPPushDelegate.swift writes the PushKit token to UserDefaults immediately
// when PushKit fires (even in killed state). We mirror it into AsyncStorage here
// so fcmTokenService.ts can read it with AsyncStorage.getItem('gyw_voip_token').
import { NativeModules, Platform } from 'react-native';

// Load before lib/firebase.ts so Android Phone Auth flags (see rnFirebase) apply first.
if (Platform.OS === 'android') {
  require('./rnFirebase');
}

if (Platform.OS === 'ios') {
  try {
    // SettingsManager reads NSUserDefaults — available in all RN versions, no
    // extra package required. The key must match what Swift writes.
    const { SettingsManager } = NativeModules;
    const voipToken: string | undefined = SettingsManager?.settings?.gyw_voip_token;
    if (voipToken) {
      // Mirror into AsyncStorage so fcmTokenService Strategy 2 finds it.
      const AS = require('@react-native-async-storage/async-storage').default;
      void AS.setItem('gyw_voip_token', voipToken);
    }
  } catch (_) {
    // Non-fatal: fcmTokenService will fall back to react-native-voip-push-notification.
  }
}
if (typeof globalThis !== 'undefined') {
  (globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
}

// Improve actionable crash logs in Metro (Hermes sometimes logs only the message).
// This keeps behavior the same but prints stack traces when available.
try {
  const ErrorUtilsAny = (globalThis as any)?.ErrorUtils;
  if (ErrorUtilsAny?.setGlobalHandler && typeof ErrorUtilsAny.getGlobalHandler === 'function') {
    const prev = ErrorUtilsAny.getGlobalHandler();
    ErrorUtilsAny.setGlobalHandler((error: any, isFatal: boolean) => {
      try {
        const msg = error?.message ?? String(error);
        const stack = error?.stack ? `\n${error.stack}` : '';
        // eslint-disable-next-line no-console
        console.error(`[globalError] ${msg}${stack}`);
      } catch {}
      prev?.(error, isFatal);
    });
  }
} catch {}
