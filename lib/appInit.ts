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
import { InteractionManager, NativeModules, Platform } from 'react-native';

import { logAppEnvironment, logFirebaseIdentity } from '@/lib/debug/productionDiagnostics';
import { logBuildInfo } from '@/lib/debug/runtimeDiagnostics';
import { logGlobalFatalError, markAppStart } from '@/lib/perf/productionTelemetry';
import { initFirebaseMonitoring } from '@/lib/services/firebaseMonitoringInit';

if (__DEV__) {
  try {
    const { initNetworkAuditToolkit } = require('@/lib/debug/networkAudit/initNetworkAuditToolkit') as typeof import('@/lib/debug/networkAudit/initNetworkAuditToolkit');
    initNetworkAuditToolkit();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[appInit] network audit toolkit failed to load', e);
  }
}

void import('@/lib/auth/otpVerificationMethod')
  .then(({ ensurePlayIntegrityOtpMode }) => ensurePlayIntegrityOtpMode())
  .catch(() => {});

// Prevents Reanimated layout animations from corrupting the native view tree during
// fast navigation (e.g. chat → call screen) — IllegalViewOperationException on Android.
try {
  const { enableLayoutAnimations } = require('react-native-reanimated') as {
    enableLayoutAnimations: (enabled: boolean) => void;
  };
  enableLayoutAnimations(false);
} catch {
  /* non-fatal */
}

// Load before lib/firebase.ts so Android Phone Auth flags (see rnFirebase) apply first.
if (Platform.OS === 'android') {
  require('./rnFirebase');
  try {
    const { logAndroidAuthEnvironment } = require('./auth/androidAuthEnvironment') as typeof import('./auth/androidAuthEnvironment');
    logAndroidAuthEnvironment('AUTH_FIREBASE_APP');
    const { logRegisteredSha1Index } = require('./auth/googleServicesShaIndex') as typeof import('./auth/googleServicesShaIndex');
    logRegisteredSha1Index();
  } catch {
    /* non-fatal */
  }
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

markAppStart();
logBuildInfo();
logAppEnvironment();
initFirebaseMonitoring();

if (Platform.OS === 'android' || Platform.OS === 'ios') {
  InteractionManager.runAfterInteractions(() => {
    logFirebaseIdentity();
  });
}

if (Platform.OS === 'android' || Platform.OS === 'ios') {
  InteractionManager.runAfterInteractions(() => {
    try {
      const { prewarmWebRtcEngine } = require('@/lib/services/webrtcService') as typeof import('@/lib/services/webrtcService');
      prewarmWebRtcEngine();
    } catch {
      /* non-fatal — dev client may lack native WebRTC */
    }
  });
}

async function ensureFullScreenIntentPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const apiLevel = Platform.Version as number;
  if (apiLevel < 34) return;

  try {
    const mod = NativeModules.IncomingCallModule as
      | {
          checkFullScreenIntentPermission?: () => Promise<boolean>;
          requestFullScreenIntentPermission?: () => void;
        }
      | undefined;
    const granted = await mod?.checkFullScreenIntentPermission?.();
    if (granted === false) {
      mod?.requestFullScreenIntentPermission?.();
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[appInit] full-screen intent permission check failed', e);
    }
  }
}

InteractionManager.runAfterInteractions(() => {
  void ensureFullScreenIntentPermission();
});

try {
  const { initReliability } = require('@/lib/reliability/initReliability') as typeof import('@/lib/reliability/initReliability');
  InteractionManager.runAfterInteractions(() => {
    initReliability();
  });
} catch {
  /* non-fatal */
}

try {
  const rejectionHandler = (event: PromiseRejectionEvent | { reason?: unknown }) => {
    const reason = 'reason' in event ? event.reason : event;
    const { captureReliabilityError } = require('@/lib/reliability/SentryManager') as typeof import('@/lib/reliability/SentryManager');
    captureReliabilityError('network', reason, { source: 'unhandled_promise_rejection' });
  };
  if (typeof globalThis !== 'undefined' && 'addEventListener' in globalThis) {
    (globalThis as typeof globalThis & { addEventListener: (t: string, h: (e: PromiseRejectionEvent) => void) => void }).addEventListener(
      'unhandledrejection',
      rejectionHandler as (e: PromiseRejectionEvent) => void
    );
  }
} catch {
  /* non-fatal */
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
        const isStaleMetroBundle =
          __DEV__ &&
          (/Requiring unknown module "\d+"/.test(msg) ||
            /unknown module.+try restarting Metro/i.test(msg));
        if (isStaleMetroBundle) {
          // Stale Fast Refresh graph after many file edits — not an app bug. Reload fixes it.
          // eslint-disable-next-line no-console
          console.warn(
            `[globalError] ${msg} — Metro bundle is stale; press "r" in Metro or run: npx expo start --clear`
          );
        } else {
          // eslint-disable-next-line no-console
          console.error(`[globalError] ${msg}${stack}`);
          logGlobalFatalError(error);
        }
      } catch {}
      prev?.(error, isFatal);
    });
  }
} catch {}
